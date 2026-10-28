/**
 * 选择与场景设置相关的动作（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 这批动作都是纯状态变换：(state) => state，交给 history.commit 去决定
 * 要不要进撤销栈。选择类的改动不该占撤销步数，所以调用方传 trackUndo: false。
 */
import type { DirectorState } from './state'
import type { DirectorAssetRef, DirectorProject, SceneSettings } from '../schema'
import { getCrowdMemberIds } from './objects'

/** 选中的是机位对象时，顺带把它设为当前机位 —— 点一下就能从它的视角看出去 */
function withLinkedCamera(state: DirectorState, objectId: string | null): DirectorState['project'] {
  const target = state.project.objects.find(item => item.id === objectId)
  if (target?.kind === 'camera' && target.linkedCameraId) {
    return { ...state.project, activeCameraId: target.linkedCameraId }
  }
  return state.project
}

export function selectObject(state: DirectorState, id: string | null): DirectorState {
  return {
    ...state,
    selectedObjectId: id,
    selectedObjectIds: id ? [id] : [],
    selectedCrowdId: null,
    directorInspectorMode: 'auto',
    project: withLinkedCamera(state, id),
  }
}

/** 选中整个群众组：成员全进选中列表，"当前对象"取最后一个（属性面板拿它做基准） */
export function selectCrowd(state: DirectorState, crowdId: string | null): DirectorState {
  if (!crowdId) {
    return { ...state, selectedCrowdId: null, selectedObjectId: null, selectedObjectIds: [] }
  }

  const memberIds = getCrowdMemberIds(state.project.objects, crowdId)
  if (!memberIds.length)
    return state

  return {
    ...state,
    selectedCrowdId: crowdId,
    selectedObjectId: memberIds[memberIds.length - 1] ?? null,
    selectedObjectIds: memberIds,
    directorInspectorMode: 'auto',
  }
}

/** 取当前选中列表；老状态里可能只有单个 selectedObjectId，这里统一成数组 */
export function getOrderedSelectedObjectIds(state: DirectorState) {
  if (state.selectedObjectIds.length)
    return state.selectedObjectIds
  return state.selectedObjectId ? [state.selectedObjectId] : []
}

/** Ctrl 点选：已选中就移出，未选中就追加，"当前对象"永远是最后点的那个 */
export function toggleObjectSelection(state: DirectorState, id: string): DirectorState {
  const target = state.project.objects.find(item => item.id === id)
  if (!target)
    return state

  const current = getOrderedSelectedObjectIds(state)
  const next = current.includes(id) ? current.filter(itemId => itemId !== id) : [...current, id]

  return {
    ...state,
    selectedObjectId: next[next.length - 1] ?? null,
    selectedObjectIds: next,
    selectedCrowdId: null,
    directorInspectorMode: 'auto',
    project: withLinkedCamera(state, id),
  }
}

/** 点空白处或场景标题：取消选中，右侧面板停在场景设置 */
export function openSceneInspector(state: DirectorState): DirectorState {
  return {
    ...state,
    directorInspectorMode: 'scene',
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedCrowdId: null,
  }
}

export function updateScene(state: DirectorState, patch: Partial<SceneSettings>): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      scene: { ...state.project.scene, ...patch },
    },
  }
}

/**
 * 摘掉全景背景。
 *
 * 素材本身也一起删掉：全景图是被 panoramaAssetId 单独引用的，摘掉之后
 * 没有别的地方会再指向它，留在 assets 里只会把场景存档撑大（一张全景图
 * 动辄几 MB 的 dataURL）。
 */
export function removePanoramaAsset(state: DirectorState): DirectorState {
  const assetId = state.project.panoramaAssetId
  if (!assetId)
    return state

  return {
    ...state,
    project: {
      ...state.project,
      panoramaAssetId: null,
      assets: state.project.assets.filter(item => item.id !== assetId),
    },
  }
}

export interface PanoramaAssetInput {
  url: string
  fileName: string
  /** equirectangular 包住整个场景，backdrop 只当远景板 */
  projectionMode?: 'equirectangular' | 'backdrop'
}

/**
 * 把全景图挂进一个场景。
 *
 * 单独给出项目级的版本：画布连线送进来的全景要在装场景时就并进去，
 * 而不是装完再提交一次 —— 后者会在撤销栈里留一步，用户开台后按的第一次
 * 撤销就把全景摘了，画布上那条连线也跟着断，谁都想不到。
 *
 * 换图时把上一张从 assets 里删掉：panoramaAssetId 是唯一的引用，
 * 留着旧的只会把场景 JSON 撑大（画布 graph 有 2 MB 上限）。
 */
export function attachPanoramaToProject(project: DirectorProject, input: PanoramaAssetInput): DirectorProject {
  const previousId = project.panoramaAssetId
  const assetId = `pano_${Date.now().toString(36)}`

  const asset: DirectorAssetRef = {
    id: assetId,
    kind: 'panorama',
    sourceType: 'image',
    fileName: input.fileName,
    url: input.url,
    // 来自画布连线的全景是服务器地址，不是本地 blob，删对象时不该被当作孤儿清掉
    assetSource: 'library',
    projectionMode: input.projectionMode ?? 'equirectangular',
  }

  return {
    ...project,
    panoramaAssetId: assetId,
    assets: [...project.assets.filter(item => item.id !== previousId), asset],
  }
}

/** 用户在导演台里自己换图时用这个，占一步撤销是对的 */
export function setPanoramaAsset(state: DirectorState, input: PanoramaAssetInput): DirectorState {
  return { ...state, project: attachPanoramaToProject(state.project, input) }
}
