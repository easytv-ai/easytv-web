/**
 * 运镜路径的求值（复刻自 open-director 的 camera/cameraPath.ts，MIT）。
 *
 * 一条运镜路径 = 一串节点（某一刻的机位姿态）+ 节点之间的运动段。
 * 段负责"怎么从上一个节点走到下一个"：走多久、用什么缓动、走直线还是贝塞尔曲线、
 * 到了之后停多久（holdAfter）。时间轴上任意时刻的相机姿态都由这里算出来。
 *
 * 整份是纯函数，只依赖 three 的数学类型，不碰状态也不碰渲染。
 */
import { CubicBezierCurve3, Matrix4, Quaternion, Vector3 } from 'three'
import type { CameraNode, CameraSegment, CameraSegmentEasing } from './schema'

/** 段的最小时长：再短就没法拖动调节了，也会让插值的分母趋近 0 */
export const MIN_SEGMENT_DURATION = 0.1

/** 贝塞尔默认控制柄放在直线的三等分点上 */
const HANDLE_T = 1 / 3

/** 段 id 由两端节点 id 派生，这样节点增删后重建段时能按 id 认回旧设置 */
export function getSegmentId(fromNodeId: string, toNodeId: string) {
  return `${fromNodeId}:${toNodeId}`
}

/**
 * 按节点顺序重建段列表：同 id 的老段保留用户调过的设置，新段给默认值。
 * 新段的时长由两个节点的时间差推出来，兜底到最小时长。
 */
export function buildCameraSegments(nodes: CameraNode[], existing: CameraSegment[] = []): CameraSegment[] {
  const existingById = new Map(existing.map(segment => [segment.id, segment]))
  const segments: CameraSegment[] = []

  for (let index = 0; index < nodes.length - 1; index++) {
    const fromNode = nodes[index]!
    const toNode = nodes[index + 1]!
    const id = getSegmentId(fromNode.id, toNode.id)
    const previous = existingById.get(id)

    if (previous) {
      segments.push({ ...previous, id, fromNodeId: fromNode.id, toNodeId: toNode.id })
      continue
    }

    segments.push({
      id,
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      curveMode: 'linear',
      duration: Number(Math.max(toNode.time - fromNode.time, MIN_SEGMENT_DURATION).toFixed(6)),
      holdAfter: 0,
      easing: 'linear',
    })
  }

  return segments
}

/** 各节点在时间轴上的起始时间；节点数组顺序就是路径顺序 */
export function getNodeStartTimes(nodes: CameraNode[], segments: CameraSegment[]): number[] {
  const times: number[] = [nodes[0]?.time ?? 0]

  for (let index = 1; index < nodes.length; index++) {
    const previous = segments[index - 1]
    const previousTime = times[index - 1]!
    times.push(Number((previousTime + (previous?.duration ?? 1) + (previous?.holdAfter ?? 0)).toFixed(6)))
  }

  return times
}

export function getCameraPathDuration(nodes: CameraNode[], segments: CameraSegment[]): number {
  if (!nodes.length)
    return 0
  // 末节点的起始时间就是总长：它已经累计了前面所有段的 duration + holdAfter
  const startTimes = getNodeStartTimes(nodes, segments)
  return startTimes[startTimes.length - 1]!
}

export function applyEasing(t: number, easing: CameraSegmentEasing): number {
  if (easing === 'ease-in')
    return t * t
  if (easing === 'ease-out')
    return 1 - (1 - t) * (1 - t)
  if (easing === 'ease-in-out')
    return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
  return t
}

export function lerpFov(from: number, to: number, t: number) {
  return from + (to - from) * t
}

function nodePose(node: CameraNode) {
  return {
    position: new Vector3(...node.position),
    rotation: new Quaternion(...node.rotation).normalize(),
    fov: node.fov,
  }
}

function evaluateSegment(fromNode: CameraNode, toNode: CameraNode, segment: CameraSegment, localTime: number) {
  const from = nodePose(fromNode)
  const to = nodePose(toNode)
  const rawT = Math.min(Math.max(localTime / segment.duration, 0), 1)
  const t = applyEasing(rawT, segment.easing)

  const position = segment.curveMode === 'bezier' && segment.handleOut && segment.handleIn
    ? new CubicBezierCurve3(
        from.position,
        new Vector3(...segment.handleOut),
        new Vector3(...segment.handleIn),
        to.position,
      ).getPoint(t)
    : from.position.clone().lerp(to.position, t)

  // 朝向用球面插值，欧拉角插值会在接近极点时抽风
  return {
    position,
    rotation: from.rotation.clone().slerp(to.rotation, t),
    fov: lerpFov(from.fov, to.fov, t),
  }
}

export interface CameraPathPose {
  position: Vector3
  rotation: Quaternion
  fov: number
}

/**
 * 求时间轴上任意时刻的相机姿态。
 * 段内按缓动插值，holdAfter 期间停在段末姿态，时间越界就钳到路径两端。
 */
export function evaluateCameraPath(
  nodes: CameraNode[],
  segments: CameraSegment[],
  time: number,
): CameraPathPose | null {
  if (!nodes.length)
    return null
  if (nodes.length === 1)
    return nodePose(nodes[0]!)

  const startTimes = getNodeStartTimes(nodes, segments)
  const total = getCameraPathDuration(nodes, segments)
  const clampedTime = Math.min(Math.max(time, 0), total)

  let segmentIndex = segments.length - 1
  for (let index = 0; index < segments.length; index++) {
    if (clampedTime < startTimes[index + 1]!) {
      segmentIndex = index
      break
    }
  }

  const segment = segments[segmentIndex]!
  const fromNode = nodes[segmentIndex]!
  const toNode = nodes[segmentIndex + 1]!
  const localTime = clampedTime - startTimes[segmentIndex]!
  const pose = evaluateSegment(fromNode, toNode, segment, Math.min(localTime, segment.duration))

  // 落在 hold 阶段（或钳在段末）时直接用终点姿态，避免缓动带来的微小偏差
  if (localTime >= segment.duration) {
    pose.position.set(...toNode.position)
    pose.rotation.copy(new Quaternion(...toNode.rotation).normalize())
    pose.fov = toNode.fov
  }

  return pose
}

/** 拖时间轴上的节点时把时间钳住：不越过相邻节点的 hold 边界，也不让段短于最小时长 */
export function clampNodeTime(
  nodes: CameraNode[],
  segments: CameraSegment[],
  index: number,
  time: number,
): number {
  const previous = index > 0 ? segments[index - 1] : null
  const next = index < segments.length ? segments[index] : null
  const minTime = index === 0
    ? 0
    : nodes[index - 1]!.time + (previous?.holdAfter ?? 0) + MIN_SEGMENT_DURATION
  const maxTime = index === nodes.length - 1
    ? Number.POSITIVE_INFINITY
    : nodes[index + 1]!.time - (next?.holdAfter ?? 0) - MIN_SEGMENT_DURATION

  return Number(Math.min(Math.max(time, minTime), maxTime).toFixed(6))
}

/** 直线转曲线时的默认控制柄：放在三等分点上，视觉上还是直线，拖了才弯 */
export function getDefaultBezierHandles(from: [number, number, number], to: [number, number, number]) {
  const start = new Vector3(...from)
  const end = new Vector3(...to)
  const delta = end.clone().sub(start)

  return {
    handleOut: [
      start.x + delta.x * HANDLE_T,
      start.y + delta.y * HANDLE_T,
      start.z + delta.z * HANDLE_T,
    ] as [number, number, number],
    handleIn: [
      end.x - delta.x * HANDLE_T,
      end.y - delta.y * HANDLE_T,
      end.z - delta.z * HANDLE_T,
    ] as [number, number, number],
  }
}

/** 由视点和注视点构造朝向四元数，新建节点时用 */
export function getLookAtQuaternion(
  position: [number, number, number],
  target: [number, number, number],
): Quaternion {
  const origin = new Vector3(...position)
  const direction = new Vector3(...target).sub(origin)
  if (direction.lengthSq() === 0)
    return new Quaternion()

  const forward = direction.normalize()
  // 视线几乎垂直时 up 会和它共线，换一根参考轴顶住
  const up = Math.abs(forward.y) > 0.999 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const matrix = new Matrix4().lookAt(origin, origin.clone().sub(forward), up)

  return new Quaternion().setFromRotationMatrix(matrix)
}

/** 段在导演视角里画成线时的采样点；直线段只要两端 */
export function getSegmentRenderPoints(
  fromNode: CameraNode,
  toNode: CameraNode,
  segment: CameraSegment,
  samples = 32,
): Array<[number, number, number]> {
  if (segment.curveMode !== 'bezier' || !segment.handleOut || !segment.handleIn)
    return [fromNode.position, toNode.position]

  const curve = new CubicBezierCurve3(
    new Vector3(...fromNode.position),
    new Vector3(...segment.handleOut),
    new Vector3(...segment.handleIn),
    new Vector3(...toNode.position),
  )

  return curve.getPoints(samples - 1).map(point => [point.x, point.y, point.z] as [number, number, number])
}
