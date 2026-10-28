<script setup lang="ts">
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'
import {
  CANVAS_NODE_ITEMS,
  canvasFitMediaSize,
  canvasMediaSizeClose,
  canvasNodeIcon,
  canvasKindIndex,
  canvasStageSize,
  hdNodeTag,
  isAudioTrackNode,
  isCropNode,
  isFrameCaptureNode,
  isFramePullNode,
  isDepthMotionNode,
  isHdNode,
  isRetakeNode,
  isSilentNode,
  FRAME_PULL_STAGE_SIZE,
  type CanvasNodeData,
} from '~/utils/canvas-node-kinds'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'
import CanvasVideoPlayer from '~/components/canvas/CanvasVideoPlayer.vue'
import CanvasAudioPlayer from '~/components/canvas/CanvasAudioPlayer.vue'
import CanvasFramePanel from '~/components/canvas/CanvasFramePanel.vue'
import { CANVAS_CHANGE_KEY } from '~/utils/canvas-change'
import { CANVAS_STALE_KEY } from '~/utils/canvas-upstream'
import { practiceSessionDefault, type PracticeSession } from '~/composables/useCanvasPractice'
import { displayedClickToImage, emptyMarkPick, type CanvasMarkElement, type CanvasMarkPick } from '~/utils/canvas-mark'
import { absPosition, isNodeLocked, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import { CANVAS_STORYBOARD_KEY, storyboardShotsOf, STORYBOARD_MAX, type StoryboardShot } from '~/utils/canvas-storyboard'

const { t } = useI18n()
/** 语言标签：一稿多版矩阵派生节点的角标要显示语种（与矩阵面板同一份语言表） */
const { langLabel } = useLangs()

const props = defineProps<NodeProps<CanvasNodeData>>()
const { updateNode, updateNodeData, updateNodeInternals, viewport, nodes, findNode } = useVueFlow('easytv-canvas')
const textRef = ref<HTMLTextAreaElement | null>(null)
const mediaRef = ref<HTMLImageElement | null>(null)
const stagePreset = computed(() => canvasStageSize(props.data.kind) ?? { w: 252, h: 220, minW: 160, minH: 140 })
const stageBox = reactive({
  w: stagePreset.value.w,
  h: stagePreset.value.h,
})
const resizing = ref(false)
const mediaPx = ref('')

const isText = computed(() => props.data.kind === 'text')
// 全景卡片上就是一张 2:1 的图，渲染路径和图片节点一样；查看球面要点卡片上的入口
const isImage = computed(() => props.data.kind === 'image' || props.data.kind === 'panorama')
const isPanorama = computed(() => props.data.kind === 'panorama')
const isDirector = computed(() => props.data.kind === 'director')
const isStage = computed(() => Boolean(canvasStageSize(props.data.kind)))
const isStoryboard = computed(() => props.data.kind === 'storyboard')
const storyboardShots = computed(() => storyboardShotsOf(props.data))
const storyboardReady = computed(() => storyboardShots.value.some(item => item.prompt.trim()))
const storyboardSplit = ref(false)
const expandStoryboard = inject(CANVAS_STORYBOARD_KEY, null)

watch(() => storyboardShots.value.map(item => `${item.id}\n${item.prompt}\n${item.seconds}`).join('\u0001'), () => {
  storyboardSplit.value = false
})

/**
 * 跟练会话（与 useCanvasPractice 同一份 useState）。本组件拿不到 Workspace 的 practiceLocked，
 * 编辑态的两条路都要在这里直接按会话态拦下：① 双击进编辑态（本组件 stopPropagation，
 * Workspace 的 onNodeDblClick 闸收不到事件，§四 #26）；② 进跟练那一刻已经开着的编辑态
 * （跟练不改图、只挂沙盒，data.mode 还是 'write'，不封 UI 就能接着改字）。
 */
const practiceSession = useState<PracticeSession>('canvas-practice', practiceSessionDefault)
/** 跟练进行中：上传 / 替换看起来就能点，点了才弹只读提示。这里直接禁用。 */
const practiceLocked = computed(() => practiceSession.value.active)
const nodeLocked = computed(() => {
  const self = findNode(props.id) as CanvasFlowNode | undefined
  return isNodeLocked(self || { id: props.id, data: props.data } as CanvasFlowNode, nodes.value as CanvasFlowNode[])
})
/** 跟练或节点（含父组）锁定：卡片上的写入入口一起冻住 */
const writeFrozen = computed(() => practiceLocked.value || nodeLocked.value)
const isMediaCard = computed(() => isStage.value && !isText.value)
const isWrite = computed(() => isText.value && props.data.mode === 'write' && !writeFrozen.value)
const hasContent = computed(() => {
  if (isDirector.value)
    return Boolean(imageSrc.value)
  const raw = props.data.content?.trim() || ''
  if (!raw)
    return false
  return Boolean(raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim())
})
const textStyle = computed(() => {
  const style: Record<string, string> = {
    fontSize: `${props.data.fontSize || 16}px`,
  }
  return style
})
const stageTone = computed(() => {
  if (!isText.value || !props.data.color)
    return undefined
  return { background: props.data.color }
})
const imageSrc = computed(() => {
  const value = (isDirector.value ? props.data.previewUrl : props.data.content)?.trim() || ''
  if ((!isImage.value && !isDirector.value) || !value || !isMediaUrl(value))
    return ''
  return resolveMediaUrl(value)
})
const videoSrc = computed(() => {
  const value = props.data.content?.trim() || ''
  if (props.data.kind !== 'video' || !value || !isMediaUrl(value))
    return ''
  return resolveMediaUrl(value)
})
const audioSrc = computed(() => {
  const value = props.data.content?.trim() || ''
  if (props.data.kind !== 'audio' || !value || !isMediaUrl(value))
    return ''
  return resolveMediaUrl(value)
})
const isBlank = computed(() => isMediaCard.value && !isDirector.value && !isStoryboard.value && !imageSrc.value && !videoSrc.value && !audioSrc.value)
const isHd = computed(() => isHdNode(props.data))
const isRetake = computed(() => isRetakeNode(props.data))
const isFramePull = computed(() => isFramePullNode(props.data))
const isDepthMotion = computed(() => isDepthMotionNode(props.data))
const isDepthExtract = computed(() => props.data.tag === '深度提取' || Boolean(props.data.depthParams))
const depthSizeLabel = computed(() => {
  const resolution = props.data.depthParams?.resolution
  if (!isDepthExtract.value)
    return ''
  return resolution === '720p' ? '1280 × 720' : '854 × 480'
})
const isCrop = computed(() => isCropNode(props.data))
const isSilent = computed(() => isSilentNode(props.data))
const isAudioTrack = computed(() => isAudioTrackNode(props.data))
const isFrameCapture = computed(() => isFrameCaptureNode(props.data))
const canvasDirectorOpenId = useState('canvas-director-open-id', () => '')
const canvasFlipNodeId = useState('canvas-flip-node-id', () => '')
const canvasFrameSubmit = useState<{ seq: number, nodeId: string, count: number, analyze: boolean } | null>('canvas-frame-submit', () => null)
/** 节点上的取消按钮：工作区收到后走 POST /user/task/:id/cancel */
const canvasTaskCancel = useState<{ seq: number, nodeId: string, taskId: number } | null>('canvas-task-cancel', () => null)
/** 失败卡片上的重试：工作区收到后走 POST /user/task/:id/retry（与运行队列同一条） */
const canvasTaskRetry = useState<{ seq: number, nodeId: string, taskId: number } | null>('canvas-task-retry', () => null)
/** 节点上的「按当前输入重跑」：工作区收到后选中该节点并按当前参数提交 */
const canvasNodeRerun = useState<{ seq: number, nodeId: string } | null>('canvas-node-rerun', () => null)
const canvasMarkPick = useState<CanvasMarkPick>('canvas-mark-pick', emptyMarkPick)
const canvasMarkTap = useState<{ seq: number, nodeId: string, x: number, y: number } | null>('canvas-mark-tap', () => null)
const imagePreviewOpen = ref(false)
const markPickOn = computed(() => canvasMarkPick.value.open)
const markAnalyzing = computed(() => markPickOn.value && canvasMarkPick.value.analyzingId === props.id)
const markAble = computed(() => markPickOn.value && isImage.value && Boolean(imageSrc.value))
const markBoxes = computed(() => {
  if (!markPickOn.value)
    return []
  const baseline = new Set(canvasMarkPick.value.baselineIds ?? [])
  const out: Array<{ id: string, name: string, box: CanvasMarkElement['box'] }> = []
  for (const node of nodes.value) {
    const items = ((node.data as any)?.markElements ?? []) as CanvasMarkElement[]
    for (const item of items) {
      if (item.sourceNodeId !== props.id)
        continue
      // 上一轮留下的框不画，只显示本轮新点的
      if (baseline.has(item.id))
        continue
      out.push({
        id: item.id,
        name: item.name,
        box: item.box,
      })
    }
  }
  return out
})

function markBoxStyle(box: CanvasMarkElement['box']) {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  }
}

function onMarkHit(event: MouseEvent) {
  if (!markAble.value)
    return
  const hit = event.currentTarget as HTMLElement
  const rect = hit.getBoundingClientRect()
  const relX = (event.clientX - rect.left) / Math.max(rect.width, 1)
  const relY = (event.clientY - rect.top) / Math.max(rect.height, 1)
  const img = hit.parentElement?.querySelector('img.cnode__media') as HTMLImageElement | null
  const point = displayedClickToImage(relX, relY, rect.width, rect.height, img?.naturalWidth || 0, img?.naturalHeight || 0)
  canvasMarkTap.value = {
    seq: Date.now(),
    nodeId: props.id,
    x: point.x,
    y: point.y,
  }
}

function onOpenDirector(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  canvasDirectorOpenId.value = props.id
}
const canvasNodeUploadId = useState('canvas-node-upload-id', () => '')
const canvasNodeUploadingId = useState('canvas-node-uploading-id', () => '')
const canvasCommentMarks = useState<Record<string, number>>('canvas-comment-marks', () => ({}))
const canvasCommentFocus = useState('canvas-comment-focus', () => '')
const canvasCommentOpen = useState('canvas-comment-open', () => ({ seq: 0, nodeId: '' }))
const commentCount = computed(() => canvasCommentMarks.value[props.id] || 0)
const commentOn = computed(() => canvasCommentFocus.value === props.id)

function openNodeComment(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  canvasCommentOpen.value = { seq: canvasCommentOpen.value.seq + 1, nodeId: props.id }
}
const nodeUploading = computed(() => canvasNodeUploadingId.value === props.id)
const taskBusy = computed(() => props.data.taskStatus === 'pending' || props.data.taskStatus === 'running')
const taskFailed = computed(() => props.data.taskStatus === 'failed')
/** 已有画面时，生成中要盖一层，避免转圈压在图上看不清 */
const generatingCover = computed(() => Boolean(imageSrc.value || videoSrc.value || audioSrc.value || (isText.value && (isWrite.value || hasContent.value))))
const generatingLabel = computed(() => {
  const label = props.data.mediaJobId || props.data.composeJobId ? t('处理中') : t('生成中')
  const progress = Number(props.data.taskProgress)
  return progress > 0 ? `${label} ${Math.round(progress)}%` : label
})
const kindLabel = computed(() => CANVAS_NODE_ITEMS.find(item => item.kind === props.data.kind)?.label ?? '')
/** 一稿多版矩阵派生节点的角标：比例（· 语种） */
const matrixTag = computed(() => {
  const matrix = props.data.matrix
  if (!matrix)
    return ''
  return [matrix.ratio, matrix.lang ? langLabel(matrix.lang) : ''].filter(Boolean).join(' · ')
})
const tagIcon = computed(() => {
  if (props.data.tag === '打光')
    return 'i-lucide-sun'
  if (isHd.value || props.data.tag === '高清' || props.data.tag === '图片高清')
    return 'i-lucide-scan-search'
  if (isRetake.value || props.data.tag === '片段重拍')
    return 'i-lucide-clapperboard'
  if (isFramePull.value || props.data.tag === '逐帧拉片')
    return 'i-lucide-gem'
  if (props.data.tag === '深度提取')
    return 'i-lucide-layers-2'
  if (isDepthMotion.value || props.data.tag === '深度动作捕捉')
    return 'i-lucide-activity'
  if (isAudioTrack.value || props.data.kind === 'audio')
    return 'i-lucide-music'
  if (isFrameCapture.value)
    return 'i-lucide-image'
  if (props.data.tag)
    return 'i-lucide-layers'
  return canvasNodeIcon(props.data.kind)
})
const tagText = computed(() => {
  if (isHd.value)
    return hdNodeTag(props.data.hdParams?.resolution)
  if (isRetake.value) {
    const source = props.data.retakeParams?.sourceLabel
    return source ? `${source}-${t('片段重拍')}` : t('片段重拍')
  }
  if (isFramePull.value) {
    const source = props.data.frameParams?.sourceLabel
    return source ? `${source}-${t('逐帧拉片')}` : t('逐帧拉片')
  }
  if (isDepthMotion.value) {
    const source = props.data.depthMotionParams?.sourceLabel
    return source ? `${t('深度动作捕捉')}-${source}` : t('深度动作捕捉')
  }
  if (isCrop.value) {
    const source = props.data.cropRect?.sourceLabel
    return source ? `${source}_${t('裁剪')}` : t('裁剪')
  }
  if (isAudioTrack.value || isSilent.value || isFrameCapture.value)
    return props.data.label || t(props.data.tag || '')
  if (props.data.tag === '图片高清')
    return props.data.label || t('图片高清')
  if (props.data.tag)
    return t(props.data.tag)
  return kindLabel.value ? `${t(kindLabel.value)}${kindNo.value || ''}` : ''
})
const kindNo = computed(() => {
  const kind = props.data.kind
  if (kind !== 'text' && kind !== 'image' && kind !== 'video' && kind !== 'audio')
    return 0
  if (isHd.value || isRetake.value || isFramePull.value || isDepthMotion.value || isCrop.value || isAudioTrack.value || isSilent.value || isFrameCapture.value)
    return 0
  return canvasKindIndex(nodes.value, props.id, kind)
})
const stageSize = computed(() => {
  if (!isStage.value)
    return null
  return {
    width: `${stageBox.w}px`,
    height: `${stageBox.h}px`,
  }
})

const canvasChange = inject(CANVAS_CHANGE_KEY, null)
/** 结果是否过期：由工作区算好 provide 下来（上游产物 / 本节点参数跟提交时不一致） */
const canvasStale = inject(CANVAS_STALE_KEY, null)

function onFrameParamsUpdate(params: NonNullable<CanvasNodeData['frameParams']>) {
  // 跟练期间画布只读：拉片参数也是画布数据编辑，静默早退（本组件没有 toast；拉片节点的创建与提交
  // 在跟练里都已拦下，能走到这里的只有画布上本来就存在的拉片节点）
  if (practiceSession.value.active)
    return
  updateNodeData(props.id, { frameParams: params })
  canvasChange?.change()
}

function onFrameSubmit(payload: { count: number, analyze: boolean }) {
  if (writeFrozen.value)
    return
  canvasFrameSubmit.value = { seq: Date.now(), nodeId: props.id, ...payload }
}

const canCancelTask = computed(() => taskBusy.value && Number(props.data.taskId) > 0 && !writeFrozen.value)
const canRetryTask = computed(() =>
  taskFailed.value && Number(props.data.taskId) > 0 && !writeFrozen.value)

/** 过期提示只在有结果、且不是「生成中 / 失败」时露出来 */
const staleReason = computed(() => (taskBusy.value || taskFailed.value ? null : canvasStale?.value?.[props.id] ?? null))
const staleTitle = computed(() => (staleReason.value === 'upstream'
  ? t('上游的结果变了，这个结果已经不是最新的')
  : t('模型或提示词改过，这个结果已经不是最新的')))

function onRerunStale(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (writeFrozen.value)
    return
  canvasNodeRerun.value = { seq: Date.now(), nodeId: props.id }
}

function onCancelTask(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const taskId = Number(props.data.taskId)
  if (!(taskId > 0) || writeFrozen.value)
    return
  canvasTaskCancel.value = { seq: Date.now(), nodeId: props.id, taskId }
}

function onRetryTask(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  const taskId = Number(props.data.taskId)
  if (!(taskId > 0) || writeFrozen.value)
    return
  canvasTaskRetry.value = { seq: Date.now(), nodeId: props.id, taskId }
}

function onPrompt(event: Event) {
  if (writeFrozen.value)
    return
  const el = event.target as HTMLTextAreaElement
  updateNodeData(props.id, { content: el.value })
  // 节点内打字只标脏触发自动保存，不逐字压撤销历史
  canvasChange?.change()
}

function writeStoryboard(next: StoryboardShot[]) {
  if (writeFrozen.value)
    return
  updateNodeData(props.id, { storyboardShots: next })
  canvasChange?.change()
}

function onStoryboardPrompt(index: number, event: Event) {
  const value = (event.target as HTMLTextAreaElement).value
  writeStoryboard(storyboardShots.value.map((item, i) => i === index ? { ...item, prompt: value } : item))
}

function onStoryboardSeconds(index: number, event: Event) {
  const seconds = Math.min(15, Math.max(1, Math.round(Number((event.target as HTMLInputElement).value) || 5)))
  writeStoryboard(storyboardShots.value.map((item, i) => i === index ? { ...item, seconds } : item))
}

function onStoryboardAdd() {
  if (storyboardShots.value.length >= STORYBOARD_MAX)
    return
  writeStoryboard([...storyboardShots.value, { id: `s${Date.now()}`, prompt: '', seconds: 5 }])
}

function onStoryboardRemove(index: number) {
  if (storyboardShots.value.length <= 1)
    return
  writeStoryboard(storyboardShots.value.filter((_, i) => i !== index))
}

function onStoryboardExpand() {
  if (writeFrozen.value || !storyboardReady.value || storyboardSplit.value)
    return
  if (expandStoryboard?.(props.id))
    storyboardSplit.value = true
}

function applyStageSize(w: number, h: number) {
  stageBox.w = w
  stageBox.h = h
  updateNode(props.id, {
    width: w,
    height: h,
    style: { width: `${w}px`, height: `${h}px` },
  })
}

/** 文本节点以节点记录的宽高为准，避免 markdown 预览异步测量把卡片撑歪 */
function textStageTarget() {
  const node = findNode(props.id)
  const style = node && typeof node.style === 'object' && node.style
    ? node.style as Record<string, string | number>
    : null
  const styleW = Number.parseFloat(String(style?.width ?? ''))
  const styleH = Number.parseFloat(String(style?.height ?? ''))
  const w = Number(node?.width) || (Number.isFinite(styleW) ? styleW : 0) || stagePreset.value.w
  const h = Number(node?.height) || (Number.isFinite(styleH) ? styleH : 0) || stagePreset.value.h
  return {
    w: w > 0 ? w : stagePreset.value.w,
    h: h > 0 ? h : stagePreset.value.h,
  }
}

function syncTextStageSize() {
  if (!isText.value || resizing.value)
    return
  const next = textStageTarget()
  if (canvasMediaSizeClose(next, stageBox))
    return
  applyStageSize(next.w, next.h)
  nextTick(() => updateNodeInternals([props.id]))
}

// 打开画布时已有的图片/视频按自身比例适配只是显示层面的校正，不标脏：
// 否则什么都没改也会弹未保存、触发自动保存，两个标签页开同一画布还会互相冲突。
// 换了新素材（生成 / 替换）后的适配才需要保存。
const initialImageSrc = imageSrc.value
const initialVideoSrc = videoSrc.value
/** 视频元数据里的真实像素。有它就以成片为准，不再用 params.ratio 猜比例。 */
const videoMeasured = ref<{ width: number, height: number } | null>(null)

function fitStageToMedia(width: number, height: number, dirty: boolean, label = true) {
  if (resizing.value || !width || !height)
    return
  if (label)
    mediaPx.value = `${Math.round(width)} × ${Math.round(height)}`
  const next = canvasFitMediaSize(width, height)
  if (canvasMediaSizeClose(next, stageBox))
    return
  applyStageSize(next.w, next.h)
  nextTick(() => updateNodeInternals([props.id]))
  if (dirty)
    canvasChange?.change()
}

function fitImageNode(img: { naturalWidth: number, naturalHeight: number }) {
  if (!isImage.value || isPanorama.value)
    return
  fitStageToMedia(img.naturalWidth, img.naturalHeight, imageSrc.value !== initialImageSrc)
}

function videoRatioPixels() {
  const ratio = typeof props.data.params?.ratio === 'string' ? props.data.params.ratio.trim() : ''
  const matched = ratio.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/)
  if (!matched)
    return null
  const width = Number(matched[1])
  const height = Number(matched[2])
  if (!width || !height)
    return null
  return { width, height }
}

/** 卡片比例：裁切框优先，其次成片像素，最后才用生成参数里的比例。 */
function videoDisplayPixels(measured?: { width: number, height: number } | null) {
  const crop = props.data.cropRect
  if (crop?.width && crop?.height)
    return { width: crop.width, height: crop.height, label: true }
  const pixels = measured?.width && measured.height ? measured : null
  if (pixels)
    return { width: pixels.width, height: pixels.height, label: true }
  const ratio = videoRatioPixels()
  if (!ratio)
    return null
  return { width: ratio.width, height: ratio.height, label: false }
}

function fitVideoNode(measured?: { width: number, height: number } | null) {
  if (props.data.kind !== 'video' || isFramePull.value)
    return
  const size = videoDisplayPixels(measured)
  if (!size)
    return
  const dirty = Boolean(videoSrc.value) && videoSrc.value !== initialVideoSrc
  fitStageToMedia(size.width, size.height, dirty, Boolean(videoSrc.value) && size.label)
}

function onVideoMeta(size: { width: number, height: number }) {
  if (!size.width || !size.height)
    return
  videoMeasured.value = size
  fitVideoNode(size)
}

function onMediaLoad(event: Event) {
  fitImageNode(event.target as HTMLImageElement)
}

function onResizeStart(event: PointerEvent) {
  if (!isText.value || writeFrozen.value)
    return
  event.preventDefault()
  event.stopPropagation()
  resizing.value = true
  const startX = event.clientX
  const startY = event.clientY
  const startW = stageBox.w
  const startH = stageBox.h
  const el = event.currentTarget as HTMLElement
  el.setPointerCapture(event.pointerId)

  function onMove(move: PointerEvent) {
    const z = viewport.value.zoom || 1
    const w = Math.max(stagePreset.value.minW, startW + (move.clientX - startX) / z)
    const h = Math.max(stagePreset.value.minH, startH + (move.clientY - startY) / z)
    applyStageSize(w, h)
  }

  function onUp() {
    resizing.value = false
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    updateNodeInternals([props.id])
    canvasChange?.commit()
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}

function onStageDblClick(event: MouseEvent) {
  if (isDirector.value) {
    event.preventDefault()
    event.stopPropagation()
    canvasDirectorOpenId.value = props.id
    return
  }
  if (!isText.value)
    return
  // 跟练中画布只读：文本节点是跟练的教具（角色设定 / 分镜脚本），双击进编辑态就是能改画布内容。
  // 提前 return 且不吞事件：冒泡到 Workspace 的 onNodeDblClick，由它弹「跟练中画布是只读的」提示。
  if (practiceSession.value.active)
    return
  if (nodeLocked.value)
    return
  event.preventDefault()
  event.stopPropagation()
  updateNodeData(props.id, { mode: 'write' })
}

function onUploadClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (nodeUploading.value || writeFrozen.value)
    return
  canvasNodeUploadId.value = props.id
}

watch(isWrite, async (on) => {
  if (!on)
    return
  // 进入编辑时再对齐一次尺寸：预览态下 markdown 测量常把卡片撑偏，双击后才「恢复正常」
  syncTextStageSize()
  await nextTick()
  textRef.value?.focus()
})

watch(() => props.selected, (on) => {
  if (!on && isText.value && props.data.mode === 'write')
    updateNodeData(props.id, { mode: 'idle' })
})

watch(
  () => [props.dimensions?.width, props.dimensions?.height, props.data.kind, props.data.content, audioSrc.value, isFramePull.value] as const,
  ([width, height]) => {
    if (!isStage.value || resizing.value)
      return
    if (isText.value) {
      syncTextStageSize()
      return
    }
    if (width)
      stageBox.w = width
    if (height)
      stageBox.h = height
    // 音轨节点以前默认 220 太高，有内容时压到紧凑尺寸
    if (props.data.kind === 'audio' && audioSrc.value) {
      const compact = canvasStageSize('audio') || { w: 280, h: 118 }
      const nextW = Math.max(compact.w, Math.min(stageBox.w || compact.w, 300))
      const nextH = compact.h
      if (!canvasMediaSizeClose({ w: nextW, h: nextH }, stageBox)) {
        applyStageSize(nextW, nextH)
        nextTick(() => updateNodeInternals([props.id]))
      }
    }
    if (isFramePull.value) {
      const next = FRAME_PULL_STAGE_SIZE
      if (!canvasMediaSizeClose(next, stageBox)) {
        applyStageSize(next.w, next.h)
        nextTick(() => updateNodeInternals([props.id]))
      }
    }
  },
  { immediate: true },
)

watch(
  () => props.data.cropRect,
  (rect) => {
    if (rect?.width && rect?.height)
      mediaPx.value = `${Math.round(rect.width)} × ${Math.round(rect.height)}`
    if (props.data.kind === 'video')
      fitVideoNode(videoMeasured.value)
  },
  { immediate: true },
)

watch(imageSrc, async (src) => {
  if (!src) {
    mediaPx.value = ''
    imagePreviewOpen.value = false
    if (!isImage.value || isPanorama.value || resizing.value)
      return
    const preset = stagePreset.value
    if (!canvasMediaSizeClose(stageBox, preset)) {
      applyStageSize(preset.w, preset.h)
      nextTick(() => updateNodeInternals([props.id]))
    }
    return
  }
  await nextTick()
  const img = mediaRef.value
  if (img?.complete && img.naturalWidth)
    fitImageNode(img)
})

watch(videoSrc, (src) => {
  if (props.data.kind !== 'video' || isFramePull.value)
    return
  videoMeasured.value = null
  if (!src) {
    mediaPx.value = ''
    const preset = stagePreset.value
    if (!canvasMediaSizeClose(stageBox, preset)) {
      applyStageSize(preset.w, preset.h)
      nextTick(() => updateNodeInternals([props.id]))
    }
    return
  }
  fitVideoNode()
})

watch(
  () => (typeof props.data.params?.ratio === 'string' ? props.data.params.ratio : ''),
  () => {
    if (videoMeasured.value)
      return
    fitVideoNode()
  },
)

onMounted(() => {
  if (!isStage.value)
    return
  if (isText.value) {
    const next = textStageTarget()
    stageBox.w = next.w
    stageBox.h = next.h
    applyStageSize(next.w, next.h)
    nextTick(() => updateNodeInternals([props.id]))
    return
  }
  const w = props.dimensions?.width || stagePreset.value.w
  const h = props.dimensions?.height || stagePreset.value.h
  stageBox.w = w
  stageBox.h = h
  if (!props.dimensions?.width || !props.dimensions?.height)
    applyStageSize(w, h)
  const img = mediaRef.value
  if (img?.complete && img.naturalWidth)
    fitImageNode(img)
  fitVideoNode()
})
</script>

<template>
  <div
    class="cnode"
    :class="{
      'is-on': selected,
      'is-stage': isStage,
      'is-text': isText,
      'is-image': isImage,
      'is-panorama': isPanorama,
      'is-video': data.kind === 'video',
      'is-depth': isDepthExtract,
      'is-audio': data.kind === 'audio',
      'is-storyboard': isStoryboard,
      'is-director': data.kind === 'director',
      'is-write': isWrite,
      'has-prompt': hasContent,
      'is-blank': isBlank,
      'is-hd': isHd,
      'is-retake': isRetake,
      'is-frame': isFramePull,
      'is-flip-ghost': canvasFlipNodeId === id,
      'is-mark-able': markAble,
      'has-note': commentCount,
    }"
    :style="stageSize ?? undefined"
  >
    <button
      v-if="commentCount"
      type="button"
      class="cnode__note"
      :class="{ 'is-on': commentOn }"
      :aria-label="t('{n} 条批注', { n: commentCount })"
      @pointerdown.stop
      @click.stop="openNodeComment"
    >
      <UIcon name="i-lucide-message-square" class="size-3" />
      {{ commentCount }}
    </button>
    <p v-if="isStage && !isFramePull" class="cnode__tag">
      <span class="cnode__tag-name">
        <UIcon :name="tagIcon" class="size-3.5" />
        {{ tagText }}
      </span>
      <span v-if="data.kind === 'video' && data.videoMode === 'talking'" class="cnode__tag-talking">
        <UIcon name="i-lucide-mic" class="size-3" />
        {{ t('口播') }}
      </span>
      <span v-if="data.practiceShowcase" class="cnode__tag-practice">
        <UIcon name="i-lucide-graduation-cap" class="size-3" />
        {{ t('跟练成片') }}
      </span>
      <span v-if="nodeLocked" class="cnode__tag-lock" :title="t('canvas.lock.hint')">
        <UIcon name="i-lucide-lock" class="size-3" />
      </span>
      <span v-if="data.previewControl" class="cnode__tag-control" :title="t('canvas.director.preview.controlTag')">
        {{ t('控制图') }}
      </span>
      <span v-if="data.matrix" class="cnode__tag-matrix" :title="t('一稿多版')">
        <UIcon name="i-lucide-layout-grid" class="size-3" />
        {{ matrixTag }}
      </span>
      <span v-if="mediaPx || depthSizeLabel" class="cnode__tag-size">{{ mediaPx || depthSizeLabel }}</span>
    </p>

    <!-- 左侧只接进来的线，不画出加号，也不能从这里往外拖 -->
    <Handle
      id="in"
      type="target"
      :position="Position.Left"
      :connectable="true"
      :connectable-start="false"
      :connectable-end="true"
    />

    <template v-if="isStage">
      <div class="cnode__stage" :style="stageTone" @dblclick="onStageDblClick">
        <textarea
          v-if="isWrite"
          ref="textRef"
          class="cnode__editor nodrag nowheel"
          :value="data.content"
          :style="textStyle"
          :placeholder="t('输入文本内容')"
          @input="onPrompt"
          @pointerdown.stop
          @dblclick.stop
        />
        <ClientOnly v-else-if="isText && hasContent">
          <v-md-preview
            class="cnode__preview is-rich nowheel"
            :style="textStyle"
            :text="data.content"
          />
          <template #fallback>
            <div class="cnode__preview nowheel" :style="textStyle">{{ data.content }}</div>
          </template>
        </ClientOnly>
        <img
          v-else-if="imageSrc"
          ref="mediaRef"
          class="cnode__media"
          :src="imageSrc"
          alt=""
          draggable="false"
          @load="onMediaLoad"
        >
        <CanvasFramePanel
          v-else-if="isFramePull"
          :src="videoSrc || resolveMediaUrl(data.content || '')"
          :params="data.frameParams"
          :submitting="taskBusy"
          @update:params="onFrameParamsUpdate"
          @submit="onFrameSubmit"
        />
        <CanvasVideoPlayer
          v-else-if="videoSrc"
          :src="videoSrc"
          :crop="data.cropRect || null"
          :muted-forced="isSilent"
          @meta="onVideoMeta"
        />
        <CanvasAudioPlayer
          v-else-if="audioSrc"
          :src="audioSrc"
        />
        <div
          v-else-if="isStoryboard"
          class="cnode__shots nowheel"
        >
          <div v-for="(shot, index) in storyboardShots" :key="shot.id" class="cnode__shot">
            <span>{{ t('镜头') }} {{ index + 1 }}</span>
            <input
              class="nodrag"
              type="number"
              min="1"
              max="15"
              :value="shot.seconds"
              :disabled="writeFrozen"
              :aria-label="t('秒数')"
              @pointerdown.stop
              @change="onStoryboardSeconds(index, $event)"
            >
            <button
              type="button"
              class="nodrag nopan"
              :disabled="writeFrozen || storyboardShots.length <= 1"
              :aria-label="t('删除这一镜')"
              @pointerdown.stop
              @click.stop="onStoryboardRemove(index)"
            >
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
            <textarea
              class="nodrag nowheel"
              :value="shot.prompt"
              :placeholder="t('这一镜的提示词')"
              :disabled="writeFrozen"
              @pointerdown.stop
              @input="onStoryboardPrompt(index, $event)"
            />
          </div>
          <div class="cnode__shot-actions nodrag">
            <button
              type="button"
              class="nodrag nopan"
              :disabled="writeFrozen || storyboardShots.length >= STORYBOARD_MAX"
              @click.stop="onStoryboardAdd"
            >
              {{ t('加一镜') }}
            </button>
            <button
              type="button"
              class="nodrag nopan is-primary"
              :disabled="writeFrozen || !storyboardReady || storyboardSplit"
              @click.stop="onStoryboardExpand"
            >
              {{ storyboardSplit ? t('已拆成视频') : t('拆成视频') }}
            </button>
          </div>
        </div>
        <template v-else>
          <span v-if="isHd && !taskBusy" class="cnode__hd-hint">
            {{ t('配置参数生成高清视频') }}
          </span>
          <div v-else-if="isMediaCard && nodeUploading && !taskBusy" class="cnode__uploading nodrag nopan nowheel">
            <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin" />
            <span>{{ t('上传中…') }}</span>
          </div>
          <template v-else-if="!isDepthExtract && !taskBusy">
            <span class="cnode__glyph" :class="{ 'is-media': isMediaCard }">
              <UIcon :name="canvasNodeIcon(data.kind)" :class="isMediaCard ? 'size-10' : 'size-12'" />
            </span>
            <button
              v-if="isDirector"
              type="button"
              class="cnode__upload nodrag nopan nowheel"
              @pointerdown.stop
              @click.stop="onOpenDirector"
              @dblclick.stop
            >
              <UIcon name="i-lucide-clapperboard" class="size-3.5" />
              {{ t('打开导演台') }}
            </button>
            <button
              v-else-if="isMediaCard"
              type="button"
              class="cnode__upload nodrag nopan nowheel"
              :disabled="nodeUploading || writeFrozen"
              :aria-label="practiceLocked ? t('跟练中画布是只读的：先退出跟练再编辑') : (nodeLocked ? t('canvas.lock.lock') : undefined)"
              @pointerdown.stop
              @click.stop="onUploadClick"
              @dblclick.stop
            >
              <UIcon
                :name="nodeUploading ? 'i-lucide-loader-circle' : 'i-lucide-upload'"
                class="size-3.5"
                :class="{ 'animate-spin': nodeUploading }"
              />
              {{ nodeUploading ? t('上传中…') : t('上传') }}
            </button>
            <span v-if="isText" class="cnode__hint">{{ t('双击编辑') }}</span>
          </template>
        </template>
        <span v-if="isRetake && data.retakeParams?.sourceLabel && videoSrc" class="cnode__src-chip">
          <UIcon name="i-lucide-film" class="size-3" />
          {{ data.retakeParams.sourceLabel }}
        </span>
        <button
          v-if="isDirector && imageSrc"
          type="button"
          class="cnode__upload nodrag nopan nowheel"
          @pointerdown.stop
          @click.stop="onOpenDirector"
          @dblclick.stop
        >
          <UIcon name="i-lucide-clapperboard" class="size-3.5" />
          {{ t('打开导演台') }}
        </button>
        <div
          v-if="isImage && imageSrc && !markPickOn"
          class="cnode-player__tools nodrag nopan nowheel"
        >
          <button
            type="button"
            class="cnode-player__full"
            :disabled="writeFrozen"
            :aria-label="practiceLocked ? t('跟练中画布是只读的：先退出跟练再编辑') : (nodeLocked ? t('canvas.lock.lock') : t('替换图片'))"
            @pointerdown.stop
            @pointerup.stop
            @click.stop="onUploadClick"
            @dblclick.stop
          >
            <UIcon name="i-lucide-upload" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('替换图片') }}</span>
          </button>
          <button
            type="button"
            class="cnode-player__full"
            :aria-label="t('查看大图')"
            @pointerdown.stop
            @pointerup.stop
            @click.stop="imagePreviewOpen = true"
            @dblclick.stop
          >
            <UIcon name="i-lucide-maximize-2" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('查看大图') }}</span>
          </button>
        </div>
        <div
          v-else-if="((data.kind === 'video' && videoSrc) || (data.kind === 'audio' && audioSrc)) && !markPickOn"
          class="cnode-player__tools nodrag nopan nowheel"
        >
          <button
            type="button"
            class="cnode-player__full"
            :disabled="writeFrozen"
            :aria-label="practiceLocked ? t('跟练中画布是只读的：先退出跟练再编辑') : (nodeLocked ? t('canvas.lock.lock') : t(data.kind === 'video' ? '替换视频' : '替换音频'))"
            @pointerdown.stop
            @pointerup.stop
            @click.stop="onUploadClick"
            @dblclick.stop
          >
            <UIcon name="i-lucide-upload" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t(data.kind === 'video' ? '替换视频' : '替换音频') }}</span>
          </button>
        </div>
        <button
          v-if="markAble"
          type="button"
          class="cnode__mark-hit nodrag nopan nowheel"
          :aria-label="t('选择局部元素')"
          @pointerdown.stop
          @click.stop="onMarkHit"
        />
        <span v-if="markAnalyzing" class="cnode__mark-busy">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          {{ t('分析中…') }}
        </span>
        <div
          v-for="item in markBoxes"
          :key="item.id"
          class="cnode__mark-box nodrag nopan nowheel"
          :style="markBoxStyle(item.box)"
        >
          <div class="cnode__mark-tag-wrap">
            <span class="cnode__mark-tag">
              <UIcon name="i-lucide-sparkles" class="size-3.5" />
              {{ item.name }}
            </span>
          </div>
        </div>
        <CanvasMediaPreview
          :open="imagePreviewOpen"
          :src="imageSrc"
          kind="image"
          @close="imagePreviewOpen = false"
        />
        <div v-if="taskBusy && !isFramePull" class="cnode__generating nodrag nopan nowheel" :class="{ 'is-cover': generatingCover }">
          <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin" />
          <span>{{ generatingLabel }}</span>
          <button
            v-if="canCancelTask"
            type="button"
            class="cnode__generating-cancel nodrag nopan"
            @pointerdown.stop
            @click="onCancelTask"
          >
            {{ t('取消') }}
          </button>
        </div>
        <span v-else-if="taskFailed" class="cnode__task is-error" :title="data.taskError">
          <UIcon name="i-lucide-circle-alert" class="size-3.5" />
          {{ data.taskError || t('生成失败') }}
          <button
            v-if="canRetryTask"
            type="button"
            class="cnode__task-cancel nodrag nopan"
            :title="t('重试')"
            :aria-label="t('重试')"
            @pointerdown.stop
            @click="onRetryTask"
          >
            <UIcon name="i-lucide-refresh-cw" class="size-3" />
          </button>
        </span>
        <span v-else-if="staleReason" class="cnode__task is-stale" :title="staleTitle">
          <UIcon name="i-lucide-history" class="size-3.5" />
          {{ t('结果已过期') }}
          <button
            v-if="!writeFrozen"
            type="button"
            class="cnode__task-cancel nodrag nopan"
            :title="t('按当前输入重跑')"
            :aria-label="t('按当前输入重跑')"
            @pointerdown.stop
            @click="onRerunStale"
          >
            <UIcon name="i-lucide-refresh-cw" class="size-3" />
          </button>
        </span>
        <button
          v-if="isText && !writeFrozen"
          type="button"
          class="cnode__resize nodrag nopan nowheel"
          :aria-label="t('调整大小')"
          @pointerdown.stop="onResizeStart"
          @click.stop
          @dblclick.stop
        />
      </div>
    </template>

    <template v-else>
      <header class="cnode__head">
        <span class="cnode__icon">
          <UIcon :name="canvasNodeIcon(data.kind)" class="size-3.5" />
        </span>
        <strong>{{ data.label }}</strong>
      </header>
      <div class="cnode__body">
        <span class="cnode__mark">
          <UIcon :name="canvasNodeIcon(data.kind)" class="size-5" />
        </span>
      </div>
    </template>

    <Handle
      id="out"
      type="source"
      :position="Position.Right"
      :connectable="true"
    >
      <span class="cnode__port">
        <UIcon name="i-lucide-plus" class="size-3.5" />
      </span>
    </Handle>

  </div>
</template>
