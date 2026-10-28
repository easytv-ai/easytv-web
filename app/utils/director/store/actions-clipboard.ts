/**
 * 复制粘贴（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 粘贴不是简单克隆一份：id、机位、群众组、注视目标都要重新接线，
 * 否则两个对象共用一个 id，或者粘出来的机位还盯着原件。
 */
import type { DirectorCameraShot, DirectorObject, DirectorTransform } from '../schema'
import { formatSceneItemName } from '../default-project'
import { getNextSequentialId } from './objects'
import { getOrderedSelectedObjectIds } from './actions-selection'
import { cloneJsonValue } from './state'
import type { DirectorClipboardEntry, DirectorState } from './state'

/** 每粘一次往右下挪一点，连续粘贴不会叠在一起 */
const COPY_PASTE_POSITION_OFFSET = 0.6

function applyPositionOffset(position: [number, number, number], offset: number): [number, number, number] {
  return [position[0] + offset, position[1], position[2] + offset]
}

function applyOffsetToTransform(transform: DirectorTransform, offset: number): DirectorTransform {
  return { ...transform, position: applyPositionOffset(transform.position, offset) }
}

function getNextCrowdId(objects: DirectorObject[]) {
  return getNextSequentialId(
    objects.map(item => item.crowdId).filter((item): item is string => typeof item === 'string'),
    'crowd_',
    1,
  )
}

/** 复制件的 id 按来源类型分前缀，方便在场景树里一眼认出是粘出来的 */
function createObjectIdForDuplicate(existing: DirectorObject[], source: DirectorObject) {
  const ids = existing.map(item => item.id)

  if (source.kind === 'camera')
    return getNextSequentialId(ids, 'cam_object_', existing.filter(item => item.kind === 'camera').length + 1)
  if (source.kind === 'character')
    return getNextSequentialId(ids, 'char_paste_', existing.filter(item => item.kind === 'character').length + 1)
  if (source.geometryType)
    return getNextSequentialId(ids, `geo_${source.geometryType}_copy_`, existing.length + 1)

  return getNextSequentialId(ids, 'obj_', existing.length + 1)
}

/** 复制：连同机位本体一起存，粘贴时才有完整数据可复原 */
export function buildClipboardEntries(state: DirectorState): DirectorClipboardEntry[] {
  const selectedIds = getOrderedSelectedObjectIds(state)
  if (!selectedIds.length)
    return []

  return selectedIds.flatMap((objectId) => {
    const object = state.project.objects.find(item => item.id === objectId)
    if (!object)
      return []

    const camera = object.kind === 'camera' && object.linkedCameraId
      ? state.project.cameras.find(item => item.id === object.linkedCameraId)
      : undefined

    return [{
      object: cloneJsonValue(object),
      camera: camera ? cloneJsonValue(camera) : undefined,
    }]
  })
}

export interface PasteResult {
  state: DirectorState
  pasteCount: number
}

/**
 * 粘贴剪贴板内容。
 *
 * 要重新接的线有四处：
 * - 对象 id 全部换新，同一批里的引用按映射表跟着换
 * - 机位对象要连同机位本体一起复制，并重新绑定 linkedCameraId
 * - 群众组换新的 crowdId，整组粘过来还是一组，但和原组分开
 * - 机位的注视目标如果指向同一批里的对象就跟着换成复制件，
 *   指向批外已不存在的对象则退回手动模式
 */
export function pasteClipboardEntries(
  state: DirectorState,
  clipboard: DirectorClipboardEntry[],
  previousPasteCount: number,
  focusTargetOf?: (object: DirectorObject) => [number, number, number],
): PasteResult {
  if (!clipboard.length)
    return { state, pasteCount: previousPasteCount }

  const pasteCount = previousPasteCount + 1
  const offset = COPY_PASTE_POSITION_OFFSET * pasteCount
  const nextObjects = [...state.project.objects]
  const nextCameras = [...state.project.cameras]
  const idMap = new Map<string, string>()
  const crowdIdMap = new Map<string, string>()
  const pastedObjectIds: string[] = []

  function mapCrowdId(sourceCrowdId: string) {
    const existing = crowdIdMap.get(sourceCrowdId)
    if (existing)
      return existing
    const next = getNextCrowdId(nextObjects)
    crowdIdMap.set(sourceCrowdId, next)
    return next
  }

  for (const entry of clipboard) {
    if (entry.object.kind === 'camera' && entry.camera) {
      const cameraIndex = nextCameras.length + 1
      const nextCameraId = getNextSequentialId(nextCameras.map(item => item.id), 'cam_', cameraIndex)
      const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object)
      idMap.set(entry.object.id, nextObjectId)
      if (entry.object.linkedCameraId)
        idMap.set(entry.object.linkedCameraId, nextCameraId)

      const nextCamera: DirectorCameraShot = {
        ...entry.camera,
        id: nextCameraId,
        name: formatSceneItemName('机位', cameraIndex),
        transform: applyOffsetToTransform(entry.camera.transform, offset),
        // 手动注视点跟着一起挪，锁定对象的则保持不动
        target: entry.camera.targetMode === 'manual'
          ? applyPositionOffset(entry.camera.target, offset)
          : entry.camera.target,
        targetObjectId: entry.camera.targetObjectId ?? null,
        // 截图不跟着复制：那是原机位拍的，挂在复制件上会误导
        captures: [],
        lastCaptureUrl: null,
      }

      nextCameras.push(nextCamera)
      nextObjects.push({
        ...entry.object,
        id: nextObjectId,
        name: nextCamera.name,
        linkedCameraId: nextCamera.id,
        transform: nextCamera.transform,
        locked: false,
      })
      pastedObjectIds.push(nextObjectId)
      continue
    }

    const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object)
    idMap.set(entry.object.id, nextObjectId)
    const characterCount = entry.object.kind === 'character'
      ? nextObjects.filter(item => item.kind === 'character').length + 1
      : null

    nextObjects.push({
      ...entry.object,
      id: nextObjectId,
      name: characterCount ? formatSceneItemName('角色', characterCount) : entry.object.name,
      crowdId: entry.object.crowdId ? mapCrowdId(entry.object.crowdId) : entry.object.crowdId,
      transform: applyOffsetToTransform(entry.object.transform, offset),
      locked: false,
    })
    pastedObjectIds.push(nextObjectId)
  }

  const objectsById = new Map(nextObjects.map(item => [item.id, item]))
  const normalizedCameras = nextCameras.map((camera) => {
    if (camera.targetMode !== 'object' || !camera.targetObjectId)
      return camera

    const mappedId = idMap.get(camera.targetObjectId) ?? camera.targetObjectId
    const targetObject = objectsById.get(mappedId)
    if (!targetObject)
      return { ...camera, targetMode: 'manual' as const, targetObjectId: null }

    return {
      ...camera,
      targetObjectId: mappedId,
      target: focusTargetOf ? focusTargetOf(targetObject) : camera.target,
    }
  })

  const lastPasted = pastedObjectIds.length
    ? nextObjects.find(item => item.id === pastedObjectIds[pastedObjectIds.length - 1])
    : null
  const pastedCrowdIds = [...new Set(
    pastedObjectIds
      .map(id => objectsById.get(id)?.crowdId)
      .filter((id): id is string => typeof id === 'string'),
  )]

  return {
    pasteCount,
    state: {
      ...state,
      selectedObjectId: pastedObjectIds[pastedObjectIds.length - 1] ?? null,
      selectedObjectIds: pastedObjectIds,
      // 整批都属于同一个群众组时才认为选中了组
      selectedCrowdId: pastedCrowdIds.length === 1 ? pastedCrowdIds[0]! : null,
      directorInspectorMode: 'auto',
      project: {
        ...state.project,
        objects: nextObjects,
        cameras: normalizedCameras,
        activeCameraId: lastPasted?.kind === 'camera'
          ? lastPasted.linkedCameraId ?? state.project.activeCameraId
          : state.project.activeCameraId,
      },
    },
  }
}

/** 从外部整份载入场景（导入工程、从后端拉回来） */
export function replaceProject(state: DirectorState, project: DirectorState['project']): DirectorState {
  return {
    ...state,
    project: cloneJsonValue(project),
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedCrowdId: null,
    directorInspectorMode: 'auto',
  }
}
