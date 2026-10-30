<script setup lang="ts">
import { ConnectionLineType, ConnectionMode, Position, SelectionMode, VueFlow, getBezierPath, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import type { Connection, Edge, EdgeChange, NodeChange, NodeDragEvent, NodeMouseEvent } from '@vue-flow/core'
import { CANVAS_CHANGE_KEY } from '~/utils/canvas-change'
import { CANVAS_STORYBOARD_KEY, storyboardExpandPlan, storyboardShotsOf } from '~/utils/canvas-storyboard'
import { pickImageEditModel, pickVisionTextModel, preferredImageModel } from '~/utils/image-input'
import { hasNativeAudio } from '~/utils/canvas-talking'
import { effectiveUnitPrice, estimateSecondDuration, estimateTaskPoints } from '~/utils/model-price'
import { resolveCatalogModel } from '~/utils/canvas-catalog-model'
import { defineAsyncComponent } from 'vue'
import '@vue-flow/core/dist/style.css'
import CanvasNode from '~/components/canvas/CanvasNode.vue'
import CanvasGroupNode from '~/components/canvas/CanvasGroupNode.vue'
import CanvasSelBar from '~/components/canvas/CanvasSelBar.vue'
import CanvasEdge from '~/components/canvas/CanvasEdge.vue'
import CanvasConnectLine from '~/components/canvas/CanvasConnectLine.vue'
import CanvasInspector from '~/components/canvas/CanvasInspector.vue'
import type { StylePreset } from '~/components/canvas/CanvasStyleEditModal.vue'
import styleApi from '~/api/style'
import assetApi from '~/api/asset'
import subjectApi from '~/api/subject'
import { IMAGE_EDIT_PROMPTS } from '~/utils/canvas-image-edit'
import {
  absPosition,
  alignFlowNodes,
  defaultGroupColor,
  distributeFlowNodes,
  fitBoxZoom,
  isContentNode,
  isGroupNode,
  isNodeLocked,
  isSelfLocked,
  nudgeFlowNodes,
  layoutGroupChildren,
  nodeSize,
  nodesBounds,
  collapsedGroupSize,
  collapseLayoutForKids,
  setGroupSize,
  type CanvasFlowNode,
} from '~/utils/canvas-group'
import type { NodeAlignMode } from '~/utils/canvas-align'
import {
  cameraIdsInPrompt,
  cameraMovesOf,
  canvasCommentNodeHint,
  expandCameraTokens,
  hasCameraToken,
  FX_PRESET_ITEMS,
  isDepthMotionNode,
  isFramePullNode,
  isHdNode,
  pickHdUpscaleModel,
  isRetakeNode,
  isPanoramaRatio,
  stripCameraTokens,
  type CanvasEmptyStart,
  type CanvasMenuKind,
  type CanvasNodeData,
  type CanvasNodeKind,
  type CanvasStartSkill,
} from '~/utils/canvas-node-kinds'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'
import { emptyMarkPick, expandMarkTokens, insertMarkToken, markHitInstruction, newMarkId, parseMarkHit, stripMarkToken, type CanvasMarkBox, type CanvasMarkPick } from '~/utils/canvas-mark'
import { renderMarkdown } from '~/utils/markdown'
import { fillI18n } from '~/utils/i18n-fill'
import { sanitizeGraphForSave } from '~/utils/canvas-graph-save'
import { briefNodeTitle, briefPickShotRefs, briefTitleHead, SHOT_REF_HINT, type BriefComposeOpts, type BriefGenerateOpts, type BriefGenerateReport } from '~/utils/canvas-chat-brief'
import { useToast } from '#imports'
import type { Asset, AssetType, CanvasGraph, GeneratePayload, GenerationModel, GenerationTask, MediaJob, Style } from '~/types/creative'
import taskApi from '~/api/task'
import mediaApi from '~/api/media'
import {
  mediaActionIfListed,
  mediaActionState,
  retakeSegmentRange,
} from '~/utils/canvas-media-job'
import { addNodeDataPatch, buildAssistNodes, orderAssistChanges, updatePromptPatch, type AssistChange, type AssistNodeSummary } from '~/utils/canvas-assist'
import { CANVAS_STALE_KEY, computeStaleMap, type InputSnapshot } from '~/utils/canvas-upstream'
import { useCanvasPracticeHost } from '~/composables/useCanvasPracticeHost'
import { useCanvasVideoOps } from '~/composables/useCanvasVideoOps'
import { useCanvasImageEdits } from '~/composables/useCanvasImageEdits'
import { useCanvasVideoTools } from '~/composables/useCanvasVideoTools'
import { useCanvasMatrix } from '~/composables/useCanvasMatrix'
import { useCanvasCompose } from '~/composables/useCanvasCompose'
import { useCanvasVideoMerge } from '~/composables/useCanvasVideoMerge'
import { useCanvasRunQueue } from '~/composables/useCanvasRunQueue'
import { useTaskActivity } from '~/composables/useTaskActivity'
import type { MatrixPlan, MatrixSource } from '~/utils/canvas-matrix'
import type { WorkflowPreset } from '~/utils/canvas-workflow-presets'
import { gridPresetById, gridPresetPatch, gridPresetsFor } from '~/utils/canvas-grid-presets'
import { montageOrder, montageReady, type MontageSource } from '~/utils/canvas-montage'
import { audioKindParams, audioKindTag, audioMoodPrompt, isPreferredComposeBgm } from '~/utils/canvas-audio'
import { composeClipDuration, composeGuessAspect, composeOrder, composeReady, type ComposeAudioSource, type ComposeOptions, type ComposeSource } from '~/utils/canvas-compose'
import { isMergeResult, mergeShotIndex, mergeVideoOrder } from '~/utils/canvas-video-merge'
import { flushMergeUploads } from '~/utils/canvas-merge-state'
import { subtitleSourceNodes } from '~/utils/timeline'
import { parseStyleExtract, styleExtractInstruction } from '~/utils/canvas-style-extract'
import { dedupeRefNames, type RefCandidate } from '~/utils/canvas-autolink'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  canvasViewportAtFlowPoint,
  canvasWheelZoomDelta,
  clampCanvasZoom,
} from '~/utils/canvas-wheel-zoom'
import { runQueueBadge } from '~/utils/canvas-run-queue'
import { canvasMediaFilesFromDataTransfer } from '~/utils/canvas-drop-files'
import { canvasFlowPaneRect, canvasFlowToClient, canvasPanelBelowNode } from '~/utils/canvas-panel-layout'
import { canvasBarMode } from '~/utils/canvas-bar-mode'
import { dispatchCanvasSelAction } from '~/utils/canvas-sel-actions'
import { dispatchCanvasShortcut } from '~/utils/canvas-shortcuts'
import { filterFindableNodes, findKindLabel, stepFindableIndex, type CanvasFindItem } from '~/utils/canvas-find'
import { canvasNodePlainText } from '~/utils/canvas-node-text'
import {
  CANVAS_ATTACH_FIELD,
  type CanvasAttachKey,
  canvasAssetNodeKind as assetNodeKind,
  canvasAttachThumbKind as attachThumbKind,
  canvasConnectedRefs,
  canvasMediaKindOfUrl as mediaKindOfUrl,
  canvasNodeImageUrl as nodeImageUrl,
  canvasNodeMediaUrl as nodeMediaUrl,
  canvasRefAcceptFor as refAcceptFor,
  canvasSyncRefFields as syncRefFields,
  canvasUploadedRefList as uploadedRefList,
} from '~/utils/canvas-refs'
import { snapNodeAlign, type AlignGuide } from '~/utils/canvas-align'
import { canvasCenterFlowPoint, canvasClampMenu, canvasOrganizePositions } from '~/utils/canvas-viewport'
import CanvasEmpty from '~/components/canvas/CanvasEmpty.vue'
import CanvasToolsRail from '~/components/canvas/CanvasToolsRail.vue'
import CanvasDock from '~/components/canvas/CanvasDock.vue'
import CanvasMergeToast from '~/components/canvas/CanvasMergeToast.vue'
import {
  buildWorkflowGraph,
  defaultWorkflowName,
  applyWorkflowGraph,
  isUsableWorkflowGraph,
  WORKFLOW_NODE_MAX,
  workflowCover,
  type CanvasWorkflowGraph,
} from '~/utils/canvas-workflow'
import workflowApi from '~/api/workflow'
import { parseClipEnvelope } from '~/utils/canvas-clip-envelope'

/** 弹层第一次打开才拉代码，并且不挂起整页（Nuxt 页面包在 Suspense 里）。 */
function lazyOverlay(loader: () => Promise<{ default: object }>) {
  return defineAsyncComponent({
    loader: () => loader().then(mod => mod.default),
    suspensible: false,
  })
}

const CanvasTextEditor = lazyOverlay(() => import('~/components/canvas/CanvasTextEditor.vue'))
const CanvasAssetPicker = lazyOverlay(() => import('~/components/canvas/CanvasAssetPicker.vue'))
const CanvasBoardPicker = lazyOverlay(() => import('~/components/canvas/CanvasBoardPicker.vue'))
const CanvasMarkModal = lazyOverlay(() => import('~/components/canvas/CanvasMarkModal.vue'))
const CanvasSmartEdit = lazyOverlay(() => import('~/components/canvas/CanvasSmartEdit.vue'))
const CanvasDepthBar = lazyOverlay(() => import('~/components/canvas/CanvasDepthBar.vue'))
const CanvasLightPanel = lazyOverlay(() => import('~/components/canvas/CanvasLightPanel.vue'))
const CanvasAnglePanel = lazyOverlay(() => import('~/components/canvas/CanvasAnglePanel.vue'))
const CanvasHdPanel = lazyOverlay(() => import('~/components/canvas/CanvasHdPanel.vue'))
const CanvasDepthMotionPanel = lazyOverlay(() => import('~/components/canvas/CanvasDepthMotionPanel.vue'))
const CanvasExtendStrip = lazyOverlay(() => import('~/components/canvas/CanvasExtendStrip.vue'))
const CanvasExtendStudio = lazyOverlay(() => import('~/components/canvas/CanvasExtendStudio.vue'))
const CanvasChipPresets = lazyOverlay(() => import('~/components/canvas/CanvasChipPresets.vue'))
const CanvasCameraLibrary = lazyOverlay(() => import('~/components/canvas/CanvasCameraLibrary.vue'))
const CanvasStyleLibrary = lazyOverlay(() => import('~/components/canvas/CanvasStyleLibrary.vue'))
const CanvasCameraModal = lazyOverlay(() => import('~/components/canvas/CanvasCameraModal.vue'))
const CanvasPanoramaViewer = lazyOverlay(() => import('~/components/canvas/CanvasPanoramaViewer.vue'))
const CanvasCropModal = lazyOverlay(() => import('~/components/canvas/CanvasCropModal.vue'))
const CanvasEraseBar = lazyOverlay(() => import('~/components/canvas/CanvasEraseBar.vue'))
const CanvasMattingBar = lazyOverlay(() => import('~/components/canvas/CanvasMattingBar.vue'))
const CanvasViralBar = lazyOverlay(() => import('~/components/canvas/CanvasViralBar.vue'))
const CanvasOutpaintModal = lazyOverlay(() => import('~/components/canvas/CanvasOutpaintModal.vue'))
const CanvasFlipModal = lazyOverlay(() => import('~/components/canvas/CanvasFlipModal.vue'))
const CanvasTextPickModal = lazyOverlay(() => import('~/components/canvas/CanvasTextPickModal.vue'))
const CanvasHelpModal = lazyOverlay(() => import('~/components/canvas/CanvasHelpModal.vue'))
const StudioPublishModal = lazyOverlay(() => import('~/components/studio/StudioPublishModal.vue'))
const CanvasWorkflowPanel = lazyOverlay(() => import('~/components/canvas/CanvasWorkflowPanel.vue'))
const CanvasMatrixPanel = lazyOverlay(() => import('~/components/canvas/CanvasMatrixPanel.vue'))
const CanvasRunQueuePanel = lazyOverlay(() => import('~/components/canvas/CanvasRunQueuePanel.vue'))
const CanvasGridSplitModal = lazyOverlay(() => import('~/components/canvas/CanvasGridSplitModal.vue'))
const CanvasTranscribeModal = lazyOverlay(() => import('~/components/canvas/CanvasTranscribeModal.vue'))
const CanvasMontageModal = lazyOverlay(() => import('~/components/canvas/CanvasMontageModal.vue'))
const CanvasComposePanel = lazyOverlay(() => import('~/components/canvas/CanvasComposePanel.vue'))
const CanvasPromptOptimizeModal = lazyOverlay(() => import('~/components/canvas/CanvasPromptOptimizeModal.vue'))
const CanvasStyleEditModal = lazyOverlay(() => import('~/components/canvas/CanvasStyleEditModal.vue'))
const CanvasMarkPickBar = lazyOverlay(() => import('~/components/canvas/CanvasMarkPickBar.vue'))
const CanvasPracticeTour = lazyOverlay(() => import('~/components/canvas/CanvasPracticeTour.vue'))
const CanvasPaneMenu = lazyOverlay(() => import('~/components/canvas/CanvasPaneMenu.vue'))

const { t, locale } = useI18n()
const { growth: growthConfig } = useStudioAppConfig()
const { confirm } = useConfirm()
const { confirmSpend } = useCanvasAgentSettings()
const { track } = useTrack()

const toast = useToast()
const { refresh: refreshWallet, isMember, balance: walletBalance } = useWallet()
const { gotoPricing } = usePricingModal()
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
/** 模型清单是否已拉过（与 Inspector / 各弹窗同一份 useState 键）：一稿多版面板打开时会补拉一次 */
const generationModelsLoaded = useState('generation-models-loaded', () => false)
let skipSpendConfirm = 0
/** 剧本批量生成排队：同时只跑一条，上一条结束再交下一条 */
let briefGenerateTail = Promise.resolve()

function estimateSpend(model: string, params?: Record<string, unknown>, count = 1) {
  const id = resolveCatalogModel(model, generationModels.value) || model
  const found = generationModels.value.find(item => item.model === id)
  if (!found?.priced)
    return 0
  return estimateTaskPoints(effectiveUnitPrice(found, isMember.value), found.unit, count, Number(params?.duration) || 0)
}

async function gateSpend(points: number) {
  if (skipSpendConfirm)
    return true
  return confirmSpend(points)
}
const inspectorRef = ref<{ generatePayload?: () => GeneratePayload, videoMode?: string, insertCameraMove?: (id: string) => void } | null>(null)
const markModalRef = ref<{ confirm: () => void } | null>(null)
const props = withDefaults(defineProps<{
  /** 当前画布 id（已保存过才有），生成任务会挂到该画布 */
  canvasId?: number
  /** 新画布进入时自动创建一个文本节点并填入该内容（Agent 页跳转） */
  initialPrompt?: string
  /** 只读（队友的画布）：锁定画布、不能加节点 / 右键菜单 / 快捷键编辑 */
  readonly?: boolean
  /**
   * 让页面把画布存一次（新画布会在这里被建出来）。
   * 一稿多版交服务端批量前要用：服务端建批次要求条目 node_id 已在库里的画布 graph 上。
   */
  requestSave?: () => Promise<unknown>
}>(), {
  canvasId: 0,
  initialPrompt: '',
  readonly: false,
})
const {
  addNodes,
  addEdges,
  addSelectedNodes,
  screenToFlowCoordinate,
  zoomTo,
  zoomIn,
  zoomOut,
  fitView,
  setCenter,
  viewport,
  setViewport,
  dimensions,
  findNode,
  updateNode,
  updateNodeData,
  updateNodeInternals,
  removeNodes,
  removeEdges,
  $destroy,
} = useVueFlow('easytv-canvas')

const nodes = ref<CanvasFlowNode[]>([])
const edges = ref<Edge[]>([])
const laterConnect = {
  syncConnectedPrompt: (_id: string, _force?: boolean) => {},
}
const laterText = {
  nodePlainText: canvasNodePlainText,
}
const counts = reactive<Record<CanvasNodeKind, number>>({
  character: 0,
  scene: 0,
  director: 0,
  panorama: 0,
  text: 0,
  image: 0,
  video: 0,
  audio: 0,
  storyboard: 0,
  edit: 0,
})

const menu = ref<{
  x: number
  y: number
  bottom?: number
  flowX: number
  flowY: number
  variant: 'add' | 'connect'
  fromAdd?: boolean
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
} | null>(null)

const paneMenu = ref<{
  x: number
  y: number
  flowX: number
  flowY: number
} | null>(null)

const nodeMenu = ref<{
  x: number
  y: number
  deleteOnly?: boolean
} | null>(null)

const isMac = computed(() => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent))

const pending = ref<{
  nodeId: string
  handleId: string | null
  handleType: 'source' | 'target'
} | null>(null)
const menuBox = ref<{ width: number, height: number } | null>(null)
let didConnect = false
let ignorePaneClick = false

const connectGhostPath = computed(() => {
  const current = menu.value
  if (!current || !(current.source || current.target))
    return null
  const fromSource = Boolean(current.source)
  const nodeId = fromSource ? current.source : current.target
  if (!nodeId)
    return null
  const node = nodes.value.find(item => item.id === nodeId)
  if (!node)
    return null
  const abs = absPosition(node, nodes.value)
  const box = nodeSize(node)
  const handle = flowToClient(abs.x + (fromSource ? box.w : 0), abs.y + box.h / 2)
  const width = menuBox.value?.width ?? 240
  const height = menuBox.value?.height ?? 236
  const menuPoint = fromSource
    ? { x: current.x, y: current.y + height / 2 }
    : { x: current.x + width, y: current.y + height / 2 }
  return getBezierPath({
    sourceX: fromSource ? handle.x : menuPoint.x,
    sourceY: fromSource ? handle.y : menuPoint.y,
    targetX: fromSource ? menuPoint.x : handle.x,
    targetY: fromSource ? menuPoint.y : handle.y,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    curvature: 0.4,
  })[0]
})

watch(() => [menu.value?.source, menu.value?.target], async ([source, target]) => {
  if (!source && !target) {
    menuBox.value = null
    return
  }
  await nextTick()
  const el = document.querySelector('.canvas-menu') as HTMLElement | null
  if (el) {
    menuBox.value = {
      width: el.offsetWidth,
      height: el.offsetHeight,
    }
  }
}, { flush: 'post' })

watch(
  () => {
    const texts: string[] = []
    const images: string[] = []
    for (const node of nodes.value) {
      if (!isContentNode(node))
        continue
      if (node.data.kind === 'text')
        texts.push(`${node.id}:${node.data.content}`)
      else if (node.data.kind === 'image')
        images.push(`${node.id}:${node.data.content}:${node.data.assetId || ''}:${node.data.label}`)
    }
    const links: string[] = []
    for (const edge of edges.value)
      links.push(`${edge.source}:${edge.target}`)
    return `${texts.join('\x1f')}#${images.join('\x1f')}#${links.join('|')}`
  },
  () => {
    for (const edge of edges.value) {
      laterConnect.syncConnectedPrompt(edge.target)
      laterConnect.syncConnectedPrompt(edge.source)
    }
  },
  { flush: 'post', immediate: true },
)

const selectedNodes = computed(() => nodes.value.filter(node => node.selected && isContentNode(node)))
const selectedGroup = computed(() => nodes.value.find(node => node.selected && isGroupNode(node)) ?? null)
const selected = computed(() => selectedNodes.value[0] ?? null)
const selectedId = computed(() => selected.value?.id)
const {
  markOpen,
  markMode,
  markSrc,
  markExisting,
  markNodeId,
  inpaintBusy,
  smartEditOpen,
  smartEditSrc,
  smartEditNodeId,
  smartEditAssetId,
  smartEditRefs,
  smartEditBusy,
  smartEditPick,
  depthOpen,
  depthNodeId,
  depthBusy,
  depthResolution,
  depthModel,
  lightOpen,
  lightNodeId,
  lightBusy,
  lightSrc,
  angleOpen,
  angleNodeId,
  angleBusy,
  angleSrc,
  cropOpen,
  cropNodeId,
  cropVariant,
  eraseOpen,
  eraseNodeId,
  eraseMode,
  mattingOpen,
  mattingNodeId,
  mattingBusy,
  viralOpen,
  viralNodeId,
  viralBusy,
  viralStep,
  viralModelId,
  outpaintOpen,
  outpaintNodeId,
  outpaintBusy,
  flipOpen,
  flipNodeId,
  extendStripOpen,
  extendStripNodeId,
  clipStripOpen,
  clipStripSrc,
  clipStripNodeId,
  splitStripOpen,
  splitStripSrc,
  splitStripNodeId,
  splitBusy,
  stripAssetDuration,
  editSrc,
  closeOverlays,
  closeOverlaysForNodes,
} = useCanvasToolOverlays({ selectedId })
const nodeTypes = { easytv: markRaw(CanvasNode), group: markRaw(CanvasGroupNode) }
const edgeTypes = { easytv: markRaw(CanvasEdge) }
const showInspector = computed(() => {
  const node = selected.value
  if (!node || selectedNodes.value.length !== 1 || !isContentNode(node) || node.data.kind === 'director')
    return false
  // 右键上传的占位节点：上传中只显示卡片本身，成功后才弹功能检查器
  if (canvasNodeUploadingId.value === node.id)
    return false
  // 高清 / 逐帧拉片节点用专用参数面板，不走普通 Inspector
  if (isHdNode(node.data) || isFramePullNode(node.data) || isDepthMotionNode(node.data))
    return false
  // 浏览器拼接的成片已经是视频，不再弹出模型生成栏
  if (isMergeResult(node.data))
    return false
  return !barMode.value || barMode.value === 'text' || barMode.value === 'image' || barMode.value === 'video' || barMode.value === 'audio'
})
const showHdPanel = computed(() => {
  const node = selected.value
  return Boolean(node && selectedNodes.value.length === 1 && isContentNode(node) && isHdNode(node.data) && !canvasLocked.value && !nodeLocked(node))
})
const showDepthMotionPanel = computed(() => {
  const node = selected.value
  return Boolean(node && selectedNodes.value.length === 1 && isContentNode(node) && isDepthMotionNode(node.data) && !canvasLocked.value && !nodeLocked(node))
})
/** 高清 / 深度捕捉：节点已经在跑就禁用提交，避免连点 */
const mediaPanelSubmitting = computed(() => {
  const node = selected.value
  if (!node || !isContentNode(node))
    return false
  return node.data.taskStatus === 'pending' || node.data.taskStatus === 'running'
})
const showRetakeStrip = computed(() => {
  const node = selected.value
  return Boolean(node && selectedNodes.value.length === 1 && isContentNode(node) && isRetakeNode(node.data) && !canvasLocked.value && !nodeLocked(node))
})
/**
 * 画布舞台自身尺寸 / 屏幕位置变化（窗口 resize、侧栏开合）时用它触发面板 computed 重算。
 * canvasFlowPaneRect() 读的是 getBoundingClientRect，本身不响应式，
 * 这里用 ResizeObserver 观察舞台元素，变化时 bump 一下，让依赖它的面板位置重新计算。
 */
const flowPaneRectTick = ref(0)
const hdPanelStyle = computed(() => {
  if (!showHdPanel.value && !showDepthMotionPanel.value)
    return null
  void flowPaneRectTick.value
  const box = selectedNodeBox()
  if (!box)
    return null
  const panelW = showDepthMotionPanel.value ? Math.max(280, box.w * (viewport.value.zoom || 1)) : 360
  return canvasPanelBelowNode(box, viewport.value, {
    paneRect: canvasFlowPaneRect(),
    panelW,
  })
})
const inspectorStyle = computed(() => {
  const node = selected.value
  if (!showInspector.value || !node)
    return null
  void flowPaneRectTick.value
  const kind = node.data?.kind
  const panelW = kind === 'image' || kind === 'video' ? 760 : 680
  const stripGap = showRetakeStrip.value || clipStripOpen.value || extendStripOpen.value || splitStripOpen.value ? 68 : 16
  return canvasPanelBelowNode(selectedNodeBox(), viewport.value, {
    paneRect: canvasFlowPaneRect(),
    panelW,
    gap: stripGap,
  })
})
const depthBarStyle = computed(() => {
  if (!depthOpen.value)
    return null
  void flowPaneRectTick.value
  return canvasPanelBelowNode(nodeBoxById(depthNodeId.value), viewport.value, { paneRect: canvasFlowPaneRect() })
})
/** 爆款复刻悬浮条：贴着源节点下缘居中，取消选中后条还跟着它 */
const viralBarStyle = computed(() => {
  if (!viralOpen.value)
    return null
  void flowPaneRectTick.value
  return canvasPanelBelowNode(nodeBoxById(viralNodeId.value), viewport.value, { paneRect: canvasFlowPaneRect() })
})
const lightPanelStyle = computed(() => {
  if (!lightOpen.value)
    return null
  void flowPaneRectTick.value
  return canvasPanelBelowNode(nodeBoxById(lightNodeId.value), viewport.value, { paneRect: canvasFlowPaneRect() })
})
const anglePanelStyle = computed(() => {
  if (!angleOpen.value)
    return null
  void flowPaneRectTick.value
  return canvasPanelBelowNode(nodeBoxById(angleNodeId.value), viewport.value, { paneRect: canvasFlowPaneRect() })
})
const inspectorKind = computed(() => {
  const kind = selected.value?.data?.kind
  return typeof kind === 'string' ? kind : 'image'
})
const inspectorOpen = ref(false)
const textEditorOpen = ref(false)

watch(() => selected.value?.id, (id) => {
  inspectorOpen.value = false
  textEditorOpen.value = false
  if (id) {
    laterConnect.syncConnectedPrompt(id)
    void backfillRefNames(id)
  }
})

/** 资产 id → 资产名，回填老参考的名字时用；查过一次（含查不到）就不再查 */
const refNameCache = new Map<number, string>()
const refNamePending = new Set<number>()

/**
 * 老的上传参考没有 name（refItems.name 是 9-24 才开始记的），智能引用里只能显示 OSS 文件名。
 * 选中节点时按 assetId 回查一次资产名补上；查不到（已删 / 不是自己的）就留空，照旧回退到文件名。
 */
async function backfillRefNames(nodeId: string) {
  const node = findNode(nodeId) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node) || !Array.isArray(node.data.refItems))
    return
  const todo = node.data.refItems
    .map(item => Number(item?.assetId) || 0)
    .filter(id => id > 0 && !String(node.data.refItems!.find(item => Number(item?.assetId) === id)?.name || '').trim() && !refNameCache.has(id) && !refNamePending.has(id))
  for (const id of [...new Set(todo)]) {
    refNamePending.add(id)
    try {
      const res = await assetApi.get(id)
      refNameCache.set(id, res?.success && res.data?.name ? String(res.data.name).trim() : '')
    }
    catch {
      refNameCache.set(id, '')
    }
    finally {
      refNamePending.delete(id)
    }
  }
  const fresh = findNode(nodeId) as CanvasFlowNode | undefined
  if (!fresh || !isContentNode(fresh) || !Array.isArray(fresh.data.refItems))
    return
  let changed = false
  const items = fresh.data.refItems.map((item) => {
    const id = Number(item?.assetId) || 0
    const name = id > 0 ? refNameCache.get(id) : ''
    if (!item || String(item.name || '').trim() || !name)
      return item
    changed = true
    return { ...item, name }
  })
  if (changed)
    updateNodeData(nodeId, { refItems: items })
}
const showHelp = ref(false)
const findOpen = ref(false)
const findQuery = ref('')
const findItems = computed<CanvasFindItem[]>(() => nodes.value.map((node) => {
  const kind = isContentNode(node) ? node.data.kind : isGroupNode(node) ? 'group' : ''
  return {
    id: node.id,
    label: String(node.data?.label || node.id),
    kind,
    kindLabel: findKindLabel(kind, t),
    prompt: isContentNode(node) ? String(node.data.prompt || node.data.content || '') : '',
  }
}))
const {
  canvasTool,
  spacePan,
  isPanning,
  toolMenu,
  showMinimap,
  zoomMenu,
  zoomDraft,
  zoomPct,
  zoomCmd,
  viewRect,
  mini,
  setTool,
  beginSpacePan,
  endSpacePan,
  toggleToolMenu,
  toggleZoomMenu,
  applyZoomPct,
  applyZoomDraft,
  onDockPointer,
} = useCanvasChrome({
  nodes,
  viewport,
  dimensions,
  zoomTo,
  isMac,
  menu,
  showHelp,
})
const addInto = ref<string | null>(null)
const groupCount = ref(0)
const snapOn = ref(false)
const canvasLocked = ref(false)
watch(() => props.readonly, (value) => {
  if (value)
    canvasLocked.value = true
}, { immediate: true })
const hideEdges = ref(false)
const panOnDrag = computed(() => {
  if (canvasLocked.value)
    return false
  return isPanning.value ? true : [1]
})
/** Vue Flow：true 才是空白处左键拖出选框；null 会关掉框选。抓手或锁定时返回 null */
const selectionKeyCode = computed(() => {
  if (canvasLocked.value || isPanning.value)
    return null
  return true
})
const barMode = computed(() => canvasBarMode(selectedNodes.value, selectedGroup.value))
const overlay = computed(() => {
  void flowPaneRectTick.value
  const z = viewport.value.zoom || 1
  // 悬浮条自己的节点优先：点画布空白取消选中后，条还挂着，定位要跟着它的源节点
  const overlayNodeId = gridSplitOpen.value
    ? gridSplitNodeId.value
    : cropOpen.value
      ? cropNodeId.value
      : eraseOpen.value
        ? eraseNodeId.value
        : mattingOpen.value
          ? mattingNodeId.value
          : viralOpen.value
            ? viralNodeId.value
            : extendStripOpen.value
              ? extendStripNodeId.value
              : clipStripOpen.value
                ? clipStripNodeId.value
                : splitStripOpen.value
                  ? splitStripNodeId.value
                  : ''
  if (overlayNodeId) {
    const node = findNode(overlayNodeId) as CanvasFlowNode | undefined
    if (node) {
      const box = nodesBounds([node], nodes.value)
      if (box) {
        const origin = flowToClient(box.x, box.y)
        return {
          left: origin.x,
          top: origin.y,
          width: box.w * z,
          height: box.h * z,
        }
      }
    }
  }
  if (!barMode.value)
    return null
  const group = selectedGroup.value
  if (barMode.value === 'group' && group && isGroupNode(group)) {
    const kids = nodes.value.filter(node => node.parentNode === group.id)
    const size = group.data.collapsed ? collapsedGroupSize(kids.length, collapseLayoutForKids(kids, group.data.layout)) : nodeSize(group)
    const origin = flowToClient(group.position.x, group.position.y)
    return {
      left: origin.x,
      top: origin.y,
      width: size.w * z,
      height: size.h * z,
    }
  }
  const list = selectedNodes.value
  if (!list.length)
    return null
  const box = nodesBounds(list, nodes.value)
  if (!box)
    return null
  const origin = flowToClient(box.x, box.y)
  return {
    left: origin.x,
    top: origin.y,
    width: box.w * z,
    height: box.h * z,
  }
})

function flowToClient(x: number, y: number) {
  return canvasFlowToClient(viewport.value, x, y, canvasFlowPaneRect())
}

function selectedNodeBox() {
  const node = selected.value
  if (!node)
    return null
  return nodesBounds([node], nodes.value)
}

/** 悬浮条锚点：按源节点 id 取画布盒，取消选中后条还跟着它 */
function nodeBoxById(nodeId: string) {
  const node = nodeId ? findNode(nodeId) as CanvasFlowNode | undefined : undefined
  if (!node)
    return null
  return nodesBounds([node], nodes.value)
}

const SNAP_GRID: [number, number] = [22, 22]

const defaultEdgeOptions = {
  type: 'easytv',
  animated: false,
}

function clampMenu(x: number, y: number, width = 248, height = 460) {
  return canvasClampMenu(x, y, width, height)
}

function openMenu(event: MouseEvent, extra: Partial<typeof menu.value> = {}) {
  toolMenu.value = false
  paneMenu.value = null
  const flow = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const pos = clampMenu(event.clientX + 8, event.clientY + 8)
  menu.value = {
    x: pos.x,
    y: pos.y,
    flowX: flow.x,
    flowY: flow.y,
    variant: extra?.variant ?? 'add',
    source: extra?.source ?? null,
    target: extra?.target ?? null,
    sourceHandle: extra?.sourceHandle ?? null,
    targetHandle: extra?.targetHandle ?? null,
  }
}

function openMenuAtAdd(event?: MouseEvent) {
  // 工具轨的加号：菜单本身是「加节点 / 上传」的入口，跟练期间不开（面板照旧可见，只是点了会被拦）
  if (practiceBlocked())
    return
  toolMenu.value = false
  showHelp.value = false
  paneMenu.value = null
  if (menu.value?.fromAdd) {
    menu.value = null
    return
  }
  const btn = (event?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect()
    ?? document.querySelector('.canvas-tools__add')?.getBoundingClientRect()
  if (!btn) {
    const x = window.innerWidth / 2
    const y = window.innerHeight / 2
    const flow = screenToFlowCoordinate({ x, y })
    const pos = clampMenu(x - 80, y - 80)
    menu.value = {
      x: pos.x,
      y: pos.y,
      flowX: flow.x,
      flowY: flow.y,
      variant: 'add',
    }
    return
  }
  const width = 248
  const x = Math.min(btn.right + 12, window.innerWidth - width - 12)
  const y = Math.min(Math.max(12, btn.top - 72), window.innerHeight - 360)
  const flow = screenToFlowCoordinate({
    x: btn.right + 80,
    y: btn.top + btn.height / 2,
  })
  menu.value = {
    x,
    y,
    flowX: flow.x,
    flowY: flow.y,
    variant: 'add',
    fromAdd: true,
  }
}

function toggleHelp() {
  showHelp.value = !showHelp.value
  zoomMenu.value = false
  if (showHelp.value)
    menu.value = null
}

function openFind() {
  findOpen.value = true
  showHelp.value = false
  zoomMenu.value = false
  menu.value = null
}

function onFindPick(id: string) {
  locateNode(id)
}

function findStep(delta: number) {
  const hits = filterFindableNodes(findItems.value, findQuery.value)
  if (!hits.length) {
    if (!findOpen.value)
      openFind()
    return
  }
  const next = stepFindableIndex(hits, selected.value?.id, delta)
  const hit = next >= 0 ? hits[next] : hits[0]
  if (hit)
    locateNode(hit.id)
}

function nudgeSelection(key: string, shift: boolean, repeat: boolean) {
  if (props.readonly || canvasLocked.value || practiceBlocked())
    return
  const list = selectedNodes.value.filter(item => !nodeLocked(item))
  if (!list.length)
    return
  const cell = SNAP_GRID[0]
  const step = snapOn.value ? (shift ? cell * 4 : cell) : (shift ? 10 : 1)
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
  if (!dx && !dy)
    return
  nudgeFlowNodes(list, nodes.value, dx, dy)
  if (!repeat)
    pushHistory()
}

function isTyping(event: KeyboardEvent) {
  return Boolean((event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]'))
}

const emit = defineEmits<{
  change: []
  /** 顶部「历史」按钮：由页面打开版本历史面板 */
  history: []
  /** 节点右键「批注」：由页面打开批注面板并定位到该节点 */
  comment: [nodeId: string]
  /** 节点右键「问助手」：由页面打开对话栏并切到结合画布 */
  assist: [nodeId: string]
  /** 打开 3D 导演台独立页 */
  'open-director': [nodeId: string]
  /** 对话附件模式：资产选择器选中的资产交给对话区（输入框上方缩略图） */
  'chat-assets': [assets: Asset[]]
  /** 空画布点了技能起步卡：由页面打开右侧抽屉配置生成，不落节点 */
  'skill-start': [skill: CanvasStartSkill]
  /** 对话栏选风格：风格库点中后交给页面写回对话 */
  'chat-style': [style: Style | null]
}>()

const {
  historySnaps,
  historyIndex,
  canUndo,
  canRedo,
  gate,
  pushHistory,
  notifyChange,
  restoreHistory,
  undo,
  redo,
  resetHistory,
  suspended,
} = useCanvasHistory({
  nodes: nodes as { value: unknown },
  edges: edges as { value: unknown },
  emitChange: () => emit('change'),
})

provide(CANVAS_CHANGE_KEY, { change: notifyChange, commit: pushHistory })

const { teamId: workspaceTeamId } = useWorkspace()

const {
  canPaste,
  duplicateSelected,
  copySelected,
  pasteClip,
  pasteEnvelope,
} = useCanvasClipboard({
  nodes,
  edges,
  counts,
  addNodes: list => addNodes(list as any),
  addEdges: edge => addEdges(edge as any),
  defaultEdgeOptions,
  pushHistory,
  paneMenu,
  canvasId: () => props.canvasId,
  teamId: () => workspaceTeamId.value,
  updateNodeData,
  notify,
  t: tx,
})

/**
 * 原生 paste 事件：readText 权限被拒时，Ctrl+V 仍会带着 clipboardData 到这里。
 * 只在画布获得焦点（没在输入框里）且弹层没开时处理；同一份信封由 pasteEnvelope 按 at 去重，keydown 路径不会再贴一次。
 * 没有信封时再看系统剪贴板里的图片 / 视频 / 音频文件。
 */
function onWindowPaste(event: ClipboardEvent) {
  const target = event.target as HTMLElement | null
  // 先让输入框里的粘贴归输入框（画布名、节点里的输入）：它们本来就不进画布，别拿只读提示去打断
  if (target?.closest('input, textarea, [contenteditable="true"]'))
    return
  // ⌘V 的原生粘贴走的是浏览器默认行为，不经过 dispatchCanvasShortcut：
  // 快捷键闸拦不住它，而信封可能是进跟练之前复制的（会建节点、还会走网络导入素材）
  if (props.readonly || practiceBlocked())
    return
  if (smartEditOpen.value || markOpen.value || cropOpen.value || eraseOpen.value || outpaintOpen.value || flipOpen.value)
    return
  const envelope = parseClipEnvelope(event.clipboardData?.getData('text/plain'))
  if (envelope) {
    event.preventDefault()
    void pasteEnvelope(envelope)
    return
  }
  const files = canvasMediaFilesFromDataTransfer(event.clipboardData)
  if (!files.length)
    return
  event.preventDefault()
  void placeDroppedFiles(files)
}

const dropBusy = ref(false)

function onCanvasDragOver(event: DragEvent) {
  if (!event.dataTransfer?.types?.includes('Files'))
    return
  event.preventDefault()
  event.dataTransfer.dropEffect = (props.readonly || practiceLocked.value) ? 'none' : 'copy'
}

function onCanvasDrop(event: DragEvent) {
  if (props.readonly || practiceBlocked())
    return
  if (!event.dataTransfer?.types?.includes('Files'))
    return
  event.preventDefault()
  const files = canvasMediaFilesFromDataTransfer(event.dataTransfer)
  if (!files.length) {
    notify(t('canvas.drop.none'), 'error')
    return
  }
  const at = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  void placeDroppedFiles(files, at)
}

async function placeDroppedFiles(files: File[], at?: { x: number, y: number }) {
  if (!files.length || dropBusy.value)
    return
  if (!canEditCanvas('放入'))
    return
  dropBusy.value = true
  const origin = at ?? centerFlowPoint()
  let placed = 0
  try {
    for (const [index, file] of files.entries()) {
      const res = await assetApi.upload(file)
      if (!res?.success || !res.data) {
        notify(res?.message || t('上传失败'), 'error')
        continue
      }
      const id = addAssetNodeAt(res.data, origin.x + index * 40, origin.y + index * 40)
      if (id)
        placed += 1
    }
    if (placed)
      notify(t('canvas.drop.ok'))
  }
  finally {
    dropBusy.value = false
  }
}

const {
  relabelGroups,
  groupSelected,
  ungroupSelected,
  setGroupKidsVisible,
  toggleGroupCollapse,
  onBarColor,
  scaleTextNode,
  setGroupLayout,
} = useCanvasGroups({
  nodes,
  selectedNodes,
  selectedGroup,
  selected,
  barMode,
  groupCount,
  addNodes: node => addNodes(node),
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  addSelectedNodes: list => addSelectedNodes(list as any),
  updateNode,
  updateNodeData,
  pushHistory,
  t: (key, params) => String(params ? t(key, params) : t(key)),
})

const {
  connectedTextPrompt,
  syncConnectedPrompt,
  detachLinkedRef,
  linkNodes,
  isValidConnection,
  connectSelected,
} = useCanvasConnect({
  nodes,
  edges,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  updateNodeData,
  addEdges: edge => addEdges(edge as any),
  defaultEdgeOptions,
  pushHistory,
  nodePlainText: n => laterText.nodePlainText(n),
  onPromptAppended: () => notify(t('已把上游文本追加到提示词末尾，Ctrl+Z 可撤销')),
})
laterConnect.syncConnectedPrompt = syncConnectedPrompt

const {
  nextId,
  addNode,
  addNodeAtCenter,
  addEmptyStart,
  insertTextNode,
  insertImageNodes: placeImageNodes,
  insertAudioNodes: placeAudioNodes,
  insertVideoNodes: placeVideoNodes,
  applyMediaNodeSize,
  addAssetNodeAt,
  addAssetNodeAtCenter,
} = useCanvasAddNode({
  nodes,
  counts,
  menu,
  addInto,
  canvasLocked,
  readonly: () => props.readonly,
  // 箭头里读 practiceLocked：它声明在 useCanvasAddNode 之后，直接取值会踩 TDZ；
  // addEmptyStart 只在点击时调用，那时早已初始化
  practiceLocked: () => practiceLocked.value,
  t: key => String(t(key)),
  addNodes: node => addNodes(node),
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  addSelectedNodes: list => addSelectedNodes(list as any),
  updateNode,
  updateNodeData,
  updateNodeInternals,
  pushHistory,
  centerFlowPoint: () => canvasCenterFlowPoint(viewport.value, dimensions.value),
})

const briefPlaced: { id: string, group: string }[] = []

function resetBriefPlaced() {
  briefPlaced.length = 0
}

function rememberBriefPlaced(ids: string[], items: { group?: string }[]) {
  items.forEach((item, index) => {
    const id = ids[index]
    if (id && item.group)
      briefPlaced.push({ id, group: item.group })
  })
}

type BriefNode = CanvasFlowNode & { data: CanvasNodeData }

function briefGroupNodes(group: string): BriefNode[] {
  const marked = briefPlaced
    .filter(item => item.group === group)
    .map(item => findNode(item.id) as any)
    .filter((node): node is BriefNode => isContentNode(node))
  if (marked.length)
    return marked
  if (group === 'video') {
    return nodes.value.filter((node): node is BriefNode => {
      if (!isContentNode(node) || node.data.kind !== 'video')
        return false
      const label = String(node.data.label || '')
      return /分镜视频/.test(label) || /^镜\d+/.test(label)
    })
  }
  const suffix = group === 'character'
    ? '角色锚点'
    : group === 'scene'
      ? '场景锚点'
      : group === 'prop'
        ? '道具锚点'
        : group === 'shot'
          ? '分镜'
          : ''
  if (!suffix)
    return []
  return nodes.value.filter((node): node is BriefNode => {
    if (!isContentNode(node) || node.data.kind !== 'image')
      return false
    const label = String(node.data.label || '')
    if (group === 'shot')
      return /分镜$/.test(label) && !label.includes('分镜视频')
    return label.includes(suffix)
  })
}

function briefAnchorName(node: BriefNode) {
  return briefTitleHead(String(node.data.label || ''))
}

/** 分镜接到角色/场景/道具图上，出图才带参考，脸和道具才跟锚点一致 */
function linkBriefShotAnchors() {
  const shots = briefGroupNodes('shot')
  if (!shots.length)
    return
  const people = briefGroupNodes('character')
  const scenes = briefGroupNodes('scene')
  const props = briefGroupNodes('prop')
  if (!people.length && !scenes.length && !props.length)
    return
  const names = {
    characters: people.map(briefAnchorName).filter(Boolean),
    scenes: scenes.map(briefAnchorName).filter(Boolean),
    props: props.map(briefAnchorName).filter(Boolean),
  }
  for (const shot of shots) {
    const hits = briefPickShotRefs(`${shot.data.label}\n${shot.data.prompt}`, names)
    const sources = [
      ...people.filter(node => hits.characters.includes(briefAnchorName(node))),
      ...scenes.filter(node => hits.scenes.includes(briefAnchorName(node))),
      ...props.filter(node => hits.props.includes(briefAnchorName(node))),
    ]
    for (const src of sources)
      linkNodes({ source: src.id, target: shot.id, sourceHandle: 'out', targetHandle: 'in' }, { force: false })
    const prompt = String(shot.data.prompt || '')
    if (prompt && !prompt.includes('参考图中的角色'))
      updateNodeData(shot.id, { prompt: `${SHOT_REF_HINT}${prompt}` })
    let castId = 0
    let setId = 0
    const patch: Record<string, unknown> = {}
    for (const src of sources) {
      const assetId = Number(src.data.assetId) || 0
      if (!assetId)
        continue
      const group = briefPlaced.find(item => item.id === src.id)?.group || inferBriefGroup(src)
      if (group === 'character' && !castId) {
        castId = assetId
        patch.castAssetId = assetId
      }
      if (group === 'scene' && !setId) {
        setId = assetId
        patch.setAssetId = assetId
      }
    }
    if (Object.keys(patch).length)
      updateNodeData(shot.id, patch)
  }
}

function inferBriefGroup(node: CanvasFlowNode) {
  if (!isContentNode(node))
    return ''
  if (node.data.kind === 'audio')
    return 'voice'
  const label = String(node.data.label || '')
  if (node.data.kind === 'video')
    return 'video'
  if (/^镜\d+/.test(label))
    return 'shot'
  const ratio = String((node.data.params as { ratio?: string } | undefined)?.ratio || '')
  if (ratio === '1:1')
    return 'prop'
  if (ratio === '16:9')
    return 'scene'
  return 'character'
}

function idleBriefNode(node: CanvasFlowNode) {
  if (!isContentNode(node))
    return false
  if (node.data.kind !== 'image' && node.data.kind !== 'audio' && node.data.kind !== 'video')
    return false
  if (!String(node.data.prompt || '').trim())
    return false
  if (node.data.content)
    return false
  return node.data.taskStatus !== 'pending' && node.data.taskStatus !== 'running'
}

function briefNodesToGenerate(groups?: string[]) {
  const allow = groups?.length ? new Set(groups) : null
  const fromPlaced = briefPlaced
    .filter(item => !allow || allow.has(item.group))
    .map(item => findNode(item.id) as any)
    .filter((node): node is CanvasFlowNode => Boolean(node && idleBriefNode(node)))
  if (fromPlaced.length)
    return fromPlaced
  if (allow) {
    const fromGroups = [...allow].flatMap(group => briefGroupNodes(group)).filter(node => idleBriefNode(node))
    if (fromGroups.length)
      return fromGroups
  }
  return nodes.value.filter(node => idleBriefNode(node) && (!allow || allow.has(inferBriefGroup(node))))
}

function preferredAudioModel() {
  return generationModels.value.find(item => item.type === 'audio' && item.priced)?.model
    || generationModels.value.find(item => item.type === 'audio')?.model
    || ''
}

function preferredVideoModel() {
  return generationModels.value.find(item => item.type === 'video' && item.priced)?.model
    || generationModels.value.find(item => item.type === 'video')?.model
    || ''
}

function briefModelOf(node: CanvasFlowNode) {
  if (!isContentNode(node))
    return ''
  if (node.data.kind === 'audio')
    return preferredAudioModel()
  if (node.data.kind === 'video')
    return preferredVideoModel()
  return preferredImageModel(generationModels.value)
}

async function ensureGenerationModels() {
  if (generationModels.value.length)
    return
  const res = await taskApi.models()
  if (res?.success && Array.isArray(res.data)) {
    generationModels.value = res.data
    generationModelsLoaded.value = true
  }
}

function estimateBriefPlaced(groups?: string[]) {
  const targets = briefNodesToGenerate(groups)
  let points = 0
  for (const node of targets) {
    const model = briefModelOf(node)
    if (!model)
      continue
    points += estimateSpend(model, isContentNode(node) ? node.data.params : undefined, 1)
  }
  return { count: targets.length, points }
}

function emptyBriefReport(): BriefGenerateReport {
  return { ok: 0, failed: 0, total: 0 }
}

async function generateBriefPlaced(groups?: string[], opts?: BriefGenerateOpts) {
  const run = () => generateBriefPlacedNow(groups, opts)
  const next = briefGenerateTail.then(run, run)
  briefGenerateTail = next.then(() => undefined, () => undefined)
  return next
}

async function generateBriefPlacedNow(groups?: string[], opts?: BriefGenerateOpts): Promise<BriefGenerateReport> {
  const report = emptyBriefReport()
  if (props.readonly)
    return report
  await ensureGenerationModels()
  if (!groups?.length || groups.includes('shot'))
    linkBriefShotAnchors()
  const targets = briefNodesToGenerate(groups)
  report.total = targets.length
  if (!targets.length) {
    notify(t('没有可以生成的节点'))
    return report
  }
  const quote = estimateBriefPlaced(groups)
  if (targets.some(node => isContentNode(node) && !briefModelOf(node))) {
    notify(t('请在节点面板里选择模型后点击生成'), 'error')
    report.failed = targets.length
    return report
  }
  if (!await gateSpend(quote.points))
    return report
  skipSpendConfirm++
  try {
    notify(tx('开始按顺序生成 {n} 条，同时只跑一条', { n: targets.length }))
    let index = 0
    for (const node of targets) {
      index++
      const label = isContentNode(node) ? String(node.data.label || node.data.tag || node.id) : node.id
      opts?.onProgress?.({ index, total: targets.length, label, status: 'start' })
      const model = briefModelOf(node)
      if (!model || !isContentNode(node)) {
        report.failed++
        opts?.onProgress?.({ index, total: targets.length, label, status: 'fail' })
        continue
      }
      await onGenerate({
        model,
        params: { ...(node.data.params || {}) },
      }, node)
      let status = String(node.data.taskStatus || '')
      const taskId = Number(node.data.taskId) || 0
      if (taskId > 0 && (status === 'pending' || status === 'running')) {
        const timeout = node.data.kind === 'video' ? 600_000 : node.data.kind === 'audio' ? 360_000 : 180_000
        const task = await waitTask(node.id, taskId, timeout)
        status = String(task?.status || node.data.taskStatus || '')
      }
      const ok = status === 'succeeded'
      if (ok)
        report.ok++
      else
        report.failed++
      opts?.onProgress?.({ index, total: targets.length, label, status: ok ? 'ok' : 'fail' })
    }
    if (report.ok)
      notify(tx('已完成 {n} 条生成', { n: report.ok }))
  }
  finally {
    skipSpendConfirm--
  }
  return report
}

/** 从文本落到角色或分镜图时，每张图接一条线；不改已经写好的提示词 */
function insertImageNodes(items: { label: string, prompt: string, ratio?: string, group?: string, tag?: string }[], fromId?: string) {
  const ready = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 28)
  const ids = placeImageNodes(ready, fromId)
  rememberBriefPlaced(ids, ready)
  if (fromId) {
    ids.forEach((id) => {
      linkNodes({ source: fromId, target: id, sourceHandle: 'out', targetHandle: 'in' }, { force: false })
    })
  }
  if (ready.some(item => item.group === 'shot'))
    linkBriefShotAnchors()
  return ids
}

function lastTextNodeId() {
  const list = nodes.value.filter(node => isContentNode(node) && node.data.kind === 'text')
  return list[list.length - 1]?.id
}

function insertAudioNodes(items: { label: string, prompt: string, group?: string }[], fromId?: string) {
  const ready = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 8)
  const source = fromId || lastTextNodeId()
  const ids = placeAudioNodes(ready, source)
  rememberBriefPlaced(ids, ready)
  if (source) {
    ids.forEach((id) => {
      linkNodes({ source, target: id, sourceHandle: 'out', targetHandle: 'in' }, { force: false })
    })
  }
  return ids
}

function insertVideoNodes(items: { label: string, prompt: string, ratio?: string, seconds?: number, group?: string }[], fromId?: string) {
  const ready = items.filter(item => item.label.trim() && item.prompt.trim()).slice(0, 16)
  const ids = placeVideoNodes(ready, fromId)
  rememberBriefPlaced(ids, ready)
  if (fromId) {
    ids.forEach((id) => {
      linkNodes({ source: fromId, target: id, sourceHandle: 'out', targetHandle: 'in' }, { force: false })
    })
  }
  return ids
}

function shotHasVideo(shotId: string) {
  return nodes.value.some((node) => {
    if (!isContentNode(node) || node.data.kind !== 'video')
      return false
    return edges.value.some(edge => edge.source === shotId && edge.target === node.id)
  })
}

function placeBriefVideos(only?: string[]) {
  const shots = briefGroupNodes('shot')
  const ids: string[] = []
  const filter = (only || []).map(item => String(item || '').trim()).filter(Boolean)
  for (const node of shots) {
    if (!isContentNode(node))
      continue
    const label = String(node.data.label || '')
    if (filter.length && !filter.some(item => label.includes(item) || label.includes(`镜${item}`)))
      continue
    if (shotHasVideo(node.id))
      continue
    const seconds = Number((node.data.params as { duration?: number } | undefined)?.duration)
      || Number(String(node.data.prompt || '').match(/约(\d+)秒/)?.[1])
      || 4
    const ratio = typeof node.data.params?.ratio === 'string' ? node.data.params.ratio : '9:16'
    const prompt = String(node.data.prompt || '')
      .replace('分镜静帧，单镜头画面', '把这一镜做成视频，单镜头，动作连贯')
      .replace('生成图片的风格', '生成视频的风格')
    ids.push(...insertVideoNodes([{
      label: briefNodeTitle(briefTitleHead(label) || `镜${ids.length + 1}`, 'video', t('分镜视频')),
      prompt: prompt || String(node.data.label || '分镜视频'),
      ratio,
      seconds,
      group: 'video',
    }], node.id))
  }
  return ids
}

function briefVideoSources(): ComposeSource[] {
  const marked = briefGroupNodes('video')
  const list = (marked.length ? marked : nodes.value)
    .filter((node): node is BriefNode => Boolean(node && isContentNode(node) && node.data.kind === 'video' && Number(node.data.assetId) > 0))
  return composeOrder(list.map((node) => {
    const abs = absPosition(node, nodes.value)
    const size = nodeSize(node)
    return {
      id: node.id,
      assetId: Number(node.data.assetId),
      url: nodeMediaUrl(node),
      label: node.data.label || node.id,
      x: abs.x,
      y: abs.y,
      w: size.w,
      h: size.h,
      duration: composeClipDuration(node.data.params),
      trimIn: Number(node.data.trimIn) || 0,
      trimOut: Number(node.data.trimOut) || 0,
      ratio: typeof node.data.params?.ratio === 'string' ? node.data.params.ratio : undefined,
    }
  }))
}

function composeReadyVideos() {
  const ordered = briefVideoSources()
  return composeReady(ordered.map(item => ({ kind: 'video', assetId: item.assetId }))) ? ordered : []
}

/** 分镜静帧 → 图生视频 → 合成一条成片。没有现成视频时先按镜1/镜2这些图出视频。 */
async function composeBrief(opts?: BriefComposeOpts) {
  if (props.readonly) {
    opts?.onDone?.({ ok: false, error: 'readonly' })
    return false
  }
  let ordered = composeReadyVideos()
  if (!ordered.length) {
    placeBriefVideos()
    if (briefNodesToGenerate(['video']).length) {
      const report = await generateBriefPlaced(['video'])
      ordered = composeReadyVideos()
      if (!ordered.length) {
        notify(t('canvas.compose.needTwo'), 'error')
        opts?.onDone?.({ ok: false, error: 'needTwo', count: report.ok })
        return false
      }
    }
    else {
      notify(t('canvas.compose.needTwo'), 'error')
      opts?.onDone?.({ ok: false, error: 'needTwo', count: 0 })
      return false
    }
  }
  const aspect = composeGuessAspect(opts?.aspect || ordered[0]?.ratio)
  void submitCompose(ordered, {
    aspect,
    resolution: '1080p',
    subtitles: false,
    voice: true,
    lang: 'zh',
    bgmAssetId: 0,
    bgmVolume: 0.2,
    preview: Boolean(opts?.preview),
    package: !opts?.preview,
  }, {
    onNode: opts?.onStart,
    onDone: opts?.onDone,
  })
  return true
}

/**
 * 空画布起步卡在跟练里会露出来（选场景卡与 welcome 步都没有 prepare，画布确实是空的），
 * 卡片上的固定预设卡点一下会真的 addNodeAtCenter 落一个不在基线里的节点——先给只读提示再早退。
 * （§四 #23 原先判断「跟练中必有节点」，对空画布开场不成立，这里补闸。）
 */
function onEmptyStart(item: CanvasEmptyStart) {
  if (practiceBlocked())
    return
  addEmptyStart(item)
}

/** 技能卡走对话栏：跟练期间对话栏不渲染，点了只会留下一个「开着」的标志，同样先提示再早退 */
function onEmptyStartSkill(skill: CanvasStartSkill) {
  if (practiceBlocked())
    return
  emit('skill-start', skill)
}

/**
 * 通过 vue-flow API 删节点 / 连线（右键删除、连线上的剪刀、批量副本回滚）不会经过 pushHistory，
 * 这里兜底：本轮有 remove 就在变更落地后压一条历史（节点和连线一起删时只压一次）。
 */
let removalCommitQueued = false
function onFlowElementsChange(changes: Array<NodeChange | EdgeChange>) {
  if (gate.lock || !changes.some(change => change.type === 'remove'))
    return
  // 这一刻边还在：先按被剪掉的线清掉接收节点上抄来的参考，再让 vue-flow 把边删掉
  for (const change of changes) {
    if (change.type !== 'remove')
      continue
    const edge = (edges.value as Edge[]).find(item => item.id === change.id)
    if (edge)
      detachLinkedRef(edge)
  }
  // 其他途径（快捷键、vue-flow 自带删除）删掉组时，把留下的子节点一起清掉
  const removed = new Set(changes.filter(change => change.type === 'remove').map(change => (change as { id: string }).id))
  const orphans = nodes.value.filter(node => node.parentNode && removed.has(node.parentNode) && !removed.has(node.id))
  if (orphans.length)
    nextTick(() => removeNodes(orphans.map(node => node.id), true, true))
  if (removalCommitQueued)
    return
  removalCommitQueued = true
  nextTick(() => {
    removalCommitQueued = false
    pushHistory()
  })
}

function hasBlobMedia() {
  return nodes.value.some(node => isContentNode(node) && String(node.data.content || '').startsWith('blob:'))
}

/** 导出当前画布（供页面保存）：摘掉 Vue Flow 运行时拷贝和 data URL，参考线只留两端 id。 */
function getGraph(): CanvasGraph {
  return sanitizeGraphForSave({
    nodes: nodes.value,
    edges: edges.value,
    viewport: {
      x: viewport.value.x,
      y: viewport.value.y,
      zoom: viewport.value.zoom || 1,
    },
  })
}

/** 载入画布（供页面读取后调用）：重置历史与计数，不触发 change。 */
function loadGraph(graph: CanvasGraph | null | undefined, opts: { keepHistory?: boolean } = {}) {
  gate.suppress = true
  gate.lock = true
  const loaded = (Array.isArray(graph?.nodes) ? graph!.nodes : []).map((node) => {
    const data = (node as CanvasFlowNode).data
    const next = (!data || (data as { kind?: string }).kind !== 'script')
      ? node
      : { ...node, data: { ...data, kind: 'text' } }
    return next as CanvasFlowNode
  })
  nodes.value = loaded.map((node) => {
    const frozen = isNodeLocked(node, loaded)
    return { ...node, draggable: !frozen, connectable: !frozen }
  })
  edges.value = Array.isArray(graph?.edges) ? graph!.edges : []
  for (const key of Object.keys(counts) as CanvasNodeKind[])
    counts[key] = 0
  groupCount.value = 0
  for (const node of nodes.value) {
    const m = /^([a-z]+)-(\d+)$/.exec(node.id)
    if (!m)
      continue
    const kindKey = m[1] ?? ''
    const n = Number(m[2])
    if (kindKey === 'group')
      groupCount.value = Math.max(groupCount.value, n)
    else if (kindKey in counts)
      counts[kindKey as CanvasNodeKind] = Math.max(counts[kindKey as CanvasNodeKind], n)
  }
  for (const node of nodes.value) {
    if (!isGroupNode(node))
      continue
    const kids = nodes.value.filter(item => item.parentNode === node.id)
    setGroupKidsVisible(kids, !node.data.collapsed)
    if (node.data.collapsed) {
      const box = collapsedGroupSize(kids.length, collapseLayoutForKids(kids, node.data.layout))
      setGroupSize(node, box.w, box.h)
    }
  }
  relabelGroups()
  // keepHistory：跟练退出还原走这条路——恢复的是"进去之前的那张图"，撤销栈要一起留着
  if (!opts.keepHistory)
    resetHistory()
  nextTick(() => {
    const vp = graph?.viewport
    if (vp && Number.isFinite(vp.x) && Number.isFinite(vp.y) && vp.zoom > 0)
      setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom })
    gate.lock = false
    gate.suppress = false
    resumePolling()
  })
}

/** 对话栏 / 左侧工具条「资产 / 上传」 */
function pickAssetFromChat(autoUpload = false) {
  openAssetPicker({
    mode: 'add',
    autoUpload,
    title: autoUpload ? t('上传资产') : t('从资产库选择'),
    chatPick: assets => emit('chat-assets', assets),
  })
}

// ---- 画布助手（API.md 16）----
/** 选中节点的名字，对话栏据此提示「围绕哪些节点提问」 */
const selectionLabels = computed(() => selectedNodes.value.map(node => node.data?.label || node.id))

/** 发给助手的节点摘要：选中节点及上下游，没选中时整张画布 */
function assistContext(): AssistNodeSummary[] {
  return buildAssistNodes(nodes.value as Parameters<typeof buildAssistNodes>[0], edges.value, node => nodePlainText(node as CanvasFlowNode))
}

/** 每次应用前后的历史快照，撤销时按对象找回位置（历史满 40 条会从头挤掉，下标不可靠） */
const assistUndo = new Map<number, { before: { nodes: string, edges: string }, after: { nodes: string, edges: string } }>()
let assistSeq = 0

/**
 * 应用助手方案：连线 / 加节点 / 改提示词合成一步撤销历史；generate=true 时再对「重新生成」逐个提交任务。
 * 返回撤销凭据（0 表示没有可撤销的改动）与各项计数。
 */
async function applyAssistChanges(changes: AssistChange[], generate: boolean) {
  const result = { undoToken: 0, applied: 0, skipped: 0, generated: 0 }
  if (props.readonly || canvasLocked.value) {
    notify(props.readonly ? t('只读画布不能修改') : t('画布已锁定，解锁后再应用'), 'error')
    return result
  }
  const before = historySnaps.value[historyIndex.value]
  const regenerate: AssistChange[] = []
  gate.lock = true
  try {
    for (const change of orderAssistChanges(changes)) {
      if (change.action === 'apply_graph') {
        // 契约 3.5：整张图落到「选区右侧 / 视口中心」，id 全部重建，整批只占一步撤销（循环后统一 pushHistory）
        if (!isUsableWorkflowGraph(change.graph)) {
          result.skipped++
          continue
        }
        const placed = applyWorkflowGraph(change.graph, graphOriginPoint(), kind => nextId(kind))
        addNodes(placed.nodes as any)
        addEdges(placed.edges.map(edge => ({ ...edge, ...defaultEdgeOptions })) as any)
        result.applied++
      }
      else if (change.action === 'connect') {
        const ok = change.source && change.target && findNode(change.source) && findNode(change.target)
        if (!ok) {
          result.skipped++
          continue
        }
        if (!edges.value.some(edge => edge.source === change.source && edge.target === change.target))
          linkNodes({ source: change.source!, target: change.target!, sourceHandle: 'out', targetHandle: 'in' })
        result.applied++
      }
      else if (change.action === 'add_node') {
        const from = change.from ? findNode(change.from) as CanvasFlowNode | undefined : undefined
        let at = centerFlowPoint()
        if (from) {
          const abs = absPosition(from, nodes.value)
          at = { x: abs.x + nodeSize(from).w + 80, y: abs.y }
        }
        const id = addNode(change.kind as CanvasNodeKind, at.x, at.y)
        if (!id) {
          result.skipped++
          continue
        }
        // 先连线再写提示词：连线会把上游文本同步成下游提示词，顺序反了助手写的就被盖掉
        if (from)
          linkNodes({ source: from.id, target: id, sourceHandle: 'out', targetHandle: 'in' })
        // model / params / content 也一并写进新节点（契约 3.2），Inspector 初始化时读它们
        updateNodeData(id, addNodeDataPatch(change))
        result.applied++
      }
      else if (change.action === 'update_prompt') {
        const node = change.node_id ? findNode(change.node_id) as CanvasFlowNode | undefined : undefined
        if (!node || !isContentNode(node)) {
          result.skipped++
          continue
        }
        // 文本节点显示 / 下游取用的是 data.content，写 prompt 用户看不到变化
        updateNodeData(node.id, updatePromptPatch(change, node.data.kind))
        result.applied++
      }
      else if (change.action === 'regenerate') {
        regenerate.push(change)
      }
    }
  }
  finally {
    gate.lock = false
  }
  if (result.applied) {
    pushHistory()
    const after = historySnaps.value[historyIndex.value]
    if (before && after && before !== after) {
      result.undoToken = ++assistSeq
      assistUndo.set(result.undoToken, { before, after })
    }
  }
  if (generate) {
    skipSpendConfirm++
    try {
      await nextTick()
      for (const change of regenerate) {
        const node = change.node_id ? findNode(change.node_id) as CanvasFlowNode | undefined : undefined
        if (!node || !isContentNode(node) || !change.model) {
          result.skipped++
          continue
        }
        if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
          result.skipped++
          continue
        }
        // 上次是图片编辑（智能编辑 / 局部修改等）：在当前图片上再编辑一次，不能按文生图重来
        const edit = change.params?.edit
        if (typeof edit === 'string' && edit)
          await runImageEdit(edit as import('~/utils/canvas-image-edit').ImageEditAction, node.data.prompt, change.model, node)
        else
          await onGenerate({ model: change.model, params: { ...(change.params || {}) } }, node)
        result.generated++
      }
    }
    finally {
      skipSpendConfirm--
    }
  }
  return result
}

/** 撤销一次助手修改；之后画布又有别的改动时不直接跳回去，免得把那些改动一起丢掉 */
function undoAssistChanges(token: number): 'ok' | 'stale' | 'missing' {
  const entry = assistUndo.get(token)
  if (!entry)
    return 'missing'
  if (historySnaps.value[historyIndex.value] !== entry.after)
    return 'stale'
  const index = historySnaps.value.indexOf(entry.before)
  if (index < 0)
    return 'missing'
  restoreHistory(index)
  assistUndo.delete(token)
  return 'ok'
}

/** 落图前的两道闸：只读画布 / 锁定画布。两处入口（存模板、发回画布）口径一致 */
function canEditCanvas(action: '保存' | '放入' | '生成') {
  if (props.readonly) {
    notify(t('只读画布不能修改'), 'error')
    return false
  }
  // '保存' / '放入' 都是往画布上落真实数据（存模板、工作流落图、矩阵回滚），跟练期间一并挡下；
  // '生成' 放行——跟练的主动作就是点生成看回放，回放拦截在扣点确认之前。
  if (action !== '生成' && practiceBlocked())
    return false
  if (canvasLocked.value) {
    notify(action === '保存'
      ? t('画布已锁定，解锁后再保存')
      : action === '生成' ? t('画布已锁定，解锁后再生成') : t('画布已锁定，解锁后再放入'), 'error')
    return false
  }
  return true
}

/** 官方预设：前端常量，不回后端取；落图走与「我的工作流」同一条路径（applyWorkflowToCanvas） */
function useWorkflowPreset(preset: WorkflowPreset) {
  // 工作流落图同样是往画布上放真实节点：跟练期间只读（面板能开、列表能看，只是落不进去）
  if (practiceBlocked())
    return
  if (!canEditCanvas('放入'))
    return
  if (!isUsableWorkflowGraph(preset.graph)) {
    notify(t('这条工作流是空的，放不进画布'), 'error')
    return
  }
  workflowPanelOpen.value = false
  applyWorkflowToCanvas(preset.graph as unknown as CanvasWorkflowGraph)
  if (preset.teachingPoint)
    notify(t(preset.teachingPoint))
}

// ---- 节点级重跑与「结果已过期」（utils/canvas-upstream）----
/** 提交任务成功时盖一份输入快照；失败不盖，免得标出一个其实没跑过的结果 */
function stampInputSnapshot(id: string, snapshot: InputSnapshot) {
  updateNodeData(id, { inputSnapshot: snapshot })
}

/** 谁的结果过期了：上游产物或本节点的模型/提示词跟提交时不一致 */
const staleMap = computed(() => computeStaleMap(nodes.value as any, edges.value as any))
provide(CANVAS_STALE_KEY, staleMap)

/** 节点卡片上的「按当前输入重跑」按钮：走 useState 通知 workspace（与取消任务同一条路子） */
const canvasNodeRerun = useState<{ seq: number, nodeId: string } | null>('canvas-node-rerun', () => null)

watch(canvasNodeRerun, (payload) => {
  if (!payload)
    return
  canvasNodeRerun.value = null
  void rerunCanvasNode(payload.nodeId)
})

/** 重跑单个节点：先选中它（Inspector 与 ⌘Enter 都跟着切过去），再走和手动点「生成」同一条路径 */
async function rerunCanvasNode(id: string) {
  if (!canEditCanvas('生成') || idLocked(id))
    return
  const node = findNode(id) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node))
    return
  for (const item of nodes.value)
    item.selected = false
  node.selected = true
  inspectorOpen.value = true
  await nextTick()
  void onGenerate(inspectorRef.value?.generatePayload?.(), node)
}

/**
 * 跟练要引用主体时的解析器（宿主注入点）：取该 kind 的第一个主体，连同当前版本一起给宿主。
 * 主体库为空（或接口失败）返回 null——宿主据此把这一步降级成「不引用主体」并写 session.notice，
 * 绝不为了「看起来完整」而假装引用了一个不存在的主体。
 */
async function resolvePracticeSubject(kind: 'character' | 'scene' | 'prop') {
  const res = await subjectApi.list({ kind, page_size: 1 })
  const item = res?.success ? res.data?.items?.[0] : null
  if (!item?.id)
    return null
  return { id: item.id, version: item.version ?? 1 }
}

/**
 * 口播步的模型解析（宿主注入点）：清单里第一个带原生出声能力位的视频模型。
 * 解析不到返回 null——宿主会退回首帧驱动（不写 videoMode:'talking'）并写 session.notice，
 * 因为口播下拉只列带 native_audio 的模型，硬写一个不带的模型会让这一步的生成按钮被 disabled 卡死。
 */
function resolvePracticeTalkingModel(): string | null {
  return generationModels.value.find(item => item.type === 'video' && hasNativeAudio(item))?.model ?? null
}

// 跟练宿主：开会话、快照、兜底布景、退出还原。见 composables/useCanvasPracticeHost.ts
// viewport / inspectorOpen / historySuspended 三个必须是 ref（宿主里要写 .value、reveal 要读当前缩放）：
// 传 `.value` 或布尔快照不报错，只是跟练的 reveal / 面板展开 / 历史挂起整段静默失效。
const practice = useCanvasPracticeHost({
  nodes,
  edges,
  updateNodeData,
  notify,
  t: tx,
  canEditCanvas,
  getGraph,
  loadGraph,
  addNode,
  addNodeAtCenter,
  findNode,
  linkNodes,
  isContentNode,
  setCenter,
  setViewport,
  viewport,
  inspectorOpen,
  historySuspended: suspended,
  resolveSubject: resolvePracticeSubject,
  resolveTalkingModel: resolvePracticeTalkingModel,
})
const practiceSession = practice.session
const practiceView = practice.view
/**
 * 跟练中画布只读的总开关（不并入 canvasLocked：那个还管 Dock 锁按钮与 panOnDrag，
 * 构成跟练的场景必须保留平移与缩放这两条读操作）。
 */
const practiceLocked = computed(() => practiceSession.value.active)

/**
 * 只读闸的统一出口：被跟练拦下时提示一句并返回 true，调用方一行早退即可。
 * 为什么不用 props.readonly / canvasLocked 那两个开关：跟练的写入只允许两路——跟练自己的
 * prepare（走 addNode / linkNodes / updateNodeData，与用户入口共用同一批函数，不能在手底下关掉）
 * 与被回放接管的生成，所以闸必须落在「用户可点的入口」上，而不是落在底层写入函数上。
 */
function nodeLocked(node: CanvasFlowNode | undefined | null) {
  return isNodeLocked(node, nodes.value)
}

function idLocked(id?: string | null) {
  return Boolean(id) && nodeLocked(findNode(id) as CanvasFlowNode | undefined)
}

/** 选区里的内容节点和编组全部锁定时，工具条才整段冻住。混选时未锁的仍可对齐、删除。 */
const selectionLocked = computed(() => {
  const picked = nodes.value.filter(item => item.selected && (isContentNode(item) || isGroupNode(item)))
  return picked.length > 0 && picked.every(item => nodeLocked(item))
})

function selectionWriteBlocked() {
  if (practiceBlocked())
    return true
  return selectionLocked.value
}

function practiceBlocked() {
  if (!practiceLocked.value)
    return false
  notify(t('跟练中画布是只读的：先退出跟练再编辑'))
  return true
}

/** 分镜节点上的多条提示词，拆成右侧一镜一条视频。生成仍走原来的单条视频。 */
function expandStoryboard(nodeId: string) {
  if (practiceBlocked() || props.readonly || canvasLocked.value)
    return false
  const source = findNode(nodeId) as CanvasFlowNode | undefined
  if (!source || !isContentNode(source) || source.data.kind !== 'storyboard')
    return false
  const abs = absPosition(source, nodes.value)
  const box = nodeSize(source)
  const plan = storyboardExpandPlan(storyboardShotsOf(source.data), {
    x: abs.x,
    y: abs.y,
    w: box.w,
    h: box.h,
  })
  if (!plan.length) {
    notify(t('先写至少一条镜头提示词'), 'error')
    return false
  }
  let made = 0
  for (const item of plan) {
    const id = addNode('video', item.x, item.y, null, {
      label: item.label,
      prompt: item.prompt,
      params: { duration: item.seconds },
    })
    if (!id)
      continue
    made += 1
    linkNodes({ source: nodeId, target: id, sourceHandle: 'out', targetHandle: 'in' }, { force: false })
  }
  if (!made)
    return false
  pushHistory()
  notify(t('已拆成 {n} 条视频，到各条上点生成', { n: made }))
  return true
}

provide(CANVAS_STORYBOARD_KEY, expandStoryboard)

/**
 * 顶层别名，不能直接在模板里写 `practice.camera.tweening`：宿主返回的是普通对象，
 * 模板只对顶层绑定做 ref 拆包，链式取值会把 Ref 对象本身当 prop 传下去
 * （Tour 的 directFall 恒为真、聚光永远直落，属静默失效）。
 */
const practiceCamera = practice.camera
const practiceCameraTweening = practice.camera.tweening

const startPractice = practice.start
const exitPractice = practice.exit
/** 场景选择卡上挑了一条剧本（同样是顶层别名：模板里不能写 practice.selectScript） */
const selectPracticeScript = practice.selectScript


function onBlankContext(event: MouseEvent) {
  if (props.readonly || practiceBlocked())
    return
  const el = event.target as HTMLElement
  if (el.closest('input, textarea, [contenteditable="true"]'))
    return
  event.preventDefault()
  if (el.closest('.vue-flow__node, .vue-flow__edge, .canvas-menu, .canvas-ctx, .canvas-inspector, .canvas-hd, .canvas-tools, .canvas-dock, .canvas-help, .cnode'))
    return
  toolMenu.value = false
  showHelp.value = false
  menu.value = null
  nodeMenu.value = null
  const flow = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const pos = clampMenu(event.clientX + 4, event.clientY + 4, 220, 280)
  paneMenu.value = {
    x: pos.x,
    y: pos.y,
    flowX: flow.x,
    flowY: flow.y,
  }
}

function onNodeContextMenu({ event, node }: NodeMouseEvent) {
  if (props.readonly || !('clientX' in event))
    return
  // 节点右键菜单里全是编辑动作（删除 / 副本 / 重拍 / 扩展 / 高清 / 发布）：跟练期间整张菜单不开，只提示
  if (practiceBlocked())
    return
  event.preventDefault()
  if (!isContentNode(node as CanvasFlowNode))
    return
  menu.value = null
  paneMenu.value = null
  toolMenu.value = false
  showHelp.value = false
  if (!node.selected) {
    for (const item of nodes.value)
      item.selected = false
    node.selected = true
  }
  // 视频节点多出重拍 / 续写 / 超分三行，菜单更高
  const pos = clampMenu(event.clientX + 4, event.clientY + 4, 220, 300)
  const target = node as CanvasFlowNode
  nodeMenu.value = {
    x: pos.x,
    y: pos.y,
    deleteOnly: isContentNode(target) && target.data.kind === 'director',
  }
}

function onNodeMenuCopy() {
  copySelected()
  nodeMenu.value = null
}

function onNodeMenuDuplicate() {
  duplicateSelected()
  nodeMenu.value = null
}

/** 视频节点且内容来自资产（上传/生成产物）时可直接发布 */
const publishTarget = ref<{ id: number, name: string, url: string } | null>(null)
/** 组折叠成叠卡时按位置取首张当封面，所以「设为组封面」= 把它排到组内第一位 */
const coverTarget = computed(() => {
  const node = selected.value
  if (!node?.parentNode || !isContentNode(node))
    return null
  const group = nodes.value.find(item => item.id === node.parentNode)
  if (!isGroupNode(group))
    return null
  const kids = nodes.value.filter(item => item.parentNode === group.id)
  if (kids.length < 2)
    return null
  // 排序规则必须和 CanvasGroupNode 的缩略图一致，否则「第一位」和封面显示的不是同一张
  const layout = collapseLayoutForKids(kids, group.data.layout)
  const first = [...kids].sort((a, b) => (layout === 'col'
    ? (a.position.y === b.position.y ? a.position.x - b.position.x : a.position.y - b.position.y)
    : (a.position.x === b.position.x ? a.position.y - b.position.y : a.position.x - b.position.x)))[0]
  return first?.id === node.id ? null : { group, kids, node }
})

const canSetCover = computed(() => {
  const target = coverTarget.value
  return Boolean(target && !nodeLocked(target.node) && !nodeLocked(target.group))
})

// ---- 全景预览 ----
const panoOpen = ref(false)
const panoSrc = ref('')
const panoTitle = ref('')

const panoTarget = computed(() => {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'panorama')
    return null
  const raw = String(node.data.content || '').trim()
  return isMediaUrl(raw) ? { node, url: resolveMediaUrl(raw) } : null
})

const canViewPano = computed(() => Boolean(panoTarget.value))

function openPanorama() {
  nodeMenu.value = null
  const target = panoTarget.value
  if (!target)
    return
  panoSrc.value = target.url
  panoTitle.value = target.node.data.label
  panoOpen.value = true
}

function onNodeMenuSetCover() {
  nodeMenu.value = null
  const target = coverTarget.value
  if (!target || nodeLocked(target.node) || nodeLocked(target.group))
    return
  const rest = target.kids.filter(item => item.id !== target.node.id)
  layoutGroupChildren(target.group, [target.node, ...rest], target.group.data.layout)
  pushHistory()
}

const canPublishSelected = computed(() => {
  const node = selected.value
  return Boolean(node && isContentNode(node) && (node.data.kind === 'video' || node.data.kind === 'director') && node.data.assetId && node.data.content)
})

function onNodeMenuPublish() {
  const node = selected.value
  nodeMenu.value = null
  if (!node || !isContentNode(node) || !node.data.assetId)
    return
  publishTarget.value = { id: node.data.assetId, name: node.data.label, url: node.data.content }
}

function onNodeMenuRemove() {
  nodeMenu.value = null
  removeSelectedNodes()
}

function selectedRemovableIds() {
  return nodes.value
    .filter(item => item.selected && (isContentNode(item) || isGroupNode(item)) && !nodeLocked(item))
    .map(item => item.id)
}

function syncLockHandles() {
  const list = nodes.value
  for (const node of list) {
    const frozen = isNodeLocked(node, list)
    updateNode(node.id, { draggable: !frozen, connectable: !frozen })
  }
}

function toggleLockSelected() {
  if (props.readonly || canvasLocked.value || practiceBlocked())
    return
  const picked = new Map<string, CanvasFlowNode>()
  for (const node of selectedNodes.value)
    picked.set(node.id, node)
  if (selectedGroup.value)
    picked.set(selectedGroup.value.id, selectedGroup.value)
  const list = [...picked.values()].filter(item => isContentNode(item) || isGroupNode(item))
  if (!list.length)
    return
  const next = !list.every(item => isSelfLocked(item))
  for (const node of list) {
    if (next && isContentNode(node) && node.data.kind === 'text')
      updateNodeData(node.id, { locked: next, mode: 'idle' })
    else
      updateNodeData(node.id, { locked: next })
  }
  syncLockHandles()
  if (next)
    closeOverlaysForNodes(nodes.value.filter(item => nodeLocked(item)).map(item => item.id))
  pushHistory()
}

async function removeSelectedNodes() {
  // 硬闸（不只靠右键菜单的早退）：别的调用点（快捷键、助手、成片失败清理）漏进来时也删不动
  if (canvasLocked.value || practiceLocked.value)
    return
  const ids = selectedRemovableIds()
  if (!ids.length)
    return
  const ok = await confirm({
    title: t('删除节点'),
    message: ids.length === 1
      ? t('确定删除该节点？')
      : t('确定删除这 {n} 个节点？', { n: ids.length }),
    confirmText: t('删除'),
    danger: true,
  })
  if (!ok)
    return
  // 第三个参数连带删掉组里的子节点；不传的话删了组，子节点会变成悬空的孤儿留在画布上
  removeNodes(ids, true, true)
}

// ===== 资产进画布：上传 / 资产库 / 参考 / 风格 / 角色… =====
const picker = reactive({
  open: false,
  mode: 'add' as 'add' | 'attach',
  attach: 'ref' as CanvasAttachKey,
  autoUpload: false,
  title: t('从资产库选择'),
  accept: ['image', 'video', 'audio'] as AssetType[],
  flowX: 0,
  flowY: 0,
  nodeId: '',
  /** 对话附件模式：选中的资产交给回调（输入框上方缩略图），不落画布节点 */
  chatPick: false,
  /** 右键上传的「上传中」占位节点：选完文件先落空节点，上传成功填充、失败撤掉 */
  pendingNodeId: '',
  link: null as null | { source?: string | null, target?: string | null, sourceHandle?: string | null, targetHandle?: string | null },
})

/** 对话附件模式下的资产回调 */
let chatPickHandler: ((assets: Asset[]) => void) | null = null

const canvasMarkPick = useState<CanvasMarkPick>('canvas-mark-pick', emptyMarkPick)
const canvasMarkTap = useState<{ seq: number, nodeId: string, x: number, y: number } | null>('canvas-mark-tap', () => null)
/** 原片时长（秒），悬浮条估复刻扣分用 */
const viralSourceSeconds = ref(0)
/** 用户在悬浮条上手动选的参数；空串 / 0 = 自动（跟原片） */
const viralRatioPick = ref('')
const viralResolutionPick = ref('')
const viralDurationPick = ref(0)
const textPickOpen = ref(false)
const textPickMode = ref<'skill' | 'template' | 'prompt'>('skill')
const helpOpen = ref(false)
const presetOpen = ref(false)
/** 宫格与故事板预设（L6）：需要参考图的那几条在没有上游图时不列出来 */
const gridOpen = ref(false)
/** 宫格切分（L4）：拖分割线把一张宫格图拆成切片 */
const gridSplitOpen = ref(false)
const gridSplitNodeId = ref('')
/** 提示词优化（L15）：文本任务改写后弹对照，用户决定填回 */
const optimizeOpen = ref(false)
const optimizeBusy = ref(false)
const optimizeNodeId = ref('')
const optimizeOriginal = ref('')
const optimizeResult = ref('')
const optimizeError = ref('')
const optimizeModel = ref('')
/** 这次改写预计扣的积分（按文本模型单价估），弹窗里给用户看一眼 */
const optimizePoints = ref(0)

/** 分镜组拼接（L4）：多选的图片按阅读顺序拼成一张宫格图 */
const montageOpen = ref(false)
const montageSources = computed<MontageSource[]>(() => {
  const picked = selectedNodes.value.filter(isContentNode).filter(node => node.data.kind === 'image' && Number(node.data.assetId) > 0)
  return montageOrder(picked.map((node) => {
    const abs = absPosition(node, nodes.value)
    const size = nodeSize(node)
    return {
      id: node.id,
      assetId: Number(node.data.assetId),
      url: nodeImageUrl(node),
      label: node.data.label || node.id,
      x: abs.x,
      y: abs.y,
      w: size.w,
      h: size.h,
    }
  }))
})
const montageAvailable = computed(() => montageReady(selectedNodes.value.filter(isContentNode).map(node => ({ kind: node.data.kind, assetId: node.data.assetId }))))

/** 多段合成一条：多选的视频按阅读顺序排，确认后走 compose 接口 */
const composeOpen = ref(false)
const composeSources = computed<ComposeSource[]>(() => {
  const picked = selectedNodes.value.filter(isContentNode).filter(node => node.data.kind === 'video' && Number(node.data.assetId) > 0)
  return composeOrder(picked.map((node) => {
    const abs = absPosition(node, nodes.value)
    const size = nodeSize(node)
    return {
      id: node.id,
      assetId: Number(node.data.assetId),
      url: nodeMediaUrl(node),
      label: node.data.label || node.id,
      x: abs.x,
      y: abs.y,
      w: size.w,
      h: size.h,
      duration: composeClipDuration(node.data.params),
      trimIn: Number(node.data.trimIn) || 0,
      trimOut: Number(node.data.trimOut) || 0,
      ratio: typeof node.data.params?.ratio === 'string' ? node.data.params.ratio : undefined,
    }
  }))
})
const composeAvailable = computed(() => {
  if (!composeReady(selectedNodes.value.filter(isContentNode).map(node => ({ kind: node.data.kind, assetId: node.data.assetId }))))
    return false
  return mediaActionIfListed(mediaActions.value, 'compose').available
})

/** 浏览器拼接：至少两段已经有画面的视频，不看合成接口开没开 */
const mergeClipList = computed(() => {
  const picked = selectedNodes.value.filter(isContentNode).filter(node => node.data.kind === 'video' && nodeMediaUrl(node))
  return mergeVideoOrder(picked.map((node) => {
    const abs = absPosition(node, nodes.value)
    const size = nodeSize(node)
    return {
      id: node.id,
      url: nodeMediaUrl(node),
      x: abs.x,
      y: abs.y,
      w: size.w,
      h: size.h,
      shotIndex: mergeShotIndex(node.data),
      parentId: node.parentNode,
    }
  }))
})
const mergeReady = computed(() => mergeClipList.value.length >= 2)
const composeAudioSources = computed(() => {
  const out: ComposeAudioSource[] = []
  for (const node of nodes.value) {
    if (!isContentNode(node) || node.data.kind !== 'audio')
      continue
    const assetId = Number(node.data.assetId) || 0
    if (assetId <= 0)
      continue
    out.push({
      id: node.id,
      assetId,
      label: node.data.label || node.id,
      preferred: isPreferredComposeBgm(node.data.params),
    })
  }
  out.sort((a, b) => Number(b.preferred) - Number(a.preferred))
  return out
})
const composeSubtitleSources = computed(() => subtitleSourceNodes(nodes.value))
const gridItems = computed(() => {
  const node = selected.value
  const hasRef = Boolean(node && isContentNode(node)
    && (connectedRefThumbs(node.id).length || uploadedRefList(node.data).length))
  return gridPresetsFor(hasRef).map(item => ({ id: item.id, label: t(item.label), hint: t(item.hint), meta: item.ratio }))
})
const camLibOpen = ref(false)
/** 风格库（L5，API.md 34）：选一个运营配好的整体风格，生成时片段接在提示词末尾 */
const styleLibOpen = ref(false)
/** 风格库这次是给谁选的：空 = 当前节点，extend = 续写弹窗，chat = 对话栏 */
const stylePickFor = ref<'' | 'extend' | 'chat'>('')
/** 我的风格（L18，API.md 34.5）：编辑弹窗由工作区托管，风格库弹窗留在底下 */
const styleEditOpen = ref(false)
const styleEditTarget = ref<Style | null>(null)
const styleEditPreset = ref<StylePreset | null>(null)
/** 这次编辑弹窗是「从当前图定风格」打开的：保存后直接套用到节点 */
const styleEditFromExtract = ref(false)
/** 保存 / 编辑后递增，风格库据此重拉「我的」 */
const styleMineVersion = ref(0)
const styleExtractBusy = ref(false)
let styleExtractSeq = 0
/** 风格库「从当前图定风格」的来源：当前选中的有图图片节点 */
const styleSourceImage = computed(() => {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'image')
    return null
  const url = currentImageSrc(node)
  return url ? { url, assetId: Number(node.data.assetId) || undefined } : null
})
const cameraOpen = ref(false)
const boardPickOpen = ref(false)
const FX_PRESETS = computed(() => [
  { id: '', label: t('无特效') },
  ...FX_PRESET_ITEMS.map(item => ({ id: item.id, label: t(item.label) })),
])

const inspectorChipState = computed(() => {
  const node = selected.value
  const data = node && isContentNode(node) ? node.data : null
  const hasLinkedRef = Boolean(node && isContentNode(node) && connectedRefThumbs(node.id).length)
  return {
    ref: Boolean(hasLinkedRef || uploadedRefList(data).length),
    style: Boolean(data?.styleUrl),
    mark: Boolean(data?.markUrl || data?.markElements?.length),
    voice: Boolean(data?.voiceUrl),
    cast: Boolean(data?.castUrl),
    set: Boolean(data?.setUrl),
    last: Boolean(data?.lastUrl),
    cam: Boolean(cameraMovesOf(data).length || hasCameraToken(data?.prompt)),
    fx: Boolean(data?.fxPreset),
    stylelib: Boolean(data?.stylePreset),
    lens: Boolean(data?.camera?.on),
  }
})

const ATTACH_THUMB_LABEL: Record<CanvasAttachKey, string> = {
  ref: t('参考'),
  first: t('首帧'),
  last: t('尾帧'),
  style: t('风格'),
  voice: t('音色'),
  cast: t('角色'),
  set: t('场景'),
}

const boardPickItems = computed(() => {
  const current = selected.value
  if (!current || !isContentNode(current))
    return []
  const wantAudio = current.data.kind === 'audio'
  const items: Array<{ id: string, label: string, url: string, kind: 'image' | 'video' | 'audio' }> = []
  for (const node of nodes.value) {
    if (node.id === current.id || !isContentNode(node))
      continue
    if (wantAudio) {
      if (node.data.kind !== 'audio')
        continue
    }
    else if (node.data.kind !== 'image' && node.data.kind !== 'video' && node.data.kind !== 'audio') {
      continue
    }
    const raw = nodeMediaUrl(node)
    if (!raw)
      continue
    items.push({
      id: node.id,
      label: node.data.label || t('节点'),
      url: resolveMediaUrl(raw),
      kind: node.data.kind === 'audio' ? 'audio' : node.data.kind === 'video' ? 'video' : 'image',
    })
  }
  return items
})

function onBoardNodePick(id: string) {
  boardPickOpen.value = false
  const target = selected.value
  const source = findNode(id) as CanvasFlowNode | undefined
  if (!target || !isContentNode(target) || !source || !isContentNode(source))
    return
  if (source.data.kind !== 'image' && !refAcceptFor(target.data.kind).includes(source.data.kind as 'video' | 'audio')) {
    notify(t('这个节点只能用图片作参考'), 'error')
    return
  }
  if (source.data.kind === 'image') {
    if (edges.value.some(edge => (edge.source === source.id && edge.target === target.id) || (edge.source === target.id && edge.target === source.id))) {
      notify(t('该参考已添加'))
      return
    }
    // 加参考只是多一条线，用户写好的提示词不能被上游文本冲掉（手拖连线才是 force 同步）
    linkNodes({
      source: source.id,
      target: target.id,
      sourceHandle: 'out',
      targetHandle: 'in',
    }, { force: false })
    pushHistory()
    notify(t('已从画布添加参考：{name}', { name: source.data.label || t('节点') }))
    return
  }
  const url = nodeMediaUrl(source)
  if (!url)
    return
  const items = uploadedRefList(target.data)
  if (items.some(item => item.url === url)) {
    notify(t('该参考已添加'))
    return
  }
  items.push({ assetId: source.data.assetId, url })
  updateNodeData(target.id, syncRefFields(items))
  pushHistory()
  notify(t('已从画布添加参考：{name}', { name: source.data.label || t('节点') }))
}

function linkedImageOf(edge: Pick<Edge, 'source' | 'target'>, nodeId: string) {
  // 参考图只认连进来的上游。连出去的下游图（例如三视图）不是这张图的参考
  if (edge.target !== nodeId || edge.source === nodeId)
    return null
  const otherId = edge.source
  const other = findNode(otherId) as CanvasFlowNode | undefined
  if (!other || !isContentNode(other) || other.data.kind !== 'image')
    return null
  return other
}

function refPeer(id: string) {
  const other = findNode(id) as CanvasFlowNode | undefined
  if (!other || !isContentNode(other))
    return null
  return {
    id: other.id,
    kind: other.data.kind,
    assetId: other.data.assetId,
    url: nodeMediaUrl(other),
  }
}

/** 加号上的参考：连进来的图片，以及视频节点上连进来的视频 / 音频（爆款复刻的原片走这里） */
function connectedRefThumbs(nodeId: string) {
  const node = findNode(nodeId) as CanvasFlowNode | undefined
  const targetKind = node && isContentNode(node) ? node.data.kind : undefined
  return canvasConnectedRefs(nodeId, targetKind, edges.value, refPeer).map(item => ({
    key: `edge:${item.edgeId}`,
    url: item.url,
    label: t('参考'),
    kind: item.kind,
    assetId: item.assetId,
  }))
}

const inspectorAttachThumbs = computed(() => {
  const node = selected.value
  if (!node || !isContentNode(node))
    return []
  const data = node.data as any
  const connected = connectedRefThumbs(node.id)
  const linked = new Set(connected.map(item => item.url))
  const uploaded = uploadedRefList(data)
    .filter(item => !linked.has(item.url))
    .map(item => ({
      key: `upload:${item.url}`,
      url: item.url,
      label: t('参考'),
      kind: attachThumbKind('ref', item.url),
    }))
  const extras: Array<{ key: string, url: string, label: string, kind: 'image' | 'video' | 'audio' }> = []
  const seen = new Set(connected.map(item => item.url).concat(uploaded.map(item => item.url)))
  for (const key of ['style', 'cast', 'set', 'voice', 'last'] as CanvasAttachKey[]) {
    const url = String(data[CANVAS_ATTACH_FIELD[key].url] || '').trim()
    if (!url || seen.has(url))
      continue
    seen.add(url)
    extras.push({
      key,
      url,
      label: ATTACH_THUMB_LABEL[key],
      kind: attachThumbKind(key, url),
    })
  }
  const thumbs = [...connected, ...uploaded, ...extras]
  const uniq = new Set<string>()
  return thumbs.filter((item) => {
    const mark = item.url || item.key
    if (!mark || uniq.has(mark))
      return false
    uniq.add(mark)
    return true
  })
})

/** 上传素材的名字：从地址里取文件名，没有就留空交给 dedupeRefNames 兜底 */
function refNameOfUrl(url: string) {
  const path = String(url || '').split('?')[0] || ''
  const file = path.split('/').pop() || ''
  return decodeURIComponent(file.replace(/\.[a-z0-9]+$/i, '')).slice(0, 20)
}

/**
 * 智能引用候选（L1，API.md 31.2）：顺序与 buildTaskInputs 里的参考顺序一致，
 * 提示词里打到素材名就能 Tab 引用，@ 选回来的素材也靠它落标签（L21）。
 * 09-22 拆组件时这段和 :refs 绑定一起丢了，AutoLink 因此一直没候选——别再丢第二次。
 */
const inspectorRefs = computed<RefCandidate[]>(() => {
  const node = selected.value
  if (!node || !isContentNode(node))
    return []
  const items: Array<{ name: string, kind: RefCandidate['kind'], url?: string }> = []
  for (const item of canvasConnectedRefs(node.id, node.data.kind, edges.value, refPeer)) {
    const src = findNode(item.id) as CanvasFlowNode | undefined
    const name = src && isContentNode(src) ? String(src.data.label || '') : ''
    items.push({ name, kind: item.kind, url: item.kind === 'image' ? item.url : undefined })
  }
  for (const item of uploadedRefList(node.data)) {
    const kind = mediaKindOfUrl(item.url)
    const name = String((item as { name?: string }).name || '').trim().slice(0, 20) || refNameOfUrl(item.url)
    items.push({ name, kind, url: kind === 'image' ? item.url : undefined })
  }
  return dedupeRefNames(items)
})

/** 视口中心对应的画布坐标（「资产」按钮落点） */
function centerFlowPoint() {
  return canvasCenterFlowPoint(viewport.value, dimensions.value)
}

/**
 * 整图落点（契约 3.5）：有选中节点 → 选中节点包围盒右侧 80px（与 add_node 的落点口径一致）；
 * 空画布 / 有内容但没选中 → 视口中心。
 */
function graphOriginPoint() {
  const picked = selectedNodes.value.filter(isContentNode)
  if (!picked.length)
    return centerFlowPoint()
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (const node of picked) {
    const abs = absPosition(node, nodes.value)
    const box = nodeSize(node)
    right = Math.max(right, abs.x + box.w)
    top = Math.min(top, abs.y)
  }
  return { x: right + 80, y: top }
}

// ===== 工作流模板（L3，API.md 31.1）=====
const workflowPanelOpen = ref(false)
const workflowSaving = ref(false)
/** 存完一条就让面板重新拉列表 */
const workflowRefreshAt = ref(0)

/** 存为工作流的选区：打组时取组内节点，否则取多选中的内容节点 */
function workflowPicked(): Array<CanvasFlowNode & { data: CanvasNodeData }> {
  const group = selectedGroup.value
  if (group && isGroupNode(group))
    return nodes.value.filter((node): node is CanvasFlowNode & { data: CanvasNodeData } => node.parentNode === group.id && isContentNode(node))
  return nodes.value.filter((node): node is CanvasFlowNode & { data: CanvasNodeData } => Boolean(node.selected) && isContentNode(node))
}

async function saveWorkflow(pickedOverride?: Array<CanvasFlowNode & { data: CanvasNodeData }>) {
  if (workflowSaving.value)
    return
  const picked = pickedOverride ?? workflowPicked()
  if (picked.length < 2) {
    notify(t('请先选中两个以上有连线的节点'), 'error')
    return
  }
  if (picked.length > WORKFLOW_NODE_MAX) {
    notify(t('一个工作流最多 {n} 个节点', { n: WORKFLOW_NODE_MAX }), 'error')
    return
  }
  const ids = new Set(picked.map(node => node.id))
  const graph = buildWorkflowGraph(
    picked.map((node) => {
      const abs = absPosition(node, nodes.value)
      const size = nodeSize(node)
      return {
        id: node.id,
        kind: node.data.kind,
        x: abs.x,
        y: abs.y,
        width: size.w,
        height: size.h,
        data: cloneContentNodeData(node.data) as unknown as Record<string, any>,
      }
    }),
    (edges.value as Array<{ source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null }>)
      .filter(edge => ids.has(edge.source) && ids.has(edge.target))
      .map(edge => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || 'out',
        targetHandle: edge.targetHandle || 'in',
      })),
  )
  if (!graph.edges.length) {
    notify(t('选中的节点之间还没有连线，连起来才是工作流'), 'error')
    return
  }
  workflowSaving.value = true
  try {
    const res = await workflowApi.create({
      name: defaultWorkflowName(graph.nodes, t),
      cover_url: workflowCover(graph.nodes),
      graph,
    })
    if (!res?.success) {
      notify(res?.message || t('保存失败'), 'error')
      return
    }
    notify(t('已存为工作流，可在左侧「工作流」里改名或发送到画布'))
    workflowRefreshAt.value = Date.now()
  }
  finally {
    workflowSaving.value = false
  }
}

/** 发送到画布：整套节点与连线落到视口中心 */
function applyWorkflowToCanvas(graph: CanvasWorkflowGraph) {
  if (!isUsableWorkflowGraph(graph)) {
    notify(t('这个工作流是空的'), 'error')
    return
  }
  const origin = centerFlowPoint()
  // applyWorkflowGraph 会把节点 kind 写进 data。只拷 data 的话，跟练和卡片都认不出这是图片还是视频。
  const placed = applyWorkflowGraph(graph, origin, (kind) => {
    const key = kind as CanvasNodeKind
    counts[key] += 1
    return `${key}-${counts[key]}`
  })
  const created: CanvasFlowNode[] = placed.nodes.map(node => ({
    ...node,
    selected: true,
    data: cloneContentNodeData(node.data as any),
  }))
  for (const node of nodes.value)
    node.selected = false
  addNodes(created)
  let n = 0
  for (const edge of placed.edges) {
    addEdges({
      ...defaultEdgeOptions,
      id: `e-${edge.source}-${edge.target}-${Date.now()}-${n++}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || 'out',
      targetHandle: edge.targetHandle || 'in',
    })
  }
  pushHistory()
  notify(t('工作流已发送到画布'))
}

async function onWorkflowUse(id: number) {
  if (practiceBlocked())
    return
  const res = await workflowApi.detail(id)
  if (!res?.success || !res.data?.graph) {
    notify(res?.message || t('加载失败'), 'error')
    return
  }
  workflowPanelOpen.value = false
  applyWorkflowToCanvas(res.data.graph)
}

function openAssetPicker(opts: Partial<Omit<typeof picker, 'chatPick' | 'open'>> & { mode: 'add' | 'attach', chatPick?: (assets: Asset[]) => void }) {
  // 上传 / 资产落图的唯一收口：对话栏、检查器 chips、工具轨、右键菜单四路都过它，
  // 所以闸放在这一处就够（跟练期间连上传框都不打开）
  if (practiceBlocked())
    return
  const center = centerFlowPoint()
  picker.mode = opts.mode ?? 'add'
  picker.attach = opts.attach ?? 'ref'
  picker.autoUpload = opts.autoUpload ?? false
  picker.title = opts.title ?? (picker.mode === 'attach' ? t('选择参考资产') : t('从资产库选择'))
  picker.accept = opts.accept ?? ['image', 'video', 'audio']
  picker.flowX = opts.flowX ?? center.x
  picker.flowY = opts.flowY ?? center.y
  picker.nodeId = opts.nodeId ?? ''
  picker.link = opts.link ?? null
  picker.pendingNodeId = ''
  chatPickHandler = opts.chatPick ?? null
  picker.chatPick = Boolean(opts.chatPick)
  picker.open = true
}

async function onAssetPicked(list: Asset[]) {
  picker.open = false
  canvasNodeUploadingId.value = ''
  const picked = (list || []).filter(Boolean)
  if (!picked.length)
    return
  // 对话附件模式：资产交给对话区做输入框上方缩略图，不落画布
  if (picker.chatPick && chatPickHandler) {
    const handler = chatPickHandler
    chatPickHandler = null
    picker.chatPick = false
    handler(picked)
    return
  }
  if (smartEditPick.value) {
    smartEditPick.value = false
    const images = picked.filter(item => item.type === 'image')
    if (!images.length) {
      notify(t('请选择图片'), 'error')
      return
    }
    const next = [...smartEditRefs.value]
    let added = 0
    for (const asset of images) {
      if (next.some(item => item.assetId === asset.id || item.url === asset.url))
        continue
      next.push({ assetId: asset.id, url: asset.url })
      added++
    }
    if (!added) {
      notify(t('该参考图已添加'))
      return
    }
    smartEditRefs.value = next
    return
  }
  if (picker.mode === 'attach') {
    const node = findNode(picker.nodeId) as CanvasFlowNode | undefined
    if (!node || !isContentNode(node))
      return
    const field = CANVAS_ATTACH_FIELD[picker.attach]
    if (picker.attach === 'first') {
      const asset = picked[picked.length - 1]!
      updateNodeData(node.id, syncRefFields([{ assetId: asset.id, url: asset.url }]))
      pushHistory()
      notify(t('已设置首帧：{name}', { name: asset.name }))
      return
    }
    if (picker.attach === 'ref') {
      const items = uploadedRefList(node.data)
      const names: string[] = []
      for (const asset of picked) {
        if (items.some(item => item.url === asset.url || item.assetId === asset.id))
          continue
        // 名字一起记：智能引用的标签用它，比从 OSS 地址里抠出来的一串 key 好认
        items.push({ assetId: asset.id, url: asset.url, name: asset.name })
        names.push(asset.name)
      }
      if (!names.length) {
        notify(t('该参考素材已添加'))
        return
      }
      updateNodeData(node.id, syncRefFields(items))
      pushHistory()
      notify(names.length === 1
        ? t('已设置参考素材：{name}', { name: names[0] })
        : t('已添加 {n} 个参考素材', { n: names.length }))
      return
    }
    const asset = picked[picked.length - 1]!
    updateNodeData(node.id, { [field.id]: asset.id, [field.url]: asset.url })
    pushHistory()
    const done = picker.attach === 'style'
      ? t('已设置风格：{name}', { name: asset.name })
      : picker.attach === 'voice'
        ? t('已设置音色：{name}', { name: asset.name })
        : picker.attach === 'cast'
          ? t('已设置角色：{name}', { name: asset.name })
          : picker.attach === 'set'
            ? t('已设置场景：{name}', { name: asset.name })
            : picker.attach === 'last'
              ? t('已设置尾帧：{name}', { name: asset.name })
            : t('已设置参考素材：{name}', { name: asset.name })
    notify(done)
    return
  }
  if (picker.nodeId) {
    const asset = picked[picked.length - 1]!
    const node = findNode(picker.nodeId) as CanvasFlowNode | undefined
    if (!node || !isContentNode(node))
      return
    applyMediaNodeSize(node.id, asset.width, asset.height)
    const replacing = Boolean(node.data.content?.trim() && isMediaUrl(node.data.content))
    updateNodeData(node.id, { content: asset.url, assetId: asset.id, label: asset.name })
    pushHistory()
    notify(replacing
      ? (asset.type === 'image'
          ? t('已替换图片')
          : asset.type === 'video'
            ? t('已替换视频')
            : asset.type === 'audio' ? t('已替换音频') : t('已添加到节点'))
      : t('已添加到节点'))
    nextTick(() => {
      const found = findNode(node.id)
      if (found)
        addSelectedNodes([found])
    })
    return
  }
  const link = picker.link
  const ids: string[] = []
  let offset = 0
  // 右键上传已经先落了「上传中」占位节点：填充它，不再新建
  const placeholderId = picked.length === 1 ? picker.pendingNodeId : ''
  if (placeholderId)
    picker.pendingNodeId = ''
  for (const asset of picked) {
    let kind = assetNodeKind(asset)
    if (!kind)
      continue
    if (kind === 'image' && picked.length === 1 && isPanoramaRatio(asset.width, asset.height)) {
      const asPano = await confirm({
        title: t('这是一张全景图吗？'),
        message: t('这张图是 {w}×{h}，正好 2:1。作为全景导入可以进球面预览；作为普通图片导入就当一张宽图用。', { w: asset.width, h: asset.height }),
        confirmText: t('作为全景导入'),
        cancelText: t('作为普通图片'),
      })
      if (asPano)
        kind = 'panorama'
    }
    const id = placeholderId || addNode(kind, picker.flowX + offset, picker.flowY, addInto.value)
    if (!id)
      continue
    if (placeholderId) {
      const existing = findNode(placeholderId) as CanvasFlowNode | undefined
      if (existing && isContentNode(existing) && existing.data.kind !== kind)
        updateNodeData(placeholderId, { kind })
    }
    applyMediaNodeSize(id, asset.width, asset.height)
    updateNodeData(id, { content: asset.url, assetId: asset.id, label: asset.name })
    ids.push(id)
    offset += 280
  }
  if (!ids.length) {
    if (placeholderId)
      onPickerUploadFail(placeholderId)
    notify(t('该类型素材暂不能放到画布'), 'error')
    return
  }
  pushHistory()
  const first = ids[0]!
  if (link && (link.source || link.target)) {
    nextTick(() => {
      if (link.source)
        linkNodes({ source: link.source, target: first, sourceHandle: link.sourceHandle || 'out', targetHandle: 'in' }, { mode: 'append' })
      else if (link.target)
        linkNodes({ source: first, target: link.target, sourceHandle: 'out', targetHandle: link.targetHandle || 'in' }, { mode: 'append' })
    })
  }
}

function onNodeUpload(nodeId: string) {
  const node = findNode(nodeId) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node))
    return
  const kind = node.data.kind
  const imageLike = kind === 'image' || kind === 'panorama'
  const accept: AssetType[] = imageLike
    ? ['image']
    : kind === 'audio'
      ? ['audio']
      : kind === 'video' || kind === 'director'
        ? ['video']
        : ['image', 'video', 'audio']
  const hasMedia = Boolean(node.data.content?.trim() && isMediaUrl(node.data.content))
  // 已有内容时标题按类型说「替换」，空节点保持「上传」
  const replaceTitle = imageLike
    ? t('替换图片')
    : kind === 'audio'
      ? t('替换音频')
      : kind === 'video' || kind === 'director'
        ? t('替换视频')
        : ''
  openAssetPicker({
    mode: 'add',
    autoUpload: true,
    nodeId,
    title: hasMedia ? (replaceTitle || t('替换素材')) : t('上传'),
    accept,
  })
}

const canvasNodeUploadId = useState('canvas-node-upload-id', () => '')
const canvasNodeUploadingId = useState('canvas-node-uploading-id', () => '')
watch(canvasNodeUploadId, (id) => {
  if (!id)
    return
  canvasNodeUploadId.value = ''
  onNodeUpload(id)
})

function onPickerUploading(on: boolean) {
  // 只有节点上「上传」直传时挂 loading；资产库弹窗里上传不盖节点。
  // 右键上传的占位节点由 onPickerUploadStart 挂状态——这个 watcher 在 upload-start
  // 之后才异步触发，且此时 picker.nodeId 为空，不挡一下会把转圈状态冲掉
  if (picker.pendingNodeId)
    return
  canvasNodeUploadingId.value = on && picker.autoUpload && picker.nodeId ? picker.nodeId : ''
}

/** 关掉资产库弹窗：右键上传的占位节点还在上传时保留「上传中」，完成后由 onAssetPicked 填充 */
function onPickerClose() {
  picker.open = false
  smartEditPick.value = false
  if (!picker.pendingNodeId)
    canvasNodeUploadingId.value = ''
}

/**
 * 右键上传（空白右键 → 上传）：选完文件先在右键落点放一个「上传中」空节点，
 * 上传完成由 onAssetPicked 填充，失败 / 类型不符由 onPickerUploadFail 撤掉——
 * 不然选完文件到节点出现之间画布毫无反馈，大视频尤其突兀。
 */
function onPickerUploadStart(file: File) {
  if (picker.mode !== 'add' || !picker.autoUpload || picker.nodeId || picker.chatPick)
    return
  const kind = file.type.startsWith('video/')
    ? 'video'
    : file.type.startsWith('audio/')
      ? 'audio'
      : file.type.startsWith('image/') ? 'image' : ''
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio')
    return
  const id = addNode(kind, picker.flowX, picker.flowY, addInto.value, { label: file.name })
  if (!id)
    return
  picker.pendingNodeId = id
  canvasNodeUploadingId.value = id
}

function onPickerUploadFail(targetId = picker.pendingNodeId) {
  picker.pendingNodeId = ''
  canvasNodeUploadingId.value = ''
  if (!targetId)
    return
  const node = findNode(targetId)
  if (node)
    removeNodes([node])
  pushHistory()
}

const canvasDirectorOpenId = useState('canvas-director-open-id', () => '')
watch(canvasDirectorOpenId, (id) => {
  if (!id)
    return
  canvasDirectorOpenId.value = ''
  const node = findNode(id) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node) || node.data.kind !== 'director')
    return
  emit('open-director', id)
})

function onCtxUpload() {
  const origin = paneMenu.value
  paneMenu.value = null
  openAssetPicker({ mode: 'add', autoUpload: true, flowX: origin?.flowX, flowY: origin?.flowY })
}

function onCtxAdd() {
  const origin = paneMenu.value
  paneMenu.value = null
  if (!origin)
    return
  const pos = clampMenu(origin.x, origin.y)
  menu.value = {
    x: pos.x,
    y: pos.y,
    flowX: origin.flowX,
    flowY: origin.flowY,
    variant: 'add',
  }
}

function dismissMenus() {
  menu.value = null
  paneMenu.value = null
  nodeMenu.value = null
  showHelp.value = false
  toolMenu.value = false
  zoomMenu.value = false
  addInto.value = null
}

function onPaneClick() {
  if (ignorePaneClick)
    return
  dismissMenus()
}

const nodePress = { id: '', selected: false, x: 0, y: 0 }

function onWorkspacePointerDown(event: PointerEvent) {
  if (event.button !== 0)
    return
  const el = event.target as HTMLElement | null
  const nodeEl = el?.closest('.vue-flow__node') as HTMLElement | null
  const id = nodeEl?.dataset.id || ''
  const node = id ? nodes.value.find(item => item.id === id) : null
  nodePress.id = id
  nodePress.selected = Boolean(node?.selected)
  nodePress.x = event.clientX
  nodePress.y = event.clientY
  if (!menu.value && !paneMenu.value && !nodeMenu.value && !toolMenu.value && !showHelp.value && !zoomMenu.value)
    return
  if (el?.closest('.canvas-menu, .canvas-ctx, .canvas-help, .canvas-zoom-pop, .canvas-dock__zoom-wrap, .canvas-tools'))
    return
  dismissMenus()
}

/** 点节点本体收起它挂着的工具悬浮条（复刻 / 深度 / 打光 / 多视角 / 抠像 / 三条胶片条）；有关掉才返回 true */
function closeNodeBars(nodeId: string) {
  let closed = false
  const close = (open: { value: boolean }, owner: { value: string }) => {
    if (open.value && owner.value === nodeId) {
      open.value = false
      closed = true
    }
  }
  close(viralOpen, viralNodeId)
  close(depthOpen, depthNodeId)
  close(lightOpen, lightNodeId)
  close(angleOpen, angleNodeId)
  close(mattingOpen, mattingNodeId)
  close(extendStripOpen, extendStripNodeId)
  close(clipStripOpen, clipStripNodeId)
  close(splitStripOpen, splitStripNodeId)
  return closed
}

function onNodeClick({ event, node }: NodeMouseEvent) {
  // 用户自己点了节点（跟练的选中是程序化写的，不走这里）：相机补间让位，不再把画面拖回锚点
  practiceCamera.cancel()
  if (canvasMarkPick.value.open) {
    const kind = (node as any)?.data?.kind
    if (kind !== 'image' && kind !== 'panorama')
      notify(t('只有图片能标记'))
    return
  }
  if (canvasLocked.value || isPanning.value)
    return
  if (!('clientX' in event))
    return
  const el = event.target as HTMLElement
  if (el.closest('button, input, textarea, .vue-flow__handle, .cnode-player__bar, .cnode-player__full, .cnode__resize, .cnode__editor'))
    return
  // 该节点挂着工具悬浮条（爆款复刻 / 深度提取 / 打光…）：点节点先把条收起来、选中态保留，
  // 让上下的功能条出来；不走下面的取消选中 toggle
  if (closeNodeBars(node.id))
    return
  if (nodePress.id !== node.id || !nodePress.selected)
    return
  if (Math.hypot(event.clientX - nodePress.x, event.clientY - nodePress.y) > 6)
    return
  // vue-flow 的 Partial<Node> 没有 selected 字段，但运行时接受
  updateNode(node.id, { selected: false } as Parameters<typeof updateNode>[1])
}

function onNodeDragStart() {
  practiceCamera.cancel()
  alignGuides.value = []
}

const ALIGN_SCREEN_PX = 6
const alignGuides = ref<AlignGuide[]>([])

function onNodeDrag({ node, nodes: dragging }: NodeDragEvent) {
  const dragIds = new Set(dragging.map(item => item.id))
  const grabbed = node as CanvasFlowNode
  const parentAlso = Boolean(grabbed.parentNode && dragIds.has(grabbed.parentNode))
  const target = ((parentAlso
    ? dragging.find(item => item.id === grabbed.parentNode)
    : grabbed) ?? grabbed) as CanvasFlowNode
  const liveAt = (item: CanvasFlowNode) => {
    const pos = { x: item.position.x, y: item.position.y }
    let pid = item.parentNode
    const seen = new Set<string>()
    while (pid && !seen.has(pid)) {
      seen.add(pid)
      const parent = dragging.find(entry => entry.id === pid) ?? nodes.value.find(entry => entry.id === pid)
      if (!parent)
        break
      pos.x += parent.position.x
      pos.y += parent.position.y
      pid = parent.parentNode
    }
    return pos
  }
  const abs = liveAt(target)
  const size = nodeSize(target)
  const others = nodes.value
    .filter(item => !dragIds.has(item.id) && !item.hidden)
    .map((item) => {
      const pos = absPosition(item, nodes.value)
      const box = nodeSize(item)
      return { id: item.id, x: pos.x, y: pos.y, w: box.w, h: box.h }
    })
  const zoom = viewport.value.zoom || 1
  const snapped = snapNodeAlign(
    { id: target.id, x: abs.x, y: abs.y, w: size.w, h: size.h },
    others,
    ALIGN_SCREEN_PX / zoom,
  )
  const dx = snapped.x - abs.x
  const dy = snapped.y - abs.y
  if (dx || dy) {
    const roots = dragging.filter(item => !item.parentNode || !dragIds.has(item.parentNode))
    for (const item of roots) {
      updateNode(item.id, {
        position: { x: item.position.x + dx, y: item.position.y + dy },
      })
    }
  }
  alignGuides.value = snapped.guides
}

function onNodeDragStop() {
  alignGuides.value = []
  pushHistory()
}

const alignLines = computed(() => {
  const zoom = viewport.value.zoom || 1
  const pad = 10
  const originX = viewport.value.x
  const originY = viewport.value.y
  return alignGuides.value.map((guide) => {
    const at = guide.at * zoom + (guide.dir === 'v' ? originX : originY)
    const from = guide.from * zoom + (guide.dir === 'v' ? originY : originX) - pad
    const to = guide.to * zoom + (guide.dir === 'v' ? originY : originX) + pad
    if (guide.dir === 'v')
      return { x1: at, y1: from, x2: at, y2: to }
    return { x1: from, y1: at, x2: to, y2: at }
  })
})

function onStageDblClick(event: MouseEvent) {
  if (props.readonly || practiceBlocked())
    return
  const el = event.target as HTMLElement
  if (el.closest('.vue-flow__node, .canvas-menu, .canvas-ctx, .canvas-inspector, .canvas-tools, .canvas-dock, .canvas-help, .cnode'))
    return
  event.preventDefault()
  openMenu(event, { variant: 'add' })
}

/**
 * 跟练期间在路由之前拦掉编辑类快捷键：Delete / Backspace / ⌘C / ⌘V / ⌘D / ⌘G / ⌘L / ⌘Z（含 ⇧）/ Tab / Alt+⇧+F。
 *
 * dispatchCanvasShortcut 自己也认 practiceReadonly 位（见下面 onKeydown 的传参），这里是入口侧的保险：
 * 键盘粘贴（⌘V）会先把浏览器默认粘贴的 paste 事件放出来，只靠原生粘贴那道闸（onWindowPaste）
 * 属于事后拦截，而 ⌘V 的 keydown 一旦被路由到 pasteClip 就已经在跟练里建节点了。
 * 放行的读操作一个都不碰：空格平移、⌘±、⌘0、⌘Enter（生成→回放）、? 帮助、V 选工具、Escape 关浮层；
 * 正在输入框里打字时一律放行（否则画布名输入框里的退格都会被吃掉）。
 */
function practiceBlocksShortcut(event: KeyboardEvent) {
  if (!practiceLocked.value || isTyping(event))
    return false
  const key = event.key
  const cmd = event.ctrlKey || event.metaKey
  if (event.altKey && event.shiftKey && key.toLowerCase() === 'f')
    return true
  // Tab 不 preventDefault：跟练里它只是不加节点，别顺手把键盘焦点导航也锁死
  if (key === 'Tab')
    return true
  if (key === 'Delete' || key === 'Backspace')
    return true
  return cmd && 'cvdglz'.includes(key.toLowerCase())
}

function onKeydown(event: KeyboardEvent) {
  if (practiceBlocksShortcut(event)) {
    if (event.key !== 'Tab')
      event.preventDefault()
    // 长按不重复弹提示：一次按键一句就够
    if (!event.repeat)
      practiceBlocked()
    return
  }
  dispatchCanvasShortcut(event, {
    markPickOpen: canvasMarkPick.value.open,
    closeMarkPick,
    smartEditOpen: smartEditOpen.value,
    markOpen: markOpen.value,
    cropOpen: cropOpen.value,
    eraseOpen: eraseOpen.value,
    outpaintOpen: outpaintOpen.value,
    flipOpen: flipOpen.value,
    depthOpen: depthOpen.value,
    lightOpen: lightOpen.value,
    angleOpen: angleOpen.value,
    viralOpen: viralOpen.value,
    closeDepth: () => { depthOpen.value = false },
    closeLight: () => { lightOpen.value = false },
    closeAngle: () => { angleOpen.value = false },
    closeViral: () => { viralOpen.value = false },
    dismissChrome: () => {
      menu.value = null
      paneMenu.value = null
      nodeMenu.value = null
      pending.value = null
      showHelp.value = false
      findOpen.value = false
      toolMenu.value = false
      zoomMenu.value = false
      inspectorOpen.value = false
    },
    isTyping: isTyping(event),
    readonly: props.readonly,
    // 跟练期间只读：Delete / ⌘C / ⌘V / ⌘D / ⌘G / ⌘L / ⌘Z / Tab 全拦；
    // 空格平移、⌘±、⌘0、⌘Enter（生成→回放）、? 一律放行（由 dispatchCanvasShortcut 决定走哪条）
    practiceReadonly: practiceLocked.value || props.readonly,
    organizeCanvas,
    toggleHelp,
    openMenuAtAdd,
    setToolSelect: () => setTool('select'),
    beginSpacePan,
    groupSelected,
    ungroupSelected,
    copySelected,
    pasteClip: () => { void pasteClip() },
    duplicateSelected,
    connectSelected,
    onGenerate: () => {
      if (selected.value && nodeLocked(selected.value)) {
        notify(t('节点已锁定'))
        return
      }
      void onGenerate(undefined, selected.value || undefined)
    },
    zoomIn: onUserZoomIn,
    zoomOut: onUserZoomOut,
    fitView: onUserFitView,
    findOpen: findOpen.value,
    openFind,
    closeFind: () => { findOpen.value = false },
    undo,
    redo,
    removeSelectedNodes,
    alignSelection: applySelectionAlign,
    toggleLockSelected,
    findStep,
    nudgeSelection,
  })
}

function onKeyup(event: KeyboardEvent) {
  if (event.key !== ' ')
    return
  if (spacePan.value)
    event.preventDefault()
  endSpacePan(true)
}

function onWindowBlur() {
  endSpacePan(false)
}

/**
 * 用户主动改视口的命令入口（Dock 缩放条 / 小地图拖动 / ⌘0 / ⌘±）都先停掉在飞的相机补间（§6.3「打断与取消」）：
 * 这些入口走 Vue Flow 的程序化 setViewport / setCenter / zoomTo，没有 sourceEvent，d3 的 start 事件不触发，
 * @move-start 收不到；不在这里取消的话，补间每帧会把用户刚缩的 zoom 写回插值起点，看起来就是缩放没生效。
 * 取消只挂用户入口：跟练自己的补间也走 setViewport，把取消下沉到 setViewport 会变成补间自己取消自己。
 */
function onUserZoomIn() {
  practiceCamera.cancel()
  zoomIn()
}

function onUserZoomOut() {
  practiceCamera.cancel()
  zoomOut()
}

function onUserFitView() {
  practiceCamera.cancel()
  const picked = nodes.value.filter(node => node.selected)
  const box = picked.length ? nodesBounds(picked, nodes.value) : null
  if (box) {
    const zoom = clampCanvasZoom(fitBoxZoom(box, { w: dimensions.value.width, h: dimensions.value.height }))
    setCenter(box.x + box.w / 2, box.y + box.h / 2, { zoom })
  }
  else {
    fitView({ padding: 0.2 })
  }
  zoomMenu.value = false
}

/** Dock 缩放菜单里选档（50 / 100 / 800）与输入框里手输百分比 */
function onUserZoomPct(value: number) {
  practiceCamera.cancel()
  applyZoomPct(value, true)
}

function onUserZoomDraft() {
  practiceCamera.cancel()
  applyZoomDraft()
}

/**
 * Ctrl / ⌘ + 滚轮：卡片上大量 nowheel（文本预览、播放条、按钮）会让 Vue Flow 放过事件，
 * 浏览器就去改页面缩放。捕获阶段拦下来，整张画布（含节点）都按指针位置缩放。
 */
function onWindowWheel(event: WheelEvent) {
  if (!(event.ctrlKey || event.metaKey) || document.fullscreenElement)
    return
  const el = event.target instanceof Element ? event.target : null
  if (!el?.closest('.canvas-workspace'))
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (!event.deltaY)
    return
  // 捕获阶段截走事件后 Vue Flow 的 @move-start 收不到：跟练的相机补间若在飞，
  // 不在这里取消的话它会每帧把用户刚缩的 zoom 写回补间起点（§6.3「打断与取消」的滚轮一路）
  practiceCamera.cancel()
  const current = viewport.value
  const zoom = current.zoom || 1
  const nextZoom = clampCanvasZoom(zoom * 2 ** canvasWheelZoomDelta(event, isMac.value))
  if (Math.abs(nextZoom - zoom) < 1e-6)
    return
  const flowPoint = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  setViewport(canvasViewportAtFlowPoint({ ...current, zoom }, flowPoint, nextZoom))
}

function toggleHideEdges() {
  hideEdges.value = !hideEdges.value
  try {
    localStorage.setItem('easytv-hide-edges', hideEdges.value ? '1' : '0')
  }
  catch {
    // ignore
  }
}

/** 观察画布舞台尺寸变化（侧栏开合 / 窗口 resize），bump tick 让所有面板 computed 重算位置 */
let flowPaneResizeObserver: ResizeObserver | null = null

onMounted(() => {
  try {
    hideEdges.value = localStorage.getItem('easytv-hide-edges') === '1'
  }
  catch {
    // ignore
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('paste', onWindowPaste)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('wheel', onWindowWheel, { capture: true, passive: false })
  // 舞台尺寸 / 屏幕位置变化时（对话栏开合、窗口 resize），面板位置要跟着重新计算
  const flowEl = document.querySelector('.canvas-flow') as HTMLElement | null
  if (flowEl) {
    flowPaneResizeObserver = new ResizeObserver(() => {
      flowPaneRectTick.value++
    })
    flowPaneResizeObserver.observe(flowEl)
  }
  pushHistory()
  gate.suppress = false
  if (props.initialPrompt) {
    const id = addNode('text', 120, 140)
    if (id) {
      updateNodeData(id, { content: props.initialPrompt })
      pushHistory()
    }
  }
  void loadMediaActions()
  resumePolling()
})

onUnmounted(() => {
  // 这两个是跨组件的全局 useState：离开画布不清，下一张画布会带着「选元素模式 / 翻转中的节点 id」打开
  canvasMarkPick.value = emptyMarkPick()
  canvasMarkTap.value = null
  flipNodeId.value = ''
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('paste', onWindowPaste)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('wheel', onWindowWheel, true)
  if (flowPaneResizeObserver) {
    flowPaneResizeObserver.disconnect()
    flowPaneResizeObserver = null
  }
  endSpacePan(false)
  $destroy()
})

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target || connection.source === connection.target)
    return
  if (connection.sourceHandle !== 'out' || connection.targetHandle !== 'in')
    return
  if (idLocked(connection.source) || idLocked(connection.target))
    return
  didConnect = true
  if (edges.value.some(edge => edge.source === connection.source && edge.target === connection.target))
    return
  // 手拖连线走追加模式：用户写过的提示词不盖，上游文本追到末尾（按段去重）；
  // linkNodes 会在下一拍再同步一次（vue-flow 的边不是同步落地的），追加成功才提示可撤销
  linkNodes(connection, {
    mode: 'append',
    onLater: (result) => {
      pushHistory()
      if (result === 'appended')
        notify(t('已把上游文本追加到提示词末尾，Ctrl+Z 可撤销'))
    },
  })
  pushHistory()
}

function onConnectStart({ nodeId, handleId, handleType }: {
  nodeId?: string
  handleId: string | null
  handleType?: 'source' | 'target'
}) {
  didConnect = false
  if (!nodeId || !handleType)
    return
  if (idLocked(nodeId))
    return
  pending.value = { nodeId, handleId, handleType }
}

function onConnectEnd(event?: MouseEvent | TouchEvent) {
  if (didConnect || !pending.value || !event || !('clientX' in event)) {
    pending.value = null
    return
  }
  const el = event.target as HTMLElement | null
  if (el?.closest('.vue-flow__handle, .vue-flow__node, .cnode')) {
    pending.value = null
    return
  }
  const from = pending.value
  pending.value = null
  ignorePaneClick = true
  window.setTimeout(() => {
    ignorePaneClick = false
  }, 250)
  openMenu(event, {
    variant: 'add',
    source: from.handleType === 'source' ? from.nodeId : null,
    target: from.handleType === 'target' ? from.nodeId : null,
    sourceHandle: from.handleType === 'source' ? (from.handleId || 'out') : 'out',
    targetHandle: from.handleType === 'target' ? (from.handleId || 'in') : 'in',
  })
}

function downloadTextNode() {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'text')
    return
  const text = canvasNodePlainText(node) || t('文本')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${String(node.data.label || 'text').replace(/[\\/:*?"<>|]/g, '_')}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function nodePlainText(node: CanvasFlowNode) {
  return canvasNodePlainText(node)
}

function mediaDownloadName(label: string, href: string, mime: string) {
  const base = label.replace(/[\\/:*?"<>|]/g, '_').trim() || 'media'
  if (/\.[a-z0-9]{2,5}$/i.test(base))
    return base
  const fromUrl = href.split('?')[0]?.match(/\.([a-z0-9]{2,5})$/i)?.[1]
  if (fromUrl)
    return `${base}.${fromUrl.toLowerCase()}`
  const rawMime = mime.split('/')[1]?.split(';')[0]?.toLowerCase() || ''
  const ext = rawMime === 'jpeg' ? 'jpg' : rawMime
  if (ext && /^[a-z0-9]{2,5}$/.test(ext))
    return `${base}.${ext}`
  return base
}

async function downloadMediaNode() {
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  const raw = node.data.content?.trim() || node.data.refUrl || ''
  if (!raw || !isMediaUrl(raw)) {
    notify(t('还没有可下载的内容'), 'error')
    return
  }
  const href = resolveMediaUrl(raw)
  try {
    const res = await fetch(href)
    if (!res.ok)
      throw new Error('download failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = mediaDownloadName(String(node.data.label || 'media'), href, blob.type)
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    notify(t('已开始下载'))
  }
  catch {
    notify(t('canvas.download.failed'), 'error')
  }
}

function onTextEditorSave(html: string) {
  if (selectionWriteBlocked()) {
    textEditorOpen.value = false
    return
  }
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'text')
    return
  updateNodeData(node.id, { content: html, mode: 'idle' })
  textEditorOpen.value = false
  pushHistory()
}

function applySelectionAlign(name: string) {
  if (props.readonly || canvasLocked.value || practiceBlocked())
    return
  const list = selectedNodes.value.filter(item => !nodeLocked(item))
  if (name === 'distribute-h')
    distributeFlowNodes(list, nodes.value, 'horizontal')
  else if (name === 'distribute-v')
    distributeFlowNodes(list, nodes.value, 'vertical')
  else if (name.startsWith('align-'))
    alignFlowNodes(list, nodes.value, name.slice('align-'.length) as NodeAlignMode)
  else
    return
  pushHistory()
}

function onSelAction(name: string) {
  // 选中浮动条在跟练期间本来就不渲染（见模板的 v-if）：这里再兜一道，
  // 因为它是媒体动作 / 派生任务 / 图片编辑的入口（反推提示词 / 高清 / 三视图 / 续写 / 分离音轨…全是真提交）
  if (practiceBlocked())
    return
  if (name === 'lock') {
    toggleLockSelected()
    return
  }
  // 下载是读操作：锁定条上 data-keep 仍可点，不能被写入闸提前 return
  const allowWhenLocked = name === 'download'
  if (!allowWhenLocked && selectionWriteBlocked())
    return
  if (name === 'grid-split') {
    onGridSplit()
    return
  }
  if (name === 'montage') {
    if (!montageAvailable.value) {
      notify(t('请先选中两张以上带图的图片节点'), 'error')
      return
    }
    if (ensureMediaAction('montage'))
      montageOpen.value = true
    return
  }
  if (name === 'compose') {
    if (!composeReady(selectedNodes.value.filter(isContentNode).map(node => ({ kind: node.data.kind, assetId: node.data.assetId })))) {
      notify(t('canvas.compose.needTwo'), 'error')
      return
    }
    const catalog = mediaActionIfListed(mediaActions.value, 'compose')
    if (!catalog.available) {
      notify(catalog.reason || t('该功能暂未开放'), 'error')
      return
    }
    if (!canEditCanvas('放入'))
      return
    composeOpen.value = true
    return
  }
  if (name === 'merge-videos') {
    const clips = mergeClipList.value
    if (clips.length < 2) {
      notify(t('canvas.merge.needTwo'), 'error')
      return
    }
    if (clips.some(item => nodeLocked(findNode(item.id) as CanvasFlowNode | undefined))) {
      notify(t('canvas.merge.locked'), 'error')
      return
    }
    if (!canEditCanvas('放入'))
      return
    void mergeSelectedVideos(clips)
    return
  }
  if (name.startsWith('align-') || name.startsWith('distribute-')) {
    applySelectionAlign(name)
    return
  }
  if (name === 'add-bgm') {
    addBgmForSelected()
    return
  }
  if (name === 'save-workflow') {
    void saveWorkflow()
    return
  }
  dispatchCanvasSelAction(name, {
    group: groupSelected,
    ungroup: ungroupSelected,
    collapse: toggleGroupCollapse,
    duplicate: duplicateSelected,
    shrink: () => scaleTextNode(0.85),
    grow: () => scaleTextNode(1.15),
    download: () => {
      if (barMode.value === 'text')
        downloadTextNode()
      else
        downloadMediaNode()
    },
    expand: () => { textEditorOpen.value = true },
    regen: () => { void onGenerate(inspectorRef.value?.generatePayload?.(), selected.value || undefined) },
    brush: () => openMarkEditor(selected.value, 'mark'),
    inpaint: () => openMarkEditor(selected.value, 'erase'),
    smartEdit: openSmartEdit,
    depth: openDepthBar,
    light: openLightPanel,
    multiview: openAnglePanel,
    promptReverse: () => { void runPromptReverse() },
    crop: openCropEditor,
    frameCrop: openFrameCropEditor,
    removeSubtitles: () => openEraseBar('smart'),
    boxSubtitles: () => openEraseBar('box'),
    separate: () => { void onSeparateAv('音轨') },
    extractVoice: () => { void onSeparateAv('人声') },
    extractBgm: () => { void onSeparateAv('背景音') },
    transcribe: () => { void onTranscribe() },
    removeSilence: () => { void onRemoveSilence() },
    outpaint: openOutpaintEditor,
    flip: openFlipEditor,
    runUpscale: scale => { void runUpscale(scale) },
    runRemoveBg: name => { void runRemoveBg(name) },
    runThreeView: name => { void runThreeView(name) },
    hd: onNodeMenuHd,
    viral: openViralBar,
    videoSplit: openSplitStrip,
    retake: onNodeMenuRetake,
    smartExtend: openExtendStudio,
    clipCut: openClipStrip,
    frameByFrame: onNodeMenuFramePull,
    depthMotion: onNodeMenuDepthMotion,
    smartMatting: openMattingBar,
    captureFrame: () => { void onCaptureVideoFrame('current') },
    captureFirst: () => { void onCaptureVideoFrame('first') },
    captureLast: () => { void onCaptureVideoFrame('last') },
    runSubject: name => { void runSubjectAction(name) },
    runImageEdit: name => { void runImageEdit(name) },
    saveWorkflow: () => { void saveWorkflow() },
    // 走到这儿说明按钮发了个没人接的动作（漏收尾的入口）：如实说「暂不可用」，
    // 原来那句「请先选择节点」会把真实原因盖掉。dev 下把动作名打出来，便于定位漏接的按钮。
    fallback: () => {
      if (import.meta.dev)
        console.warn('[canvas] 未处理的选区动作：', name)
      notify(t('这个操作暂不可用'), 'error')
    },
  })
}

const bgmPending = new Set<string>()
const bgmMixStarted = new Set<string>()

async function ensureCanvasAudioModel() {
  if (!generationModels.value.some(item => item.type === 'audio')) {
    const res = await taskApi.models()
    if (res?.success && Array.isArray(res.data)) {
      generationModels.value = res.data
      generationModelsLoaded.value = true
    }
  }
  return generationModels.value.find(item => item.type === 'audio')?.model || ''
}

/** 配乐已经生成过、还没混进去时，再点一次直接混，不再重新生成 */
function readyBgmNode(videoId: string, videoAssetId: number) {
  return nodes.value.find(item =>
    isContentNode(item)
    && item.data.kind === 'audio'
    && item.data.bgmMix?.videoNodeId === videoId
    && item.data.bgmMix.videoAssetId === videoAssetId
    && Number(item.data.assetId) > 0
    && item.data.taskStatus === 'succeeded',
  )
}

async function finishBgmMix(audioId: string, audioAssetId?: number) {
  if (bgmMixStarted.has(audioId))
    return
  const audio = findNode(audioId) as CanvasFlowNode | undefined
  if (!audio || !isContentNode(audio) || !audio.data.bgmMix)
    return
  const plan = audio.data.bgmMix
  const assetId = Number(audioAssetId || audio.data.assetId || 0)
  if (!plan.videoAssetId || !assetId) {
    bgmPending.delete(plan.videoNodeId)
    return
  }
  bgmMixStarted.add(audioId)
  const source = findNode(plan.videoNodeId) as CanvasFlowNode | undefined
  const from = source && isContentNode(source) && source.data.kind === 'video' ? source : audio
  const mixed = spawnMediaNode(from, 'video', '配乐成片', t('配乐成片'), {
    at: from.id === audio.id
      ? undefined
      : { x: audio.position.x, y: audio.position.y + (Number(audio.height) || 140) + 36 },
    data: { prompt: from.data.prompt || '' },
    select: true,
    link: true,
  })
  try {
    const ok = await submitMediaJob(mixed, 'mix_bgm', { asset_id: plan.videoAssetId }, {
      audio_asset_id: assetId,
      volume: 0.2,
    }, { label: '混入配乐', dropOnFail: [mixed.id] })
    if (ok)
      updateNodeData(audioId, { bgmMix: null })
    else
      bgmMixStarted.delete(audioId)
  }
  finally {
    bgmPending.delete(plan.videoNodeId)
  }
}

async function addBgmForSelected() {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'video') {
    notify(t('请先选择节点'))
    return
  }
  if (practiceBlocked() || !canEditCanvas('放入'))
    return
  if (!node.data.assetId) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  if (!mediaActions.value.length)
    await loadMediaActions()
  if (!mediaActions.value.length) {
    notify(t('提交失败'), 'error')
    return
  }
  if (!ensureMediaAction('mix_bgm'))
    return
  if (bgmPending.has(node.id)) {
    notify(t('这段视频正在配乐'))
    return
  }
  const ready = readyBgmNode(node.id, node.data.assetId)
  if (ready && isContentNode(ready)) {
    bgmPending.add(node.id)
    await finishBgmMix(ready.id, ready.data.assetId)
    bgmPending.delete(node.id)
    return
  }
  let model = ''
  try {
    model = await ensureCanvasAudioModel()
  }
  catch {
    notify(t('提交失败'), 'error')
    return
  }
  if (!model) {
    notify(t('暂无音频模型，暂时不能配乐'), 'error')
    return
  }
  const mood = 'pulse'
  const videoId = node.id
  bgmPending.add(videoId)
  const audio = spawnMediaNode(node, 'audio', audioKindTag('bgm'), t('canvas.audio.kind.bgm'), {
    data: {
      prompt: audioMoodPrompt(mood),
      params: audioKindParams('bgm', mood),
      bgmMix: { videoNodeId: videoId, videoAssetId: node.data.assetId },
    },
    link: false,
  })
  try {
    const task = await submitDerivedTask(audio, '配乐', {
      type: 'audio',
      model,
      prompt: audioMoodPrompt(mood),
      params: audioKindParams('bgm', mood),
    })
    if (!task || task.status === 'failed' || task.status === 'cancelled') {
      bgmPending.delete(videoId)
      return
    }
    if (task.status === 'succeeded') {
      await finishBgmMix(audio.id, task.result_asset_id)
      return
    }
    const done = await waitTask(audio.id, task.id, 360_000)
    if (done?.status === 'succeeded') {
      await finishBgmMix(audio.id, done.result_asset_id)
      return
    }
    if (!done) {
      notify(t('配乐还在生成，完成后会自动混进当前视频'))
      return
    }
    bgmPending.delete(videoId)
  }
  catch (err) {
    bgmPending.delete(videoId)
    notify(err instanceof Error ? err.message : t('提交失败'), 'error')
  }
}

function onPick(kind: CanvasMenuKind) {
  if (kind === 'upload' || kind === 'library') {
    const origin = menu.value
    menu.value = null
    openAssetPicker({
      mode: 'add',
      autoUpload: kind === 'upload',
      title: kind === 'upload' ? t('上传资产') : t('从资产库选择'),
      flowX: origin ? origin.flowX - 20 : undefined,
      flowY: origin ? origin.flowY - 40 : undefined,
      link: origin && (origin.source || origin.target)
        ? { source: origin.source, target: origin.target, sourceHandle: origin.sourceHandle, targetHandle: origin.targetHandle }
        : null,
    })
    return
  }
  const origin = menu.value
  const parentId = addInto.value
  const id = addNode(kind, (origin?.flowX ?? 0) - 20, (origin?.flowY ?? 0) - 40, parentId)
  if (!id || !origin || !(origin.source || origin.target))
    return
  if (idLocked(origin.source || origin.target))
    return
  nextTick(() => {
    if (origin.source) {
      linkNodes({
        source: origin.source,
        target: id,
        sourceHandle: origin.sourceHandle || 'out',
        targetHandle: 'in',
      }, { mode: 'append' })
      return
    }
    if (origin.target) {
      linkNodes({
        source: id,
        target: origin.target,
        sourceHandle: 'out',
        targetHandle: origin.targetHandle || 'in',
      }, { mode: 'append' })
    }
  })
}

function onInspectorPrompt(value: string) {
  // 提示词框本体是 contenteditable，HTML 的 readonly 对它无效：写入侧必须自己再拦一道
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  const ids = cameraIdsInPrompt(value)
  node.data.prompt = value
  node.data.cameraMoves = ids.length ? [...new Set(ids)] : undefined
  node.data.cameraMove = ids.at(-1) || undefined
  notifyChange()
}

function onInspectorGenerate(payload?: GeneratePayload) {
  if (selected.value && nodeLocked(selected.value)) {
    notify(t('节点已锁定'))
    return
  }
  void onGenerate(payload, selected.value || undefined)
}

function onInspectorSend() {
  // send 与 generate 是两条 emit：跟练的主动作（点生成看回放）走的是 @generate，必须放行；
  // send 属编辑侧出口，跟练期间一并拦下
  if (selectionWriteBlocked())
    return
  void onGenerate(undefined, selected.value || undefined)
}

/** 主体引用（API.md 10.2）：记在节点 data.subjectIds 上，随画布保存 */
function onInspectorSubjects(ids: number[], versions: Record<string, number> = {}) {
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { subjectIds: ids.slice(0, 4), subjectVersions: versions })
  pushHistory()
}

/** 检查器选中的模型写回 data.model，生成 / 估价 / 跟练卡片都跟这一份走 */
function onInspectorModel(model: string) {
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  const id = String(model || '').trim()
  if (!id || id === String(node.data.model || ''))
    return
  updateNodeData(node.id, { model: id })
  notifyChange()
}

/** 视频生成模式记在节点 data.videoMode 上，重新选中或刷新后面板仍是原来的模式 */
function onInspectorVideoMode(mode: NonNullable<import('~/utils/canvas-node-kinds').CanvasNodeData['videoMode']>) {
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { videoMode: mode })
  notifyChange()
}

/** 口播预设（API.md 24.9）：台词 / 语气 / 景别 / 手动时长记在节点 data.talking 上，随画布保存 */
function onInspectorTalking(data: import('~/utils/canvas-talking').TalkingData) {
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { talking: { ...data } })
  notifyChange()
}

/** 检查器规格（含音频语种 / 音色）写回 data.params，随画布保存 */
function onInspectorParams(params: Record<string, unknown>) {
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { params: { ...params } })
  notifyChange()
}

function organizeCanvas() {
  // 整理会把所有节点重新排版（真写节点坐标）：跟练的写入白名单里没有它，跟练期间不放
  if (practiceBlocked())
    return
  const list = nodes.value.filter(node => !node.parentNode && !nodeLocked(node))
  if (!list.length) {
    fitView({ padding: 0.24 })
    return
  }
  const byId = new Map(list.map(node => [node.id, node]))
  const payload = list.map((node) => {
    const size = nodeSize(node)
    return { id: node.id, width: size.w, height: size.h }
  })
  for (const item of canvasOrganizePositions(payload, edges.value)) {
    const node = byId.get(item.id)
    if (node)
      node.position = { x: item.x, y: item.y }
  }
  nextTick(() => {
    fitView({ padding: 0.24, duration: 220 })
    pushHistory()
  })
}

function panMinimapTo(el: HTMLElement, event: PointerEvent) {
  // 小地图拖动同样是程序化 setCenter（没有 sourceEvent，@move-start 收不到）：先停掉在飞的相机补间（§6.3）
  practiceCamera.cancel()
  const rect = el.getBoundingClientRect()
  const box = mini.value
  const flowX = box.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * box.w
  const flowY = box.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * box.h
  setCenter(flowX, flowY, { zoom: viewport.value.zoom })
}

function onMinimapPointer(event: PointerEvent) {
  const el = event.currentTarget as HTMLElement
  el.setPointerCapture(event.pointerId)
  panMinimapTo(el, event)
  function onMove(move: PointerEvent) {
    panMinimapTo(el, move)
  }
  function onUp() {
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}

function onNodeMenuAssist() {
  const node = selected.value
  nodeMenu.value = null
  if (node)
    emit('assist', node.id)
}

function onNodeMenuComment() {
  const node = selected.value
  nodeMenu.value = null
  if (node)
    emit('comment', node.id)
}

function onHelp() {
  helpOpen.value = true
}

function onNodeDblClick({ node }: NodeMouseEvent) {
  // 双击文本节点会把它切成编辑态（mode:'write'）：文本节点正是跟练自己建的教具（角色设定 / 分镜脚本），
  // 能改字就是「能编辑画布内容」，跟练期间直接不进编辑态
  if (practiceBlocked())
    return
  if (nodeLocked(node as CanvasFlowNode))
    return
  if (!isContentNode(node as CanvasFlowNode) || node.data.kind !== 'text')
    return
  updateNodeData(node.id, { mode: 'write' })
}

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function tx(key: string, params?: Record<string, unknown>) {
  const raw = String(params ? t(key, params) : t(key))
  if (!params)
    return raw
  const vars: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number')
      vars[name] = value
  }
  return fillI18n(raw, vars)
}

const applyMediaJobToNodeRef = { fn: (_nodeId: string, _job: MediaJob) => {} }
/** 运行队列实例建在后面：提交任务的路径先从这里通知它（与本文件 laterFns / applyMediaJobToNodeRef 同一手法） */
const runQueueNotify = { submitted: () => {} }
const laterFns = {
  dropNode: (_id: string) => {},
  groupNodeList: (_ids: string[]) => {},
  joinGroup: (_group: CanvasFlowNode & { data: import('~/utils/canvas-group').CanvasGroupData }, _ids: string[]) => {},
}

const {
  applyTaskToNode,
  pollTask: pollTaskRaw,
  stopPolling,
  pollMediaJob: pollMediaJobRaw,
  resumePolling,
  waitTask,
  waitMediaJob,
} = useCanvasJobPolling({
  findNode,
  nodes,
  updateNodeData,
  pushHistory,
  notify,
  t: tx,
  applyMediaJobToNode: (id, job) => applyMediaJobToNodeRef.fn(id, job),
  onTaskSucceeded: (nodeId, task) => { void finishBgmMix(nodeId, task.result_asset_id) },
})

/**
 * 所有提交路径都从这里开始轮询（节点生成 / 节点重跑 / 一稿多版 / 视频重拍续写 / 媒体作业的模型动作），
 * 顺手通知运行队列查一次：不然面板关着、当前又一条进行中的都没有时不会轮询，
 * 新任务与工具轨角标要等手动打开面板才出现。
 */
function pollTask(nodeId: string, taskId: number) {
  runQueueNotify.submitted()
  pollTaskRaw(nodeId, taskId)
}

/** 媒体作业同理：模型动作会在服务端起一条生成任务，队列也要立刻看到（本地动作没有任务，最多白查一次） */
function pollMediaJob(nodeId: string, jobId: number) {
  runQueueNotify.submitted()
  pollMediaJobRaw(nodeId, jobId)
}

const {
  mediaActions,
  loadMediaActions,
  ensureMediaAction,
  mediaSourceOf,
  mediaSourceNode,
  spawnMediaNode,
  spawnDerivedImage,
  spawnDerivedText,
  applyMediaJobToNode,
  submitMediaJob,
  submitDerivedTask,
} = useCanvasMediaJobs({
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  updateNodeData,
  updateNode,
  addNodes: node => addNodes(node),
  addEdges: edge => addEdges(edge as any),
  addSelectedNodes: list => addSelectedNodes(list as any),
  nodes,
  edges,
  counts,
  defaultEdgeOptions,
  pushHistory,
  notify,
  t: tx,
  canvasId: () => props.canvasId,
  refreshWallet,
  pollMediaJob,
  pollTask,
  applyTaskToNode,
  dropNode: id => laterFns.dropNode(id),
  groupNodeList: ids => laterFns.groupNodeList(ids),
  gateSpend,
  estimateSpend,
  // 真提交点的最后一道闸（媒体作业 / 派生任务：submitMediaJob 与 submitDerivedTask 两条都会先问它）：
  // 这里只回答「现在是不是跟练中」，提示由真提交点自己给，免得同一动作弹两次 toast
  blocked: () => practiceLocked.value,
})

/** 高清源视频时长：节点参数 / 资产库 / 探测，供报价和提交共用 */
const hdSourceSeconds = ref(0)

/**
 * 视频高清面板单价：和提交用的超分模型同一条。
 * 按秒计价用源视频时长；还没读到时按 5 秒估，和服务端 EstimateTaskPoints 回落一致。
 */
const hdCost = computed(() => {
  const node = selected.value
  if (!node || !isContentNode(node) || !isHdNode(node.data))
    return undefined
  const models = mediaActions.value.find(item => item.action === 'upscale')?.models || []
  const model = pickHdUpscaleModel(node.data.hdParams, models)
  if (!model)
    return undefined
  return estimateSpend(model, { duration: estimateSecondDuration(hdSourceSeconds.value) }) || undefined
})

const { running: mergeRunning, mergeClips: mergeSelectedVideos } = useCanvasVideoMerge({
  nodes,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  spawnMediaNode,
  addEdges: edge => addEdges({ ...edge, ...defaultEdgeOptions } as any),
  updateNodeData,
  pushHistory,
  notify,
  t: tx,
  blocked: () => practiceLocked.value,
})

const { run: composeRun, submit: submitCompose, resume: composeResume } = useCanvasCompose({
  canvasId: () => props.canvasId,
  nodes,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  updateNodeData,
  spawnMediaNode,
  dropNode: id => laterFns.dropNode(id),
  requestSave: async () => { await props.requestSave?.() },
  pushHistory,
  notify,
  t: tx,
  track,
  blocked: () => practiceLocked.value,
})

function persistComposeTrims(items: ComposeSource[]) {
  for (const item of items) {
    const node = findNode(item.id) as CanvasFlowNode | undefined
    if (!node || !isContentNode(node))
      continue
    const nextIn = item.trimIn || 0
    const nextOut = item.trimOut || 0
    if (nodeLocked(node))
      continue
    if ((Number(node.data.trimIn) || 0) === nextIn && (Number(node.data.trimOut) || 0) === nextOut)
      continue
    updateNodeData(node.id, {
      trimIn: nextIn || undefined,
      trimOut: nextOut || undefined,
    })
  }
}

function onComposeConfirm(options: ComposeOptions, ordered: ComposeSource[]) {
  if (!canEditCanvas('放入'))
    return
  persistComposeTrims(ordered)
  composeOpen.value = false
  void submitCompose(ordered, options)
}

function spawnDepthNode(from: CanvasFlowNode & { data: CanvasNodeData }) {
  // 深度提取会真提交 media job：跟练期间连节点都不落，别留下一张跑不起来的空壳
  if (practiceBlocked())
    return
  const size = nodeSize(from)
  const scale = depthResolution.value === '720p' ? 1 : 854 / 1280
  const w = Math.max(240, Math.round(size.w * scale))
  const kind = from.data.kind === 'image' ? 'image' : 'video'
  const h = kind === 'image'
    ? Math.max(136, Math.round(size.h * scale))
    : Math.max(136, Math.round(w * 9 / 16))
  return spawnMediaNode(from, kind, '深度提取', t('深度提取'), {
    w,
    h,
    link: false,
    data: {
      depthParams: {
        sourceId: from.id,
        resolution: depthResolution.value,
        model: depthModel.value,
      },
    },
  })
}

applyMediaJobToNodeRef.fn = applyMediaJobToNode

function onBarUnavailable(_name: string, reason: string) {
  notify(reason || t('该功能暂未开放'), 'error')
}

const retakeReason = computed(() => mediaActionState(mediaActions.value, 'retake_segment').reason)

/** 主体消除 / 修改 / 替换 / 智能抠像：模型动作，按清单可用性放行；修改 / 替换要提示词 */
async function runSubjectAction(name: 'remove-subject' | 'edit-subject' | 'replace-subject' | 'smart-matting', targetId = '') {
  // 这四个都是模型动作（会真提交任务并扣点）
  if (practiceBlocked())
    return
  const from = (targetId ? findNode(targetId) : selected.value) as CanvasFlowNode | null
  if (!from || !isContentNode(from) || from.data.kind !== 'video')
    return
  const action = name === 'remove-subject'
    ? 'subject_remove'
    : name === 'edit-subject'
      ? 'subject_modify'
      : name === 'replace-subject'
        ? 'subject_replace'
        : 'matting'
  const tag = name === 'remove-subject' ? '主体消除' : name === 'edit-subject' ? '主体修改' : name === 'replace-subject' ? '主体替换' : '智能抠像'
  if (!ensureMediaAction(action))
    return
  const src = String(from.data.content || '').trim()
  if (!src || !isMediaUrl(src)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  const source = mediaSourceOf(from)
  if (!source)
    return
  const params: Record<string, unknown> = {}
  if (action === 'subject_modify' || action === 'subject_replace') {
    let prompt = stripCameraTokens(String(from.data.prompt || '')).trim()
    if (!prompt) {
      const typed = typeof window !== 'undefined'
        ? window.prompt(action === 'subject_modify' ? t('描述要把主体改成什么') : t('描述要把主体替换成什么'), '')
        : ''
      prompt = String(typed || '').trim()
    }
    if (!prompt) {
      notify(t('请先填写提示词'))
      return
    }
    params.prompt = prompt
  }
  const sourceLabel = from.data.label || t('视频节点')
  const sibling = spawnMediaNode(from, 'video', tag, `${sourceLabel}_${t(tag)}`, {
    data: { prompt: typeof params.prompt === 'string' ? params.prompt : '' },
    select: true,
  })
  await submitMediaJob(sibling, action, source, params, { label: tag, dropOnFail: [sibling.id] })
}

/** 拉片节点点「开始拉片」→ 媒体作业 storyboard */
const canvasFrameSubmit = useState<{ seq: number, nodeId: string, count: number, analyze: boolean } | null>('canvas-frame-submit', () => null)
watch(canvasFrameSubmit, (payload) => {
  if (!payload)
    return
  canvasFrameSubmit.value = null
  void onFrameSubmit(payload.nodeId, { count: payload.count, analyze: payload.analyze })
})

async function onFrameSubmit(nodeId: string, payload: { count: number, analyze: boolean }) {
  // 逐帧拉片是媒体动作（真提交且扣点），跟练期间挡在提交之前
  if (practiceBlocked() || idLocked(nodeId))
    return
  const node = findNode(nodeId) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node) || !isFramePullNode(node.data) || canvasLocked.value)
    return
  if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return
  }
  if (!ensureMediaAction('storyboard'))
    return
  const source = mediaSourceOf(mediaSourceNode(node, node.data.frameParams?.sourceId))
  if (!source)
    return
  updateNodeData(node.id, {
    frameParams: { sourceId: '', sourceLabel: '', ...node.data.frameParams, count: payload.count, analyze: payload.analyze },
  })
  await submitMediaJob(node, 'storyboard', source, { count: payload.count, analyze: payload.analyze }, { label: '逐帧拉片' })
}

/** 节点上的取消按钮：模型动作 / 生成任务都走 POST /user/task/:id/cancel，状态由轮询带回来 */
const canvasTaskCancel = useState<{ seq: number, nodeId: string, taskId: number } | null>('canvas-task-cancel', () => null)
watch(canvasTaskCancel, (payload) => {
  if (!payload)
    return
  canvasTaskCancel.value = null
  void cancelNodeTask(payload.nodeId, payload.taskId)
})

async function cancelNodeTask(nodeId: string, taskId: number) {
  if (idLocked(nodeId))
    return
  const node = findNode(nodeId) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node) || !(taskId > 0))
    return
  const res = await taskApi.cancel(taskId)
  if (!res?.success) {
    notify(res?.message || t('取消失败'), 'error')
    return
  }
  notify(t('已取消任务'))
  void refreshWallet()
  if (node.data.mediaJobId) {
    // 作业接口会把任务取消映射成失败，这里只提前查一次让节点别再转圈
    const job = await mediaApi.get(node.data.mediaJobId)
    if (job?.success && job.data)
      applyMediaJobToNode(nodeId, job.data)
    return
  }
  const task = await taskApi.get(taskId)
  if (task?.success && task.data) {
    applyTaskToNode(nodeId, task.data)
    if (task.data.status !== 'pending' && task.data.status !== 'running')
      stopPolling(nodeId)
  }
}

/** 片段重拍（API.md 23.8）：重拍节点上点「生成」→ 媒体作业 retake_segment，成片写回该节点 */
async function submitRetakeSegment(node: CanvasFlowNode & { data: CanvasNodeData }, payload?: GeneratePayload) {
  // 重拍是媒体动作（真提交）：跟练期间不放手（成片不可能是跟练产生的，没有放行的理由）
  if (practiceBlocked())
    return
  const params = node.data.retakeParams
  if (!params)
    return
  if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return
  }
  if (!ensureMediaAction('retake_segment'))
    return
  const range = retakeSegmentRange(params)
  if (!range) {
    notify(t('请在胶片条上圈选至少 0.5 秒的片段'), 'error')
    return
  }
  const source = mediaSourceOf(mediaSourceNode(node, params.sourceId))
  if (!source)
    return
  let prompt = stripCameraTokens(String(node.data.prompt || '')).trim()
  if (prompt)
    prompt = expandMarkTokens(expandCameraTokens(prompt), node.data.markElements)
  const model = String(payload?.model || '').trim()
  await submitMediaJob(node, 'retake_segment', source, {
    ...range,
    prompt,
    model,
    keep_audio: true,
  }, { label: '片段重拍', model })
}

function openTextPick(mode: 'skill' | 'template' | 'prompt') {
  textPickMode.value = mode
  textPickOpen.value = true
}

function onTextPicked(text: string, title?: string) {
  textPickOpen.value = false
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'text')
    return
  const body = text.trim()
  if (!body)
    return
  if (textPickMode.value === 'skill')
    updateNodeData(node.id, { prompt: body, label: title || node.data.label })
  else {
    const prev = (node.data.content || '').trimEnd()
    updateNodeData(node.id, { content: prev ? `${prev}\n${body}` : body })
  }
  pushHistory()
  notify(title ? t('已插入「{name}」', { name: title }) : t('已插入'))
}

function markSourceOf(node: CanvasFlowNode) {
  if (!isContentNode(node))
    return ''
  if (node.data.kind === 'image') {
    const content = node.data.content?.trim() || ''
    if (content && isMediaUrl(content))
      return content
  }
  if (node.data.refUrl && isMediaUrl(node.data.refUrl))
    return node.data.refUrl
  return ''
}

function openMarkEditor(node = selected.value, kind: 'mark' | 'erase' = 'mark') {
  if (!node || !isContentNode(node) || nodeLocked(node))
    return
  const src = markSourceOf(node)
  if (!src) {
    notify(t('请先添加参考图或生成一张图，再标记区域'), 'error')
    return
  }
  markNodeId.value = node.id
  markSrc.value = resolveMediaUrl(src)
  markExisting.value = kind === 'mark' && node.data.markUrl ? resolveMediaUrl(node.data.markUrl) : ''
  markMode.value = kind
  closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'outpaint', 'flip'])
  markOpen.value = true
}

function startMarkPick(node = selected.value) {
  if (!node || !isContentNode(node) || nodeLocked(node))
    return
  canvasMarkPick.value = {
    open: true,
    ownerId: node.id,
    analyzingId: '',
    // 本轮只画新点的框，旧标记留在提示词里，画面上不带出来
    baselineIds: (node.data.markElements ?? []).map(item => item.id),
  }
  notify(t('canvas.mark.clickHint'))
}

let markHitEpoch = 0

function closeMarkPick() {
  markHitEpoch++
  const ownerId = canvasMarkPick.value.ownerId
  canvasMarkPick.value = emptyMarkPick()
  canvasMarkTap.value = null
  if (!ownerId)
    return
  const owner = findNode(ownerId)
  if (owner)
    addSelectedNodes([owner])
}

let markHitPending = 0

function commitMark(ownerId: string, sourceNodeId: string, name: string, box: CanvasMarkBox) {
  if (!canvasMarkPick.value.open || canvasMarkPick.value.ownerId !== ownerId)
    return
  const owner = findNode(ownerId) as CanvasFlowNode | undefined
  if (!owner || !isContentNode(owner) || nodeLocked(owner))
    return
  const items = [...(owner.data.markElements ?? [])]
  const row = {
    id: newMarkId(),
    name: name || t('canvas.mark.label', { n: items.length + 1 }),
    sourceNodeId,
    box,
  }
  items.push(row)
  updateNodeData(owner.id, {
    markElements: items,
    prompt: insertMarkToken(owner.data.prompt || '', row.id).prompt,
  })
  pushHistory()
}

function finishMarkHit() {
  markHitPending = Math.max(0, markHitPending - 1)
  if (markHitPending === 0 && canvasMarkPick.value.open)
    canvasMarkPick.value = { ...canvasMarkPick.value, analyzingId: '' }
}

async function waitMarkHit(taskId: number, alive: () => boolean) {
  for (let i = 0; i < 45; i++) {
    await new Promise(resolve => setTimeout(resolve, 1600))
    if (!alive())
      throw new Error('cancelled')
    const res = await taskApi.get(taskId)
    const task = res?.data
    if (!res?.success || !task)
      continue
    if (task.status === 'succeeded')
      return String(task.result_text || '')
    if (task.status === 'failed' || task.status === 'cancelled')
      throw new Error(task.error_msg || t('识别失败，请稍后重试'))
  }
  throw new Error(t('识别超时，请稍后重试'))
}

/** 点在图上的位置交给看图模型：认出物体名称，并按它的范围落框 */
async function placeMark(nodeId: string, x: number, y: number) {
  const owner = findNode(canvasMarkPick.value.ownerId) as CanvasFlowNode | undefined
  const image = findNode(nodeId) as CanvasFlowNode | undefined
  if (!owner || !isContentNode(owner) || !image || !isContentNode(image) || nodeLocked(owner))
    return
  if (image.data.kind !== 'image' && image.data.kind !== 'panorama') {
    notify(t('只有图片能标记'))
    return
  }
  if (!nodeImageUrl(image)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (practiceBlocked())
    return
  const ownerId = owner.id
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickVisionTextModel(models, growthConfig.value?.vision_text_model)
  if (!model) {
    notify(t('暂无能识别图片的文本模型，请联系运营开通'), 'error')
    return
  }
  if (!await gateSpend(estimateSpend(model, {})))
    return
  const epoch = markHitEpoch
  const alive = () => epoch === markHitEpoch && canvasMarkPick.value.open && canvasMarkPick.value.ownerId === ownerId
  if (!alive())
    return
  markHitPending++
  canvasMarkPick.value = { ...canvasMarkPick.value, analyzingId: nodeId }
  try {
    // 原图在 CDN 上，浏览器跨域读不了像素。只把已有资产 id 交给看图任务，由服务端自己取图。
    let assetId = Number(image.data.assetId || image.data.refAssetId || 0)
    if (!assetId)
      assetId = await ensureNodeImageAsset(image)
    if (!alive())
      return
    if (!assetId)
      throw new Error(t('原图无法读取，请先把图片上传到资产库再编辑'))
    const res = await taskApi.create({
      type: 'text',
      model,
      prompt: markHitInstruction(x, y, locale.value),
      params: { mark_hit: true },
      inputs: [{ asset_id: assetId, role: 'image' }],
      canvas_id: props.canvasId || undefined,
    })
    if (!alive())
      return
    if (!res?.success || !res.data)
      throw new Error(res?.message || t('识别失败，请稍后重试'))
    void refreshWallet()
    const text = res.data.status === 'succeeded'
      ? String(res.data.result_text || '')
      : await waitMarkHit(res.data.id, alive)
    if (!alive())
      return
    const hit = parseMarkHit(text, x, y)
    if (!hit)
      throw new Error(t('识别失败，请稍后重试'))
    commitMark(ownerId, nodeId, hit.name, hit.box)
  }
  catch (error) {
    if (!alive())
      return
    const message = error instanceof Error ? error.message : String(error)
    if (message !== 'cancelled')
      notify(message || t('识别失败，请稍后重试'), 'error')
  }
  finally {
    finishMarkHit()
  }
}

function onRemoveMark(id: string) {
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  const items = (node.data.markElements ?? []).filter(item => item.id !== id)
  updateNodeData(node.id, {
    markElements: items.length ? items : undefined,
    prompt: stripMarkToken(node.data.prompt || '', id),
  })
  pushHistory()
}

watch(() => canvasMarkTap.value?.seq, () => {
  const tap = canvasMarkTap.value
  if (!tap || !canvasMarkPick.value.open)
    return
  placeMark(tap.nodeId, tap.x, tap.y)
})

async function onMarkConfirm(blob: Blob, model?: string) {
  if (markMode.value === 'erase') {
    await runInpaint(blob, model)
    return
  }
  markOpen.value = false
  const node = findNode(markNodeId.value) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node))
    return
  const file = new File([blob], 'mark-mask.png', { type: 'image/png' })
  const res = await assetApi.upload(file)
  if (!res?.success || !res.data) {
    notify(res?.message || t('标记上传失败'), 'error')
    return
  }
  updateNodeData(node.id, { markAssetId: res.data.id, markUrl: res.data.url })
  pushHistory()
  notify(t('已保存标记'))
}

async function runInpaint(blob: Blob, preferredModel?: string) {
  const from = findNode(markNodeId.value) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from))
    return
  if (from.data.taskStatus === 'pending' || from.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickImageEditModel(models, preferredModel || defaultImageModel(), true)
  if (!model) {
    notify(t('暂无支持局部修改的图片模型，请联系运营开通 gpt-image 系模型'), 'error')
    return
  }
  inpaintBusy.value = true
  try {
    const assetId = await ensureNodeImageAsset(from)
    if (!assetId) {
      notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
      return
    }
    const file = new File([blob], 'inpaint-mask.png', { type: 'image/png' })
    const uploaded = await assetApi.upload(file)
    if (!uploaded?.success || !uploaded.data) {
      notify(uploaded?.message || t('标记上传失败'), 'error')
      return
    }
    const prompt = IMAGE_EDIT_PROMPTS.inpaint
    await submitDerivedTask(spawnDerivedImage(from, '移除物体', prompt), '移除物体', {
      type: 'image',
      model,
      prompt,
      params: { edit: 'inpaint', mode: 'i2i' },
      inputs: [
        { asset_id: assetId, role: 'image' },
        { asset_id: uploaded.data.id, role: 'mask' },
      ],
    })
    markOpen.value = false
  }
  finally {
    inpaintBusy.value = false
  }
}

function onCamPick(id: string) {
  const node = selected.value
  camLibOpen.value = false
  if (!node || !isContentNode(node))
    return
  inspectorRef.value?.insertCameraMove?.(id)
  pushHistory()
}

/** 选中宫格预设：提示词接到用户已写的内容后面，比例写进 data.params（Inspector 优先读它） */
function onGridPick(id: string) {
  const node = selected.value
  gridOpen.value = false
  const preset = gridPresetById(id)
  if (!node || !isContentNode(node) || !preset)
    return
  updateNodeData(node.id, gridPresetPatch(preset, node.data.prompt, node.data.params))
  pushHistory()
  notify(t('已套用「{name}」，可以直接生成', { name: t(preset.label) }))
}

function onPresetPick(id: string) {
  const node = selected.value
  presetOpen.value = false
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { fxPreset: id })
  pushHistory()
}

/** 风格库：再点同一个风格即取消；套用即 POST /style/:id/use 记一次，失败静默 */
function onStyleLibPick(style: Style) {
  if (stylePickFor.value === 'extend') {
    styleLibOpen.value = false
    extendStudioRef.value?.applyStyle?.(style)
    stylePickFor.value = ''
    return
  }
  if (stylePickFor.value === 'chat') {
    styleLibOpen.value = false
    emit('chat-style', style)
    stylePickFor.value = ''
    return
  }
  const node = selected.value
  styleLibOpen.value = false
  if (!node || !isContentNode(node))
    return
  if (node.data.stylePreset?.id === style.id) {
    updateNodeData(node.id, { stylePreset: undefined })
    pushHistory()
    notify(t('已清除风格'))
    return
  }
  updateNodeData(node.id, {
    stylePreset: {
      id: style.id,
      name: style.name,
      prompt: style.prompt,
      negative: style.negative || undefined,
    },
  })
  pushHistory()
  styleApi.use(style.id).catch(() => {})
  notify(t('已套用风格「{name}」', { name: style.name }))
}

function onStyleLibClear() {
  if (stylePickFor.value === 'extend') {
    styleLibOpen.value = false
    extendStudioRef.value?.clearStyle?.()
    stylePickFor.value = ''
    return
  }
  if (stylePickFor.value === 'chat') {
    styleLibOpen.value = false
    emit('chat-style', null)
    stylePickFor.value = ''
    return
  }
  const node = selected.value
  styleLibOpen.value = false
  if (!node || !isContentNode(node) || !node.data.stylePreset)
    return
  updateNodeData(node.id, { stylePreset: undefined })
  pushHistory()
  notify(t('已清除风格'))
}

function openStyleLibrary(target: '' | 'extend' | 'chat' = '') {
  stylePickFor.value = target
  styleLibOpen.value = true
}

defineExpose({ getGraph, loadGraph, flushMergeUploads, hasBlobMedia, addNodeAtCenter, insertTextNode, insertImageNodes, insertAudioNodes, insertVideoNodes, resetBriefPlaced, generateBriefPlaced, estimateBriefPlaced, placeBriefVideos, composeBrief, pickAssetFromChat, addAssetNodeAtCenter, selectionLabels, assistContext, applyAssistChanges, undoAssistChanges, openStyleLibrary, refreshRunQueue, locateNode, commentNodeHint })

function commentNodeHint(nodeId: string) {
  return canvasCommentNodeHint(nodes.value, nodeId, t)
}

/** 我的风格：新建 / 编辑都走同一个弹窗，风格库留在底下，保存后只刷新「我的」列表 */
function onStyleLibCreate() {
  styleEditTarget.value = null
  styleEditPreset.value = null
  styleEditFromExtract.value = false
  styleEditOpen.value = true
}

function onStyleLibEdit(style: Style) {
  styleEditTarget.value = style
  styleEditPreset.value = null
  styleEditFromExtract.value = false
  styleEditOpen.value = true
}

function closeStyleEdit() {
  styleEditOpen.value = false
  styleEditFromExtract.value = false
}

function onStyleEditSaved(style: Style) {
  styleMineVersion.value++
  if (!styleEditFromExtract.value)
    return
  styleEditFromExtract.value = false
  // 「从当前图定风格」保存即套用：节点上如果已是别的风格，直接换成新的
  const node = selected.value
  if (node && isContentNode(node) && node.data.stylePreset?.id === style.id)
    return
  onStyleLibPick(style)
}

/**
 * 从当前图定风格（L18，API.md 34.5）：让看图文本模型只输出一段风格描述，
 * 回填到保存表单（名字取片段开头、封面取节点图、留痕来源资产）。
 * 模型选型与反推提示词 / 提示词优化同一套；走普通文本任务计费。
 */
async function runStyleExtract() {
  // 「从当前图定风格」会真提交一个识图文本任务（不经回放拦截），跟练期间必须挡在提交之前
  if (practiceBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node) || styleExtractBusy.value)
    return
  const src = currentImageSrc(node)
  if (node.data.kind !== 'image' || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickVisionTextModel(models, growthConfig.value?.vision_text_model)
  if (!model) {
    notify(t('暂无能识别图片的文本模型，请联系运营开通'), 'error')
    return
  }
  if (!await gateSpend(estimateSpend(model, {})))
    return
  const seq = ++styleExtractSeq
  styleExtractBusy.value = true
  try {
    const assetId = await ensureNodeImageAsset(node)
    if (!assetId)
      throw new Error(t('原图无法读取，请先把图片上传到资产库再编辑'))
    const res = await taskApi.create({
      type: 'text',
      model,
      prompt: styleExtractInstruction(locale.value),
      params: { style_extract: true },
      inputs: [{ asset_id: assetId, role: 'image' }],
      canvas_id: props.canvasId || undefined,
    })
    if (!res?.success || !res.data)
      throw new Error(res?.message || t('提交失败'))
    void refreshWallet()
    const text = res.data.status === 'succeeded'
      ? String(res.data.result_text || '')
      : await waitTextTask(res.data.id, seq, () => seq === styleExtractSeq && styleLibOpen.value)
    if (seq !== styleExtractSeq)
      return
    const { name, prompt } = parseStyleExtract(text)
    if (!prompt)
      throw new Error(t('模型没有返回内容'))
    styleEditTarget.value = null
    styleEditPreset.value = {
      name,
      prompt,
      cover_url: src,
      source_asset_id: assetId,
      kinds: [],
    }
    styleEditFromExtract.value = true
    styleEditOpen.value = true
  }
  catch (error) {
    if (seq !== styleExtractSeq)
      return
    const message = error instanceof Error ? error.message : String(error)
    if (message !== 'cancelled')
      notify(message || t('定风格失败'), 'error')
  }
  finally {
    if (seq === styleExtractSeq)
      styleExtractBusy.value = false
  }
}

function onCameraApply(setup: import('~/utils/canvas-camera').CameraSetup) {
  const node = selected.value
  cameraOpen.value = false
  if (selectionWriteBlocked())
    return
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { camera: setup })
  pushHistory()
  notify(setup.on ? t('已应用摄影配置') : t('已保存摄影配置（未启用）'))
}

function onCameraClear() {
  const node = selected.value
  cameraOpen.value = false
  if (selectionWriteBlocked())
    return
  if (!node || !isContentNode(node))
    return
  updateNodeData(node.id, { camera: undefined })
  pushHistory()
}

function onClearChip(key: string) {
  // chips 上的叉（参考 / 首帧 / 风格 / 主体 / 运镜 / 连线）每一个都是在改节点数据
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  if (key.startsWith('edge:')) {
    const edgeId = key.slice('edge:'.length)
    removeEdges([edgeId])
    pushHistory()
    return
  }
  if (key.startsWith('upload:')) {
    const url = key.slice('upload:'.length)
    const items = uploadedRefList(node.data).filter(item => item.url !== url)
    updateNodeData(node.id, syncRefFields(items))
    pushHistory()
    return
  }
  if (key === 'lens') {
    updateNodeData(node.id, { camera: undefined })
    pushHistory()
    return
  }
  if (key === 'cam') {
    node.data.prompt = stripCameraTokens(node.data.prompt)
    updateNodeData(node.id, { cameraMove: undefined, cameraMoves: undefined, prompt: node.data.prompt })
    pushHistory()
    return
  }
  const field = CANVAS_ATTACH_FIELD[key as CanvasAttachKey]
  if (!field)
    return
  updateNodeData(node.id, { [field.id]: undefined, [field.url]: '' })
  pushHistory()
}

function onInspectorChip(key: string) {
  // chips 与面板按钮（参考 / 标记 / 运镜 / 风格库 / 宫格 / 优化 / 技能模板）都是编辑入口；
  // 跟练自己写进去的这些字段照常渲染（只读查看），但点不动
  if (selectionWriteBlocked())
    return
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  const kind = node.data.kind
  if (key === 'first') {
    openAssetPicker({
      mode: 'attach',
      attach: 'first',
      nodeId: node.id,
      title: t('选择首帧'),
      accept: ['image'],
    })
    return
  }
  if (key === 'ref' || key === 'ref-asset') {
    openAssetPicker({
      mode: 'attach',
      attach: 'ref',
      nodeId: node.id,
      title: kind === 'audio' ? t('选择参考音频') : t('选择参考素材'),
      accept: refAcceptFor(kind),
    })
    return
  }
  if (key === 'ref-local') {
    openAssetPicker({
      mode: 'attach',
      attach: 'ref',
      nodeId: node.id,
      autoUpload: true,
      title: t('上传参考'),
      accept: refAcceptFor(kind),
    })
    return
  }
  if (key === 'ref-canvas') {
    boardPickOpen.value = true
    return
  }
  if (key === 'style') {
    openAssetPicker({
      mode: 'attach',
      attach: 'style',
      nodeId: node.id,
      title: t('选择风格'),
      accept: ['image'],
    })
    return
  }
  if (key === 'voice') {
    openAssetPicker({
      mode: 'attach',
      attach: 'voice',
      nodeId: node.id,
      title: t('选择音色'),
      accept: ['audio'],
    })
    return
  }
  if (key === 'cast') {
    openAssetPicker({
      mode: 'attach',
      attach: 'cast',
      nodeId: node.id,
      title: t('选择角色'),
      accept: ['image', 'video', 'audio'],
    })
    return
  }
  if (key === 'set') {
    openAssetPicker({
      mode: 'attach',
      attach: 'set',
      nodeId: node.id,
      title: t('选择场景'),
      accept: ['image'],
    })
    return
  }
  if (key === 'last') {
    openAssetPicker({
      mode: 'attach',
      attach: 'last',
      nodeId: node.id,
      title: t('选择尾帧'),
      accept: ['image'],
    })
    return
  }
  if (key === 'mark') {
    startMarkPick(node)
    return
  }
  if (key === 'cam') {
    camLibOpen.value = true
    return
  }
  if (key === 'lens') {
    cameraOpen.value = true
    return
  }
  if (key === 'fx') {
    presetOpen.value = true
    return
  }
  if (key === 'stylelib') {
    openStyleLibrary('')
    return
  }
  if (key === 'grid') {
    gridOpen.value = true
    return
  }
  if (key === 'optimize') {
    void runPromptOptimize()
    return
  }
  if (key === 'skill') {
    openTextPick('skill')
    return
  }
  if (key === 'template') {
    openTextPick('template')
    return
  }
  if (key === 'prompt') {
    openTextPick('prompt')
    return
  }
}

function dropNode(id: string) {
  // 跟练里节点是教具，删掉它这一步就再也演示不了：与 removeSelectedNodes 同一道硬闸
  if (practiceLocked.value)
    return
  removeNodes([id], true)
}

function joinGroup(group: CanvasFlowNode & { data: import('~/utils/canvas-group').CanvasGroupData }, ids: string[]) {
  const picked = ids
    .map(id => findNode(id) as CanvasFlowNode | undefined)
    .filter((node): node is CanvasFlowNode => Boolean(node))
  if (!picked.length)
    return
  const origin = absPosition(group, nodes.value)
  for (const node of picked) {
    const abs = absPosition(node, nodes.value)
    node.parentNode = group.id
    node.extent = 'parent'
    node.expandParent = true
    node.position = { x: abs.x - origin.x, y: abs.y - origin.y }
    node.hidden = Boolean(group.data.collapsed)
  }
  nextTick(() => {
    const kids = nodes.value.filter(item => item.parentNode === group.id)
    if (group.data.collapsed) {
      const box = collapsedGroupSize(kids.length, collapseLayoutForKids(kids, group.data.layout))
      setGroupSize(group, box.w, box.h)
    }
    else {
      layoutGroupChildren(group, kids, group.data.layout)
    }
    pushHistory()
  })
}

function groupNodeList(ids: string[]) {
  const picked = ids
    .map(id => findNode(id) as CanvasFlowNode | undefined)
    .filter((node): node is CanvasFlowNode => Boolean(node))
  if (picked.length < 2)
    return
  const box = nodesBounds(picked, nodes.value)
  if (!box)
    return
  const pad = 28
  groupCount.value += 1
  const id = `group-${groupCount.value}`
  const group: CanvasFlowNode = {
    id,
    type: 'group',
    position: { x: box.x - pad, y: box.y - pad },
    data: {
      kind: 'group',
      label: `${t('组')} ${nodes.value.filter(isGroupNode).length + 1}`,
      color: defaultGroupColor(),
      layout: 'row',
    },
    selectable: true,
    draggable: true,
    zIndex: 0,
    width: box.w + pad * 2,
    height: box.h + pad * 2,
    style: { width: `${box.w + pad * 2}px`, height: `${box.h + pad * 2}px` },
  }
  addNodes(group)
  nextTick(() => {
    for (const node of picked) {
      const abs = absPosition(node, nodes.value)
      node.parentNode = id
      node.extent = 'parent'
      node.expandParent = true
      node.position = { x: abs.x - group.position.x, y: abs.y - group.position.y }
    }
    relabelGroups()
    pushHistory()
  })
}

const {
  collectRefImages,
  onGenerate,
  submitting: generating,
} = useCanvasGenerate({
  selected,
  inspectorRef,
  canvasId: () => props.canvasId,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  nodes,
  edges,
  counts,
  addNodes: node => addNodes(node),
  addEdges: edge => addEdges(edge as any),
  defaultEdgeOptions,
  applyMediaNodeSize,
  applyTaskToNode,
  stampInputSnapshot,
  replaySubmit: (node, req) => practice.replaySubmit(node, req),
  pollTask,
  waitTask,
  beforeGenerate: () => linkBriefShotAnchors(),
  pushHistory,
  notify,
  t: tx,
  track,
  gateSpend,
  estimateSpend,
  modelInfo: model => generationModels.value.find(item => item.model === model),
  refreshWallet,
  submitRetakeSegment,
  connectedTextPrompt,
  nodePlainText,
  groupNodeList: ids => laterFns.groupNodeList(ids),
  joinGroup: (group, ids) => laterFns.joinGroup(group, ids),
  linkedImageOf,
  nodeImageUrl,
  uploadedRefList,
  mediaKindOfUrl,
  dropNode: id => laterFns.dropNode(id),
})

laterFns.dropNode = dropNode
laterFns.groupNodeList = groupNodeList
laterFns.joinGroup = joinGroup

// ===== 一稿多版矩阵（平台规格 × 多语言派生）：面板选与算，这里落图 + 交服务端批量 =====

const matrixPanelOpen = ref(false)
/** 面板打开时若模型清单还没拉过就先拉一次（同一份 useState 与 Inspector / 各弹窗共用） */
const matrixModelsLoading = ref(false)

// ===== 运行队列（这幅画布正在跑 / 刚跑完的任务）：面板只渲染，数据在 useCanvasRunQueue =====

const runQueueOpen = ref(false)

/** 连到某个节点上的图片节点（派生版本沿用同一批连线，与 useCanvasGenerate.spawnBatchSibling 同口径） */
function matrixSourceImages(nodeId: string): Array<{ id: string, assetId: number }> {
  const out: Array<{ id: string, assetId: number }> = []
  for (const edge of edges.value) {
    if (edge.target !== nodeId)
      continue
    const src = nodes.value.find(item => item.id === edge.source)
    if (!src || !isContentNode(src) || src.data.kind !== 'image')
      continue
    out.push({ id: src.id, assetId: Number(src.data.assetId) || 0 })
  }
  return out
}

/**
 * 面板的源节点清单：画布上的图片 / 视频节点（没出片的也列出来，选中时面板会说明为什么不能派生）。
 * 用显式循环而不是链式 filter/map：链式在 computed 里会被 vue 与联合类型一起推得过深（TS2589）。
 */
const matrixSources = computed<MatrixSource[]>(() => {
  const out: MatrixSource[] = []
  for (const node of nodes.value) {
    if (!isContentNode(node))
      continue
    const kind = node.data.kind
    if (kind !== 'image' && kind !== 'video')
      continue
    out.push({
      id: node.id,
      kind,
      label: String(node.data.label || node.id),
      prompt: String(node.data.prompt || ''),
      model: String(node.data.model || ''),
      params: node.data.params,
      data: node.data as unknown as Record<string, unknown>,
      assetId: Number(node.data.assetId) || 0,
      content: String(node.data.content || ''),
      images: matrixSourceImages(node.id),
      talking: node.data.talking,
    })
  }
  return out
})

/** 面板的估价：与 Inspector 同口径（定价表 + 会员价，图片按张、视频按秒） */
function matrixEstimate(model: string, params: Record<string, unknown>) {
  return estimateSpend(model, params, 1)
}

/** 目标模型声明的时长 / 分辨率档（封面版按它收敛，与 Inspector 的档位下拉同源） */
function matrixModelDurations(model: string) {
  return generationModels.value.find(item => item.model === model)?.durations || []
}

function matrixModelResolutions(model: string) {
  return generationModels.value.find(item => item.model === model)?.resolutions || []
}

/** 「去充值」：定价弹窗的积分页（与钱包入口同一条路） */
function onMatrixRecharge() {
  gotoPricing('points')
}

const {
  run: matrixRun,
  derive: matrixDerive,
  resubmit: matrixResubmit,
  rollback: matrixRollback,
  action: matrixAction,
  restore: matrixRestore,
} = useCanvasMatrix({
  canvasId: () => props.canvasId,
  nodes,
  counts,
  addNodes: list => addNodes(list),
  addEdges: edge => addEdges(edge as any),
  defaultEdgeOptions,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  updateNodeData,
  removeNodes: ids => removeNodes(ids, true, true),
  groupNodeList,
  pollTask,
  saveCanvas: async () => { await props.requestSave?.() },
  pushHistory,
  notify,
  t: tx,
  track,
  refreshWallet,
  sourceOf: id => matrixSources.value.find(item => item.id === id) ?? null,
  estimate: matrixEstimate,
})

/**
 * 打开一稿多版面板：与工作流面板同一个位置，开一个就关另一个；
 * 顺手把模型清单拉一次（没有它估价永远是 0，面板会一直卡在「定价清单还没加载好」）。
 */
function toggleMatrixPanel() {
  matrixPanelOpen.value = !matrixPanelOpen.value
  if (!matrixPanelOpen.value)
    return
  workflowPanelOpen.value = false
  runQueueOpen.value = false
  if (generationModels.value.length || matrixModelsLoading.value)
    return
  matrixModelsLoading.value = true
  void taskApi.models()
    .then((res) => {
      if (res?.success && Array.isArray(res.data)) {
        generationModels.value = res.data
        generationModelsLoaded.value = true
      }
    })
    .finally(() => { matrixModelsLoading.value = false })
}

// 进画布 / 新建画布后把服务端还在跑的矩阵批次接回来（刷新、换页都不丢结果）
onMounted(() => {
  void matrixRestore()
  composeResume()
})
watch(() => props.canvasId, (id) => {
  if (id) {
    void matrixRestore()
    composeResume()
  }
})

/** 打开工作流面板：同理，把一稿多版 / 运行队列面板让开 */
function openWorkflowPanel() {
  workflowPanelOpen.value = !workflowPanelOpen.value
  if (workflowPanelOpen.value) {
    matrixPanelOpen.value = false
    runQueueOpen.value = false
  }
}

/**
 * 运行队列：这幅画布正在跑 / 刚跑完的任务。与工作流 / 一稿多版同一个位置，开一个就关另一个。
 * 数据与取消 / 重试在 useCanvasRunQueue 里（接既有端点，刷新沿用画布的 hidden-aware 轮询写法）。
 */
/** 取消 / 重试后顶栏的任务角标要跟着变（与钱包同一个全局 state） */
const { refreshActivity } = useTaskActivity()
const runQueue = useCanvasRunQueue({
  canvasId: () => props.canvasId,
  open: () => runQueueOpen.value,
  t: tx,
  notify,
  refreshWallet,
  refreshActivity: () => refreshActivity(),
  pollTask,
  applyTaskToNode,
  confirm: options => confirm(options),
})
const runQueueActive = runQueue.activeCount
/** 画布内刚提交了任务就查一次队列（提交路径见上面的 pollTask，对话栏走 refreshRunQueue） */
runQueueNotify.submitted = () => { void runQueue.noteSubmitted() }
/** 工具轨入口上的角标：超过 99 显示 99+ */
const queueBadge = computed(() => runQueueBadge(runQueueActive.value))
/**
 * 顶层别名，不能直接在模板里写 `runQueue.tasks`：模板只对顶层绑定做 ref 拆包，
 * 普通对象上的 ref 得写 `.value`（见跟练那段同样的注记）。
 */
const runQueueTasks = runQueue.tasks
const runQueueLoading = runQueue.loading
const runQueueError = runQueue.error
const runQueueBusyId = runQueue.busyId
const runQueueRefreshedAt = runQueue.refreshedAt
/** 任务挂的节点还在不在：被删的那条只能看不能点（原因在面板里写） */
const runQueueNodeIds = computed(() => nodes.value.map(node => node.id))

function toggleRunQueue() {
  runQueueOpen.value = !runQueueOpen.value
  if (!runQueueOpen.value)
    return
  workflowPanelOpen.value = false
  matrixPanelOpen.value = false
  // 打开就查一次：面板不能停在进画布那次的旧数据上
  void runQueue.refresh()
}

/** 对话栏提交了任务（文本 / 结合画布）：页面从这里通知队列（与提交路径的 pollTask 同一个出口） */
function refreshRunQueue() {
  return runQueue.noteSubmitted()
}

/** 队列「重试」会真提交任务：跟练期间只读。取消不封——在飞的任务不可能是跟练产生的（回放不挂真任务 id） */
function onRunQueueRetry(task: GenerationTask) {
  if (practiceBlocked() || idLocked(task.node_id))
    return
  void runQueue.retryTask(task)
}

/** 失败卡片上的重试：与运行队列同一条 POST /user/task/:id/retry */
const canvasTaskRetry = useState<{ seq: number, nodeId: string, taskId: number } | null>('canvas-task-retry', () => null)
watch(canvasTaskRetry, (payload) => {
  if (!payload)
    return
  canvasTaskRetry.value = null
  onRunQueueRetry({ id: payload.taskId, node_id: payload.nodeId } as GenerationTask)
})
/** 把折叠在分组里的分组逐层展开：不然「居中」到的是一个看不见的节点 */
function expandRunQueueAncestors(nodeId: string) {
  const seen = new Set<string>()
  let parentId = (findNode(nodeId) as CanvasFlowNode | undefined)?.parentNode
  let changed = false
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const group = findNode(parentId) as CanvasFlowNode | undefined
    if (!group || !isGroupNode(group))
      break
    if (group.data.collapsed) {
      const kids = nodes.value.filter(node => node.parentNode === group.id)
      setGroupKidsVisible(kids, true)
      group.data.collapsed = false
      const w = group.data.expandedW
      const h = group.data.expandedH
      if (w && h)
        setGroupSize(group, w, h)
      else
        layoutGroupChildren(group, kids, group.data.layout)
      changed = true
    }
    parentId = group.parentNode
  }
  return changed
}

/** 点队列里的一条：选中它挂的节点并居中（复用画布既有的选中 / setCenter） */
function onRunQueueLocate(task: GenerationTask) {
  if (task.node_id)
    locateNode(task.node_id)
}

/** 批注点过来：选中节点并居中，缩得太远时至少拉到能看见 */
function locateNode(nodeId: string) {
  const node = findNode(nodeId) as CanvasFlowNode | undefined
  if (!node)
    return
  practiceCamera.cancel()
  const expanded = expandRunQueueAncestors(node.id)
  for (const item of nodes.value)
    item.selected = false
  node.selected = true
  const abs = absPosition(node, nodes.value)
  const box = nodeSize(node)
  const zoom = clampCanvasZoom(Math.max(viewport.value.zoom || 1, 0.5))
  setCenter(abs.x + box.w / 2, abs.y + box.h / 2, { zoom })
  if (expanded)
    pushHistory()
}

/** 面板确认派生：先过只读 / 锁定与跟练态（跟练期间的节点不进画布版本），再落图 + 提交批量 */
function onMatrixDerive(plan: MatrixPlan, points: number) {
  if (!canEditCanvas('生成'))
    return
  if (practiceSession.value.active) {
    notify(t('跟练中不能派生：先退出跟练'))
    return
  }
  void matrixDerive(plan, points)
}

/** 回滚派生节点：同样是画布改动，只读 / 锁定时不放手 */
function onMatrixRollback() {
  if (!canEditCanvas('放入'))
    return
  void matrixRollback()
}

const {
  currentImageSrc,
  imageEditModel,
  defaultImageModel,
  openSmartEdit,
  openDepthBar,
  runPromptReverse,
  openLightPanel,
  onLightSubmit,
  runUpscale,
  runRemoveBg,
  runThreeView,
  openAnglePanel,
  onAngleSubmit,
  onDepthSubmit,
  onSmartEditCite,
  onSmartEditSubmit,
  openCropEditor,
  openFrameCropEditor,
  openEraseBar,
  openMattingBar,
  onMattingSubmit,
  viralPlan,
  viralDurationReady,
  viralAnalyzePoints,
  viralGeneratePoints,
  openViralBar,
  onViralSubmit,
  onViralReset,
  onViralPick,
  onViralClear,
  onViralExtra,
  onViralShot,
  onViralCommit,
  onEraseSubmit,
  onSeparateAv,
  transcribeDialog,
  transcribeModels,
  depthExtractModels,
  transcribeEstimate,
  onTranscribe,
  onTranscribeConfirm,
  onRemoveSilence,
  onCaptureVideoFrame,
  openOutpaintEditor,
  onOutpaintSubmit,
  openFlipEditor,
  waitTextTask,
  runPromptOptimize,
  closeOptimize,
  onOptimizeApply,
  onMontageConfirm,
  onStoryboardCols,
  onStoryboardOff,
  onGridSplit,
  onGridSplitConfirm,
  onCropConfirm,
  onFlipSave,
  ensureNodeImageAsset,
  runImageEdit,
} = useCanvasImageEdits({
  selected,
  selectedGroup,
  notify,
  t,
  locale,
  closeOverlays,
  updateNodeData,
  pushHistory,
  findNode,
  nodes,
  edges,
  counts,
  addNodes,
  addEdges,
  addSelectedNodes,
  defaultEdgeOptions,
  ensureMediaAction,
  mediaSourceOf,
  mediaSourceNode,
  mediaActions,
  spawnMediaNode,
  spawnDerivedImage,
  spawnDerivedText,
  submitDerivedTask,
  submitMediaJob,
  gateSpend,
  estimateSpend,
  applyTaskToNode,
  pollTask,
  refreshWallet,
  waitTask,
  waitMediaJob,
  applyMediaNodeSize,
  openAssetPicker,
  canvasId: () => props.canvasId,
  connectedRefThumbs,
  collectRefImages,
  uploadedRefList,
  mediaKindOfUrl,
  nodeImageUrl,
  spawnDepthNode,
  runSubjectAction,
  relabelGroups,
  editSrc,
  montageOpen,
  montageSources,
  gridSplitOpen,
  gridSplitNodeId,
  groupCount,
  angleBusy,
  angleNodeId,
  angleOpen,
  angleSrc,
  cropNodeId,
  cropOpen,
  cropVariant,
  depthBusy,
  depthResolution,
  depthModel,
  depthNodeId,
  depthOpen,
  eraseMode,
  eraseNodeId,
  eraseOpen,
  flipNodeId,
  flipOpen,
  lightBusy,
  lightNodeId,
  lightOpen,
  lightSrc,
  mattingBusy,
  mattingNodeId,
  mattingOpen,
  optimizeBusy,
  optimizeError,
  optimizeModel,
  optimizeNodeId,
  optimizeOpen,
  optimizeOriginal,
  optimizePoints,
  optimizeResult,
  outpaintBusy,
  outpaintNodeId,
  outpaintOpen,
  smartEditAssetId,
  smartEditBusy,
  smartEditNodeId,
  smartEditOpen,
  smartEditPick,
  smartEditRefs,
  smartEditSrc,
  viralBusy,
  viralDurationPick,
  viralModelId,
  viralNodeId,
  viralOpen,
  viralRatioPick,
  viralResolutionPick,
  viralSourceSeconds,
  viralStep,
  // 图片编辑 / 视频派生自己的两处 taskApi.create 也吃这道闸（回放拦不到它们，会真花点数）
  blocked: () => practiceLocked.value,
})

const {
  openClipStrip,
  loadStripDuration,
  openSplitStrip,
  onSplitStripSubmit,
  onNodeMenuFramePull,
  onClipStripSubmit,
  onNodeMenuHd,
  onHdParamsUpdate,
  onHdSubmit,
  onNodeMenuDepthMotion,
  onDepthMotionParamsUpdate,
  onDepthMotionSubmit,
} = useCanvasVideoTools({
  selected,
  nodeMenu,
  nodes,
  counts,
  ensureMediaAction,
  notify,
  t,
  closeOverlays,
  currentImageSrc,
  clipStripOpen,
  clipStripNodeId,
  clipStripSrc,
  splitStripOpen,
  splitStripNodeId,
  splitStripSrc,
  splitBusy,
  stripAssetDuration,
  hdSourceSeconds,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  mediaSourceOf,
  mediaSourceNode,
  spawnMediaNode,
  submitMediaJob,
  mediaActions,
  addNodes: node => addNodes(node),
  addEdges: edge => addEdges(edge as any),
  defaultEdgeOptions,
  pushHistory,
  addSelectedNodes: list => addSelectedNodes(list as any),
  updateNodeData,
  notifyChange,
})

const {
  canVideoOps,
  canRetake,
  onNodeMenuRetake,
  onNodeMenuExtend,
  extendStudioOpen,
  extendStudioRef,
  extendStudioVariant,
  extendStudioSrc,
  extendStudioPrompt,
  extendStudioModels,
  extendStudioRefs,
  extendStudioBusy,
  extendStudioTotal,
  openExtendStudio,
  pickExtendStudioRefs,
  onExtendStudioSubmit,
  onNodeMenuUpscale,
  retakeClip,
} = useCanvasVideoOps({
  selected,
  canvasLocked,
  nodeMenu,
  nodes,
  counts,
  ensureMediaAction,
  notify,
  t: tx,
  addNodes: node => addNodes(node),
  addEdges: edge => addEdges(edge as any),
  defaultEdgeOptions,
  pushHistory,
  findNode: id => findNode(id) as CanvasFlowNode | undefined,
  addSelectedNodes: list => addSelectedNodes(list as any),
  showRetakeStrip,
  closeOverlays,
  currentImageSrc,
  loadStripDuration,
  openAssetPicker,
  generationModels,
  updateNodeData,
  submitRetakeSegment,
  addNode,
  submitDerivedTask,
  applyTaskToNode,
  refreshWallet,
  pollTask,
  confirm,
  removeNodes: ids => removeNodes(ids),
  extendStripOpen,
  canvasId: () => props.canvasId,
})

const styleLibValue = computed(() => {
  if (stylePickFor.value === 'extend')
    return Number(extendStudioRef.value?.styleId) || 0
  if (stylePickFor.value === 'chat')
    return 0
  const node = selected.value
  return node && isContentNode(node) ? node.data.stylePreset?.id || 0 : 0
})

</script>

<template>
  <div
    class="canvas-workspace"
    @pointerdown.capture="onWorkspacePointerDown"
    @dblclick="onStageDblClick"
    @contextmenu="onBlankContext"
    @dragover="onCanvasDragOver"
    @drop="onCanvasDrop"
  >
    <VueFlow
      id="easytv-canvas"
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :default-edge-options="defaultEdgeOptions"
      :min-zoom="CANVAS_MIN_ZOOM"
      :max-zoom="CANVAS_MAX_ZOOM"
      :connection-radius="36"
      :snap-to-grid="snapOn"
      :snap-grid="SNAP_GRID"
      :zoom-on-scroll="false"
      :pan-on-scroll="true"
      :pan-on-scroll-speed="0.85"
      :zoom-on-pinch="true"
      :zoom-activation-key-code="['Control', 'Meta']"
      :prevent-scrolling="true"
      :pan-on-drag="panOnDrag"
      :pan-activation-key-code="null"
      :selection-key-code="(!canvasLocked && !practiceLocked) ? selectionKeyCode : null"
      :selection-mode="SelectionMode.Partial"
      :select-nodes-on-drag="false"
      :nodes-draggable="!canvasLocked && !practiceLocked && !isPanning && !canvasMarkPick.open"
      :nodes-connectable="!canvasLocked && !practiceLocked && !canvasMarkPick.open"
      :elements-selectable="!canvasLocked && !isPanning && !canvasMarkPick.open"
      :delete-key-code="null"
      :zoom-on-double-click="false"
      :connection-mode="ConnectionMode.Strict"
      :is-valid-connection="isValidConnection"
      :connection-line-type="ConnectionLineType.Bezier"
      class="canvas-flow"
      :class="{
        'is-pan': isPanning,
        'is-select': !isPanning,
        'is-connecting': Boolean(pending) || menu?.source || menu?.target,
        'is-edges-hidden': hideEdges,
        'is-mark-pick': canvasMarkPick.open,
      }"
      @connect="onConnect"
      @connect-start="onConnectStart"
      @connect-end="onConnectEnd"
      @pane-click="onPaneClick"
      @move-start="practiceCamera.cancel()"
      @node-click="onNodeClick"
      @node-double-click="onNodeDblClick"
      @node-context-menu="onNodeContextMenu"
      @node-drag="onNodeDrag"
      @node-drag-stop="onNodeDragStop"
      @node-drag-start="onNodeDragStart"
      @edges-delete="pushHistory"
      @nodes-change="onFlowElementsChange"
      @edges-change="onFlowElementsChange"
    >
      <template #connection-line="{ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }">
        <CanvasConnectLine
          :source-x="sourceX"
          :source-y="sourceY"
          :target-x="targetX"
          :target-y="targetY"
          :source-position="sourcePosition"
          :target-position="targetPosition"
        />
      </template>
      <Background
        variant="dots"
        :gap="22"
        :size="1.15"
        color="var(--st-dot)"
      />
    </VueFlow>

    <svg v-if="alignLines.length" class="canvas-align" aria-hidden="true">
      <line
        v-for="(line, index) in alignLines"
        :key="index"
        :x1="line.x1"
        :y1="line.y1"
        :x2="line.x2"
        :y2="line.y2"
      />
    </svg>

    <CanvasEmpty
      v-if="!nodes.length && !menu && !canvasMarkPick.open"
      :readonly="readonly"
      :canvas-locked="canvasLocked"
      @start="onEmptyStart"
      @start-skill="onEmptyStartSkill"
      @workflow="workflowPanelOpen = true"
      @practice="startPractice()"
    />

    <CanvasMarkPickBar
      :open="canvasMarkPick.open"
      @back="closeMarkPick"
      @close="closeMarkPick"
    />

    <CanvasShortcutsModal :open="showHelp" @close="showHelp = false" />
    <CanvasFind
      :open="findOpen"
      :items="findItems"
      :query="findQuery"
      :active-id="selected?.id"
      @close="findOpen = false"
      @update:query="findQuery = $event"
      @pick="onFindPick"
    />

    <CanvasToolsRail
      v-if="!readonly"
      :menu-from-add="Boolean(menu?.fromAdd)"
      :picker-open="picker.open"
      :tool-menu="toolMenu"
      :practice-open="practiceSession.active"
      :canvas-tool="canvasTool"
      :show-help="showHelp"
      :find-open="findOpen"
      :workflow-open="workflowPanelOpen"
      :matrix-open="matrixPanelOpen"
      :queue-open="runQueueOpen"
      :queue-active="runQueueActive"
      :queue-badge="queueBadge"
      @add="openMenuAtAdd"
      @assets="openAssetPicker({ mode: 'add', title: t('从资产库选择') })"
      @practice="practiceSession.active ? exitPractice() : startPractice()"
      @toggle-tool="toggleToolMenu"
      @set-tool="setTool"
      @workflow="openWorkflowPanel()"
      @matrix="toggleMatrixPanel()"
      @queue="toggleRunQueue()"
      @history="emit('history')"
      @shortcuts="toggleHelp"
      @find="openFind"
      @help="onHelp"
    />

    <CanvasWorkflowPanel
      v-if="workflowPanelOpen"
      :open="workflowPanelOpen"
      :refresh-at="workflowRefreshAt"
      @close="workflowPanelOpen = false"
      @use="onWorkflowUse"
      @use-preset="useWorkflowPreset"
    />

    <CanvasMatrixPanel
      v-if="matrixPanelOpen"
      :open="matrixPanelOpen"
      :sources="matrixSources"
      :selected-id="selectedId || ''"
      :estimate="matrixEstimate"
      :model-durations="matrixModelDurations"
      :model-resolutions="matrixModelResolutions"
      :priced="Boolean(generationModels.length)"
      :balance="walletBalance"
      :run="matrixRun"
      :busy="Boolean(matrixRun?.busy)"
      @close="matrixPanelOpen = false"
      @derive="onMatrixDerive"
      @resubmit="matrixResubmit"
      @rollback="onMatrixRollback"
      @action="matrixAction"
      @recharge="onMatrixRecharge()"
    />

    <CanvasRunQueuePanel
      v-if="runQueueOpen"
      :open="runQueueOpen"
      :tasks="runQueueTasks"
      :node-ids="runQueueNodeIds"
      :loading="runQueueLoading"
      :error="runQueueError"
      :busy-id="runQueueBusyId"
      :unsaved="!canvasId"
      :refreshed-at="runQueueRefreshedAt"
      @close="runQueueOpen = false"
      @refresh="runQueue.refresh()"
      @locate="onRunQueueLocate"
      @cancel="runQueue.cancelTask"
      @retry="onRunQueueRetry"
    />

    <CanvasDock
      :show-minimap="showMinimap"
      :nodes="nodes"
      :view-rect="viewRect"
      :mini="mini"
      :hide-edges="hideEdges"
      :canvas-locked="canvasLocked"
      :readonly="readonly"
      :snap-on="snapOn"
      :zoom-menu="zoomMenu"
      :zoom-pct="zoomPct"
      :zoom-draft="zoomDraft"
      :zoom-cmd="zoomCmd"
      @organize="organizeCanvas"
      @toggle-minimap="showMinimap = !showMinimap"
      @toggle-edges="toggleHideEdges"
      @toggle-lock="canvasLocked = !canvasLocked"
      @toggle-snap="snapOn = !snapOn"
      @toggle-zoom="toggleZoomMenu"
      @apply-zoom-draft="onUserZoomDraft"
      @zoom-in="onUserZoomIn"
      @zoom-out="onUserZoomOut"
      @fit="onUserFitView"
      @apply-zoom="onUserZoomPct($event)"
      @update:zoom-draft="zoomDraft = $event"
      @dock-pointer="onDockPointer"
      @minimap-pointer="onMinimapPointer"
    />

    <CanvasInspector
      v-if="showInspector && inspectorStyle && !smartEditOpen && !depthOpen && !lightOpen && !angleOpen && !cropOpen && !eraseOpen && !mattingOpen && !viralOpen && !outpaintOpen && !flipOpen && !markOpen && !extendStudioOpen && !extendStripOpen && !clipStripOpen && !splitStripOpen"
      :key="selected?.id"
      ref="inspectorRef"
      :prompt="(selected && isContentNode(selected) ? selected.data.prompt : '') ?? ''"
      :kind="inspectorKind"
      :expanded="inspectorOpen"
      :panel-style="inspectorStyle"
      @update:prompt="onInspectorPrompt"
      @update:expanded="inspectorOpen = $event"
      :ref-url="selected && isContentNode(selected) ? selected.data.refUrl : ''"
      :readonly="practiceLocked"
      :locked="Boolean(selected && nodeLocked(selected))"
      :chip-state="inspectorChipState"
      :style-preset-name="selected && isContentNode(selected) ? selected.data.stylePreset?.name || '' : ''"
      :attach-thumbs="inspectorAttachThumbs"
      :refs="inspectorRefs"
      :subject-ids="selected && isContentNode(selected) ? selected.data.subjectIds ?? [] : []"
      :subject-versions="selected && isContentNode(selected) ? selected.data.subjectVersions ?? {} : {}"
      :camera-move="selected && isContentNode(selected) ? selected.data.cameraMove || '' : ''"
      :mark-elements="selected && isContentNode(selected) ? selected.data.markElements ?? [] : []"
      :retake-clip="retakeClip"
      :video-mode="selected && isContentNode(selected) ? selected.data.videoMode || 'reference' : 'reference'"
      :talking="selected && isContentNode(selected) ? selected.data.talking ?? null : null"
      :model="selected && isContentNode(selected) ? selected.data.model || '' : ''"
      :params="selected && isContentNode(selected) ? selected.data.params ?? null : null"
      :submitting="generating"
      @update:model="onInspectorModel"
      @update:subject-ids="onInspectorSubjects"
      @update:video-mode="onInspectorVideoMode"
      @update:talking="onInspectorTalking"
      @update:params="onInspectorParams"
      @send="onInspectorSend"
      @generate="onInspectorGenerate"
      @chip="onInspectorChip"
      @clear-chip="onClearChip"
      @remove-mark="onRemoveMark"
      @toggle-lock="toggleLockSelected"
      @quota="gotoPricing('points')"
    />

    <CanvasHdPanel
      v-if="showHdPanel && hdPanelStyle"
      :open="showHdPanel"
      :params="selected && isContentNode(selected) ? selected.data.hdParams : null"
      :panel-style="hdPanelStyle"
      :submitting="mediaPanelSubmitting"
      :cost="hdCost"
      @update:params="onHdParamsUpdate"
      @submit="onHdSubmit"
    />

    <CanvasDepthMotionPanel
      v-if="showDepthMotionPanel && hdPanelStyle"
      :open="showDepthMotionPanel"
      :params="selected && isContentNode(selected) ? selected.data.depthMotionParams : null"
      :panel-style="hdPanelStyle"
      :submitting="mediaPanelSubmitting"
      @update:params="onDepthMotionParamsUpdate"
      @submit="onDepthMotionSubmit"
    />

    <CanvasPromptOptimizeModal
      v-if="optimizeOpen"
      :open="optimizeOpen"
      :original="optimizeOriginal"
      :optimized="optimizeResult"
      :busy="optimizeBusy"
      :error="optimizeError"
      :model="optimizeModel"
      :points="optimizePoints"
      @close="closeOptimize"
      @apply="onOptimizeApply"
    />

    <CanvasMontageModal
      v-if="montageOpen"
      :open="montageOpen"
      :items="montageSources"
      @close="montageOpen = false"
      @confirm="onMontageConfirm"
    />

    <CanvasComposePanel
      v-if="composeOpen"
      :open="composeOpen"
      :items="composeSources"
      :audios="composeAudioSources"
      :subtitles="composeSubtitleSources"
      :run="composeRun"
      @close="composeOpen = false"
      @persist="persistComposeTrims"
      @confirm="onComposeConfirm"
    />

    <CanvasTranscribeModal
      v-if="transcribeDialog.open"
      :open="transcribeDialog.open"
      :source-label="transcribeDialog.sourceLabel"
      :duration="transcribeDialog.duration"
      :models="transcribeModels"
      :estimate="transcribeEstimate"
      @close="transcribeDialog.open = false"
      @confirm="onTranscribeConfirm"
    />
    <CanvasGridSplitModal
      v-if="gridSplitOpen"
      :open="gridSplitOpen"
      :box="overlay"
      @close="gridSplitOpen = false"
      @confirm="onGridSplitConfirm"
    />

    <CanvasCropModal
      v-if="cropOpen"
      :open="cropOpen"
      :src="editSrc"
      :variant="cropVariant"
      :box="overlay"
      @close="cropOpen = false"
      @confirm="onCropConfirm"
    />

    <CanvasEraseBar
      v-if="eraseOpen"
      :open="eraseOpen"
      :mode="eraseMode"
      :box="overlay"
      @close="eraseOpen = false"
      @submit="onEraseSubmit"
    />

    <CanvasMattingBar
      v-if="mattingOpen"
      :open="mattingOpen"
      :box="overlay"
      :cost="2"
      :submitting="mattingBusy"
      @close="mattingOpen = false"
      @submit="onMattingSubmit"
    />

    <CanvasViralBar
      v-if="viralOpen"
      :open="viralOpen"
      :panel-style="viralBarStyle"
      :stage="viralPlan ? 'review' : 'confirm'"
      :points="viralPlan ? viralGeneratePoints : (viralDurationReady ? viralAnalyzePoints : null)"
      :duration-ready="viralDurationReady"
      :plan="viralPlan"
      :submitting="viralBusy"
      :step="viralStep"
      @close="viralOpen = false"
      @submit="onViralSubmit"
      @reset="onViralReset"
      @pick="onViralPick"
      @clear="onViralClear"
      @extra="onViralExtra"
      @shot="onViralShot"
      @commit="onViralCommit"
    />

    <CanvasOutpaintModal
      v-if="outpaintOpen"
      :open="outpaintOpen"
      :src="editSrc"
      :box="overlay"
      :submitting="outpaintBusy"
      @close="outpaintOpen = false"
      @submit="onOutpaintSubmit"
    />

    <CanvasFlipModal
      v-if="flipOpen"
      :open="flipOpen"
      :src="editSrc"
      :box="overlay"
      @close="flipOpen = false"
      @save="onFlipSave"
    />

    <CanvasTextPickModal
      v-if="textPickOpen"
      :open="textPickOpen"
      :mode="textPickMode"
      @close="textPickOpen = false"
      @pick="onTextPicked"
    />

    <CanvasHelpModal
      v-if="helpOpen"
      :open="helpOpen"
      @close="helpOpen = false"
    />

    <CanvasPracticeTour
      v-if="!readonly"
      :session="practiceSession"
      :view="practiceView"
      :notice="practiceSession.notice"
      :camera-tweening="practiceCameraTweening"
      @exit="exitPractice"
      @next="practice.next()"
      @goto="practice.gotoStep($event)"
      @minimize="practice.minimize()"
      @restore="practice.restore()"
      @pick-script="selectPracticeScript($event)"
      @skip="practice.skipStep()"
    />

    <CanvasMarkModal
      v-if="markOpen"
      ref="markModalRef"
      :open="markOpen"
      :mode="markMode"
      :src="markSrc"
      :mask-url="markExisting"
      :box="overlay"
      :submitting="inpaintBusy"
      @close="markOpen = false"
      @confirm="onMarkConfirm"
    />

    <CanvasSmartEdit
      v-if="smartEditOpen"
      :open="smartEditOpen"
      :readonly="practiceLocked"
      :src="smartEditSrc"
      :asset-id="smartEditAssetId"
      :box="overlay"
      :panel-style="inspectorStyle"
      :refs="smartEditRefs"
      :submitting="smartEditBusy"
      @close="smartEditOpen = false"
      @cite="onSmartEditCite"
      @update:refs="smartEditRefs = $event"
      @submit="onSmartEditSubmit"
    />

    <CanvasDepthBar
      v-if="depthOpen"
      :open="depthOpen"
      :panel-style="depthBarStyle"
      :resolution="depthResolution"
      :model="depthModel"
      :models="depthExtractModels"
      :submitting="depthBusy"
      @close="depthOpen = false"
      @update:resolution="depthResolution = $event"
      @update:model="depthModel = $event"
      @submit="onDepthSubmit"
    />

    <CanvasLightPanel
      v-if="lightOpen"
      :open="lightOpen"
      :model="imageEditModel"
      :src="lightSrc"
      :panel-style="lightPanelStyle"
      :submitting="lightBusy"
      @close="lightOpen = false"
      @submit="onLightSubmit"
    />

    <CanvasAnglePanel
      v-if="angleOpen"
      :open="angleOpen"
      :model="imageEditModel"
      :src="angleSrc"
      :panel-style="anglePanelStyle"
      :submitting="angleBusy"
      @close="angleOpen = false"
      @submit="onAngleSubmit"
    />

    <CanvasPanoramaViewer
      v-if="panoOpen"
      :open="panoOpen"
      :src="panoSrc"
      :title="panoTitle"
      @close="panoOpen = false"
    />

    <CanvasCameraModal
      v-if="cameraOpen"
      :open="cameraOpen"
      :value="selected && isContentNode(selected) ? (selected.data.camera ?? null) : null"
      @close="cameraOpen = false"
      @apply="onCameraApply"
      @clear="onCameraClear"
    />

    <CanvasCameraLibrary
      v-if="camLibOpen"
      :open="camLibOpen"
      :value="selected && isContentNode(selected) ? selected.data.cameraMove || '' : ''"
      @close="camLibOpen = false"
      @pick="onCamPick"
    />

    <CanvasStyleLibrary
      v-if="styleLibOpen"
      :open="styleLibOpen"
      :value="styleLibValue"
      :kind="selected && isContentNode(selected) && (selected.data.kind === 'image' || selected.data.kind === 'video') ? selected.data.kind : undefined"
      :source-image="styleSourceImage"
      :extracting="styleExtractBusy"
      :locked="styleEditOpen"
      :mine-version="styleMineVersion"
      @close="styleLibOpen = false; stylePickFor = ''"
      @pick="onStyleLibPick"
      @clear="onStyleLibClear"
      @create="onStyleLibCreate"
      @edit="onStyleLibEdit"
      @extract="runStyleExtract"
    />

    <CanvasStyleEditModal
      v-if="styleEditOpen"
      :open="styleEditOpen"
      :editing="styleEditTarget"
      :preset="styleEditPreset"
      @close="closeStyleEdit"
      @saved="onStyleEditSaved"
    />

    <CanvasChipPresets
      v-if="gridOpen"
      :open="gridOpen"
      :title="t('宫格与故事板')"
      :hint="t('套用一段拍法提示词并锁好画幅，直接生成即可')"
      :items="gridItems"
      @close="gridOpen = false"
      @pick="onGridPick"
    />

    <CanvasChipPresets
      v-if="presetOpen"
      :open="presetOpen"
      :title="t('特效')"
      :hint="t('选择画面特效，会随生成任务一起提交')"
      :items="FX_PRESETS"
      :value="selected && isContentNode(selected) ? selected.data.fxPreset : ''"
      @close="presetOpen = false"
      @pick="onPresetPick"
    />

    <CanvasAssetPicker
      v-if="picker.open"
      :open="picker.open"
      :title="picker.title"
      :accept="picker.accept"
      :auto-upload="picker.autoUpload"
      @close="onPickerClose"
      @pick="onAssetPicked"
      @uploading="onPickerUploading"
      @upload-start="onPickerUploadStart"
      @upload-fail="onPickerUploadFail"
    />

    <CanvasBoardPicker
      v-if="boardPickOpen"
      :open="boardPickOpen"
      :items="boardPickItems"
      @close="boardPickOpen = false"
      @pick="onBoardNodePick"
    />

    <CanvasMergeToast />

    <CanvasSelBar
      v-if="overlay && barMode && !practiceLocked && !showHelp && !smartEditOpen && !depthOpen && !lightOpen && !angleOpen && !cropOpen && !eraseOpen && !mattingOpen && !viralOpen && !outpaintOpen && !flipOpen && !markOpen && !extendStudioOpen && !extendStripOpen && !clipStripOpen"
      :mode="barMode"
      :left="overlay.left"
      :top="overlay.top"
      :width="overlay.width"
      :height="overlay.height"
      :color="barMode === 'text' && selected && isContentNode(selected)
        ? (selected.data.color || '#ffffff')
        : (selectedGroup && isGroupNode(selectedGroup) ? selectedGroup.data.color : '#ececee')"
      :layout="selectedGroup && isGroupNode(selectedGroup) ? selectedGroup.data.layout : 'grid'"
      :collapsed="Boolean(selectedGroup && isGroupNode(selectedGroup) && selectedGroup.data.collapsed)"
      :storyboard-cols="selectedGroup && isGroupNode(selectedGroup) && selectedGroup.data.storyboard ? selectedGroup.data.storyboard.cols : 0"
      :storyboard-max="selectedGroup ? Math.max(1, nodes.filter(node => node.parentNode === selectedGroup!.id).length) : 1"
      :show-box="barMode === 'pick'"
      :font-size="barMode === 'text' && selected && isContentNode(selected) ? (selected.data.fontSize || 16) : 16"
      :montage-ready="barMode === 'pick' && montageAvailable"
      :compose-ready="barMode === 'pick' && composeAvailable"
      :merge-ready="barMode === 'pick' && mergeReady"
      :merge-count="mergeClipList.length"
      :merging-videos="mergeRunning"
      :locked="selectionLocked"
      @action="onSelAction"
      @unavailable="onBarUnavailable"
      @color="onBarColor"
      @layout="setGroupLayout"
      @storyboard-cols="onStoryboardCols"
      @storyboard-off="onStoryboardOff"
    />

    <CanvasTextEditor
      v-if="textEditorOpen"
      :open="textEditorOpen"
      :html="selected && isContentNode(selected) ? renderMarkdown(selected.data.content || '') : ''"
      @close="textEditorOpen = false"
      @save="onTextEditorSave"
    />

    <CanvasPaneMenu
      v-if="paneMenu"
      :x="paneMenu.x"
      :y="paneMenu.y"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :can-paste="canPaste"
      :is-mac="isMac"
      @upload="onCtxUpload"
      @add="onCtxAdd"
      @undo="undo(); paneMenu = null"
      @redo="redo(); paneMenu = null"
      @paste="void pasteClip({ x: paneMenu.flowX, y: paneMenu.flowY })"
    />

    <CanvasNodeMenu
      v-if="nodeMenu"
      :x="nodeMenu.x"
      :y="nodeMenu.y"
      :is-mac="isMac"
      :can-publish="canPublishSelected"
      :can-retake="canRetake"
      :retake-reason="retakeReason"
      :can-extend="canVideoOps"
      :can-upscale="canVideoOps"
      :can-set-cover="canSetCover"
      :can-view-pano="canViewPano"
      :delete-only="Boolean(nodeMenu.deleteOnly)"
      :locked="selectionLocked"
      @view-pano="openPanorama"
      @lock="toggleLockSelected(); nodeMenu = null"
      @set-cover="onNodeMenuSetCover"
      @copy="onNodeMenuCopy"
      @duplicate="onNodeMenuDuplicate"
      @remove="onNodeMenuRemove"
      @publish="onNodeMenuPublish"
      @retake="onNodeMenuRetake"
      @extend="onNodeMenuExtend"
      @upscale="onNodeMenuUpscale"
      @comment="onNodeMenuComment"
      @assist="onNodeMenuAssist"
      @unavailable="onBarUnavailable"
    />

    <CanvasExtendStudio
      v-if="extendStudioOpen"
      ref="extendStudioRef"
      :open="extendStudioOpen"
      :variant="extendStudioVariant"
      :src="extendStudioSrc"
      :prompt="extendStudioPrompt"
      :models="extendStudioModels"
      :refs="extendStudioRefs"
      :submitting="extendStudioBusy"
      :fallback-duration="stripAssetDuration"
      :total="extendStudioTotal"
      @close="extendStudioOpen = false"
      @open-style="openStyleLibrary('extend')"
      @pick-refs="pickExtendStudioRefs"
      @remove-ref="extendStudioRefs.splice($event, 1)"
      @submit="onExtendStudioSubmit"
    />

    <CanvasExtendStrip
      v-if="clipStripOpen"
      :open="clipStripOpen"
      variant="clip"
      :src="clipStripSrc"
      :box="overlay"
      :fallback-duration="stripAssetDuration"
      @close="clipStripOpen = false"
      @submit="onClipStripSubmit"
    />

    <CanvasExtendStrip
      v-if="splitStripOpen"
      :open="splitStripOpen"
      variant="split"
      :src="splitStripSrc"
      :box="overlay"
      :fallback-duration="stripAssetDuration"
      :submitting="splitBusy"
      @close="splitStripOpen = false"
      @submit="onSplitStripSubmit"
    />

    <StudioPublishModal
      v-if="publishTarget"
      :open="!!publishTarget"
      :canvas-id="props.canvasId"
      :asset="publishTarget"
      @close="publishTarget = null"
    />

    <svg
      v-if="connectGhostPath"
      class="canvas-connect-ghost"
      aria-hidden="true"
    >
      <path class="canvas-edge__line" :d="connectGhostPath" fill="none" />
      <CanvasEdgeFlow :d="connectGhostPath" />
    </svg>

    <CanvasAddMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :bottom="menu.bottom"
      @pick="onPick"
    />
  </div>
</template>
