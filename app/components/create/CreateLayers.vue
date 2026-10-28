<script setup lang="ts">
import { batchApi } from '~/api/batch'
import canvasApi from '~/api/canvas'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import { timelineApi } from '~/api/screenplay'
import taskApi from '~/api/task'
import type { BatchAction, BatchItemRequest, CanvasGraph, GenerationBatch, GenerationModel, GenerationTask, ReviewGate, ScreenplayPlan, ShotReview, ShotReviewReason, ShotReviewStatus, TaskInput, TaskType } from '~/types/creative'
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'
import { hasNativeAudio } from '~/utils/canvas-talking'
import { appendFxPrompt, appendStylePrompt, cameraIdsInPrompt, cameraMoveLabel, expandCameraTokens } from '~/utils/canvas-node-kinds'
import { expandRefTokens } from '~/utils/canvas-autolink'
import { expandMarkTokens } from '~/utils/canvas-mark'
import { resolveMediaUrl } from '~/utils/media'
import { voiceSegmentParams } from '~/utils/plan-dialogue'
import { isCanvasVersionConflictMessage } from '~/utils/canvas-save-machine'
import { batchActive, batchNodePatches, waitingNodeIds } from '~/utils/create-batch'
import {
  REVIEW_REASONS,
  assetReviewState,
  batchFailureSplit,
  blockedBatchItems,
  imageReviewsOf,
  isReviewGateBlocked,
  normalizeReviewGate,
  reviewGateVerdict,
  reviewReasonLabel,
} from '~/utils/create-review-gate'
import { groupLayerNodes, layerTagOf, refImageIn, shotNoOf, type LayerFlowEdge } from '~/utils/create-layer-nodes'
import {
  mergeTaskResults,
  snapshotTaskResults,
  type TaskResultBase,
} from '~/utils/create-layers-sync'

const { t } = useI18n()

/**
 * 成片向导第 3 步：按层（角色图 → 分镜图 → 镜头视频 → 配音）给 build 出来的画布节点下任务。
 * 任务参数与 CanvasInspector.generatePayload / CanvasWorkspace.onGenerate 保持一致：
 * - 图片 { count, ratio, quality, clarity }
 * - 视频 { count, mode: 'fl2v', ratio, resolution, duration, audio? }，首帧走 inputs role=first_frame；模型没有原生音频能力时不传 audio
 * - 音频 { count, duration, segments?, voice? }（分段配音见 API.md 25.1）
 * 任务状态与结果（taskId / assetId / content）写回节点 data 后用 PUT /user/canvas/:id 保存，画布打开即可看到结果。
 * 按层生成与「一键生成全部」都交给服务端批量编排（API.md 13）：依赖顺序、并发排队、预算上限在服务端，关掉页面也继续跑；
 * 这里只轮询批次，把提交出的任务挂到节点上，再由任务轮询取结果。
 */
const props = defineProps<{
  canvasId: number
  projectId: number
  models: { image: string, video: string, audio: string }
  plan: ScreenplayPlan | null
  /** 所选视频 / 配音模型支持的时长（秒）；空数组表示模型没声明，用通用档位 */
  videoDurations?: number[]
  audioDurations?: number[]
  /** 所选视频模型支持的分辨率；空数组表示不限，用 720P */
  videoResolutions?: string[]
  /** 所选图片模型接收参考图的方式（none / edits / url），不支持时分镜不带角色图 */
  imageInput?: string
  /** 这一层可换的已定价模型；失败后就地改，重新生成走新模型 */
  modelOptions: {
    image: StudioSelectOption[]
    video: StudioSelectOption[]
    audio: StudioSelectOption[]
  }
  /** 模型目录，用来判断视频要不要带 audio（没有 native_audio 的模型传了会一直失败） */
  catalog?: GenerationModel[]
}>()

const emit = defineEmits<{
  /** 已成功的镜头视频节点 id（按画布 x 排序），供合成 clip_order 用 */
  videos: [nodeIds: string[]]
  /** 本层或整批还在跑：向导离开页时用来提示任务会在后台继续 */
  running: [value: boolean]
  /** 失败后换这一层的模型，父级同步时长 / 分辨率并记住选择 */
  'update:model': [payload: { type: 'image' | 'video' | 'audio', model: string }]
}>()

type LayerKey = 'character' | 'shot' | 'video' | 'audio'
type FlowNode = { id: string, type?: string, position: { x: number, y: number }, data: Record<string, any> }

const RATIOS = new Set(['1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'])
const VIDEO_DURATIONS = [5, 10, 15]
const AUDIO_DURATIONS = [5, 10, 15, 30]
const POLL_MS = 3000

const toast = useToast()
const { refresh: refreshWallet } = useWallet()
const { track } = useTrack()
const { confirm } = useConfirm()

const loading = ref(false)
const loadError = ref('')
const graph = ref<CanvasGraph | null>(null)
const version = ref(0)
const skipped = reactive<Record<LayerKey, boolean>>({ character: false, shot: false, video: false, audio: false })
/** 画布最近一个服务端批次 */
const batch = ref<GenerationBatch | null>(null)
const batchBusy = ref(false)
/** 预算上限（积分），空 = 不限 */
const budgetInput = ref('')
const waitingIds = computed(() => waitingNodeIds(batch.value))

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const nodes = computed<FlowNode[]>(() => {
  const list = (graph.value?.nodes ?? []) as FlowNode[]
  return list.filter(node => node && node.data && typeof node.data === 'object')
})

function nodeById(id: string) {
  return nodes.value.find(node => node.id === id) ?? null
}

/** 视频节点的首帧图片节点：优先 data.refNodeId，其次画布连线里的上游图片节点 */
function refImageOf(video: FlowNode): FlowNode | null {
  return refImageIn(nodes.value, (graph.value?.edges ?? []) as LayerFlowEdge[], video)
}

/** 连到这个分镜的角色节点里已生成的角色图资产（最多 4 张，多了模型也记不住） */
function characterAssetsOf(shot: FlowNode): number[] {
  const ids: number[] = []
  for (const edge of graph.value?.edges ?? []) {
    if (String(edge?.target) !== shot.id)
      continue
    const src = nodeById(String(edge?.source))
    const assetId = Number(src?.data.assetId) || 0
    if (src && layerTag(src) === 'character' && assetId > 0 && !ids.includes(assetId))
      ids.push(assetId)
  }
  return ids.slice(0, 4)
}

/** 后端建画布 / 同步时在 data.sp.layer 标了层（character / shot_image / shot_video / voice） */
const layerTag = layerTagOf

/**
 * 四层分组（utils/create-layer-nodes）：画布上有 sp 标记就只认策划案节点（镜头按 sp.shot 升序），
 * 工具条派生的拉片帧 / 分离音轨 / 重拍节点、手加的图不进层；没有任何 sp 标记的老画布按 kind 推断。
 */
const layerGroups = computed(() => groupLayerNodes(nodes.value, (graph.value?.edges ?? []) as LayerFlowEdge[]))
const videoNodes = computed(() => layerGroups.value.video)
const shotImageNodes = computed(() => layerGroups.value.shot)
const characterNodes = computed(() => layerGroups.value.character)
const audioNodes = computed(() => layerGroups.value.audio)
/** 策划案模式下不在层里的节点数（在画布里管理） */
const otherNodeCount = computed(() => layerGroups.value.others)

type Layer = { key: LayerKey, title: string, type: TaskType, nodes: FlowNode[] }

const layers = computed<Layer[]>(() => [
  { key: 'character', title: t('角色图'), type: 'image', nodes: characterNodes.value },
  { key: 'shot', title: t('分镜图'), type: 'image', nodes: shotImageNodes.value },
  { key: 'video', title: t('镜头视频'), type: 'video', nodes: videoNodes.value },
  { key: 'audio', title: t('配音'), type: 'audio', nodes: audioNodes.value },
])

/** 有可用产物：成功过就算；后来的重试失败 / 取消不抹掉已有产物（时间线与合成也只认 assetId），只在卡片上另提示 */
function isDone(node: FlowNode) {
  if (node.data.taskStatus === 'succeeded')
    return Boolean(node.data.content)
  return Boolean(node.data.content) && (Number(node.data.assetId) || 0) > 0 && !isActive(node)
}

/** 有旧产物但最近一次尝试失败 / 取消 */
function staleAttempt(node: FlowNode) {
  return isDone(node) && (node.data.taskStatus === 'failed' || node.data.taskStatus === 'cancelled')
}

function isActive(node: FlowNode) {
  return node.data.taskStatus === 'pending' || node.data.taskStatus === 'running'
}

function successCount(layer: Layer) {
  return layer.nodes.filter(isDone).length
}

function activeCount(layer: Layer) {
  return layer.nodes.filter(isActive).length
}

/** 第 N+1 层：上一层至少一个成功、被跳过或本来就没有节点时可用 */
function layerEnabled(index: number) {
  for (let i = 0; i < index; i += 1) {
    const prev = layers.value[i]
    if (!prev)
      continue
    if (prev.nodes.length && !skipped[prev.key] && successCount(prev) === 0)
      return false
  }
  return true
}

const succeededVideoIds = computed(() => videoNodes.value.filter(isDone).map(node => node.id))
watch(succeededVideoIds, ids => emit('videos', ids), { immediate: true })

// ---- 画布读写 ----

async function load() {
  if (!props.canvasId)
    return
  loading.value = true
  loadError.value = ''
  try {
    const res = await canvasApi.get(props.canvasId)
    if (!res?.success || !res.data) {
      loadError.value = res?.message || t('画布不存在或已删除')
      return
    }
    graph.value = res.data.graph ?? { nodes: [], edges: [] }
    version.value = res.data.version
    resultBase = snapshotTaskResults(graph.value)
    ensurePolling()
    await Promise.all([loadBatch(), loadGate()])
  }
  finally {
    loading.value = false
  }
}

// ---- 审批门禁与分镜图审片（API.md 26.1 / 25.5，复审 G05）----

/** 门禁存在时间线里；时间线已定版时不能改 */
const reviewGate = ref<ReviewGate>('')
const gateBusy = ref(false)
const timelineLocked = ref(false)
/** 分镜图候选的审片结论（asset_id → review），从镜头视图读；角色图候选不在镜头视图里，只审分镜图 */
const imageReviews = ref(new Map<number, ShotReview>())
/** 正在提交审片的资产 id */
const reviewBusy = ref(0)
const rejectForm = ref<{ nodeId: string, assetId: number, reason: ShotReviewReason, note: string } | null>(null)
/** 单节点生成被门禁拦下的说明（不落画布；批次里被拦的从条目状态得出） */
const gateBlocked = reactive<Record<string, string>>({})
/** 「去审片」滚到的分镜图节点，短暂高亮 */
const highlightId = ref('')
let highlightTimer: ReturnType<typeof setTimeout> | null = null

const gateOptions = computed<Array<{ value: ReviewGate, label: string }>>(() => [
  { value: '', label: t('create.layers.gate.off') },
  { value: 'rejected', label: t('create.layers.gate.reject') },
  { value: 'approved', label: t('create.layers.gate.approve') },
])

const gateHint = computed(() => {
  if (timelineLocked.value)
    return t('create.layers.gate.locked')
  switch (reviewGate.value) {
    case 'rejected': return t('create.layers.gate.rejectHint')
    case 'approved': return t('create.layers.gate.approveHint')
    default: return t('create.layers.gate.openHint')
  }
})

const reasonOptions = computed(() => REVIEW_REASONS.map(value => ({ value, label: reviewReasonLabel(value, t) })))

/** 读门禁、定版状态与分镜图审片结论（一次 GET timeline 全有）；读不到不影响生成 */
async function loadGate() {
  if (!props.canvasId)
    return
  const res = await timelineApi.get(props.canvasId)
  if (!res?.success || !res.data)
    return
  reviewGate.value = normalizeReviewGate(res.data.timeline?.review_gate)
  timelineLocked.value = Boolean(res.data.locked)
  imageReviews.value = imageReviewsOf(res.data.shots, res.data.characters)
}

async function setGate(value: ReviewGate) {
  if (gateBusy.value || timelineLocked.value || value === reviewGate.value)
    return
  const prev = reviewGate.value
  reviewGate.value = value
  gateBusy.value = true
  try {
    const result = await timelineApi.saveReviewGate(props.canvasId, value)
    if (result.outcome === 'ok') {
      reviewGate.value = normalizeReviewGate(result.timeline?.review_gate ?? value)
      track('review_gate_set', { canvas_id: props.canvasId, gate: reviewGate.value })
      return
    }
    reviewGate.value = result.timeline ? normalizeReviewGate(result.timeline.review_gate) : prev
    if (result.outcome === 'locked') {
      timelineLocked.value = true
      notify(t('create.layers.gate.locked'), 'error')
    }
    else {
      notify(result.message || t('create.layers.gate.saveFail'), 'error')
    }
  }
  finally {
    gateBusy.value = false
  }
}

function nodeAssetId(node: FlowNode) {
  return Number(node.data.assetId) || 0
}

/** 已生成成功的分镜图与角色图都可以审（角色图候选与结论来自 timeline / shots 响应的 characters） */
function reviewable(layer: Layer, node: FlowNode) {
  return (layer.key === 'shot' || layer.key === 'character') && layer.type === 'image' && isDone(node) && nodeAssetId(node) > 0
}

function nodeReview(node: FlowNode): ShotReview | null {
  return imageReviews.value.get(nodeAssetId(node)) ?? null
}

function nodeReviewState(node: FlowNode) {
  return assetReviewState(nodeAssetId(node), imageReviews.value)
}

function nodeReviewText(node: FlowNode) {
  const review = nodeReview(node)
  if (!review)
    return ''
  if (review.status === 1)
    return t('已通过')
  return review.reason ? t('已退回 · {reason}', { reason: reviewReasonLabel(review.reason, t) }) : t('已退回')
}

/** 引用这张分镜图作首帧的视频节点 */
function videosUsing(image: FlowNode) {
  return videoNodes.value.filter(video => refImageOf(video)?.id === image.id)
}

async function submitReview(node: FlowNode, status: ShotReviewStatus, reason: ShotReviewReason | '' = '', note = '') {
  const assetId = nodeAssetId(node)
  if (!assetId || reviewBusy.value)
    return
  reviewBusy.value = assetId
  try {
    const res = await timelineApi.review(props.canvasId, { node_id: node.id, asset_id: assetId, status, reason, note })
    if (!res?.success || !res.data) {
      notify(res?.message || t('审片失败'), 'error')
      return
    }
    const next = new Map(imageReviews.value)
    if (res.data.review)
      next.set(assetId, res.data.review)
    else
      next.delete(assetId)
    imageReviews.value = next
    if (rejectForm.value?.assetId === assetId)
      rejectForm.value = null
    // 结论变了，之前「被门禁拦下」的提示不再准确，让用户重新点生成
    for (const video of videosUsing(node))
      delete gateBlocked[video.id]
    track('shot_image_review', { canvas_id: props.canvasId, asset_id: assetId, status, reason })
  }
  finally {
    reviewBusy.value = 0
  }
}

function openReject(node: FlowNode) {
  rejectForm.value = { nodeId: node.id, assetId: nodeAssetId(node), reason: 'composition', note: '' }
}

function confirmReject() {
  const form = rejectForm.value
  const node = form ? nodeById(form.nodeId) : null
  if (!form || !node)
    return
  void submitReview(node, 'rejected', form.reason, form.note.trim())
}

/** 批次里被门禁拦下的条目：node_id → 原因 */
const batchBlocked = computed(() => {
  const map = new Map<string, string>()
  for (const item of blockedBatchItems(batch.value))
    map.set(item.node_id, item.error || t('被门禁拦下'))
  return map
})

const blockedItems = computed(() => blockedBatchItems(batch.value))

function blockedText(node: FlowNode) {
  if (isActive(node) || isDone(node))
    return ''
  return gateBlocked[node.id] || batchBlocked.value.get(node.id) || ''
}

/** 被门禁拦下不是失败：分镜图通过审片或撤销退回后再生成即可 */
function isBlocked(node: FlowNode) {
  return blockedText(node) !== ''
}

function nodeStateClass(node: FlowNode) {
  if (isBlocked(node))
    return 'is-blocked'
  return `is-${node.data.taskStatus || 'idle'}`
}

/** 「去审片」：滚到这个视频节点的分镜图卡片并高亮 */
function goReview(video: FlowNode) {
  const ref = refImageOf(video)
  if (!ref) {
    notify(t('create.layers.task.missingShot'))
    return
  }
  document.getElementById(`create-node-${ref.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightId.value = ref.id
  if (highlightTimer)
    clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => { highlightId.value = '' }, 1800)
}

/** 批次条目对应节点的显示名（镜头 N / 角色名） */
function labelOfNodeId(nodeId: string) {
  for (const layer of layers.value) {
    const index = layer.nodes.findIndex(node => node.id === nodeId)
    if (index >= 0)
      return nodeLabel(layer, index, layer.nodes[index]!)
  }
  return nodeId
}

/** 门禁为「分镜图通过才放行」时，一键全部会被拦下的视频节点数（按当前审片结论估，拦不拦以后端为准） */
function videosGatedNow() {
  const layer = layers.value.find(item => item.key === 'video')
  if (!layer || skipped.video)
    return 0
  return layer.nodes.filter(node => !isDone(node) && !isActive(node) && reviewGateVerdict(reviewGate.value, buildInputs(layer, node), imageReviews.value).blocked).length
}

function patchNode(nodeId: string, patch: Record<string, unknown>) {
  const node = nodeById(nodeId)
  if (!node)
    return
  node.data = { ...node.data, ...patch }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let saveQueued = false
/** 上次和服务端对齐时各节点的任务结果字段，冲突合并时判断本地改过哪些 */
let resultBase: TaskResultBase = new Map()
/** 连续保存失败只提示一次，成功后复位 */
let persistFailNotified = false

function schedulePersist() {
  if (saveTimer)
    clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persist(), 400)
}

/**
 * 与画布页一致：PUT /user/canvas/:id 乐观锁。
 * 只有版本冲突（别的页面刚存过）才合并：拉最新 graph，只把本地改过的任务结果字段盖上去再存一次，
 * 别处改的 prompt / label / 引用保持不动。其他失败不合并，提示用户。
 */
async function persist() {
  if (!props.canvasId || !graph.value)
    return
  if (saving) {
    saveQueued = true
    return
  }
  saving = true
  try {
    let sent = plainGraph()
    let res = await canvasApi.save(props.canvasId, { version: version.value, graph: sent })
    let merged = false
    if (!res?.success) {
      const latest = await canvasApi.get(props.canvasId)
      const conflict = isCanvasVersionConflictMessage(res?.message)
        || Boolean(latest?.success && latest.data && latest.data.version !== version.value)
      if (conflict && latest?.success && latest.data) {
        const remote = latest.data.graph ?? { nodes: [], edges: [] }
        graph.value = mergeTaskResults(remote, plainGraph(), resultBase)
        version.value = latest.data.version
        // 服务端现在是 remote；合并进去的本地结果在第二次保存成功前都算「相对基线改过」
        resultBase = snapshotTaskResults(remote)
        merged = true
        sent = plainGraph()
        res = await canvasApi.save(props.canvasId, { version: version.value, graph: sent })
      }
    }
    if (res?.success && res.data) {
      version.value = res.data.version
      resultBase = snapshotTaskResults(sent)
      persistFailNotified = false
    }
    else if (!persistFailNotified) {
      persistFailNotified = true
      notify(merged
        ? t('create.layers.task.saveMergeFail')
        : (res?.message || t('create.layers.task.saveFail')), 'error')
    }
  }
  finally {
    saving = false
    if (saveQueued) {
      saveQueued = false
      schedulePersist()
    }
  }
}

function plainGraph(): CanvasGraph {
  return JSON.parse(JSON.stringify(graph.value)) as CanvasGraph
}

// ---- 任务 ----

function applyTask(nodeId: string, task: GenerationTask) {
  const patch: Record<string, unknown> = {
    taskId: task.id,
    taskStatus: task.status,
    taskProgress: task.progress,
    taskError: task.status === 'failed' ? (task.error_msg || t('生成失败')) : '',
  }
  if (task.status === 'succeeded') {
    if (task.type === 'text' && task.result_text)
      patch.content = task.result_text
    else if (task.result_url)
      patch.content = task.result_url
    if (task.result_asset_id)
      patch.assetId = task.result_asset_id
  }
  patchNode(nodeId, patch)
}

function aspectRatio() {
  const aspect = String(props.plan?.aspect || '').trim()
  return RATIOS.has(aspect) ? aspect : '16:9'
}

/** 分辨率：模型声明了就取第一个（列表按运营填写顺序），否则 720P */
function videoResolution() {
  const list = props.videoResolutions
  if (list?.length && !list.includes('720P'))
    return list[0]!
  return '720P'
}

/** 模型声明的档位优先，没声明用通用档位 */
function durationOptions(type: 'video' | 'audio'): number[] {
  const declared = type === 'video' ? props.videoDurations : props.audioDurations
  if (declared?.length)
    return [...declared].sort((a, b) => a - b)
  return type === 'video' ? VIDEO_DURATIONS : AUDIO_DURATIONS
}

function pickDuration(seconds: number, options: number[]) {
  const s = Math.max(1, Number(seconds) || 0)
  return options.find(v => v >= s) ?? options[options.length - 1]!
}

/** 镜头时长：节点自带 seconds 优先，其次 sp.seconds，再按镜号（没有镜号按顺序）对应策划案，默认 5 秒 */
function shotSeconds(node: FlowNode, layer: LayerKey) {
  const own = Number(node.data.seconds)
  if (own > 0)
    return own
  const spSeconds = Number((node.data.sp as { seconds?: unknown } | undefined)?.seconds)
  if (spSeconds > 0)
    return spSeconds
  const no = shotNoOf(node)
  const list = layer === 'audio' ? audioNodes.value : layer === 'shot' ? shotImageNodes.value : videoNodes.value
  const shot = no ? props.plan?.shots?.find(s => s.no === no) : props.plan?.shots?.[list.indexOf(node)]
  return Number(shot?.seconds) > 0 ? Number(shot?.seconds) : 5
}

function buildParams(layer: Layer, node: FlowNode): Record<string, unknown> {
  const params: Record<string, unknown> = { count: 1 }
  if (layer.type === 'image')
    Object.assign(params, { ratio: aspectRatio(), quality: 'std', clarity: '2K' })
  // 时长要落在模型支持的档位上：策划案给的秒数（比如 2 秒或 10 秒）不一定被模型接受
  if (layer.type === 'video') {
    const videoParams: Record<string, unknown> = { mode: 'fl2v', ratio: aspectRatio(), resolution: videoResolution(), duration: pickDuration(shotSeconds(node, 'video'), durationOptions('video')) }
    // 目录里能确认没有原生音频时不传 audio：这类模型收到 generate_audio 会一直失败，换模型才有意义
    const picked = (props.catalog || []).find(item => item.model === modelOf(layer, node))
    if (!picked || hasNativeAudio(picked))
      videoParams.audio = true
    Object.assign(params, videoParams)
  }
  if (layer.type === 'audio') {
    Object.assign(params, { duration: pickDuration(shotSeconds(node, 'audio'), durationOptions('audio')) })
    // 分段配音（API.md 25.1）：建画布 / 同步时后端把对白按说话人写进 data.segments，提交任务原样带上，provider 逐段 TTS 再拼接
    const segments = voiceSegmentParams(node.data.segments)
    if (segments.length) {
      params.segments = segments
      if (node.data.voice)
        params.voice = String(node.data.voice)
    }
  }
  const camId = cameraIdsInPrompt(node.data.prompt).at(-1) || node.data.cameraMove
  if (camId)
    params.camera = camId
  if (node.data.fxPreset)
    params.fx = node.data.fxPreset
  if (node.data.stylePreset)
    params.style_preset = node.data.stylePreset.id
  return params
}

function buildInputs(layer: Layer, node: FlowNode): TaskInput[] {
  const inputs: TaskInput[] = []
  if (layer.type === 'video') {
    const ref = refImageOf(node)
    if (ref?.data.assetId)
      inputs.push({ asset_id: Number(ref.data.assetId), role: 'first_frame' })
  }
  // 分镜图带上已生成的角色图（后端建画布时连了「角色 → 分镜」），模型支持参考图才带，否则只靠提示词里的外观描述
  if (layer.key === 'shot' && (props.imageInput === 'edits' || props.imageInput === 'url')) {
    for (const assetId of characterAssetsOf(node))
      inputs.push({ asset_id: assetId, role: 'character' })
  }
  if (node.data.styleAssetId)
    inputs.push({ asset_id: Number(node.data.styleAssetId), role: 'style' })
  if (node.data.voiceAssetId)
    inputs.push({ asset_id: Number(node.data.voiceAssetId), role: 'voice' })
  return inputs
}

function promptOf(layer: Layer, node: FlowNode) {
  let prompt = String(node.data.prompt || '').trim()
  if (!prompt && layer.type === 'audio')
    prompt = String(node.data.text || node.data.content || '').trim()
  if (layer.type === 'video') {
    const ids = cameraIdsInPrompt(prompt)
    if (ids.length)
      prompt = expandCameraTokens(prompt)
    else {
      const camText = t(cameraMoveLabel(node.data.cameraMove) || '')
      if (camText && !prompt.includes(camText))
        prompt = prompt ? `${prompt}\n\n${camText}` : camText
    }
  }
  prompt = expandRefTokens(expandMarkTokens(prompt, node.data.markElements))
  if (layer.type === 'image' || layer.type === 'video') {
    prompt = appendFxPrompt(prompt, node.data.fxPreset)
    prompt = appendStylePrompt(prompt, node.data.stylePreset)
  }
  return prompt
}

/** 配音节点的对白分段数（data.segments 非空文本条数） */
function segmentCount(node: FlowNode) {
  return voiceSegmentParams(node.data.segments).length
}

function modelTypeOf(layer: Layer): 'image' | 'video' | 'audio' | '' {
  if (layer.type === 'image' || layer.type === 'video' || layer.type === 'audio')
    return layer.type
  return ''
}

function modelOf(layer: Layer, node: FlowNode) {
  const type = modelTypeOf(layer)
  return (type && props.models[type]) || String(node.data.model || '')
}

function optionsOf(layer: Layer) {
  const type = modelTypeOf(layer)
  return type ? props.modelOptions[type] || [] : []
}

function modelSr(layer: Layer) {
  if (layer.type === 'video')
    return t('视频模型')
  if (layer.type === 'audio')
    return t('配音模型')
  return t('图片模型')
}

/** 换这一层的模型：后面的重新生成、生成剩余都走新模型，不再拿失败的那个硬重试 */
function onPickModel(layer: Layer, value: string | number) {
  const type = modelTypeOf(layer)
  const id = String(value || '')
  if (!type || !id || id === props.models[type])
    return
  emit('update:model', { type, model: id })
}

/** 单节点下任务；返回 false 表示没有提交（缺提示词 / 缺首帧 / 接口失败） */
/**
 * 单节点提交结果：
 * - ok 已提交
 * - busy 并发已满（后端 data.reason=concurrency）——属于排队，不是失败，调用方应等空位重试
 * - failed 真的失败，节点已标红
 * - blocked 被审批门禁拦下（后端 data.reason=review_gate，API.md 26.1）——不是失败，节点保持待生成并提示去审片
 */
type RunResult = 'ok' | 'busy' | 'failed' | 'blocked'

async function runNode(layer: Layer, node: FlowNode): Promise<RunResult> {
  if (isActive(node))
    return 'ok'
  const prompt = promptOf(layer, node)
  if (!prompt) {
    patchNode(node.id, { taskStatus: 'failed', taskError: t('create.layers.task.missingPrompt') })
    return 'failed'
  }
  const model = modelOf(layer, node)
  if (!model) {
    patchNode(node.id, { taskStatus: 'failed', taskError: t('create.layers.task.missingModel') })
    return 'failed'
  }
  if (String(node.data.model || '') !== model)
    patchNode(node.id, { model })
  if (layer.type === 'video' && !refImageOf(node)?.data.assetId) {
    patchNode(node.id, { taskStatus: 'failed', taskError: t('create.layers.task.missingShot') })
    return 'failed'
  }
  delete gateBlocked[node.id]
  const res = await taskApi.create({
    type: layer.type,
    model,
    prompt,
    params: buildParams(layer, node),
    inputs: buildInputs(layer, node),
    canvas_id: props.canvasId,
    node_id: node.id,
    project_id: props.projectId || undefined,
  })
  if (!res?.success || !res.data) {
    // 并发满：节点保持原状（待生成），由 runLayer 等空位后重试
    if ((res?.data as { reason?: string } | undefined)?.reason === 'concurrency')
      return 'busy'
    // 审批门禁拦下：不算失败，节点回到待生成并显示后端说明，提示去审分镜图
    if (isReviewGateBlocked(res)) {
      gateBlocked[node.id] = res?.message || t('被门禁拦下')
      patchNode(node.id, { taskStatus: '', taskError: '' })
      return 'blocked'
    }
    patchNode(node.id, { taskStatus: 'failed', taskError: res?.message || t('提交失败') })
    notify(res?.message || t('提交失败'), 'error')
    return 'failed'
  }
  applyTask(node.id, res.data)
  ensurePolling()
  return 'ok'
}

// ---- 服务端批量生成（API.md 13）----

/** 节点 → 批量条目；缺提示词 / 模型的直接标失败返回 null */
function batchItemOf(layer: Layer, node: FlowNode): BatchItemRequest | null {
  const prompt = promptOf(layer, node)
  if (!prompt) {
    patchNode(node.id, { taskStatus: 'failed', taskError: t('create.layers.task.missingPrompt') })
    return null
  }
  const model = modelOf(layer, node)
  if (!model) {
    patchNode(node.id, { taskStatus: 'failed', taskError: t('create.layers.task.missingModel') })
    return null
  }
  const inputs: TaskInput[] = []
  if (node.data.styleAssetId)
    inputs.push({ asset_id: Number(node.data.styleAssetId), role: 'style' })
  if (node.data.voiceAssetId)
    inputs.push({ asset_id: Number(node.data.voiceAssetId), role: 'voice' })
  const depends: BatchItemRequest['depends'] = []
  if (layer.type === 'video') {
    const ref = refImageOf(node)
    if (ref)
      depends.push({ node_id: ref.id, role: 'first_frame' })
  }
  // 分镜图带角色图参考：模型支持参考图才依赖角色节点
  if (layer.key === 'shot' && (props.imageInput === 'edits' || props.imageInput === 'url')) {
    for (const edge of graph.value?.edges ?? []) {
      const src = String(edge?.target) === node.id ? nodeById(String(edge?.source)) : null
      if (src && layerTag(src) === 'character' && depends.length < 4)
        depends.push({ node_id: src.id, role: 'character' })
    }
  }
  return { node_id: node.id, layer: layer.key, type: layer.type, model, prompt, params: buildParams(layer, node), inputs, depends }
}

/**
 * 把这些层里还没完成的节点交给服务端。依赖指向的节点不在本批次、画布里也还没产物时：
 * 按层生成（上一层没做完）→ 该节点标失败提示先生成上一层；一键全部时上游都在批次里，不会出现。
 */
async function startBatch(targetLayers: Layer[]) {
  if (batchBusy.value || batchActive(batch.value))
    return
  batchBusy.value = true
  try {
    const items: BatchItemRequest[] = []
    const included = new Set<string>()
    for (const layer of targetLayers) {
      for (const node of layer.nodes) {
        if (isDone(node) || isActive(node))
          continue
        const item = batchItemOf(layer, node)
        if (item) {
          items.push(item)
          included.add(node.id)
        }
      }
    }
    const ready = items.filter((item) => {
      const missing = item.depends.find(dep => !included.has(dep.node_id) && !isDone(nodeById(dep.node_id) ?? { id: '', position: { x: 0, y: 0 }, data: {} }))
      if (!missing)
        return true
      patchNode(item.node_id, { taskStatus: 'failed', taskError: item.type === 'video' ? t('create.layers.task.missingShot') : t('create.layers.task.upstream') })
      return false
    })
    // 依赖被剔除的节点，它的下游也不能提交
    const kept = new Set(ready.map(item => item.node_id))
    const final = ready.filter(item => item.depends.every(dep => kept.has(dep.node_id) || isDone(nodeById(dep.node_id) ?? { id: '', position: { x: 0, y: 0 }, data: {} })))
    if (!final.length) {
      notify(t('create.layers.task.nothing'))
      return
    }
    // 先把本地节点状态存上，服务端按画布里的产物解析依赖
    await persist()
    const budget = Number(budgetInput.value)
    const res = await batchApi.create(props.canvasId, { items: final, budget_points: Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0 })
    if (!res?.success || !res.data) {
      notify(res?.message || t('提交失败'), 'error')
      return
    }
    batch.value = res.data
    track('create_batch_start', { canvas_id: props.canvasId, items: final.length, estimate: res.data.estimate_points })
    notify(t('create.layers.task.handedOff', { n: final.length, p: res.data.estimate_points }))
    ensureBatchPolling()
  }
  finally {
    batchBusy.value = false
  }
}

function runLayer(layer: Layer) {
  void startBatch([layer])
}

async function runAll() {
  if (batchBusy.value || batchActive(batch.value))
    return
  // 门禁「分镜图通过才放行」：一键全部前提醒没过审的镜头不会出视频（API.md 26.1）
  if (reviewGate.value === 'approved') {
    const gated = videosGatedNow()
    const message = gated
      ? `${t('create.layers.gate.willSkip')} ${t('create.layers.gate.gatedCount', { n: gated })}`
      : t('create.layers.gate.willSkip')
    const ok = await confirm({ title: t('create.layers.gate.titleOn'), message, confirmText: t('create.layers.task.continueGenerate') })
    if (!ok)
      return
  }
  void startBatch(layers.value.filter(layer => !skipped[layer.key]))
}

async function batchAction(action: BatchAction) {
  if (!batch.value || batchBusy.value)
    return
  batchBusy.value = true
  try {
    const res = await batchApi.action(batch.value.id, action)
    if (!res?.success || !res.data) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    batch.value = res.data
    applyBatch()
    ensureBatchPolling()
    void refreshWallet()
  }
  finally {
    batchBusy.value = false
  }
}

/**
 * 批次已经结束时，用当前选中的模型重新提交失败节点。
 * 服务端「重试失败项」会沿用条目里记下的旧模型，不支持音频的模型会一直失败。
 * 批次还在跑时仍走原来的重试。
 */
function retryFailed() {
  if (batchActive(batch.value)) {
    void batchAction('retry-failed')
    return
  }
  const targets = layers.value
    .filter(layer => !skipped[layer.key])
    .map(layer => ({ ...layer, nodes: layer.nodes.filter(node => node.data.taskStatus === 'failed') }))
    .filter(layer => layer.nodes.length)
  if (!targets.length) {
    void batchAction('retry-failed')
    return
  }
  void startBatch(targets)
}

function applyBatch() {
  const items = batch.value?.items ?? []
  const patches = batchNodePatches(items, id => Number(nodeById(id)?.data.taskId) || 0)
  for (const { nodeId, patch } of patches)
    patchNode(nodeId, patch)
  if (patches.length) {
    ensurePolling()
    schedulePersist()
  }
}

let stopBatchPoll = () => {}
let batchPollOn = false

async function loadBatch() {
  const res = await batchApi.latest(props.canvasId)
  if (!res?.success)
    return
  batch.value = res.data ?? null
  applyBatch()
  ensureBatchPolling()
}

function ensureBatchPolling() {
  if (batchPollOn || !batchActive(batch.value))
    return
  batchPollOn = true
  stopBatchPoll = startHiddenAwarePoll(async () => {
    await loadBatch()
    if (!batchActive(batch.value)) {
      stopBatchPolling()
      void refreshWallet()
    }
  }, POLL_MS)
}

function stopBatchPolling() {
  stopBatchPoll()
  stopBatchPoll = () => {}
  batchPollOn = false
}

const batchStatusText = computed(() => {
  const b = batch.value
  if (!b)
    return ''
  switch (b.status) {
    case 'running': return t('create.layers.task.serverRunning')
    case 'paused': return b.pause_reason ? t('create.layers.task.pausedReason', { reason: b.pause_reason }) : t('create.layers.task.paused')
    case 'done': {
      const { failed, blocked } = batchFailureSplit(b)
      if (failed && blocked)
        return t('create.layers.task.doneFailBlocked', { n: failed, b: blocked })
      if (blocked)
        return t('create.layers.task.doneBlocked', { b: blocked })
      return failed ? t('create.layers.task.doneFail', { n: failed }) : t('create.layers.task.doneAll')
    }
    default: return t('已取消')
  }
})

const batchDoneCount = computed(() => {
  const b = batch.value
  return b ? b.succeeded + b.failed : 0
})

const batchOkPct = computed(() => {
  const b = batch.value
  if (!b?.total)
    return 0
  return Math.round((b.succeeded / b.total) * 100)
})

/** 真失败（不含被门禁拦下） */
const batchFailPct = computed(() => {
  const b = batch.value
  if (!b?.total)
    return 0
  return Math.round((batchFailureSplit(b).failed / b.total) * 100)
})

const batchBlockedPct = computed(() => {
  const b = batch.value
  if (!b?.total)
    return 0
  return Math.round((batchFailureSplit(b).blocked / b.total) * 100)
})

async function regenerate(layer: Layer, node: FlowNode) {
  if (isActive(node))
    return
  const taskId = Number(node.data.taskId) || 0
  const status = node.data.taskStatus
  const selected = modelOf(layer, node)
  const usedModel = String(node.data.model || '')
  const modelChanged = Boolean(usedModel && selected && usedModel !== selected)
  patchNode(node.id, { taskStatus: '', taskError: '' })
  let ok = false
  // 后端 retake 只接受「已成功的视频」（同参数重拍，记 retake_of）；
  // 换过模型、图片 / 音频重新生成、失败或取消后重试都按当前选择的模型新建任务
  if (taskId > 0 && layer.type === 'video' && status === 'succeeded' && !modelChanged) {
    const res = await taskApi.retake(taskId)
    if (res?.success && res.data) {
      applyTask(node.id, res.data)
      ensurePolling()
      ok = true
    }
    else {
      const message = res?.message || t('提交失败')
      patchNode(node.id, { taskStatus: 'failed', taskError: message })
      notify(message, 'error')
    }
  }
  else {
    const result = await runNode(layer, node)
    ok = result === 'ok'
    // 单节点不排队：并发占满直接告诉用户，别静默没反应
    if (result === 'busy')
      notify(t('create.layers.task.concurrency'), 'error')
    if (result === 'blocked')
      notify(gateBlocked[node.id] || t('被门禁拦下'))
  }
  if (ok) {
    void refreshWallet()
    schedulePersist()
  }
}

function skipLayer(layer: Layer) {
  skipped[layer.key] = true
}

// ---- 轮询：一个定时器扫所有进行中的节点 ----

let stopNodePoll = () => {}
let nodePollOn = false
let polling = false

function activeNodes() {
  return nodes.value.filter(node => isActive(node) && Number(node.data.taskId) > 0)
}

function ensurePolling() {
  if (nodePollOn || !activeNodes().length)
    return
  nodePollOn = true
  stopNodePoll = startHiddenAwarePoll(() => pollOnce(), POLL_MS)
}

function stopPolling() {
  stopNodePoll()
  stopNodePoll = () => {}
  nodePollOn = false
}

async function pollOnce() {
  if (polling)
    return
  polling = true
  try {
    let changed = false
    for (const node of activeNodes()) {
      const res = await taskApi.get(Number(node.data.taskId))
      if (!res?.success || !res.data)
        continue
      const before = node.data.taskStatus
      applyTask(node.id, res.data)
      if (res.data.status !== before)
        changed = true
      if (res.data.status === 'failed')
        notify(res.data.error_msg || t('生成失败'), 'error')
    }
    if (changed)
      schedulePersist()
    if (!activeNodes().length)
      stopPolling()
  }
  finally {
    polling = false
  }
}

const anyRunning = computed(() => nodes.value.some(isActive))
const generating = computed(() => anyRunning.value || batchBusy.value || batchActive(batch.value))

watch(generating, value => emit('running', value), { immediate: true })

function statusLabel(node: FlowNode) {
  if (isBlocked(node))
    return t('被门禁拦下')
  if (waitingIds.value.has(node.id) && !isActive(node))
    return t('create.layers.task.waiting')
  switch (node.data.taskStatus) {
    case 'pending': return t('排队中')
    case 'running': return t('生成中')
    case 'succeeded': return t('已完成')
    case 'failed': return staleAttempt(node) ? t('create.layers.task.retryFailKept') : t('失败')
    case 'cancelled': return staleAttempt(node) ? t('create.layers.task.retryCancelKept') : t('已取消')
    default: return t('create.layers.task.pending')
  }
}

/** 角色用节点名；镜头层显示镜号（sp.shot），没有镜号的老画布按顺序 */
function nodeLabel(layer: Layer, index: number, node: FlowNode) {
  if (layer.key === 'character')
    return String(node.data.label || `${t('角色')} ${index + 1}`)
  return `${t('镜头')} ${shotNoOf(node) || index + 1}`
}

function mediaUrl(node: FlowNode) {
  return resolveMediaUrl(String(node.data.content || ''))
}

const preview = ref<{ url: string, title: string } | null>(null)

function openPreview(node: FlowNode, layer: Layer, index: number) {
  if (layer.type !== 'image' || !isDone(node))
    return
  preview.value = { url: mediaUrl(node), title: nodeLabel(layer, index, node) }
}

function closePreview() {
  preview.value = null
}

function onPreviewKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !preview.value)
    return
  event.stopPropagation()
  closePreview()
}

watch(() => props.canvasId, () => void load(), { immediate: true })

onMounted(() => window.addEventListener('keydown', onPreviewKey, true))
onBeforeUnmount(() => {
  emit('running', false)
  window.removeEventListener('keydown', onPreviewKey, true)
  stopBatchPolling()
  stopPolling()
  if (highlightTimer)
    clearTimeout(highlightTimer)
  if (saveTimer) {
    clearTimeout(saveTimer)
    void persist()
  }
})

defineExpose({ reload: load, anyRunning })
</script>

<template>
  <div class="create-layers">
    <StudioLoading v-if="loading && !graph" />
    <div v-else-if="loadError" class="create-error">
      <p>{{ loadError }}</p>
      <button type="button" class="plan-btn plan-btn--ghost" @click="load">{{ t('重试') }}</button>
    </div>
    <template v-else>
      <div class="create-batch">
        <div class="create-batch__row">
          <button
            type="button"
            class="plan-btn plan-btn--solid create-batch__run"
            :disabled="batchBusy || batchActive(batch)"
            @click="runAll"
          >
            <UIcon name="i-lucide-sparkles" class="size-4" />
            {{ t('create.layers.batch.all') }}
          </button>
          <label class="create-batch__budget">
            <span>{{ t('create.layers.batch.budget') }}</span>
            <input v-model="budgetInput" type="number" min="0" step="10" :placeholder="t('不限')" :disabled="batchBusy || batchActive(batch)">
            <small>{{ t('积分') }}</small>
          </label>
          <p class="create-batch__tip">{{ t('create.layers.batch.serverOrder') }}</p>
        </div>
        <div class="create-gate" :class="{ 'is-locked': timelineLocked }">
          <span class="create-gate__label">
            <UIcon name="i-lucide-shield-check" class="size-4" />
            {{ t('create.layers.gate.title') }}
          </span>
          <div class="create-gate__opts" role="radiogroup" :aria-label="t('create.layers.gate.title')">
            <button
              v-for="opt in gateOptions"
              :key="opt.value || 'off'"
              type="button"
              class="studio-chip"
              :class="{ 'is-on': reviewGate === opt.value }"
              role="radio"
              :aria-checked="reviewGate === opt.value"
              :disabled="gateBusy || timelineLocked"
              @click="setGate(opt.value)"
            >{{ opt.label }}</button>
          </div>
          <small class="create-gate__hint">{{ gateHint }}</small>
        </div>
        <div
          v-if="batch"
          class="create-batch__status"
          :class="[`is-${batch.status}`, { 'has-fail': batchFailureSplit(batch).failed > 0, 'has-blocked': blockedItems.length > 0 }]"
        >
          <div class="create-batch__track" aria-hidden="true">
            <i class="is-ok" :style="{ width: `${batchOkPct}%` }" />
            <i class="is-fail" :style="{ width: `${batchFailPct}%` }" />
            <i class="is-blocked" :style="{ width: `${batchBlockedPct}%` }" />
          </div>
          <div class="create-batch__facts">
            <b>{{ batchStatusText }}</b>
            <span>{{ t('create.layers.batch.progress', { done: batchDoneCount, total: batch.total }) }}</span>
            <span>{{ t('create.layers.batch.spent', { s: batch.spent_points, e: batch.estimate_points }) }}<template v-if="batch.budget_points"> · {{ t('create.layers.batch.budgetOf', { b: batch.budget_points }) }}</template></span>
          </div>
          <div class="create-batch__ops">
            <button v-if="batch.status === 'running'" type="button" class="studio-chip" :disabled="batchBusy" @click="batchAction('pause')">{{ t('暂停') }}</button>
            <button v-if="batch.status === 'paused'" type="button" class="studio-chip" :disabled="batchBusy" @click="batchAction('resume')">{{ t('继续') }}</button>
            <button v-if="batchActive(batch)" type="button" class="studio-chip" :disabled="batchBusy" @click="batchAction('cancel')">{{ t('取消') }}</button>
            <button v-if="batch.failed > 0 && batch.status !== 'cancelled'" type="button" class="studio-chip" :disabled="batchBusy" @click="retryFailed">{{ t('create.layers.batch.retryFailed') }}</button>
          </div>
          <ul v-if="blockedItems.length" class="create-batch__blocked">
            <li v-for="item in blockedItems" :key="item.id">
              <b><UIcon name="i-lucide-shield-alert" class="size-3.5" />{{ t('create.layers.gate.blockedTitle') }}</b>
              <span>{{ labelOfNodeId(item.node_id) }}</span>
              <small>{{ item.error }}</small>
              <button v-if="nodeById(item.node_id)" type="button" class="create-node__link" @click="goReview(nodeById(item.node_id)!)">{{ t('create.layers.gate.review') }}</button>
            </li>
          </ul>
        </div>
      </div>
      <section
        v-for="(layer, li) in layers"
        :key="layer.key"
        class="create-layer"
        :class="{ 'is-locked': !layerEnabled(li), 'is-skipped': skipped[layer.key] }"
      >
        <header class="create-layer__head">
          <div class="create-layer__title">
            <span class="create-layer__no">{{ li + 1 }}</span>
            <h3>{{ layer.title }}</h3>
            <small v-if="layer.nodes.length">{{ successCount(layer) }}/{{ layer.nodes.length }}</small>
            <small v-else>{{ t('create.layers.batch.none') }}</small>
            <span v-if="skipped[layer.key]" class="create-layer__badge">{{ t('create.layers.batch.skipped') }}</span>
          </div>
          <div v-if="layer.nodes.length" class="create-layer__actions">
            <StudioSelect
              v-if="optionsOf(layer).length"
              class="create-layer__model"
              size="compact"
              :model-value="modelOf(layer, layer.nodes[0]!)"
              :options="optionsOf(layer)"
              :sr-label="modelSr(layer)"
              :disabled="batchBusy"
              @update:model-value="onPickModel(layer, $event)"
            />
            <button
              type="button"
              class="studio-chip"
              :disabled="!layerEnabled(li) || batchBusy || batchActive(batch) || activeCount(layer) > 0"
              @click="runLayer(layer)"
            >
              <UIcon name="i-lucide-play" class="size-4" />
              {{ successCount(layer) === layer.nodes.length ? t('create.layers.batch.regenAll') : successCount(layer) ? t('create.layers.batch.rest') : t('create.layers.batch.thisLayer') }}
            </button>
            <button
              v-if="!skipped[layer.key] && successCount(layer) === 0"
              type="button"
              class="studio-chip"
              :disabled="!layerEnabled(li)"
              @click="skipLayer(layer)"
            >
              {{ t('跳过') }}
            </button>
          </div>
        </header>

        <div v-if="layer.nodes.length" class="create-layer__grid">
          <article
            v-for="(node, ni) in layer.nodes"
            :id="`create-node-${node.id}`"
            :key="node.id"
            class="create-node"
            :class="[nodeStateClass(node), `is-${layer.type}`, { 'is-highlight': highlightId === node.id, 'is-approved': reviewable(layer, node) && nodeReviewState(node) === 'approved', 'is-rejected': reviewable(layer, node) && nodeReviewState(node) === 'rejected' }]"
          >
            <div class="create-node__media">
              <button
                v-if="layer.type === 'image' && isDone(node)"
                type="button"
                class="create-node__shot"
                :aria-label="t('查看大图')"
                @click="openPreview(node, layer, ni)"
              >
                <img :src="mediaUrl(node)" :alt="nodeLabel(layer, ni, node)" loading="lazy">
              </button>
              <video v-else-if="layer.type === 'video' && isDone(node)" :src="mediaUrl(node)" controls muted playsinline preload="metadata" />
              <audio v-else-if="layer.type === 'audio' && isDone(node)" :src="mediaUrl(node)" controls preload="none" />
              <div v-else class="create-node__placeholder">
                <UIcon
                  :name="isActive(node) ? 'i-lucide-loader-circle' : isBlocked(node) ? 'i-lucide-shield-alert' : node.data.taskStatus === 'failed' ? 'i-lucide-triangle-alert' : layer.type === 'video' ? 'i-lucide-play' : layer.type === 'audio' ? 'i-lucide-music' : 'i-lucide-image'"
                  class="size-6"
                  :class="{ 'animate-spin': isActive(node) }"
                />
                <span>{{ statusLabel(node) }}</span>
                <i v-if="isActive(node)" class="create-node__bar" :style="{ width: `${Math.min(100, Math.max(6, Number(node.data.taskProgress) || 0))}%` }" />
              </div>
            </div>
            <div class="create-node__meta">
              <strong>
                {{ nodeLabel(layer, ni, node) }}
                <small v-if="layer.type === 'audio' && segmentCount(node)" class="create-node__tag">{{ t('create.layers.batch.dialogue', { n: segmentCount(node) }) }}</small>
              </strong>
              <p :title="promptOf(layer, node)">{{ promptOf(layer, node) || t('create.layers.task.missingPrompt') }}</p>
              <p v-if="isBlocked(node)" class="create-node__blocked">
                {{ blockedText(node) }}
                <button v-if="layer.type === 'video'" type="button" class="create-node__link" @click="goReview(node)">{{ t('create.layers.gate.review') }}</button>
              </p>
              <p v-else-if="node.data.taskStatus === 'failed'" class="create-node__error">{{ node.data.taskError || t('生成失败') }}</p>
              <div v-if="reviewable(layer, node)" class="create-node__review">
                <template v-if="nodeReviewState(node) === 'pending'">
                  <button type="button" class="create-node__chip is-ok" :disabled="reviewBusy === nodeAssetId(node)" @click="submitReview(node, 'approved')">{{ t('通过') }}</button>
                  <button type="button" class="create-node__chip is-bad" :disabled="reviewBusy === nodeAssetId(node)" @click="openReject(node)">{{ t('退回') }}</button>
                </template>
                <template v-else>
                  <span class="create-node__verdict" :class="nodeReviewState(node) === 'approved' ? 'is-ok' : 'is-bad'">{{ nodeReviewText(node) }}</span>
                  <button type="button" class="create-node__chip" :disabled="reviewBusy === nodeAssetId(node)" @click="submitReview(node, 'clear')">{{ t('撤销') }}</button>
                </template>
                <small v-if="nodeReview(node)?.note" class="create-node__note">{{ nodeReview(node)?.note }}</small>
                <div v-if="rejectForm?.assetId === nodeAssetId(node)" class="create-node__reject">
                  <StudioSelect
                    size="compact"
                    :model-value="rejectForm.reason"
                    :options="reasonOptions"
                    :sr-label="t('退回原因')"
                    @update:model-value="rejectForm && (rejectForm.reason = $event as ShotReviewReason)"
                  />
                  <textarea v-model="rejectForm.note" rows="2" maxlength="500" :placeholder="t('给这条候选的具体意见（可选）')" />
                  <div class="create-node__reject-ops">
                    <button type="button" class="create-node__chip is-bad" :disabled="reviewBusy === nodeAssetId(node)" @click="confirmReject">{{ t('确认退回') }}</button>
                    <button type="button" class="create-node__chip" @click="rejectForm = null">{{ t('取消') }}</button>
                  </div>
                </div>
              </div>
              <button
                type="button"
                class="create-node__redo"
                :disabled="!layerEnabled(li) || isActive(node) || waitingIds.has(node.id) || batchBusy"
                @click="regenerate(layer, node)"
              >
                <UIcon name="i-lucide-refresh-cw" class="size-3.5" />
                {{ isDone(node) || node.data.taskStatus === 'failed' ? t('重新生成') : t('生成') }}
              </button>
            </div>
          </article>
        </div>
        <p v-else class="create-layer__empty">{{ t('create.layers.batch.emptyLayer') }}</p>
      </section>
      <p v-if="otherNodeCount" class="create-layers__others">{{ t('create.layers.batch.others', { n: otherNodeCount }) }}</p>
    </template>
    <Teleport to="body">
      <div
        v-if="preview"
        class="create-viewer"
        role="dialog"
        :aria-label="preview.title"
        @click="closePreview"
      >
        <button type="button" class="create-viewer__close" :aria-label="t('关闭')" @click.stop="closePreview">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <img :src="preview.url" :alt="preview.title" @click.stop>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.create-gate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  border: 1px dashed var(--st-border);
  border-radius: 14px;
}

.create-gate.is-locked {
  opacity: 0.7;
}

.create-gate__label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--st-text);
}

.create-gate__opts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.create-gate__opts .studio-chip {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
}

.create-gate__hint {
  flex: 1 1 220px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--st-muted);
}

.create-node.is-blocked {
  border-color: rgba(245, 158, 11, 0.55);
}

.create-node.is-approved {
  border-color: rgba(34, 197, 94, 0.5);
}

.create-node.is-rejected {
  border-color: rgba(244, 63, 94, 0.45);
}

.create-node.is-highlight {
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.45);
  transition: box-shadow 0.3s ease;
}

.create-node.is-blocked .create-node__placeholder {
  color: #d97706;
}

.create-node__blocked {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  color: #d97706 !important;
}

.create-node__link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--st-plan);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.create-node__review {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.create-node__chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--st-chip-border);
  border-radius: 999px;
  background: var(--st-chip-bg);
  color: var(--st-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.create-node__chip:disabled {
  opacity: 0.5;
  cursor: default;
}

.create-node__chip.is-ok {
  border-color: rgba(34, 197, 94, 0.5);
  color: #16a34a;
}

.create-node__chip.is-bad {
  border-color: rgba(244, 63, 94, 0.45);
  color: #e11d48;
}

.create-node__verdict {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.create-node__verdict.is-ok {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.create-node__verdict.is-bad {
  background: rgba(244, 63, 94, 0.12);
  color: #e11d48;
}

.create-node__note {
  flex-basis: 100%;
  font-size: 12px;
  color: var(--st-muted);
  overflow-wrap: anywhere;
}

.create-node__reject {
  display: flex;
  flex-basis: 100%;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.create-node__reject textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--st-border);
  border-radius: 8px;
  background: var(--st-elevated);
  color: inherit;
  font: inherit;
  font-size: 12px;
  resize: vertical;
}

.create-node__reject textarea:focus {
  outline: none;
  border-color: var(--st-chip-border);
}

.create-node__reject-ops {
  display: flex;
  gap: 6px;
}

.create-batch__blocked {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-basis: 100%;
  margin: 0;
  padding: 8px 0 0;
  list-style: none;
  border-top: 1px dashed var(--st-border);
  font-size: 12px;
  color: var(--st-text-soft);
}

.create-batch__blocked li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.create-batch__blocked b {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #d97706;
  font-weight: 600;
}

.create-batch__blocked small {
  flex: 1 1 200px;
  min-width: 0;
  color: var(--st-muted);
  overflow-wrap: anywhere;
}

.create-batch__track .is-blocked {
  background: #f59e0b;
}

.create-batch__status.has-blocked:not(.has-fail) {
  border-color: color-mix(in srgb, #f59e0b 40%, var(--st-border));
  background: color-mix(in srgb, #f59e0b 6%, var(--st-elevated));
}

.create-batch__status.has-blocked:not(.has-fail) .create-batch__facts b {
  color: #d97706;
}

.create-layers__others {
  margin: 0;
  font-size: 12px;
  color: var(--st-muted);
}

.create-batch {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 4px;
}

.create-batch__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
}

.create-batch__run {
  width: auto;
  min-width: 168px;
  min-height: 40px;
  padding: 0 18px;
  gap: 6px;
}

.create-batch__budget {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--st-text-soft);
  font-size: 13px;
}

.create-batch__budget input {
  width: 88px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--st-border);
  border-radius: 10px;
  font: inherit;
  color: inherit;
  background: var(--st-elevated);
}

.create-batch__budget input:focus {
  outline: none;
  border-color: var(--st-chip-border);
}

.create-batch__tip {
  margin: 0;
  flex: 1 1 180px;
  color: var(--st-muted);
  font-size: 12px;
  line-height: 1.5;
}

.create-batch__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 14px;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-elevated);
}

.create-batch__track {
  display: flex;
  width: 100%;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--st-text) 8%, transparent);
}

.create-batch__track i {
  display: block;
  height: 100%;
  transition: width 0.3s ease;
}

.create-batch__track .is-ok {
  background: #22c55e;
}

.create-batch__track .is-fail {
  background: #f43f5e;
}

.create-batch__status.is-running .create-batch__track .is-ok {
  background: var(--st-plan);
}

.create-batch__status.is-paused .create-batch__track .is-ok {
  background: #f59e0b;
}

.create-batch__status.is-cancelled .create-batch__track .is-ok,
.create-batch__status.is-cancelled .create-batch__track .is-fail {
  background: var(--st-muted);
}

.create-batch__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 14px;
  min-width: 0;
  flex: 1 1 220px;
  font-size: 13px;
  color: var(--st-muted);
}

.create-batch__facts b {
  color: var(--st-text);
  font-weight: 600;
}

.create-batch__ops {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.create-batch__status.is-paused {
  border-color: color-mix(in srgb, #f59e0b 40%, var(--st-border));
  background: color-mix(in srgb, #f59e0b 6%, var(--st-elevated));
}

.create-batch__status.is-done:not(.has-fail) {
  border-color: color-mix(in srgb, #22c55e 36%, var(--st-border));
  background: color-mix(in srgb, #22c55e 6%, var(--st-elevated));
}

.create-batch__status.is-done:not(.has-fail) .create-batch__facts b {
  color: #22c55e;
}

.create-batch__status.has-fail {
  border-color: color-mix(in srgb, #f43f5e 28%, var(--st-border));
  background: color-mix(in srgb, #f43f5e 5%, var(--st-elevated));
}

.create-batch__status.has-fail .create-batch__facts b {
  color: #f43f5e;
}
</style>
