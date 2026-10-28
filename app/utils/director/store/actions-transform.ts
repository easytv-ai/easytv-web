/**
 * 对象与群众组的变换、命名、配色等属性改写
 * （复刻自 open-director 的 store/directorStore.ts，MIT）。
 */
import type { CharacterBodyType, DirectorCameraShot, DirectorObject, DirectorTransform } from '../schema'
import type { DirectorState } from './state'
import { getCameraTargetFromRigRotation } from '../camera-geometry'
import { getCrowdAnchorTransform, getCrowdMemberIds, roundTransformTuple, updateObjectById } from './objects'

/**
 * 整组移动、旋转、缩放群众。
 *
 * 面板上拖的是整组的锚点（成员位置的平均值），成员要保持彼此的相对站位：
 * - 位置：各自到锚点的偏移先按缩放比例放大，再绕锚点转过旋转增量，最后加到新锚点上
 * - 旋转：各自加上同一个旋转增量（而不是被统一设成同一个角度）
 * - 缩放：各自乘上同一个比例
 *
 * 旋转按 X→Y→Z 的顺序逐轴套用，和 three 默认的 XYZ 欧拉顺序一致。
 */
export function applyCrowdTransformPatch(
  objects: DirectorObject[],
  crowdId: string,
  patch: Partial<DirectorTransform>,
) {
  const anchor = getCrowdAnchorTransform(objects, crowdId)
  if (!anchor)
    return { objects, changedObjectIds: [] as string[] }

  const nextPosition = patch.position ?? anchor.position
  const nextRotation = patch.rotation ?? anchor.rotation
  const nextScale = patch.scale ?? anchor.scale

  const deltaRotation: [number, number, number] = [
    nextRotation[0] - anchor.rotation[0],
    nextRotation[1] - anchor.rotation[1],
    nextRotation[2] - anchor.rotation[2],
  ]
  // 锚点缩放为 0 时没法求比例，退回 1 倍，免得整组塌到一个点上
  const scaleRatio: [number, number, number] = [
    anchor.scale[0] === 0 ? 1 : nextScale[0] / anchor.scale[0],
    anchor.scale[1] === 0 ? 1 : nextScale[1] / anchor.scale[1],
    anchor.scale[2] === 0 ? 1 : nextScale[2] / anchor.scale[2],
  ]

  const changedObjectIds = getCrowdMemberIds(objects, crowdId)
  const changedIdSet = new Set(changedObjectIds)
  const [cosX, sinX] = [Math.cos(deltaRotation[0]), Math.sin(deltaRotation[0])]
  const [cosY, sinY] = [Math.cos(deltaRotation[1]), Math.sin(deltaRotation[1])]
  const [cosZ, sinZ] = [Math.cos(deltaRotation[2]), Math.sin(deltaRotation[2])]

  return {
    changedObjectIds,
    objects: objects.map((item) => {
      if (!changedIdSet.has(item.id))
        return item

      const offsetX = (item.transform.position[0] - anchor.position[0]) * scaleRatio[0]
      const offsetY = (item.transform.position[1] - anchor.position[1]) * scaleRatio[1]
      const offsetZ = (item.transform.position[2] - anchor.position[2]) * scaleRatio[2]

      // 绕 X
      const x1 = offsetX
      const y1 = offsetY * cosX - offsetZ * sinX
      const z1 = offsetY * sinX + offsetZ * cosX
      // 绕 Y
      const x2 = x1 * cosY + z1 * sinY
      const y2 = y1
      const z2 = -x1 * sinY + z1 * cosY
      // 绕 Z
      const x3 = x2 * cosZ - y2 * sinZ
      const y3 = x2 * sinZ + y2 * cosZ
      const z3 = z2

      return {
        ...item,
        transform: {
          position: roundTransformTuple([nextPosition[0] + x3, nextPosition[1] + y3, nextPosition[2] + z3]),
          rotation: roundTransformTuple([
            item.transform.rotation[0] + deltaRotation[0],
            item.transform.rotation[1] + deltaRotation[1],
            item.transform.rotation[2] + deltaRotation[2],
          ]),
          scale: roundTransformTuple([
            item.transform.scale[0] * scaleRatio[0],
            item.transform.scale[1] * scaleRatio[1],
            item.transform.scale[2] * scaleRatio[2],
          ]),
        },
      }
    }),
  }
}

/** 改单个对象的变换；对象是机位时，配套的机位数据也跟着走 */
export function updateObjectTransform(
  state: DirectorState,
  id: string,
  patch: Partial<DirectorTransform>,
): DirectorState {
  const current = state.project.objects.find(item => item.id === id)
  if (!current)
    return state

  const nextTransform: DirectorTransform = {
    position: patch.position ?? current.transform.position,
    rotation: patch.rotation ?? current.transform.rotation,
    scale: patch.scale ?? current.transform.scale,
  }

  const linkedCameraId = current.kind === 'camera' ? current.linkedCameraId : null

  return {
    ...state,
    project: {
      ...state.project,
      objects: updateObjectById(state.project.objects, id, item => ({ ...item, transform: nextTransform })),
      cameras: linkedCameraId
        ? state.project.cameras.map(camera =>
            camera.id === linkedCameraId
              ? applyCameraRigTransform(camera, nextTransform, patch)
              : camera)
        : state.project.cameras,
    },
  }
}

/**
 * 拖机身时：手动注视跟着平移，朝向不变；转 gizmo 时按新朝向重算注视点。
 * 锁着对象的机位只改机身，注视仍跟目标走。
 */
function applyCameraRigTransform(
  camera: DirectorCameraShot,
  nextTransform: DirectorTransform,
  patch: Partial<DirectorTransform>,
) {
  let target = camera.target
  let targetMode = camera.targetMode
  let targetObjectId = camera.targetObjectId

  if (patch.position && targetMode === 'manual') {
    target = roundTransformTuple([
      camera.target[0] + nextTransform.position[0] - camera.transform.position[0],
      camera.target[1] + nextTransform.position[1] - camera.transform.position[1],
      camera.target[2] + nextTransform.position[2] - camera.transform.position[2],
    ])
  }

  if (patch.rotation) {
    const distance = Math.hypot(
      target[0] - nextTransform.position[0],
      target[1] - nextTransform.position[1],
      target[2] - nextTransform.position[2],
    )
    target = getCameraTargetFromRigRotation(nextTransform.position, nextTransform.rotation, distance)
    targetMode = 'manual'
    targetObjectId = null
  }

  return { ...camera, transform: nextTransform, target, targetMode, targetObjectId }
}

export function updateCrowdTransform(
  state: DirectorState,
  crowdId: string,
  patch: Partial<DirectorTransform>,
): DirectorState {
  const next = applyCrowdTransformPatch(state.project.objects, crowdId, patch)
  if (!next.changedObjectIds.length)
    return state

  return { ...state, project: { ...state.project, objects: next.objects } }
}

export function updateObjectName(state: DirectorState, id: string, name: string): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: updateObjectById(state.project.objects, id, item => ({ ...item, name })),
    },
  }
}

/** 群众组改的是组名，成员各自的 name 不动 */
export function updateCrowdLabel(state: DirectorState, crowdId: string, label: string): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: state.project.objects.map(item =>
        item.crowdId === crowdId ? { ...item, crowdLabel: label } : item),
    },
  }
}

export function updateObjectColor(state: DirectorState, id: string, color: string): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: updateObjectById(state.project.objects, id, item => ({ ...item, color })),
    },
  }
}

export function updateCrowdColor(state: DirectorState, crowdId: string, color: string): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: state.project.objects.map(item => (item.crowdId === crowdId ? { ...item, color } : item)),
    },
  }
}

export function updateCharacterBodyType(
  state: DirectorState,
  id: string,
  bodyType: CharacterBodyType,
): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: updateObjectById(state.project.objects, id, item => ({ ...item, bodyType })),
    },
  }
}

/** 属性面板上的「整体缩放」滑杆：三轴同一个值 */
export function updateUniformScale(state: DirectorState, id: string, scale: number): DirectorState {
  return updateObjectTransform(state, id, { scale: roundTransformTuple([scale, scale, scale]) })
}

export function updateCrowdUniformScale(state: DirectorState, crowdId: string, scale: number): DirectorState {
  return updateCrowdTransform(state, crowdId, { scale: roundTransformTuple([scale, scale, scale]) })
}

export function toggleObjectVisible(state: DirectorState, id: string): DirectorState {
  return toggleObjectsVisible(state, [id])
}

export function toggleObjectLocked(state: DirectorState, id: string): DirectorState {
  return toggleObjectsLocked(state, [id])
}

/**
 * 一批对象一起切可见 / 锁定。群众组点一行就要整组变，
 * 已经全开就全关，有一个关着就全开 —— 和大纲里常见的写法一样。
 */
export function toggleObjectsVisible(state: DirectorState, ids: string[]): DirectorState {
  return toggleObjectsFlag(state, ids, 'visible')
}

export function toggleObjectsLocked(state: DirectorState, ids: string[]): DirectorState {
  return toggleObjectsFlag(state, ids, 'locked')
}

function toggleObjectsFlag(state: DirectorState, ids: string[], key: 'visible' | 'locked'): DirectorState {
  const selected = new Set(ids)
  const members = state.project.objects.filter(item => selected.has(item.id))
  if (!members.length)
    return state
  const nextValue = !members.every(item => item[key])
  return {
    ...state,
    project: {
      ...state.project,
      objects: state.project.objects.map(item =>
        selected.has(item.id) ? { ...item, [key]: nextValue } : item),
    },
  }
}
