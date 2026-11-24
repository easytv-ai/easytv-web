<script setup lang="ts">
/**
 * 智能续写大弹窗（视频节点）：黑场大预览 + 画面下方胶片选区 + 紧凑提示词条。
 * 底栏提供 模型 / 类型（延长·全能参考·首尾帧·视频编辑）/ 风格 / 资产 / 运镜 / 输出规格 的选择。
 * 提交语义见 utils/canvas-extend-studio.ts；抽帧选区与 CanvasExtendStrip 同一套手法。
 */
import { captureVideoFrame, captureVideoStripFrames } from '~/utils/canvas-video-frame'
import { CAMERA_MOVE_ITEMS } from '~/utils/canvas-node-kinds'
import { rangeToSeconds, retakeChargeSeconds } from '~/utils/canvas-media-job'
import { viralParamOptions } from '~/utils/canvas-viral'
import { estimateTaskPoints, effectiveUnitPrice } from '~/utils/model-price'
import assetApi from '~/api/asset'
import type { GenerationModel, GenerationModelDetail } from '~/types/creative'
import {
  EXTEND_STUDIO_COUNTS,
  EXTEND_STUDIO_FORMATS,
  EXTEND_STUDIO_RATIOS,
  EXTEND_STUDIO_RESOLUTIONS,
  EXTEND_STUDIO_SECONDS_MAX,
  EXTEND_STUDIO_TYPES,
  initialRetakeRange,
  retakeOutputRatio,
  retakeOutputResolution,
  retakeOutputSeconds,
  retakeSnapRange,
  type ExtendStudioPayload,
  type ExtendStudioRef,
  type ExtendStudioType,
} from '~/utils/canvas-extend-studio'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  prompt?: string
  models?: Array<{ id: string, name: string, desc: string, priced: boolean, icon?: string, videoReference?: boolean }>
  refs?: ExtendStudioRef[]
  submitting?: boolean
  /** 浏览器读不到视频时的时长兜底（秒），来自资产库 */
  fallbackDuration?: number
  /** extend=智能续写（默认）；retake=片段重拍：类型固定，发送前可选生成秒数和分辨率 */
  variant?: 'extend' | 'retake'
  /** retake 变体：时间线分成的段数 */
  total?: number
  /** retake 变体：上次圈选的区间（0–1）。没有则打开时落在第一段 */
  initialRange?: { start: number, end: number } | null
}>(), {
  prompt: '',
  models: () => [],
  refs: () => [],
  submitting: false,
  fallbackDuration: 0,
  variant: 'extend',
  total: 5,
  initialRange: null,
})

const emit = defineEmits<{
  close: []
  /** 让工作区打开资产选择器（回调把素材写回 refs） */
  'pick-refs': []
  'remove-ref': [index: number]
  /** 打开画布风格库，选中后由工作区回写 applyStyle */
  'open-style': []
  submit: [payload: ExtendStudioPayload]
}>()

const MIN_RANGE = 0.08
const FRAME_COUNT = 16

const playerRef = ref<HTMLVideoElement | null>(null)
const screenRef = ref<HTMLElement | null>(null)
const frameStyle = ref<{ width: string, height: string } | null>(null)
const playing = ref(false)
const muted = ref(false)
const duration = ref(0)
const start = ref(0)
const end = ref(1)
const frames = ref<string[]>([])
const frameError = ref(false)
const grabbing = ref(false)
const stripRef = ref<HTMLElement | null>(null)
let frameObserver: ResizeObserver | null = null

// eslint-disable-next-line vue/no-dupe-keys -- 与同名 prop 撞名（模板里取到的是这个 ref），改名牵涉模板，留待专门处理
const prompt = ref('')
const modelId = ref('')
const type = ref<ExtendStudioType>('extend')
const cameraMoves = ref<string[]>([])
const ratio = ref('9:16')
const seconds = ref(5)
const resolution = ref('720P')
/** 重拍时长、比例被手动改过之后，不再被选区或原片比例盖掉 */
const secondsTouched = ref(false)
const ratioTouched = ref(false)
const frameWidth = ref(0)
const frameHeight = ref(0)
const videoFormat = ref<'mp4' | 'mov'>('mp4')
const audio = ref(true)
const count = ref(1)
const popover = ref<'' | 'model' | 'type' | 'camera' | 'output'>('')
/** 风格库选中项：名字给标签，提示词提交时拼进 prompt */
const styleId = ref(0)
const styleName = ref('')
const stylePrompt = ref('')
const tailFrameBusy = ref(false)
/** 抽帧代数：关弹窗或换源后，过期的那次不再回写时长和缩略图 */
let captureSeq = 0

const typeLabel = computed(() => EXTEND_STUDIO_TYPES.find(item => item.id === type.value)?.label || '')
/** 视频延长的类型菜单：不含片段重拍（片段重拍走视频编辑） */
const extendTypeOptions = computed(() => EXTEND_STUDIO_TYPES.filter(item => item.id !== 'retake'))
const modelMeta = computed(() => props.models.find(item => item.id === modelId.value))

/** 延长、全能参考、视频编辑、片段重拍都要把视频交给模型，只列出能接参考视频的 */
const listedModels = computed(() => {
  if (type.value === 'fl2v')
    return props.models
  return props.models.filter(item => item.videoReference)
})

function pickListedModel() {
  const list = listedModels.value
  if (!list.some(item => item.id === modelId.value))
    modelId.value = list[0]?.id || ''
}
const isRetake = computed(() => props.variant === 'retake')
const dialogTitle = computed(() => (isRetake.value ? t('片段重拍') : t('智能续写')))
const rangeLabel = computed(() => {
  const a = start.value * duration.value
  const b = end.value * duration.value
  return `${a.toFixed(0)}s-${b.toFixed(0)}s`
})
/** 胶片两侧时码，形如 00:05.04 */
function formatClock(sec: number) {
  const totalCs = Math.round((Number.isFinite(sec) ? Math.max(0, sec) : 0) * 100)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const mins = Math.floor(totalSec / 60)
  const whole = totalSec % 60
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

function ratioBox(value: string) {
  if (!value.includes(':'))
    return null
  const [aw, ah] = value.split(':').map(Number)
  const w = Math.max(1, aw || 1)
  const h = Math.max(1, ah || 1)
  const scale = Math.min(22 / w, 14 / h)
  return {
    width: `${Math.max(6, Math.round(w * scale))}px`,
    height: `${Math.max(6, Math.round(h * scale))}px`,
  }
}

function ratioLabel(value: string) {
  return value.toLowerCase() === 'adaptive' ? t('自适应') : value
}
const endClock = computed(() => formatClock(duration.value))
const filmStyle = computed(() => (frameStyle.value ? { width: frameStyle.value.width } : undefined))
const summaryLabel = computed(() => {
  const ratioText = ratio.value === '智能' ? t('智能') : ratio.value
  return `${ratioText} · ${resolution.value}`
})
const cameraLabel = (id: string) => CAMERA_MOVE_ITEMS.find(item => item.id === id)?.label || id

function pickSegment(index: number) {
  const total = Math.max(1, props.total)
  const i = ((index - 1) % total + total) % total
  clampRange(i / total, (i + 1) / total)
}

const dragged = ref(false)

function onStripClick(event: MouseEvent) {
  if (!isRetake.value)
    return
  const moved = dragged.value
  dragged.value = false
  if (moved)
    return
  const at = ratioAt(event as unknown as PointerEvent)
  if (!(duration.value > 0)) {
    const total = Math.max(1, props.total)
    pickSegment(Math.min(total, Math.max(1, Math.floor(at * total) + 1)))
    return
  }
  const sec = Math.floor(at * duration.value)
  start.value = sec / duration.value
  snapRetakeWindow('move', seconds.value > 0 ? seconds.value : retakeMinSeconds())
}

/** 片段重拍：发送键旁的预估积分，按即将提交的生成秒数算 */
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const { isMember } = useWallet()
const { load: loadModelDetail } = useGenerationModelDetail()
const retakeModelDetail = ref<GenerationModelDetail | null>(null)
const retakeDetailStatus = ref<'loading' | 'ready' | 'missing'>('loading')
const currentGenerationModel = computed(() => generationModels.value.find(item => item.model === modelId.value))
const retakeParamHint = computed(() => retakeDetailStatus.value === 'loading' ? t('正在读取这个模型的参数') : t('这个模型没有这项参数'))
watch(modelId, (id) => {
  retakeModelDetail.value = null
  retakeDetailStatus.value = 'loading'
  const name = String(id || '').trim()
  if (!name) {
    retakeDetailStatus.value = 'missing'
    return
  }
  void loadModelDetail(name).then((detail) => {
    if (modelId.value !== name)
      return
    retakeModelDetail.value = detail
    retakeDetailStatus.value = detail ? 'ready' : 'missing'
  })
}, { immediate: true })
const retakeParamOptions = computed(() => viralParamOptions(retakeModelDetail.value, currentGenerationModel.value))
const retakeDurations = computed(() => retakeParamOptions.value.durations.slice().sort((a, b) => a - b))
const retakeRatios = computed(() => retakeParamOptions.value.ratiosDeclared ? retakeParamOptions.value.ratios : [])
const retakeResolutions = computed(() => retakeParamOptions.value.resolutionsDeclared ? retakeParamOptions.value.resolutions : [])
const retakeSupportsAudio = computed(() => retakeParamOptions.value.audio)
const retakeSpecLabel = computed(() => `${ratioLabel(ratio.value)} · ${resolution.value || '—'} · ${seconds.value}s`)
const retakeDurationChoices = computed(() => retakeDurations.value)

function selectionSpanSeconds() {
  const known = duration.value > 0 ? duration.value : 0
  const window = known > 0
    ? rangeToSeconds({ start: start.value, end: end.value }, known, 0.5)
    : null
  if (known > 0 && !window)
    return 0
  return window ? window.end - window.start : Math.max(0, end.value - start.value) * 5
}

/** 没手改过时长时，跟着选区落到模型允许的档位；换模型后手选的档不在清单里也会抬上去 */
function syncRetakeOutput() {
  if (!isRetake.value)
    return
  if (retakeResolutions.value.length)
    resolution.value = retakeOutputResolution(resolution.value, retakeResolutions.value)
  if (retakeRatios.value.length) {
    ratio.value = retakeOutputRatio({
      current: ratio.value,
      allowed: retakeRatios.value,
      width: frameWidth.value,
      height: frameHeight.value,
      touched: ratioTouched.value,
    })
  }
  const list = retakeDurations.value
  if (secondsTouched.value) {
    if (list.length && !list.includes(seconds.value))
      seconds.value = retakeOutputSeconds(seconds.value, list)
    return
  }
  const span = selectionSpanSeconds()
  if (!(span > 0))
    return
  seconds.value = retakeOutputSeconds(span, list)
}

const points = computed(() => {
  if (!isRetake.value)
    return 0
  const found = currentGenerationModel.value
  if (!found?.priced)
    return 0
  const sec = seconds.value > 0 ? seconds.value : retakeChargeSeconds(selectionSpanSeconds())
  return estimateTaskPoints(effectiveUnitPrice(found, isMember.value), found.unit, 1, sec)
})

function modelIconOf(id: string) {
  return String(props.models.find(item => item.id === id)?.icon || '').trim()
}

function toggleCamera(id: string) {
  cameraMoves.value = cameraMoves.value.includes(id)
    ? cameraMoves.value.filter(row => row !== id)
    : [...cameraMoves.value, id]
}

function applyStyle(style: { id: number, name: string, prompt?: string }) {
  if (styleId.value === style.id) {
    clearStyle()
    return
  }
  styleId.value = style.id
  styleName.value = style.name
  stylePrompt.value = style.prompt || style.name
}

function clearStyle() {
  styleId.value = 0
  styleName.value = ''
  stylePrompt.value = ''
}

defineExpose({ applyStyle, clearStyle, styleId })

/** 时长档跟随模型声明（有的模型只收特定秒数），没有声明就自由 1-30s */
function stepSeconds(delta: number) {
  if (isRetake.value)
    secondsTouched.value = true
  const list = isRetake.value ? retakeDurations.value : []
  if (list.length) {
    const index = list.findIndex(item => item >= seconds.value)
    const at = index < 0 ? list.length - 1 : index
    const exact = list[at] === seconds.value
    const next = exact ? at + delta : (delta < 0 ? at - 1 : at)
    seconds.value = list[Math.min(list.length - 1, Math.max(0, next))]!
    return
  }
  seconds.value = Math.min(EXTEND_STUDIO_SECONDS_MAX, Math.max(1, seconds.value + delta))
}

function pickRetakeSeconds(value: number) {
  seconds.value = value
  secondsTouched.value = true
  snapRetakeWindow('fit', value)
}

function pickRetakeResolution(value: string) {
  resolution.value = value
}

function pickRetakeRatio(value: string) {
  ratio.value = value
  ratioTouched.value = true
}

const rangeStyle = computed(() => ({
  left: `${start.value * 100}%`,
  width: `${Math.max(0, (end.value - start.value) * 100)}%`,
}))

const rangeClockLabel = computed(() => {
  if (!(duration.value > 0))
    return rangeLabel.value
  return `${formatClock(start.value * duration.value)}–${formatClock(end.value * duration.value)}`
})

const rangeSecondsLabel = computed(() => {
  const span = Math.max(0, end.value - start.value)
  const sec = duration.value > 0 ? span * duration.value : span * 5
  return `${sec.toFixed(1)}s`
})

function retakeMinSeconds() {
  return retakeDurations.value[0] || 0
}

/** 重拍选区按整秒吸附，短于模型最短时长的窗口会被撑开 */
function snapRetakeWindow(mode: 'move' | 'start' | 'end' | 'fit', lengthSeconds?: number) {
  if (!isRetake.value || !(duration.value > 0))
    return
  const snapped = retakeSnapRange({
    duration: duration.value,
    start: start.value,
    end: end.value,
    minSeconds: retakeMinSeconds(),
    mode,
    lengthSeconds,
  })
  start.value = snapped.start
  end.value = snapped.end
  if (snapped.seconds > 0 && mode !== 'move')
    seconds.value = snapped.seconds
}

function clampRange(nextStart: number, nextEnd: number) {
  const a = Math.min(1, Math.max(0, nextStart))
  const b = Math.min(1, Math.max(0, nextEnd))
  if (b - a < MIN_RANGE) {
    if (a + MIN_RANGE <= 1)
      return clampRange(a, a + MIN_RANGE)
    return clampRange(b - MIN_RANGE, b)
  }
  start.value = a
  end.value = b
}

/** 大预览不带 crossOrigin，元数据一定能读到；抽帧还没回来时先用它撑起时码 */
function notePlayerDuration() {
  const video = playerRef.value
  const next = video && Number.isFinite(video.duration) ? video.duration : 0
  if (!(next > 0) || duration.value > 0)
    return
  duration.value = next
}

/** 预览框按视频比例缩进黑场，播放键才能贴在画面上而不是黑边上 */
function fitFrame() {
  notePlayerDuration()
  const screen = screenRef.value
  // 模板 ref 的类型和 DOM 库里的 Element 不是同一份，先收窄再交给浏览器 API
  if (!(screen instanceof HTMLElement) || screen.clientWidth < 8 || screen.clientHeight < 8)
    return
  const video = playerRef.value
  const vw = video?.videoWidth || 16
  const vh = video?.videoHeight || 9
  if (isRetake.value && video && video.videoWidth > 0 && video.videoHeight > 0) {
    frameWidth.value = video.videoWidth
    frameHeight.value = video.videoHeight
    syncRetakeOutput()
  }
  const style = getComputedStyle(screen)
  const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
  const maxW = Math.max(1, screen.clientWidth - 48)
  const maxH = Math.max(1, screen.clientHeight - padY)
  const scale = Math.min(maxW / vw, maxH / vh)
  frameStyle.value = {
    width: `${Math.max(1, Math.floor(vw * scale))}px`,
    height: `${Math.max(1, Math.floor(vh * scale))}px`,
  }
}

function bindFrameObserver() {
  frameObserver?.disconnect()
  const screen = screenRef.value
  if (!(screen instanceof HTMLElement) || typeof ResizeObserver === 'undefined')
    return
  frameObserver = new ResizeObserver(() => fitFrame())
  frameObserver.observe(screen)
  fitFrame()
}

function togglePlay() {
  const video = playerRef.value
  if (!video)
    return
  if (video.paused)
    void video.play().catch(() => {})
  else
    video.pause()
}

function toggleMute() {
  const video = playerRef.value
  if (!video)
    return
  video.muted = !video.muted
  muted.value = video.muted
}

function ratioAt(event: PointerEvent) {
  const el = stripRef.value
  if (!el)
    return 0
  const rect = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
}

function onHandleDown(which: 'move' | 'start' | 'end', event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  const el = event.currentTarget as HTMLElement
  try {
    el.setPointerCapture(event.pointerId)
  }
  catch {}
  grabbing.value = true
  const origin = ratioAt(event)
  const fromStart = start.value
  const fromEnd = end.value
  const span = fromEnd - fromStart

  function onMove(move: PointerEvent) {
    dragged.value = true
    const at = ratioAt(move)
    if (isRetake.value && duration.value > 0) {
      if (which === 'start')
        start.value = Math.min(at, fromEnd)
      else if (which === 'end')
        end.value = Math.max(at, fromStart)
      else {
        start.value = fromStart + (at - origin)
        end.value = start.value + span
      }
      const length = which === 'move'
        ? (seconds.value > 0 ? seconds.value : retakeMinSeconds())
        : undefined
      snapRetakeWindow(which, length)
      if (which !== 'move')
        secondsTouched.value = true
      return
    }
    if (which === 'start')
      clampRange(Math.min(at, fromEnd - MIN_RANGE), fromEnd)
    else if (which === 'end')
      clampRange(fromStart, Math.max(at, fromStart + MIN_RANGE))
    else
      clampRange(fromStart + (at - origin), fromStart + span)
  }
  function onUp() {
    grabbing.value = false
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
  }
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}

/** 打开时定一次选区。时长稍后才读到，不能在那时把用户圈好的区间盖掉 */
function applyRetakeSelection() {
  if (!isRetake.value) {
    start.value = 0
    end.value = 1
    return
  }
  const next = initialRetakeRange(props.initialRange, props.total)
  clampRange(next.start, next.end)
}

function applyKnownDuration(seconds: number) {
  if (!(seconds > 0))
    return
  duration.value = seconds
  if (!isRetake.value) {
    start.value = 0
    end.value = 1
  }
}

async function captureFrames(src: string) {
  const seq = ++captureSeq
  frames.value = []
  duration.value = 0
  frameError.value = false
  notePlayerDuration()
  const result = await captureVideoStripFrames(src, FRAME_COUNT, () => seq !== captureSeq)
  if (seq !== captureSeq)
    return
  if (result.duration > 0)
    applyKnownDuration(result.duration)
  else
    applyFallbackDuration()
  frames.value = result.frames
  frameError.value = !result.frames.length
}

function applyFallbackDuration() {
  if (duration.value > 0 || !(props.fallbackDuration > 0))
    return
  duration.value = props.fallbackDuration
}

// 弹窗用 v-if 挂上时 open 和 src 已经有值，没有 immediate 这次抽帧不会跑，胶片条会一直停在「读取视频帧…」
watch(() => [props.open, props.src] as const, ([open, src], prev) => {
  if (!open || !src) {
    captureSeq += 1
    frames.value = []
    return
  }
  type.value = props.variant === 'retake' ? 'retake' : 'extend'
  applyRetakeSelection()
  // 只在打开时填提示词。抽帧中途 src 变化不能把已经写下的改动清掉。
  // 视频延长写的是「接下来发生什么」，不能把上一条成片的提示词带进来，否则模型会重拍同一镜
  if (!prev?.[0]) {
    prompt.value = type.value === 'extend' ? '' : (props.prompt || '')
    secondsTouched.value = false
    ratioTouched.value = false
    resolution.value = '720P'
    ratio.value = '9:16'
  }
  modelId.value = props.models[0]?.id || ''
  pickListedModel()
  playing.value = false
  muted.value = false
  clearStyle()
  cameraMoves.value = []
  if (!isRetake.value) {
    seconds.value = 5
    resolution.value = '720p'
    ratio.value = '智能'
  }
  videoFormat.value = 'mp4'
  audio.value = true
  count.value = 1
  popover.value = ''
  syncRetakeOutput()
  void captureFrames(src)
}, { immediate: true })

watch([duration, () => retakeDurations.value[0] ?? 0, () => retakeRatios.value.join('|'), modelId, frameWidth, frameHeight], () => {
  if (!props.open || !isRetake.value)
    return
  syncRetakeOutput()
  if (duration.value > 0)
    snapRetakeWindow('fit', secondsTouched.value ? seconds.value : undefined)
})

watch(() => props.fallbackDuration, () => {
  if (frameError.value || !(duration.value > 0))
    applyFallbackDuration()
})

watch(type, (next, prev) => {
  pickListedModel()
  const source = (props.prompt || '').trim()
  if (next === 'extend' && prompt.value.trim() === source)
    prompt.value = ''
  else if (prev === 'extend' && !prompt.value.trim() && source)
    prompt.value = props.prompt || ''
})

/** 首尾帧模式：把选区尾帧截出来传成图片素材（first_frame） */
async function uploadTailFrame(): Promise<number | null> {
  if (tailFrameBusy.value)
    return null
  tailFrameBusy.value = true
  try {
    const at = end.value * duration.value
    const frame = await captureVideoFrame(props.src, Math.max(0, at - 0.04))
    const file = new File([frame.blob], 'extend-first-frame.jpg', { type: 'image/jpeg' })
    const uploaded = await assetApi.upload(file)
    if (!uploaded?.success || !uploaded.data?.id) {
      return null
    }
    return Number(uploaded.data.id)
  }
  catch {
    return null
  }
  finally {
    tailFrameBusy.value = false
  }
}

function onSubmit() {
  if (props.submitting || tailFrameBusy.value)
    return
  void (async () => {
    let firstFrameAssetId: number | undefined
    if (modelId.value && type.value === 'fl2v') {
      const id = await uploadTailFrame()
      if (!id)
        return
      firstFrameAssetId = id
    }
    if (isRetake.value && modelId.value) {
      const name = modelId.value
      const detail = await loadModelDetail(name)
      if (modelId.value === name)
        retakeModelDetail.value = detail
      syncRetakeOutput()
    }
    emit('submit', {
      type: type.value,
      model: modelId.value,
      prompt: prompt.value.trim(),
      style: stylePrompt.value,
      cameras: [...cameraMoves.value],
      seconds: seconds.value,
      ratio: ratio.value,
      resolution: resolution.value,
      videoFormat: videoFormat.value,
      audio: isRetake.value && !retakeSupportsAudio.value ? undefined : audio.value,
      count: count.value,
      range: { start: start.value, end: end.value, duration: duration.value },
      refs: [...props.refs],
      firstFrameAssetId,
      total: isRetake.value ? props.total : undefined,
    })
  })()
}

/** 点遮罩时若刚收起选项层，这次点击不再把整个弹窗关掉 */
let dismissMaskClick = false

function onDocPointerDown(event: PointerEvent) {
  if (!popover.value)
    return
  const target = event.target as HTMLElement | null
  if (!target?.closest)
    return
  if (target.closest('.ext-studio__pop'))
    return
  if (target.closest(`[data-pop="${popover.value}"]`))
    return
  const onMask = !target.closest('.ext-studio')
  popover.value = ''
  if (onMask)
    dismissMaskClick = true
}

function onMaskClick() {
  if (dismissMaskClick) {
    dismissMaskClick = false
    return
  }
  if (popover.value) {
    popover.value = ''
    return
  }
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    if (popover.value) {
      popover.value = ''
      return
    }
    emit('close')
    return
  }
  if (event.key !== ' ' && event.code !== 'Space')
    return
  const tag = (event.target as HTMLElement | null)?.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON')
    return
  event.preventDefault()
  togglePlay()
}

watch(() => props.open, (on) => {
  if (!import.meta.client)
    return
  if (on) {
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('pointerdown', onDocPointerDown, true)
    nextTick(() => bindFrameObserver())
    return
  }
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('pointerdown', onDocPointerDown, true)
  frameObserver?.disconnect()
  frameObserver = null
  playing.value = false
}, { immediate: true })

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('pointerdown', onDocPointerDown, true)
  }
  frameObserver?.disconnect()
  frameObserver = null
})

/** 抽不到帧时，在胶片条上标 25/50/75% 时码，选区仍可拖 */
const fallbackTicks = computed(() => {
  if (!(duration.value > 0) || frames.value.length)
    return []
  return [0.25, 0.5, 0.75].map(pct => ({ pct: `${pct * 100}%`, label: formatClock(duration.value * pct) }))
})

/** 重拍按整秒分格，不再把片子切成等分的五段 */
const retakeSecondTicks = computed(() => {
  const n = Math.floor(duration.value)
  if (!isRetake.value || n < 2)
    return []
  return Array.from({ length: n - 1 }, (_, index) => index + 1)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ext-studio-mask" @click.self="onMaskClick" @pointerdown.stop @dblclick.stop>
      <div class="ext-studio" role="dialog" aria-modal="true">
        <header class="ext-studio__head">
          <h2>{{ dialogTitle }}</h2>
          <button type="button" class="ext-studio__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="ext-studio__stage">
          <div ref="screenRef" class="ext-studio__screen">
            <div class="ext-studio__frame" :style="frameStyle || undefined">
              <video
                ref="playerRef"
                :src="src"
                playsinline
                preload="metadata"
                @loadedmetadata="fitFrame"
                @click="togglePlay"
                @play="playing = true"
                @pause="playing = false"
                @ended="playing = false"
              />
              <div class="ext-studio__controls">
                <button type="button" class="ext-studio__ctrl" :aria-label="playing ? t('暂停') : t('播放')" @click.stop="togglePlay">
                  <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-4" />
                </button>
                <button type="button" class="ext-studio__ctrl" :aria-label="muted ? t('打开声音') : t('静音')" @click.stop="toggleMute">
                  <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
                </button>
              </div>
            </div>
          </div>

          <div class="ext-studio__film" :style="filmStyle">
            <div class="ext-studio__film-meta">
              <span>00:00.00</span>
              <em>{{ frames.length ? '' : (frameError ? t('浏览器读不到视频帧，按时间选择') : t('读取视频帧…')) }}</em>
              <span>{{ endClock }}</span>
            </div>
            <div
              ref="stripRef"
              class="ext-studio__thumbs"
              :class="{ 'is-grab': grabbing, 'is-retake': isRetake }"
              @pointerdown="onHandleDown('move', $event)"
              @click="onStripClick"
            >
              <img v-for="(item, index) in frames" :key="index" :src="item" alt="" draggable="false">
              <template v-if="!frames.length">
                <i v-for="n in FRAME_COUNT" :key="`ph-${n}`" class="ext-studio__ph" />
              </template>
              <template v-if="isRetake && retakeSecondTicks.length">
                <i
                  v-for="sec in retakeSecondTicks"
                  :key="`sec-${sec}`"
                  class="ext-studio__seg"
                  :style="{ left: `${(sec / duration) * 100}%` }"
                />
              </template>
              <template v-else-if="isRetake">
                <i
                  v-for="i in Math.max(0, props.total - 1)"
                  :key="`seg-${i}`"
                  class="ext-studio__seg"
                  :style="{ left: `${(i / props.total) * 100}%` }"
                />
              </template>
              <i
                v-for="tick in fallbackTicks"
                :key="tick.pct"
                class="ext-studio__tick"
                :style="{ left: tick.pct }"
              >
                {{ tick.label }}
              </i>
              <i class="ext-studio__dim is-left" :style="{ width: `${start * 100}%` }" />
              <i class="ext-studio__dim is-right" :style="{ width: `${(1 - end) * 100}%` }" />
              <div class="ext-studio__range" :style="rangeStyle">
                <button type="button" class="ext-studio__handle" :aria-label="t('起点')" @pointerdown.stop="onHandleDown('start', $event)" />
                <button type="button" class="ext-studio__handle is-end" :aria-label="t('终点')" @pointerdown.stop="onHandleDown('end', $event)" />
              </div>
            </div>
          </div>
        </div>

        <div class="ext-studio__composer">
            <div class="ext-studio__lead">
              <button v-if="!isRetake" type="button" class="ext-studio__add" :aria-label="t('添加参考素材')" @click="emit('pick-refs')">
                <UIcon name="i-lucide-plus" class="size-4" />
              </button>
              <span class="ext-studio__ref" :class="{ 'is-empty': !frames[0] }">
                <img v-if="frames[0]" :src="frames[0]" alt="">
                <em v-if="duration > 0">{{ rangeSecondsLabel }}</em>
              </span>
              <span
                v-for="(item, index) in refs"
                :key="item.assetId"
                class="ext-studio__ref"
              >
                <img v-if="item.kind === 'image'" :src="item.url" alt="">
                <UIcon v-else :name="item.kind === 'video' ? 'i-lucide-film' : 'i-lucide-music'" class="size-4" />
                <button type="button" class="ext-studio__ref-x" :aria-label="t('移除')" @click="emit('remove-ref', index)">
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </span>
              <span class="ext-studio__clip">
                <em>[{{ dialogTitle }}]</em>
                <UIcon name="i-lucide-clapperboard" class="size-3" />
                <span>{{ isRetake ? rangeClockLabel : `${rangeLabel} ${t('视频')}` }}</span>
              </span>
              <button v-if="styleName" type="button" class="ext-studio__tag is-style" @click="clearStyle">
                {{ styleName }}
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
              <button
                v-for="cam in cameraMoves"
                :key="cam"
                type="button"
                class="ext-studio__tag is-style"
                @click="toggleCamera(cam)"
              >
                {{ cameraLabel(cam) }}
                <UIcon name="i-lucide-x" class="size-3" />
              </button>
            </div>

            <textarea
              v-model="prompt"
              class="ext-studio__input"
              rows="2"
              :placeholder="isRetake ? t('写下这一段要改成什么，例如：黑色西装换成白色，人物和机位保持不变') : t('描述接下来要发生什么，或这次要怎么改')"
            />

            <div class="ext-studio__bar">
              <div class="ext-studio__bar-left">
                <button type="button" class="ext-studio__bar-btn is-model" data-pop="model" @click="popover = popover === 'model' ? '' : 'model'">
                  <CanvasModelIcon :icon="modelIconOf(modelId)" :fallback="modelMeta?.name || ''" />
                  <span class="ext-studio__bar-name">{{ modelMeta?.name || t('选择模型') }}</span>
                  <UIcon name="i-lucide-chevron-down" class="size-3 ext-studio__caret" />
                </button>
                <button
                  v-if="!isRetake"
                  type="button"
                  class="ext-studio__bar-btn"
                  data-pop="type"
                  @click="popover = popover === 'type' ? '' : 'type'"
                >
                  <UIcon name="i-lucide-squares-unite" class="size-4" />
                  {{ typeLabel }}
                  <UIcon name="i-lucide-chevron-down" class="size-3 ext-studio__caret" />
                </button>
                <span v-else class="ext-studio__bar-btn is-static">
                  <UIcon name="i-lucide-clapperboard" class="size-4" />
                  {{ typeLabel }}
                </span>
                <button v-if="!isRetake" type="button" class="ext-studio__bar-btn" :class="{ 'is-on': !!styleName }" @click="emit('open-style')">
                  <UIcon name="i-lucide-palette" class="size-4" />
                  {{ styleName || t('风格') }}
                </button>
                <button v-if="!isRetake" type="button" class="ext-studio__bar-btn" @click="emit('pick-refs')">
                  <UIcon name="i-lucide-images" class="size-4" />
                  {{ t('资产') }}
                </button>
                <button v-if="!isRetake" type="button" class="ext-studio__bar-btn" data-pop="camera" :class="{ 'is-on': cameraMoves.length > 0 }" @click="popover = popover === 'camera' ? '' : 'camera'">
                  <UIcon name="i-lucide-video" class="size-4" />
                  {{ t('运镜') }}
                </button>
              </div>
              <div class="ext-studio__bar-right">
                <button type="button" class="ext-studio__bar-btn" data-pop="output" @click="popover = popover === 'output' ? '' : 'output'">
                  {{ isRetake ? retakeSpecLabel : summaryLabel }}
                  <UIcon name="i-lucide-chevron-down" class="size-3 ext-studio__caret" />
                </button>
                <span v-if="isRetake && points > 0" class="ext-studio__points">
                  <UIcon name="i-lucide-coins" class="size-3.5" />
                  {{ points }}
                </span>
                <button
                  type="button"
                  class="ext-studio__send"
                  :disabled="submitting"
                  :aria-label="t('发送')"
                  @click="onSubmit"
                >
                  <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'" class="size-4" :class="{ 'animate-spin': submitting }" />
                </button>
              </div>
            </div>

            <!-- 模型面板 -->
            <div v-if="popover === 'model'" class="ext-studio__pop ext-studio__pop--model">
              <h4>{{ t('模型') }}</h4>
              <p v-if="!listedModels.length" class="ext-studio__pop-empty">{{ type === 'fl2v' ? t('暂无可用的视频模型') : t('暂无支持参考视频的模型') }}</p>
              <button
                v-for="item in listedModels"
                :key="item.id"
                type="button"
                class="ext-studio__model"
                :class="{ 'is-on': item.id === modelId }"
                @click="modelId = item.id; popover = ''"
              >
                <CanvasModelIcon :icon="modelIconOf(item.id)" :fallback="item.name" />
                <span class="ext-studio__model-meta">
                  <strong>{{ item.name }}</strong>
                  <small v-if="item.desc || !item.priced">{{ item.desc || t('未定价') }}</small>
                </span>
                <UIcon v-if="item.id === modelId" name="i-lucide-check" class="size-4 ext-studio__model-check" />
              </button>
            </div>

            <!-- 类型面板 -->
            <div v-if="popover === 'type'" class="ext-studio__pop ext-studio__pop--type">
              <button
                v-for="item in extendTypeOptions"
                :key="item.id"
                type="button"
                class="ext-studio__type"
                :class="{ 'is-on': item.id === type }"
                @click="type = item.id; popover = ''"
              >
                <strong>{{ item.label }}</strong>
                <small>{{ item.hint }}</small>
              </button>
            </div>

            <!-- 运镜面板 -->
            <div v-if="popover === 'camera'" class="ext-studio__pop ext-studio__pop--camera">
              <button
                v-for="item in CAMERA_MOVE_ITEMS"
                :key="item.id"
                type="button"
                class="ext-studio__chip"
                :class="{ 'is-on': cameraMoves.includes(item.id) }"
                @click="toggleCamera(item.id)"
              >
                {{ item.label }}
              </button>
            </div>

            <!-- 输出规格。重拍用和画布生成栏同一张参数卡：比例、分辨率、时长、有声 -->
            <div v-if="popover === 'output'" class="ext-studio__pop ext-studio__pop--out" :class="{ 'is-sheet': isRetake }">
              <template v-if="isRetake">
                <section>
                  <h5>{{ t('比例') }}</h5>
                  <p v-if="!retakeRatios.length" class="ext-studio__pop-empty">{{ retakeParamHint }}</p>
                  <div v-else class="ext-studio__ratios">
                    <button
                      v-for="item in retakeRatios"
                      :key="item"
                      type="button"
                      :class="{ 'is-on': ratio === item }"
                      @click="pickRetakeRatio(item)"
                    >
                      <i v-if="ratioBox(item)" :style="ratioBox(item) || {}" />
                      {{ ratioLabel(item) }}
                    </button>
                  </div>
                </section>
                <section>
                  <h5>{{ t('分辨率') }}</h5>
                  <p v-if="!retakeResolutions.length" class="ext-studio__pop-empty">{{ retakeParamHint }}</p>
                  <div v-else class="ext-studio__picks is-duo">
                    <button
                      v-for="item in retakeResolutions"
                      :key="item"
                      type="button"
                      class="ext-studio__pick"
                      :class="{ 'is-on': resolution === item }"
                      @click="pickRetakeResolution(item)"
                    >
                      {{ item }}
                    </button>
                  </div>
                </section>
                <section>
                  <h5>{{ t('时长') }}</h5>
                  <p v-if="!retakeDurationChoices.length" class="ext-studio__pop-empty">{{ retakeParamHint }}</p>
                  <div v-else class="ext-studio__picks">
                    <button
                      v-for="item in retakeDurationChoices"
                      :key="item"
                      type="button"
                      class="ext-studio__pick"
                      :class="{ 'is-on': seconds === item }"
                      @click="pickRetakeSeconds(item)"
                    >
                      {{ item }}s
                    </button>
                  </div>
                </section>
                <section v-if="retakeSupportsAudio">
                  <h5>{{ t('音频') }}</h5>
                  <div class="ext-studio__picks is-duo">
                    <button type="button" class="ext-studio__pick" :class="{ 'is-on': audio }" @click="audio = true">
                      {{ t('有声') }}
                    </button>
                    <button type="button" class="ext-studio__pick" :class="{ 'is-on': !audio }" @click="audio = false">
                      {{ t('无声') }}
                    </button>
                  </div>
                </section>
              </template>
              <template v-else>
              <h5>{{ t('比例') }}</h5>
              <div class="ext-studio__picks">
                <button
                  v-for="item in EXTEND_STUDIO_RATIOS"
                  :key="item"
                  type="button"
                  class="ext-studio__pick"
                  :class="{ 'is-on': ratio === item }"
                  @click="ratio = item"
                >
                  {{ item }}
                </button>
              </div>
              <h5>{{ t('时长') }}</h5>
              <div class="ext-studio__sec">
                <span>1-{{ EXTEND_STUDIO_SECONDS_MAX }} {{ t('秒') }}</span>
                <span class="ext-studio__sec-step">
                  <button type="button" :aria-label="t('减少')" @click="stepSeconds(-1)">−</button>
                  <em>{{ seconds }}s</em>
                  <button type="button" :aria-label="t('增加')" @click="stepSeconds(1)">＋</button>
                </span>
              </div>
              <h5>{{ t('分辨率') }}</h5>
              <div class="ext-studio__picks">
                <button
                  v-for="item in EXTEND_STUDIO_RESOLUTIONS"
                  :key="item"
                  type="button"
                  class="ext-studio__pick"
                  :class="{ 'is-on': resolution === item }"
                  @click="resolution = item"
                >
                  {{ item }}
                </button>
              </div>
              <h5>{{ t('视频格式') }}</h5>
              <div class="ext-studio__picks">
                <button
                  v-for="item in EXTEND_STUDIO_FORMATS"
                  :key="item"
                  type="button"
                  class="ext-studio__pick"
                  :class="{ 'is-on': videoFormat === item }"
                  @click="videoFormat = item"
                >
                  {{ item.toUpperCase() }}
                </button>
              </div>
              <div class="ext-studio__sec is-audio">
                <span>{{ t('输出声音') }}</span>
                <button
                  type="button"
                  class="ext-studio__switch"
                  :class="{ 'is-on': audio }"
                  :aria-label="t('输出声音')"
                  @click="audio = !audio"
                >
                  <i />
                </button>
              </div>
              <h5>{{ t('生成数量') }}</h5>
              <div class="ext-studio__picks">
                <button
                  v-for="item in EXTEND_STUDIO_COUNTS"
                  :key="item"
                  type="button"
                  class="ext-studio__pick"
                  :class="{ 'is-on': count === item }"
                  @click="count = item"
                >
                  {{ item }}
                </button>
              </div>
              </template>
            </div>
          </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ext-studio-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.72);
}

.ext-studio {
  display: flex;
  flex-direction: column;
  width: min(1120px, 100%);
  height: min(860px, calc(100vh - 32px));
  max-height: 100%;
  overflow: hidden;
  border-radius: 16px;
  background: #0c0c0e;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.55);
  color: #f3f3f4;
}

.ext-studio__head {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  height: 48px;
  padding: 0 12px;
}

.ext-studio__head h2 {
  position: absolute;
  left: 50%;
  top: 50%;
  margin: 0;
  transform: translate(-50%, -50%);
  color: #f3f3f4;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.ext-studio__close,
.ext-studio__add,
.ext-studio__ref-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: #8d8d96;
  cursor: pointer;
}

.ext-studio__close {
  position: relative;
  z-index: 1;
  width: 28px;
  height: 28px;
  border-radius: 8px;
}

.ext-studio__close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f3f3f4;
}

.ext-studio__stage {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: #000;
}

.ext-studio__screen {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 8px 0 4px;
}

.ext-studio__frame {
  position: relative;
  width: calc(100% - 48px);
  max-width: calc(100% - 48px);
  max-height: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}

.ext-studio__frame video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  cursor: pointer;
}

.ext-studio__controls {
  position: absolute;
  right: 8px;
  bottom: 6px;
  left: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}

.ext-studio__ctrl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.38);
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
}

.ext-studio__ctrl:hover {
  background: rgba(0, 0, 0, 0.55);
}

.ext-studio__film {
  flex: none;
  align-self: center;
  width: calc(100% - 48px);
  max-width: 100%;
  margin-top: 10px;
  padding-bottom: 14px;
}

.ext-studio__film-meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ext-studio__film-meta em {
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.38);
  font-size: 11px;
  font-style: normal;
}

.ext-studio__thumbs {
  position: relative;
  display: flex;
  gap: 1px;
  height: 56px;
  overflow: hidden;
  border-radius: 4px;
  background: #141416;
  cursor: grab;
  user-select: none;
}

.ext-studio__thumbs.is-retake {
  cursor: pointer;
}

.ext-studio__thumbs.is-grab {
  cursor: grabbing;
}

.ext-studio__thumbs img,
.ext-studio__ph {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  pointer-events: none;
}

.ext-studio__thumbs img {
  object-fit: cover;
}

.ext-studio__ph {
  background: linear-gradient(180deg, #2c2c32, #1a1a1e);
  box-shadow: inset -1px 0 0 rgba(0, 0, 0, 0.35);
}

.ext-studio__tick {
  position: absolute;
  top: 3px;
  z-index: 1;
  color: rgba(255, 255, 255, 0.72);
  font-size: 9px;
  font-style: normal;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  pointer-events: none;
  transform: translateX(-50%);
}

.ext-studio__dim {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  background: rgba(0, 0, 0, 0.62);
  pointer-events: none;
}

.ext-studio__dim.is-left {
  left: 0;
}

.ext-studio__dim.is-right {
  right: 0;
}

.ext-studio__range {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  border-radius: 2px;
  box-shadow: inset 0 0 0 2px #fff;
  pointer-events: none;
}

.ext-studio__handle {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 14px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: ew-resize;
  pointer-events: auto;
}

.ext-studio__handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 2px;
  background: #fff;
}

.ext-studio__handle.is-end {
  right: 0;
}

.ext-studio__handle.is-end::after {
  right: 0;
}

.ext-studio__handle:not(.is-end) {
  left: 0;
}

.ext-studio__handle:not(.is-end)::after {
  left: 0;
}

.ext-studio__composer {
  position: relative;
  z-index: 2;
  flex: none;
  margin: 0 12px 12px;
  padding: 10px 12px 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  background: #1a1a1e;
}

.ext-studio__lead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}

.ext-studio__add {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: #b4b4bc;
}

.ext-studio__add:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f3f3f4;
}

.ext-studio__ref {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 44px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
}

/* 没抽到帧时（无 CORS）给个渐变底，不放成空灰块 */
.ext-studio__ref.is-empty {
  background: linear-gradient(135deg, #2a2a30, #3a3a42);
}

.ext-studio__ref img,
.ext-studio__ref .iconify {
  color: #9a9aa3;
}

.ext-studio__ref img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ext-studio__ref em {
  position: absolute;
  left: 4px;
  bottom: 2px;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  line-height: 1.2;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.ext-studio__ref-x {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
}

.ext-studio__clip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #ececef;
  font-size: 12px;
}

.ext-studio__clip em {
  color: #e3b34a;
  font-style: normal;
  font-weight: 500;
}

.ext-studio__clip .iconify {
  color: #c8c8d0;
}

.ext-studio__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #f3f3f4;
  font-size: 12px;
  cursor: pointer;
}

.ext-studio__input {
  width: 100%;
  margin-top: 4px;
  padding: 6px 2px 2px;
  border: 0;
  background: transparent;
  color: #f3f3f4;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  outline: none;
}

.ext-studio__input::placeholder {
  color: rgba(255, 255, 255, 0.32);
}

.ext-studio__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
}

.ext-studio__bar-left,
.ext-studio__bar-right {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.ext-studio__bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.ext-studio__bar-btn:hover,
.ext-studio__bar-btn.is-on {
  background: rgba(255, 255, 255, 0.06);
  color: #f3f3f4;
}

.ext-studio__bar-btn .canvas-chat__model-logo {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  font-size: 10px;
}

.ext-studio__bar-name {
  overflow: hidden;
  max-width: 168px;
  text-overflow: ellipsis;
}

.ext-studio__caret {
  opacity: 0.65;
}

/* 片段重拍：固定类型的静态标签（不弹面板） */
.ext-studio__bar-btn.is-static {
  cursor: default;
}

/* 片段重拍：时间线分段分隔线 */
.ext-studio__seg {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 1px;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}

/* 片段重拍：发送键旁的预估积分 */
.ext-studio__points {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: #f3f3f4;
  font-size: 12px;
  white-space: nowrap;
}

.ext-studio__send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-left: 6px;
  border: 0;
  border-radius: 999px;
  background: var(--st-on);
  color: var(--st-on-text);
  cursor: pointer;
}

.ext-studio__send:hover:not(:disabled) {
  filter: brightness(0.92);
}

.ext-studio__send:disabled {
  opacity: 0.5;
  cursor: default;
}

.ext-studio__pop {
  position: absolute;
  z-index: 5;
  min-width: 200px;
  max-width: 280px;
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border-radius: 12px;
  background: #242428;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  color: #f3f3f4;
}

.ext-studio__pop--model {
  width: min(320px, calc(100% - 24px));
  left: 12px;
  bottom: 52px;
  overflow-x: hidden;
}

.ext-studio__pop--type {
  left: 110px;
  bottom: 52px;
}

.ext-studio__pop--style,
.ext-studio__pop--camera {
  left: 12px;
  bottom: 52px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ext-studio__pop--out {
  right: 12px;
  bottom: 52px;
  width: 248px;
  max-height: min(360px, calc(100vh - 160px));
  overflow: auto;
  padding: 12px;
}

.ext-studio__pop--out.is-sheet {
  width: 392px;
  display: grid;
  gap: 16px;
  padding: 16px;
  border-radius: 18px;
}

.ext-studio__pop--out.is-sheet section {
  display: grid;
  gap: 8px;
}

.ext-studio__pop--out.is-sheet h5 {
  margin: 0;
}

.ext-studio__ratios {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.ext-studio__ratios button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 56px;
  padding: 6px 4px;
  border: 1px solid var(--st-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  background: transparent;
  color: var(--st-text-soft, #9a9aa3);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.ext-studio__ratios button.is-on {
  border-color: var(--st-text, #f3f3f4);
  background: var(--st-hover, rgba(255, 255, 255, 0.06));
  color: var(--st-text, #f3f3f4);
}

.ext-studio__ratios i {
  display: block;
  flex-shrink: 0;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  font-style: normal;
}

.ext-studio__pop--out.is-sheet .ext-studio__picks {
  gap: 8px;
}

.ext-studio__pop--out.is-sheet .ext-studio__picks.is-duo {
  grid-template-columns: repeat(2, 1fr);
}

.ext-studio__pop--out.is-sheet .ext-studio__pick {
  min-height: 36px;
  border: 1px solid var(--st-border, rgba(255, 255, 255, 0.12));
  border-radius: 10px;
  background: transparent;
}

.ext-studio__pop--out.is-sheet .ext-studio__pick.is-on {
  border-color: var(--st-text, #f3f3f4);
  background: var(--st-hover, rgba(255, 255, 255, 0.08));
  color: var(--st-text, #f3f3f4);
}

.ext-studio__pop h4 {
  margin: 2px 0 8px;
  font-size: 12px;
  color: #f3f3f4;
}

.ext-studio__pop h5 {
  margin: 14px 0 8px;
  color: #9a9aa3;
  font-size: 11px;
  font-weight: 500;
}

.ext-studio__pop h5:first-child {
  margin-top: 0;
}

.ext-studio__pop-empty {
  margin: 4px 0;
  color: #9a9aa3;
  font-size: 12px;
}

.ext-studio__model {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #f3f3f4;
  text-align: left;
  cursor: pointer;
}

.ext-studio__model:hover,
.ext-studio__model.is-on {
  background: rgba(255, 255, 255, 0.08);
}

.ext-studio__model-meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.ext-studio__model-meta strong,
.ext-studio__model-meta small {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ext-studio__model-meta strong {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
}

.ext-studio__model-meta small {
  color: #9a9aa3;
  font-size: 11px;
  line-height: 1.35;
}

.ext-studio__model-check {
  flex-shrink: 0;
  margin-top: 2px;
  margin-left: auto;
  color: #f3f3f4;
}

.ext-studio__type {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #f3f3f4;
  text-align: left;
  cursor: pointer;
}

.ext-studio__type:hover,
.ext-studio__type.is-on {
  background: rgba(255, 255, 255, 0.08);
}

.ext-studio__type strong {
  font-size: 12px;
}

.ext-studio__type small {
  color: #9a9aa3;
  font-size: 10px;
}

.ext-studio__chip {
  padding: 4px 10px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #f3f3f4;
  font-size: 12px;
  cursor: pointer;
}

.ext-studio__chip.is-on {
  background: color-mix(in srgb, var(--st-accent, #7c5cff) 40%, transparent);
}

.ext-studio__picks {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.ext-studio__picks:has(> :nth-child(2):last-child) {
  grid-template-columns: repeat(2, 1fr);
}

.ext-studio__pick {
  padding: 6px 0;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #f3f3f4;
  font-size: 12px;
  cursor: pointer;
}

.ext-studio__pick.is-on {
  background: var(--st-on);
  color: var(--st-on-text);
  font-weight: 600;
}

.ext-studio__sec {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 28px;
  color: #9a9aa3;
  font-size: 12px;
}

/* 输出声音没有小标题，要和上面的格式按钮拉开，避免贴在一起 */
.ext-studio__sec.is-audio {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ext-studio__sec-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ext-studio__sec-step button {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #f3f3f4;
  cursor: pointer;
}

.ext-studio__sec-step em {
  min-width: 34px;
  text-align: center;
  color: #f3f3f4;
  font-style: normal;
  font-size: 12px;
}

.ext-studio__switch {
  position: relative;
  width: 34px;
  height: 20px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
}

.ext-studio__switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  transition: left 0.15s ease;
}

.ext-studio__switch.is-on {
  background: var(--st-on);
}

.ext-studio__switch.is-on i {
  left: 16px;
  background: var(--st-on-text);
}
</style>
