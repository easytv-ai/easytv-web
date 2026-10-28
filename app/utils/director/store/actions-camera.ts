/**
 * 机位与运镜相关动作（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 这里最容易出岔子的是「三份数据要对齐」：
 * - project.cameras 里的机位本体（fov / transform / target / 节点 / 段）
 * - project.objects 里那个同名的机位对象（场景树里能选中、能拖的那个）
 * - 运镜节点的 time 与段表的 duration + holdAfter
 *
 * 任何一处改了，另外两处都得跟着走，否则视角、线框、时间轴会各说各话。
 */
import { Euler, Quaternion, Vector3 } from 'three'
import type { CameraNode, CameraSegment, DirectorCameraShot, DirectorTransform } from '../schema'
import {
  buildCameraSegments,
  clampNodeTime,
  getDefaultBezierHandles,
  getNodeStartTimes,
  MIN_SEGMENT_DURATION,
} from '../camera-path'
import { getLookAtQuaternion } from '../camera-path'
import {
  getCameraRigPositionFromViewSnapshot,
  getCameraViewSnapshotFromShot,
  VIEWPORT_CAMERA_FRUSTUM_DEPTH,
} from '../camera-geometry'
import { getNextSceneItemIndex, getNextSequentialId, roundTransformTuple } from './objects'
import { formatSceneItemName } from '../default-project'
import type { DirectorState } from './state'

export interface CameraPoseInput {
  position: [number, number, number]
  rotation: [number, number, number, number]
  fov: number
}

/**
 * 四元数转欧拉角。必须走 three 的 Euler：它默认是 XYZ 顺序，
 * 自己手写的 roll/pitch/yaw 公式是 ZYX，两者在非小角度下结果不同，
 * 机位一转就会歪。
 */
function eulerFromQuaternion(quaternion: [number, number, number, number]): [number, number, number] {
  const euler = new Euler().setFromQuaternion(new Quaternion(...quaternion))
  return roundTransformTuple([euler.x, euler.y, euler.z])
}

/** 用段表反推各节点时间，保证 node.time 和 duration + holdAfter 始终一致 */
export function syncNodeTimes(nodes: CameraNode[], segments: CameraSegment[]): CameraNode[] {
  const startTimes = getNodeStartTimes(nodes, segments)
  return nodes.map((node, index) => (node.time === startTimes[index] ? node : { ...node, time: startTimes[index]! }))
}

/** 节点变了之后重建段表（同 id 的段保留设置）并对齐节点时间 */
export function rebuildCameraTiming(camera: DirectorCameraShot): DirectorCameraShot {
  if (!camera.nodes || camera.nodes.length < 2)
    return camera.segments ? { ...camera, segments: [] } : camera

  const segments = buildCameraSegments(camera.nodes, camera.segments)
  return { ...camera, segments, nodes: syncNodeTimes(camera.nodes, segments) }
}

/**
 * 把一个相机姿态写回机位。
 *
 * 传进来的是**取景位置**（真正出画面的那个点），但机位存的是机身位置，
 * 两者差一个视锥深度，所以要沿朝向往后退一段。注视点按原来的距离沿新朝向重算；
 * 如果这个机位是"锁定某个对象"模式，注视点改用那个对象的焦点，不被姿态覆盖。
 */
export function applyCameraPose(
  state: DirectorState,
  cameraId: string,
  input: CameraPoseInput,
  nodes: CameraNode[] | undefined,
  focusTargetOf?: (objectId: string) => [number, number, number] | null,
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera)
    return state

  const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...input.rotation))
  const viewPosition = new Vector3(...input.position)
  // 保持原来的注视距离，免得转个方向注视点就贴到脸上
  const radius = Math.max(viewPosition.distanceTo(new Vector3(...camera.target)), 0.001)
  const nextTarget = viewPosition.clone().add(forward.clone().multiplyScalar(radius))

  const tracked = camera.targetMode === 'object' && camera.targetObjectId && focusTargetOf
    ? focusTargetOf(camera.targetObjectId)
    : null

  const rigPosition = viewPosition.clone().sub(forward.clone().multiplyScalar(VIEWPORT_CAMERA_FRUSTUM_DEPTH))
  const transform: DirectorTransform = {
    position: roundTransformTuple([rigPosition.x, rigPosition.y, rigPosition.z]),
    rotation: eulerFromQuaternion(input.rotation),
    scale: [1, 1, 1],
  }

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item =>
        item.id === cameraId
          ? {
              ...item,
              nodes,
              fov: input.fov,
              transform,
              target: tracked ?? roundTransformTuple([nextTarget.x, nextTarget.y, nextTarget.z]),
            }
          : item),
      // 场景树里的机位对象跟着走，否则线框会留在原地
      objects: state.project.objects.map(item =>
        item.kind === 'camera' && item.linkedCameraId === cameraId ? { ...item, transform } : item),
    },
  }
}

export function setActiveCamera(state: DirectorState, cameraId: string): DirectorState {
  return { ...state, project: { ...state.project, activeCameraId: cameraId } }
}

/** 掌镜时按 K：在当前机位的路径末尾追加一个节点，并把机位姿态同步过去 */
export function recordCameraNode(
  state: DirectorState,
  cameraId: string,
  input: CameraPoseInput,
  focusTargetOf?: (objectId: string) => [number, number, number] | null,
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera)
    return state

  const existing = camera.nodes ?? []
  const lastNode = existing[existing.length - 1]
  const lastSegment = camera.segments?.[camera.segments.length - 1]
  // 新节点接在上一个节点之后：走完上一段的时长再加它的停顿
  const nextTime = lastNode
    ? lastNode.time + (lastSegment?.duration ?? 1) + (lastSegment?.holdAfter ?? 0)
    : 0

  const nextNodes: CameraNode[] = [
    ...existing,
    {
      id: getNextSequentialId(existing.map(item => item.id), 'node_', existing.length + 1),
      position: input.position,
      rotation: input.rotation,
      fov: input.fov,
      time: Number(nextTime.toFixed(6)),
    },
  ]

  const nextCamera = rebuildCameraTiming({ ...camera, nodes: nextNodes })
  const withCamera: DirectorState = {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item => (item.id === cameraId ? nextCamera : item)),
    },
  }

  return applyCameraPose(withCamera, cameraId, input, nextCamera.nodes, focusTargetOf)
}

/** 掌镜过程中持续同步姿态，但不新增节点 */
export function syncCameraPose(
  state: DirectorState,
  cameraId: string,
  input: CameraPoseInput,
  focusTargetOf?: (objectId: string) => [number, number, number] | null,
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera)
    return state
  return applyCameraPose(state, cameraId, input, camera.nodes, focusTargetOf)
}

/**
 * 拖时间轴上的节点。
 * 拖的是「前一段走多久」，停顿不动；时间会被钳在相邻节点的边界内。
 */
export function updateCameraNodeTime(
  state: DirectorState,
  cameraId: string,
  nodeId: string,
  time: number,
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera?.nodes)
    return state

  const index = camera.nodes.findIndex(node => node.id === nodeId)
  if (index < 0)
    return state

  const segments = buildCameraSegments(camera.nodes, camera.segments)
  const clamped = clampNodeTime(camera.nodes, segments, index, time)
  if (clamped === camera.nodes[index]!.time)
    return state

  const nodes = camera.nodes.map((node, i) => (i === index ? { ...node, time: clamped } : node))
  const nextSegments = segments.map((segment, i) => {
    if (i !== index - 1)
      return segment
    const previousNode = nodes[index - 1]!
    return {
      ...segment,
      duration: Number(Math.max(clamped - previousNode.time - segment.holdAfter, MIN_SEGMENT_DURATION).toFixed(6)),
    }
  })

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item =>
        item.id === cameraId
          ? { ...item, nodes: syncNodeTimes(nodes, nextSegments), segments: nextSegments }
          : item),
    },
  }
}

export function updateCameraNode(
  state: DirectorState,
  cameraId: string,
  nodeId: string,
  patch: Partial<Omit<CameraNode, 'id'>>,
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera?.nodes)
    return state

  const nodes = camera.nodes.map(node => (node.id === nodeId ? { ...node, ...patch } : node))
  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item =>
        item.id === cameraId ? rebuildCameraTiming({ ...camera, nodes }) : item),
    },
  }
}

export function deleteCameraNode(state: DirectorState, cameraId: string, nodeId: string): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera?.nodes)
    return state

  const nextNodes = camera.nodes.filter(node => node.id !== nodeId)
  if (nextNodes.length === camera.nodes.length)
    return state

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item =>
        item.id === cameraId ? rebuildCameraTiming({ ...camera, nodes: nextNodes }) : item),
    },
  }
}

export function updateCameraSegment(
  state: DirectorState,
  cameraId: string,
  segmentId: string,
  patch: Partial<Omit<CameraSegment, 'id' | 'fromNodeId' | 'toNodeId'>>,
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera?.nodes)
    return state

  const segments = buildCameraSegments(camera.nodes, camera.segments).map(segment =>
    segment.id === segmentId ? { ...segment, ...patch } : segment)

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item =>
        item.id === cameraId
          ? { ...item, segments, nodes: syncNodeTimes(camera.nodes!, segments) }
          : item),
    },
  }
}

/** 直线转曲线时补一组默认控制柄，视觉上还是直线，用户拖了才弯 */
export function setSegmentCurveMode(
  state: DirectorState,
  cameraId: string,
  segmentId: string,
  mode: CameraSegment['curveMode'],
): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera?.nodes)
    return state

  const segments = buildCameraSegments(camera.nodes, camera.segments).map((segment) => {
    if (segment.id !== segmentId)
      return segment

    if (mode !== 'bezier')
      return { ...segment, curveMode: mode }

    const fromNode = camera.nodes!.find(node => node.id === segment.fromNodeId)
    const toNode = camera.nodes!.find(node => node.id === segment.toNodeId)
    if (!fromNode || !toNode)
      return segment

    const handles = getDefaultBezierHandles(fromNode.position, toNode.position)
    return { ...segment, curveMode: mode, ...handles }
  })

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item => (item.id === cameraId ? { ...item, segments } : item)),
    },
  }
}

export function updateCamera(
  state: DirectorState,
  cameraId: string,
  patch: Partial<Omit<DirectorCameraShot, 'id'>>,
): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item => (item.id === cameraId ? { ...item, ...patch } : item)),
    },
  }
}

/** 机位截图追加进列表，编号接着往下排 */
export function addCameraCaptures(
  state: DirectorState,
  cameraId: string | null | undefined,
  dataUrls: string[],
): DirectorState {
  const targetId = cameraId ?? state.project.activeCameraId
  if (!targetId || !dataUrls.length)
    return state

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map((item) => {
        if (item.id !== targetId)
          return item
        const captures = item.captures ?? []
        const added = dataUrls.map((dataUrl, offset) => {
          const index = captures.length + offset + 1
          return {
            id: `${item.id}_capture_${index}`,
            index,
            name: `${item.name}-截图${String(index).padStart(2, '0')}`,
            dataUrl,
          }
        })
        return { ...item, captures: [...captures, ...added], lastCaptureUrl: added[added.length - 1]?.dataUrl ?? item.lastCaptureUrl }
      }),
    },
  }
}

/**
 * 删掉一张机位截图。
 *
 * 不挑机位：截图 id 在整个场景里唯一，面板的「全部截图」页可以跨机位删，
 * 让调用方先找出是哪个机位的只会把这段逻辑抄两份。
 *
 * lastCaptureUrl 跟着重算 —— 它是机位缩略图的取值来源，删掉最后一张之后
 * 不更新的话，缩略图会一直指着一张已经不存在的图。
 */
export function deleteCameraCapture(state: DirectorState, captureId: string): DirectorState {
  const owner = state.project.cameras.find(item => (item.captures ?? []).some(capture => capture.id === captureId))
  if (!owner)
    return state

  const captures = (owner.captures ?? []).filter(item => item.id !== captureId)

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item => (item.id === owner.id
        ? { ...item, captures, lastCaptureUrl: captures[captures.length - 1]?.dataUrl ?? null }
        : item)),
    },
  }
}

/** 清空所有机位的截图 */
export function clearCameraCaptures(state: DirectorState): DirectorState {
  const hasAny = state.project.cameras.some(item => (item.captures ?? []).length > 0 || item.lastCaptureUrl)
  // 本来就是空的就原样返回，不占一步撤销
  if (!hasAny)
    return state

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item => ({ ...item, captures: [], lastCaptureUrl: null })),
    },
  }
}

/**
 * 在时间轴上加一个运镜节点（复刻自 open-director 的 addCameraNode，MIT）。
 *
 * 两种加法：
 * - 不传 afterNodeId：接在末尾，取机位当前的取景姿态 —— 就是「摆好机位再点一下」。
 * - 传了：插在那个节点后面，姿态取前后两个节点的中点（旋转用 slerp，不能对
 *   四元数逐分量求平均，那样插出来的朝向是歪的）。
 *
 * 插在中间时旧段的设置要拆给新的两段：缓动两段都继承，停顿只给后一段 ——
 * 停顿在语义上属于「到了终点之后停一下」，跟着终点走。后一段的时长要把
 * 停顿扣掉，不然整条路径凭空变长。
 */
export function addCameraNode(state: DirectorState, cameraId: string, afterNodeId?: string): DirectorState {
  const camera = state.project.cameras.find(item => item.id === cameraId)
  if (!camera)
    return state

  const nodes = camera.nodes ?? []
  const insertIndex = afterNodeId
    ? nodes.findIndex(node => node.id === afterNodeId) + 1
    : nodes.length

  // findIndex 没找到会得到 0，那是「插在最前面」，不是调用方的意思
  if (afterNodeId && insertIndex === 0)
    return state
  if (insertIndex < 0 || insertIndex > nodes.length)
    return state

  const nodeId = getNextSequentialId(nodes.map(item => item.id), 'node_', nodes.length + 1)
  const previous = nodes[insertIndex - 1] ?? null
  const next = nodes[insertIndex] ?? null
  const segments = buildCameraSegments(nodes, camera.segments)

  if (previous && next) {
    const oldSegment = segments[insertIndex - 1]
    const midRotation = new Quaternion(...previous.rotation).normalize()
      .slerp(new Quaternion(...next.rotation).normalize(), 0.5)

    const inserted: CameraNode = {
      id: nodeId,
      position: [
        (previous.position[0] + next.position[0]) / 2,
        (previous.position[1] + next.position[1]) / 2,
        (previous.position[2] + next.position[2]) / 2,
      ],
      rotation: [midRotation.x, midRotation.y, midRotation.z, midRotation.w],
      fov: (previous.fov + next.fov) / 2,
      time: clampNodeTime(nodes, segments, insertIndex, (previous.time + next.time) / 2),
    }

    const nextNodes = [...nodes.slice(0, insertIndex), inserted, ...nodes.slice(insertIndex)]
    const inheritedHold = oldSegment?.holdAfter ?? 0
    const mergedSegments = buildCameraSegments(nextNodes, segments).map((segment, index) => {
      // 前半段：继承缓动，停顿归零（停顿跟着旧的终点节点走）
      if (index === insertIndex - 1)
        return { ...segment, easing: oldSegment?.easing ?? 'linear' as const, holdAfter: 0 }
      // 后半段：继承缓动和停顿，时长把停顿扣掉，总长度才不变
      if (index === insertIndex) {
        return {
          ...segment,
          easing: oldSegment?.easing ?? 'linear' as const,
          holdAfter: inheritedHold,
          duration: Number(Math.max(segment.duration - inheritedHold, MIN_SEGMENT_DURATION).toFixed(6)),
        }
      }
      return segment
    })

    return {
      ...state,
      project: {
        ...state.project,
        cameras: state.project.cameras.map(item => (item.id === cameraId
          ? { ...camera, nodes: syncNodeTimes(nextNodes, mergedSegments), segments: mergedSegments }
          : item)),
      },
    }
  }

  // 追加：取机位当前的取景姿态（取景点，不是机身位置）
  const snapshot = getCameraViewSnapshotFromShot(camera)
  const rotation = getLookAtQuaternion(snapshot.position, snapshot.target)
  const lastSegment = segments[segments.length - 1]
  const appended: CameraNode = {
    id: nodeId,
    position: snapshot.position,
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    fov: camera.fov,
    time: previous
      ? Number((previous.time + (lastSegment?.duration ?? 1) + (lastSegment?.holdAfter ?? 0)).toFixed(6))
      : 0,
  }

  return {
    ...state,
    project: {
      ...state.project,
      cameras: state.project.cameras.map(item => (item.id === cameraId
        ? rebuildCameraTiming({ ...camera, nodes: [...nodes, appended] })
        : item)),
    },
  }
}

export interface AddCameraShotInput {
  /** 取景位置（真正出画面的那个点，不是机身位置） */
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  name?: string
}

/**
 * 新建一台机位（复刻自 open-director 的 addCameraShot，MIT）。
 *
 * 机位是成对的：cameras 里的本体负责取景参数，objects 里还有个同名对象，
 * 场景树里能选中、视口里能拖。只建一半的话，新机位在树里根本看不见。
 *
 * 传进来的是取景点，存的是机身位置，两者差一个视锥深度。
 */
export function addCameraShot(state: DirectorState, input: AddCameraShotInput): {
  state: DirectorState
  cameraId: string
} {
  const cameraId = getNextSequentialId(state.project.cameras.map(item => item.id), 'cam_', 1)
  const name = input.name?.trim()
    || formatSceneItemName('机位', getNextSceneItemIndex(state.project.objects, 'camera') + 1)

  const rigPosition = getCameraRigPositionFromViewSnapshot({
    position: input.position,
    target: input.target,
    fov: input.fov,
  })
  const rotation = eulerFromQuaternion(
    (() => {
      const quaternion = getLookAtQuaternion(input.position, input.target)
      return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
    })(),
  )
  const transform: DirectorTransform = {
    position: roundTransformTuple(rigPosition),
    rotation,
    scale: [1, 1, 1],
  }

  const camera: DirectorCameraShot = {
    id: cameraId,
    name,
    fov: input.fov,
    transform,
    targetMode: 'manual',
    target: roundTransformTuple(input.target),
    lastCaptureUrl: null,
    captures: [],
  }

  const cameraObject = {
    id: getNextSequentialId(state.project.objects.map(item => item.id), 'cam_object_', 1),
    name,
    kind: 'camera' as const,
    visible: true,
    locked: false,
    linkedCameraId: cameraId,
    transform,
  }

  return {
    cameraId,
    state: {
      ...state,
      project: {
        ...state.project,
        cameras: [...state.project.cameras, camera],
        objects: [...state.project.objects, cameraObject],
        // 新建的机位直接设为当前，建完就能切过去看
        activeCameraId: cameraId,
      },
    },
  }
}
