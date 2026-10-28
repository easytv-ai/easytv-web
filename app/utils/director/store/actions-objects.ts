/**
 * 往场景里加对象、删对象（复刻自 open-director 的 store/directorStore.ts，MIT）。
 */
import type {
  CharacterBodyType,
  CharacterRigType,
  DirectorAssetKind,
  DirectorAssetRef,
  DirectorObject,
  GeometryPrimitiveType,
} from '../schema'
import { GEOMETRY_PRIMITIVE_OPTIONS } from '../schema'
import { createTransform, DEFAULT_CHARACTER_BODY_TYPE, formatSceneItemName } from '../default-project'
import { importedModelDisplayName } from '../imported-model'
import { bindLookOnProject, clearLookOnProject, type CharacterLookInput } from '../character-look'

export type { CharacterLookInput }
import { getCrowdAnchorTransform, getCrowdMemberIds, getNextCharacterColor, getNextSequentialId } from './objects'
import { getOrderedSelectedObjectIds } from './actions-selection'
import type { DirectorState } from './state'

const GEOMETRY_PRIMITIVE_COLOR = '#d7e7ff'
/** 新加的模型在世界里左右岔开的间距 */
const ADDED_MODEL_WORLD_SPACING = 1.25

/**
 * 新对象左右交替摆：第 1 个在左、第 2 个在右、第 3 个更左……
 * 这样连加几个不会叠在一起，也不会一路往一个方向跑远。
 */
export function getAddedModelColumnOffset(index: number) {
  const side = index % 2 === 1 ? -1 : 1
  const step = Math.ceil(index / 2)
  return side * step * ADDED_MODEL_WORLD_SPACING
}

export function getGeometryPrimitiveLabel(geometryType: GeometryPrimitiveType) {
  return GEOMETRY_PRIMITIVE_OPTIONS.find(item => item.type === geometryType)?.label ?? geometryType
}

/** 群众阵列的站位：以整组中心为原点铺成 rows × columns 的网格 */
export function getCrowdCharacterPositions(rows: number, columns: number, spacing: number) {
  const safeRows = Math.max(1, rows)
  const safeColumns = Math.max(1, columns)
  const safeSpacing = Math.max(0.1, spacing)
  const xOffset = ((safeColumns - 1) * safeSpacing) / 2
  const zOffset = ((safeRows - 1) * safeSpacing) / 2
  const positions: Array<[number, number, number]> = []

  for (let row = 0; row < safeRows; row++) {
    for (let column = 0; column < safeColumns; column++) {
      positions.push([
        Number((column * safeSpacing - xOffset).toFixed(4)),
        0,
        Number((row * safeSpacing - zOffset).toFixed(4)),
      ])
    }
  }

  return positions
}

function buildCharacterObject(
  state: DirectorState,
  bodyType: CharacterBodyType,
  position: [number, number, number],
  crowd?: { crowdId: string, crowdLabel: string },
): DirectorObject {
  const characterIndex = state.project.objects.filter(item => item.kind === 'character').length + 1
  const id = getNextSequentialId(state.project.objects.map(item => item.id), 'char_preset_', characterIndex)

  return {
    id,
    name: formatSceneItemName('角色', characterIndex),
    kind: 'character',
    visible: true,
    locked: false,
    bodyType,
    color: getNextCharacterColor(state.project.objects),
    transform: createTransform(position),
    characterRig: { rigType: 'ue4-mannequin', posePresetId: 'stand', controls: {} },
    ...(crowd ?? {}),
  }
}

/** 加一个预置角色，落点按已有预置角色的数量左右岔开、四个一排往后退 */
export function addPresetCharacter(
  state: DirectorState,
  bodyType: CharacterBodyType = DEFAULT_CHARACTER_BODY_TYPE,
): DirectorState {
  const presetCount = state.project.objects.filter(
    item => item.kind === 'character' && item.id.startsWith('char_preset_'),
  ).length
  const index = presetCount + 1
  const row = Math.floor((index - 1) / 4)
  const position: [number, number, number] = [getAddedModelColumnOffset(index - row * 4), 0, row * 0.8]
  const next = buildCharacterObject(state, bodyType, position)

  return {
    ...state,
    selectedObjectId: next.id,
    selectedObjectIds: [next.id],
    selectedCrowdId: null,
    directorInspectorMode: 'auto',
    project: { ...state.project, objects: [...state.project.objects, next] },
  }
}

export interface CrowdCharactersInput {
  bodyType?: CharacterBodyType
  rows: number
  columns: number
  spacing: number
}

/**
 * 一次铺一片群众。整组共用一个 crowdId，之后可以整体选中、整体变换。
 * 整片摆在已有角色的后方，不跟主角挤在一起。
 */
export function addCrowdCharacters(state: DirectorState, input: CrowdCharactersInput) {
  const { bodyType = DEFAULT_CHARACTER_BODY_TYPE, rows, columns, spacing } = input
  const crowdIndex = new Set(
    state.project.objects.map(item => item.crowdId).filter((id): id is string => Boolean(id)),
  ).size + 1
  const crowdId = `crowd_${crowdIndex}`
  const crowdLabel = `群众${String(crowdIndex).padStart(2, '0')}`

  // 整片往后排：找现有角色最靠后的 z，再留一个间距
  const characterZs = state.project.objects
    .filter(item => item.kind === 'character')
    .map(item => item.transform.position[2])
  const baseZ = (characterZs.length ? Math.max(...characterZs) : 0) + Math.max(0.1, spacing)

  let working = state
  const createdIds: string[] = []

  for (const [x, , z] of getCrowdCharacterPositions(rows, columns, spacing)) {
    const next = buildCharacterObject(working, bodyType, [x, 0, z + baseZ], { crowdId, crowdLabel })
    createdIds.push(next.id)
    working = { ...working, project: { ...working.project, objects: [...working.project.objects, next] } }
  }

  return {
    state: {
      ...working,
      selectedCrowdId: crowdId,
      selectedObjectId: createdIds[createdIds.length - 1] ?? null,
      selectedObjectIds: createdIds,
      directorInspectorMode: 'auto' as const,
    },
    crowdId,
    createdIds,
  }
}

/** 加一个基础几何体，四个一排铺在角色前方 */
export function addGeometryPrimitive(state: DirectorState, geometryType: GeometryPrimitiveType): DirectorState {
  const geometryObjects = state.project.objects.filter(item => item.kind === 'prop' && item.geometryType)
  const index = geometryObjects.length + 1
  const sameTypeCount = geometryObjects.filter(item => item.geometryType === geometryType).length
  const row = Math.floor((index - 1) / 4)
  const column = (index - 1) % 4
  const label = getGeometryPrimitiveLabel(geometryType)

  const next: DirectorObject = {
    id: getNextSequentialId(state.project.objects.map(item => item.id), `geo_${geometryType}_`, index),
    // 同类第一个就叫「立方体」，第二个起才加编号
    name: sameTypeCount === 0 ? label : `${label}${String(sameTypeCount + 1).padStart(2, '0')}`,
    kind: 'prop',
    visible: true,
    locked: false,
    geometryType,
    color: GEOMETRY_PRIMITIVE_COLOR,
    transform: createTransform([column * 1.15 - 1.725, 0, row * 0.75 + 1.15]),
  }

  return {
    ...state,
    selectedObjectId: next.id,
    selectedObjectIds: [next.id],
    selectedCrowdId: null,
    directorInspectorMode: 'auto',
    project: { ...state.project, objects: [...state.project.objects, next] },
  }
}

export interface ImportedModelInput {
  url: string
  fileName: string
  name?: string
  /** 角色加载后认出人形骨骼才能摆姿势，道具走「我的模型」 */
  kind?: Extract<DirectorAssetKind, 'prop' | 'character'>
  assetSource?: DirectorAssetRef['assetSource']
}

function nextImportedModelName(state: DirectorState, base: string) {
  const used = new Set(state.project.objects.map(item => item.name))
  if (!used.has(base))
    return base
  for (let index = 2; index < 1000; index++) {
    const name = `${base}${String(index).padStart(2, '0')}`
    if (!used.has(name))
      return name
  }
  return `${base}${Date.now()}`
}

/**
 * 把一份外部模型放进场景。
 *
 * 调用方先给 blob: 或已上传的 https 地址。存档时 local blob 会被摘掉，
 * 所以画布会话里要尽快把 assetSource 改成 library。
 */
export function addImportedModel(state: DirectorState, input: ImportedModelInput) {
  const kind = input.kind === 'character' ? 'character' : 'prop'
  const fileName = input.fileName.trim() || 'model.glb'
  const name = nextImportedModelName(state, (input.name || importedModelDisplayName(fileName)).trim() || '模型')
  const importedCount = state.project.objects.filter(item => item.assetRefId).length
  const assetId = getNextSequentialId(state.project.assets.map(item => item.id), 'asset_model_', 1)
  const objectId = getNextSequentialId(
    state.project.objects.map(item => item.id),
    kind === 'character' ? 'char_model_' : 'model_',
    1,
  )

  const asset: DirectorAssetRef = {
    id: assetId,
    kind,
    sourceType: 'model',
    fileName,
    name,
    url: input.url,
    assetSource: input.assetSource ?? 'local',
  }

  const next: DirectorObject = {
    id: objectId,
    name,
    kind,
    visible: true,
    locked: false,
    assetRefId: assetId,
    transform: createTransform([getAddedModelColumnOffset(importedCount + 1), 0, kind === 'character' ? 0 : 1.15]),
  }

  return {
    state: {
      ...state,
      selectedObjectId: next.id,
      selectedObjectIds: [next.id],
      selectedCrowdId: null,
      directorInspectorMode: 'auto' as const,
      project: {
        ...state.project,
        assets: [...state.project.assets, asset],
        objects: [...state.project.objects, next],
      },
    },
    assetId,
    objectId,
  }
}

/**
 * 导入的角色模型认出骨架之后，补上姿势数据。
 * 只绑一次：已经有姿势的角色（包括素体）不会被清掉。
 * 道具不绑，避免没有角色面板的对象出现一堆无效滑块。
 */
export function bindImportedCharacterRig(
  state: DirectorState,
  objectId: string,
  rigType: CharacterRigType,
): DirectorState {
  const current = state.project.objects.find(item => item.id === objectId)
  if (!current || current.kind !== 'character' || current.characterRig)
    return state

  return {
    ...state,
    project: {
      ...state.project,
      objects: state.project.objects.map(item => item.id === objectId
        ? {
            ...item,
            characterRig: {
              rigType,
              posePresetId: 'stand',
              controls: {},
            },
          }
        : item),
    },
  }
}

export function bindCharacterLook(state: DirectorState, objectId: string, input: CharacterLookInput): DirectorState {
  return { ...state, project: bindLookOnProject(state.project, [objectId], input) }
}

export function bindCrowdLook(state: DirectorState, crowdId: string, input: CharacterLookInput): DirectorState {
  const ids = getCrowdMemberIds(state.project.objects, crowdId)
  return { ...state, project: bindLookOnProject(state.project, ids, input) }
}

export function clearCharacterLook(state: DirectorState, objectId: string): DirectorState {
  return { ...state, project: clearLookOnProject(state.project, [objectId]) }
}

export function clearCrowdLook(state: DirectorState, crowdId: string): DirectorState {
  const ids = getCrowdMemberIds(state.project.objects, crowdId)
  return { ...state, project: clearLookOnProject(state.project, ids) }
}

/** 上传成功后把 blob 地址换成资产库 URL，存档才留得住 */
export function updateImportedAsset(
  state: DirectorState,
  assetId: string,
  patch: Partial<Pick<DirectorAssetRef, 'url' | 'assetSource' | 'fileName' | 'name'>>,
): DirectorState {
  if (!state.project.assets.some(item => item.id === assetId))
    return state

  return {
    ...state,
    project: {
      ...state.project,
      assets: state.project.assets.map(item => item.id === assetId ? { ...item, ...patch } : item),
    },
  }
}

/**
 * 按 id 删对象。除了移除对象本身，还要收拾三处关联：
 * - 删的是机位对象时，配套的机位一起删；删的正好是当前机位就换到还在的第一个
 * - 有机位正盯着被删对象时，把它的注视目标退回手动模式，否则会指向一个不存在的 id
 * - 被删对象引用的导入资产，如果没人再用且不是本地模型，顺手清掉
 *
 * 树上一行一个删除按钮，不能先靠选中再删 —— 群众组要一次清掉全体成员。
 */
export function deleteObjectsByIds(state: DirectorState, ids: string[]): DirectorState {
  const selectedIds = [...new Set(ids.filter(Boolean))]
  if (!selectedIds.length)
    return state

  const requestedSet = new Set(selectedIds)
  const requested = state.project.objects.filter(item => requestedSet.has(item.id))
  if (!requested.length)
    return { ...state, selectedObjectId: null, selectedObjectIds: [] }

  const selectedObjects = requested.filter(item => !item.locked)
  if (!selectedObjects.length)
    return state

  const selectedSet = new Set(selectedObjects.map(item => item.id))

  const linkedCameraIds = new Set(
    selectedObjects
      .filter(item => item.kind === 'camera' && item.linkedCameraId)
      .map(item => item.linkedCameraId as string),
  )

  const remainingCameras = linkedCameraIds.size
    ? state.project.cameras.filter(camera => !linkedCameraIds.has(camera.id))
    : state.project.cameras

  const camerasAfterFocusReset = remainingCameras.map(camera =>
    camera.targetObjectId && selectedSet.has(camera.targetObjectId)
      ? { ...camera, targetMode: 'manual' as const, targetObjectId: null }
      : camera)

  const nextActiveCameraId = state.project.activeCameraId && linkedCameraIds.has(state.project.activeCameraId)
    ? camerasAfterFocusReset[0]?.id ?? null
    : state.project.activeCameraId

  const nextObjects = state.project.objects.filter(item => !selectedSet.has(item.id))
  const assetsById = new Map(state.project.assets.map(item => [item.id, item]))
  const stillReferenced = new Set(
    nextObjects.flatMap(item => [item.assetRefId, item.lookAssetId]).filter((id): id is string => Boolean(id)),
  )
  const removableAssetIds = new Set(
    selectedObjects
      .flatMap(item => [item.assetRefId, item.lookAssetId])
      .filter((id): id is string => {
        if (typeof id !== 'string' || stillReferenced.has(id))
          return false
        // 本地导入的模型留着：文件只在这台机器上，删了就再也找不回来
        return assetsById.get(id)?.assetSource !== 'local'
      }),
  )

  return {
    ...state,
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedCrowdId: null,
    directorInspectorMode: 'auto',
    project: {
      ...state.project,
      assets: state.project.assets.filter(item => !removableAssetIds.has(item.id)),
      objects: nextObjects,
      cameras: camerasAfterFocusReset,
      activeCameraId: nextActiveCameraId,
    },
  }
}

export function deleteSelectedObject(state: DirectorState): DirectorState {
  return deleteObjectsByIds(state, getOrderedSelectedObjectIds(state))
}

export { getCrowdAnchorTransform }
