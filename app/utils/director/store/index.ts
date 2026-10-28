/**
 * 导演台 store：把前面几个文件里的纯状态变换接到撤销栈上，给出真正能用的 API。
 *
 * 和上游最大的不同是**可实例化**。上游用 zustand 的全局单例，一个页面只能有
 * 一个导演台；我们的导演台是画布上的节点，同一张画布可以有好几个，各自一套场景。
 * 所以这里导出的是工厂函数，组件树里用 provide / inject 往下传。
 */
import { computed, ref } from 'vue'
import type {
  CharacterBodyType,
  CharacterRigType,
  DirectorProject,
  GeometryPrimitiveType,
  PosePresetId,
  SceneSettings,
  ViewMode,
  ViewportAspectRatio,
  CameraSegment,
  CameraNode,
  DirectorCameraShot,
  DirectorObject,
  DirectorTransform,
} from '../schema'
import { getDirectorObjectFocusTarget } from '../object-focus'
import { labelYOf } from '../body-types'
import { lookupPosePreset } from '../pose-presets'
import { createDirectorHistory } from './history'
import {
  createInitialDirectorState,
  type DirectorClipboardEntry,
  cloneJsonValue,
  type DirectorState,
  type TransformMode,
} from './state'
import * as selection from './actions-selection'
import * as transform from './actions-transform'
import * as objects from './actions-objects'
import * as pose from './actions-pose'
import * as camera from './actions-camera'
import * as clipboard from './actions-clipboard'

export function createDirectorStore(initial?: DirectorState, opts?: { readonly?: boolean }) {
  const state = ref<DirectorState>(initial ?? createInitialDirectorState())
  const history = createDirectorHistory(state)
  const readonly = computed(() => Boolean(opts?.readonly))

  // 剪贴板不进撤销栈，也不随场景保存：它是会话级的临时数据
  const clipboardEntries = ref<DirectorClipboardEntry[]>([])
  let clipboardPasteCount = 0

  const {
    commit: rawCommit,
    beginBatch,
    endBatch,
    undo: rawUndo,
    redo: rawRedo,
    canUndo: historyCanUndo,
    canRedo: historyCanRedo,
    reset,
  } = history

  function commit(updater: (current: DirectorState) => DirectorState, options: { trackUndo?: boolean } = {}) {
    if (readonly.value && options.trackUndo !== false)
      return false
    return rawCommit(updater, options)
  }

  function undo() {
    if (readonly.value)
      return false
    return rawUndo()
  }

  function redo() {
    if (readonly.value)
      return false
    return rawRedo()
  }

  const canUndo = computed(() => !readonly.value && historyCanUndo.value)
  const canRedo = computed(() => !readonly.value && historyCanRedo.value)

  /** 机位锁定对象时要拿对象的焦点，这里统一提供查找 */
  function focusTargetOf(objectId: string) {
    const object = state.value.project.objects.find(item => item.id === objectId)
    return object ? getDirectorObjectFocusTarget(object, labelYOf) : null
  }

  /** 纯 UI 改动的提交口：不占撤销步数 */
  const commitUi = (updater: (current: DirectorState) => DirectorState) => commit(updater, { trackUndo: false })

  return {
    state,
    project: computed(() => state.value.project),
    readonly,
    canUndo,
    canRedo,
    undo,
    redo,
    beginBatch,
    endBatch,

    // ---- 视口 UI ----
    setViewMode: (mode: ViewMode) => commitUi(s => ({ ...s, viewMode: mode })),
    setTransformMode: (mode: TransformMode) => commitUi(s => ({ ...s, transformMode: mode })),
    setViewportAspectRatio: (ratio: ViewportAspectRatio) => commitUi(s => ({ ...s, viewportAspectRatio: ratio })),
    setViewportRuleOfThirds: (on: boolean) => commitUi(s => ({ ...s, viewportRuleOfThirdsEnabled: on })),
    setViewportPanelsCollapsed: (collapsed: boolean) => commitUi(s => ({ ...s, viewportPanelsCollapsed: collapsed })),
    toggleViewportPanelsCollapsed: () => commitUi(s => ({ ...s, viewportPanelsCollapsed: !s.viewportPanelsCollapsed })),

    // ---- 选择 ----
    selectObject: (id: string | null) => commitUi(s => selection.selectObject(s, id)),
    selectCrowd: (crowdId: string | null) => commitUi(s => selection.selectCrowd(s, crowdId)),
    toggleObjectSelection: (id: string) => commitUi(s => selection.toggleObjectSelection(s, id)),
    openSceneInspector: () => commitUi(s => selection.openSceneInspector(s)),

    // ---- 场景与对象属性 ----
    updateScene: (patch: Partial<SceneSettings>) => commit(s => selection.updateScene(s, patch)),
    removePanoramaAsset: () => commit(s => selection.removePanoramaAsset(s)),
    setPanoramaAsset: (input: selection.PanoramaAssetInput) => commit(s => selection.setPanoramaAsset(s, input)),
    updateObjectTransform: (id: string, patch: Partial<DirectorTransform>) =>
      commit(s => transform.updateObjectTransform(s, id, patch)),
    updateCrowdTransform: (crowdId: string, patch: Partial<DirectorTransform>) =>
      commit(s => transform.updateCrowdTransform(s, crowdId, patch)),
    updateObjectName: (id: string, name: string) => commit(s => transform.updateObjectName(s, id, name)),
    updateCrowdLabel: (crowdId: string, label: string) => commit(s => transform.updateCrowdLabel(s, crowdId, label)),
    updateObjectColor: (id: string, color: string) => commit(s => transform.updateObjectColor(s, id, color)),
    updateCrowdColor: (crowdId: string, color: string) => commit(s => transform.updateCrowdColor(s, crowdId, color)),
    updateCharacterBodyType: (id: string, bodyType: CharacterBodyType) =>
      commit(s => transform.updateCharacterBodyType(s, id, bodyType)),
    updateUniformScale: (id: string, scale: number) => commit(s => transform.updateUniformScale(s, id, scale)),
    updateCrowdUniformScale: (crowdId: string, scale: number) =>
      commit(s => transform.updateCrowdUniformScale(s, crowdId, scale)),
    toggleObjectVisible: (id: string) => commit(s => transform.toggleObjectVisible(s, id)),
    toggleObjectLocked: (id: string) => commit(s => transform.toggleObjectLocked(s, id)),
    toggleObjectsVisible: (ids: string[]) => commit(s => transform.toggleObjectsVisible(s, ids)),
    toggleObjectsLocked: (ids: string[]) => commit(s => transform.toggleObjectsLocked(s, ids)),

    // ---- 增删对象 ----
    addPresetCharacter: (bodyType?: CharacterBodyType) => commit(s => objects.addPresetCharacter(s, bodyType)),
    addGeometryPrimitive: (geometryType: GeometryPrimitiveType) =>
      commit(s => objects.addGeometryPrimitive(s, geometryType)),
    addCrowdCharacters: (input: objects.CrowdCharactersInput) => {
      let created: string[] = []
      commit((s) => {
        const result = objects.addCrowdCharacters(s, input)
        created = result.createdIds
        return result.state
      })
      return created
    },
    addImportedModel: (input: objects.ImportedModelInput) => {
      let created = { assetId: '', objectId: '' }
      commit((s) => {
        const result = objects.addImportedModel(s, input)
        created = { assetId: result.assetId, objectId: result.objectId }
        return result.state
      })
      return created
    },
    updateImportedAsset: (
      assetId: string,
      patch: Parameters<typeof objects.updateImportedAsset>[2],
    ) => commit(s => objects.updateImportedAsset(s, assetId, patch)),
    bindImportedCharacterRig: (id: string, rigType: CharacterRigType) =>
      commit(s => objects.bindImportedCharacterRig(s, id, rigType)),
    bindCharacterLook: (id: string, input: objects.CharacterLookInput) =>
      commit(s => objects.bindCharacterLook(s, id, input)),
    bindCrowdLook: (crowdId: string, input: objects.CharacterLookInput) =>
      commit(s => objects.bindCrowdLook(s, crowdId, input)),
    clearCharacterLook: (id: string) => commit(s => objects.clearCharacterLook(s, id)),
    clearCrowdLook: (crowdId: string) => commit(s => objects.clearCrowdLook(s, crowdId)),
    deleteSelectedObject: () => commit(s => objects.deleteSelectedObject(s)),
    deleteObjects: (ids: string[]) => commit(s => objects.deleteObjectsByIds(s, ids)),

    // ---- 姿势 ----
    // lookup 默认用内置姿势表，测试里可以传自己的
    applyPosePreset: (id: string, presetId: PosePresetId, lookup: pose.PosePresetLookup = lookupPosePreset) =>
      commit(s => pose.applyPosePreset(s, id, presetId, lookup)),
    applyCrowdPosePreset: (
      crowdId: string,
      presetId: PosePresetId,
      lookup: pose.PosePresetLookup = lookupPosePreset,
    ) => commit(s => pose.applyCrowdPosePreset(s, crowdId, presetId, lookup)),
    updatePoseControl: (id: string, key: string, value: number) =>
      commit(s => pose.updatePoseControl(s, id, key, value)),
    updateCrowdPoseControl: (crowdId: string, key: string, value: number) =>
      commit(s => pose.updateCrowdPoseControl(s, crowdId, key, value)),

    // ---- 机位与运镜 ----
    setActiveCamera: (cameraId: string) => commitUi(s => camera.setActiveCamera(s, cameraId)),
    recordCameraNode: (cameraId: string, input: camera.CameraPoseInput) =>
      commit(s => camera.recordCameraNode(s, cameraId, input, focusTargetOf)),
    // 掌镜时每帧都在调，不能进撤销栈，否则撤销一次只退一帧
    syncCameraPose: (cameraId: string, input: camera.CameraPoseInput) =>
      commitUi(s => camera.syncCameraPose(s, cameraId, input, focusTargetOf)),
    addCameraShot: (input: camera.AddCameraShotInput) => {
      let created = ''
      commit((s) => {
        const result = camera.addCameraShot(s, input)
        created = result.cameraId
        return result.state
      })
      return created
    },
    addCameraNode: (cameraId: string, afterNodeId?: string) =>
      commit(s => camera.addCameraNode(s, cameraId, afterNodeId)),
    updateCameraNode: (cameraId: string, nodeId: string, patch: Partial<Omit<CameraNode, 'id'>>) =>
      commit(s => camera.updateCameraNode(s, cameraId, nodeId, patch)),
    updateCameraNodeTime: (cameraId: string, nodeId: string, time: number) =>
      commit(s => camera.updateCameraNodeTime(s, cameraId, nodeId, time)),
    deleteCameraNode: (cameraId: string, nodeId: string) =>
      commit(s => camera.deleteCameraNode(s, cameraId, nodeId)),
    updateCameraSegment: (
      cameraId: string,
      segmentId: string,
      patch: Partial<Omit<CameraSegment, 'id' | 'fromNodeId' | 'toNodeId'>>,
    ) => commit(s => camera.updateCameraSegment(s, cameraId, segmentId, patch)),
    setSegmentCurveMode: (cameraId: string, segmentId: string, mode: CameraSegment['curveMode']) =>
      commit(s => camera.setSegmentCurveMode(s, cameraId, segmentId, mode)),
    addCameraCaptures: (cameraId: string | null | undefined, dataUrls: string[]) =>
      commit(s => camera.addCameraCaptures(s, cameraId, dataUrls)),
    updateCamera: (cameraId: string, patch: Partial<Omit<DirectorCameraShot, 'id'>>) =>
      commit(s => camera.updateCamera(s, cameraId, patch)),
    deleteCameraCapture: (captureId: string) => commit(s => camera.deleteCameraCapture(s, captureId)),
    clearCameraCaptures: () => commit(s => camera.clearCameraCaptures(s)),

    // ---- 剪贴板 ----
    copySelectedObjects: () => {
      clipboardEntries.value = clipboard.buildClipboardEntries(state.value)
      clipboardPasteCount = 0
      return clipboardEntries.value.length
    },
    pasteClipboardObjects: () => {
      if (!clipboardEntries.value.length)
        return false
      return commit((s) => {
        const result = clipboard.pasteClipboardEntries(
          s,
          clipboardEntries.value,
          clipboardPasteCount,
          (object: DirectorObject) => getDirectorObjectFocusTarget(object, labelYOf),
        )
        clipboardPasteCount = result.pasteCount
        return result.state
      })
    },

    // ---- 场景装载 ----
    replaceProject: (project: DirectorProject) => commit(s => clipboard.replaceProject(s, project)),
    /** 换一整个场景：撤销栈一起清掉，免得撤回到上一个场景去 */
    loadProject: (project: DirectorProject) => {
      reset({ ...createInitialDirectorState(), project: cloneJsonValue(project) })
      clipboardPasteCount = 0
    },
  }
}

export type DirectorStore = ReturnType<typeof createDirectorStore>
