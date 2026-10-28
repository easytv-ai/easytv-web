<script setup lang="ts">
/**
 * 智能续写大弹窗（视频节点）：黑场大预览 + 画面下方胶片选区 + 紧凑提示词条。
 * 底栏提供 模型 / 类型（延长·全能参考·首尾帧·视频编辑）/ 风格 / 资产 / 运镜 / 输出规格 的选择。
 * 提交语义见 utils/canvas-extend-studio.ts；抽帧选区与 CanvasExtendStrip 同一套手法。
 */
import { isSameOriginMediaUrl } from '~/utils/canvas-image-edit'
import { captureVideoFrame } from '~/utils/canvas-video-frame'
import { CAMERA_MOVE_ITEMS } from '~/utils/canvas-node-kinds'
import { estimateTaskPoints, effectiveUnitPrice } from '~/utils/model-price'
import assetApi from '~/api/asset'
import type { GenerationModel } from '~/types/creative'
import {
  EXTEND_STUDIO_COUNTS,
  EXTEND_STUDIO_FORMATS,
  EXTEND_STUDIO_RATIOS,
  EXTEND_STUDIO_RESOLUTIONS,
  EXTEND_STUDIO_SECONDS_MAX,
  EXTEND_STUDIO_TYPES,
  type ExtendStudioPayload,
  type ExtendStudioRef,
  type ExtendStudioType,
} from '~/utils/canvas-extend-studio'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  prompt?: string
  models?: Array<{ id: string, name: string, desc: string, priced: boolean }>
  refs?: ExtendStudioRef[]
  submitting?: boolean
  /** 浏览器读不到视频时的时长兜底（秒），来自资产库 */
  fallbackDuration?: number
  /** extend=智能续写（默认）；retake=片段重拍：类型固定、无资产/输出规格，发送键旁显示预估积分 */
  variant?: 'extend' | 'retake'
  /** retake 变体：时间线分成的段数 */
  total?: number
}>(), {
  prompt: '',
  models: () => [],
  refs: () => [],
  submitting: false,
  fallbackDuration: 0,
  variant: 'extend',
  total: 5,
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

const prompt = ref('')
const modelId = ref('')
const type = ref<ExtendStudioType>('extend')
const cameraMoves = ref<string[]>([])
const ratio = ref('智能')
const seconds = ref(5)
const resolution = ref('720p')
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

const endClock = computed(() => formatClock(duration.value))
const filmStyle = computed(() => (frameStyle.value ? { width: frameStyle.value.width } : undefined))
const summaryLabel = computed(() => {
  const ratioText = ratio.value === '智能' ? t('智能') : ratio.value
  return `${ratioText} · ${resolution.value}`
})
const cameraLabel = (id: string) => CAMERA_MOVE_ITEMS.find(item => item.id === id)?.label || id

/** 片段重拍：时间线分成 total 段，点选某一段即选中该段 */
const segmentIndex = computed(() => {
  const total = Math.max(1, props.total)
  const mid = (start.value + end.value) / 2
  return Math.min(total, Math.max(1, Math.floor(mid * total) + 1))
})

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
  const total = Math.max(1, props.total)
  pickSegment(Math.min(total, Math.max(1, Math.floor(at * total) + 1)))
}

/** 片段重拍：发送键旁的预估积分（按选中的模型 + 选区时长估算） */
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const { isMember } = useWallet()
const points = computed(() => {
  if (!isRetake.value)
    return 0
  const found = generationModels.value.find(item => item.model === modelId.value)
  if (!found?.priced)
    return 0
  const span = Math.max(0, end.value - start.value)
  const sec = duration.value > 0 ? span * duration.value : span * 5
  return estimateTaskPoints(effectiveUnitPrice(found, isMember.value), found.unit, 1, sec)
})

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
  seconds.value = Math.min(EXTEND_STUDIO_SECONDS_MAX, Math.max(1, seconds.value + delta))
}

const rangeStyle = computed(() => ({
  left: `${start.value * 100}%`,
  width: `${Math.max(0, (end.value - start.value) * 100)}%`,
}))

const rangeSecondsLabel = computed(() => {
  const span = Math.max(0, end.value - start.value)
  const sec = duration.value > 0 ? span * duration.value : span * 5
  return `${sec.toFixed(1)}s`
})

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
  if (isRetake.value)
    pickSegment(1)
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

/** 带 cors 读元数据；失败返回 null（OSS 没跨域头时带 crossOrigin 的加载会直接失败） */
function probeMeta(src: string, cors: boolean) {
  return new Promise<{ duration: number, width: number, height: number } | null>((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    if (cors)
      video.crossOrigin = 'anonymous'
    video.src = src
    const finish = (value: { duration: number, width: number, height: number } | null) => {
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    video.onloadedmetadata = () => finish({
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    })
    video.onerror = () => finish(null)
    window.setTimeout(() => finish(null), 12000)
  })
}

/**
 * 胶片缩略图 + 时长探测（与 CanvasExtendStrip 同一套手法）。
 * OSS 视频往往没有 CORS 头：带 crossOrigin 的加载会失败 → 再不带 cors 读一次元数据，
 * 时长/时间线照常可用，只是出不了缩略图（canvas 读跨域像素必须 CORS）。
 */
function applyKnownDuration(seconds: number) {
  if (!(seconds > 0))
    return
  duration.value = seconds
  if (isRetake.value)
    pickSegment(1)
  else {
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
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // 同源 / blob 设了 crossOrigin，没有 ACAO 头时浏览器会直接拒，预览能播、抽帧却一直挂着
  if (!isSameOriginMediaUrl(src))
    video.crossOrigin = 'anonymous'
  video.src = src
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), 8000)
      const finish = (ok: boolean) => {
        window.clearTimeout(timer)
        if (ok)
          resolve()
        else
          reject(new Error('load'))
      }
      video.onloadedmetadata = () => finish(true)
      video.onerror = () => finish(false)
    })
    if (seq !== captureSeq)
      return
    applyKnownDuration(Number.isFinite(video.duration) ? video.duration : 0)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return
    const shots: string[] = []
    for (let i = 0; i < FRAME_COUNT; i++) {
      const time = duration.value > 0 ? (i / Math.max(1, FRAME_COUNT - 1)) * duration.value * 0.98 : 0
      await new Promise<void>((resolve) => {
        let settled = false
        const done = () => {
          if (settled)
            return
          settled = true
          video.removeEventListener('seeked', done)
          resolve()
        }
        video.addEventListener('seeked', done)
        try {
          if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2)
            done()
          else
            video.currentTime = time
        }
        catch {
          done()
        }
        window.setTimeout(done, 400)
      })
      if (seq !== captureSeq)
        return
      canvas.width = video.videoWidth || 160
      canvas.height = video.videoHeight || 90
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        shots.push(canvas.toDataURL('image/jpeg', 0.72))
      }
      catch {
        break
      }
    }
    if (seq !== captureSeq)
      return
    frames.value = shots
    if (!shots.length)
      frameError.value = true
  }
  catch {
    if (seq !== captureSeq)
      return
    // 无 CORS 兜底：不带 crossOrigin 再读一次元数据，保住时长与时间线（缩略图放弃）
    frameError.value = true
    const meta = await probeMeta(src, false)
    if (seq !== captureSeq)
      return
    if (meta?.duration) {
      applyKnownDuration(meta.duration)
      return
    }
    if (!(duration.value > 0))
      applyFallbackDuration()
  }
  finally {
    video.removeAttribute('src')
    video.load()
  }
}

function applyFallbackDuration() {
  if (duration.value > 0 || !(props.fallbackDuration > 0))
    return
  duration.value = props.fallbackDuration
}

// 弹窗用 v-if 挂上时 open 和 src 已经有值，没有 immediate 这次抽帧不会跑，胶片条会一直停在「读取视频帧…」
watch(() => [props.open, props.src] as const, ([open, src]) => {
  if (!open || !src) {
    captureSeq += 1
    frames.value = []
    return
  }
  prompt.value = props.prompt || ''
  modelId.value = props.models[0]?.id || ''
  type.value = props.variant === 'retake' ? 'retake' : 'extend'
  playing.value = false
  muted.value = false
  clearStyle()
  cameraMoves.value = []
  ratio.value = '智能'
  seconds.value = 5
  resolution.value = '720p'
  videoFormat.value = 'mp4'
  audio.value = true
  count.value = 1
  popover.value = ''
  void captureFrames(src)
}, { immediate: true })

watch(() => props.fallbackDuration, () => {
  if (frameError.value || !(duration.value > 0))
    applyFallbackDuration()
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
  if (!modelId.value) {
    return
  }
  void (async () => {
    let firstFrameAssetId: number | undefined
    if (type.value === 'fl2v') {
      const id = await uploadTailFrame()
      if (!id)
        return
      firstFrameAssetId = id
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
      audio: audio.value,
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
              <template v-if="isRetake">
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
                <span>{{ rangeLabel }} {{ t('视频') }}</span>
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
              :placeholder="t('描述接下来要发生什么，或这次要怎么改')"
            />

            <div class="ext-studio__bar">
              <div class="ext-studio__bar-left">
                <button type="button" class="ext-studio__bar-btn is-model" data-pop="model" @click="popover = popover === 'model' ? '' : 'model'">
                  <UIcon name="i-lucide-audio-lines" class="size-4" />
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
                <button type="button" class="ext-studio__bar-btn" :class="{ 'is-on': !!styleName }" @click="emit('open-style')">
                  <UIcon name="i-lucide-palette" class="size-4" />
                  {{ styleName || t('风格') }}
                </button>
                <button v-if="!isRetake" type="button" class="ext-studio__bar-btn" @click="emit('pick-refs')">
                  <UIcon name="i-lucide-images" class="size-4" />
                  {{ t('资产') }}
                </button>
                <button type="button" class="ext-studio__bar-btn" data-pop="camera" :class="{ 'is-on': cameraMoves.length > 0 }" @click="popover = popover === 'camera' ? '' : 'camera'">
                  <UIcon name="i-lucide-video" class="size-4" />
                  {{ t('运镜') }}
                </button>
              </div>
              <div class="ext-studio__bar-right">
                <button v-if="!isRetake" type="button" class="ext-studio__bar-btn" data-pop="output" @click="popover = popover === 'output' ? '' : 'output'">
                  {{ summaryLabel }}
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
              <p v-if="!models.length" class="ext-studio__pop-empty">{{ t('暂无可用的视频模型') }}</p>
              <button
                v-for="item in models"
                :key="item.id"
                type="button"
                class="ext-studio__model"
                :class="{ 'is-on': item.id === modelId }"
                @click="modelId = item.id; popover = ''"
              >
                <span class="ext-studio__model-icon">
                  <UIcon name="i-lucide-clapperboard" class="size-4" />
                </span>
                <span class="ext-studio__model-meta">
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.desc || (item.priced ? '' : t('未定价')) }}</small>
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

            <!-- 输出规格面板 -->
            <div v-if="popover === 'output'" class="ext-studio__pop ext-studio__pop--out">
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
  background: #d946ef;
  color: #fff;
  cursor: pointer;
}

.ext-studio__send:hover:not(:disabled) {
  background: #e879f9;
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
  width: 300px;
  left: 12px;
  bottom: 52px;
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
  right: 60px;
  bottom: 52px;
  width: 248px;
  max-height: none;
  padding: 12px;
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
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
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

.ext-studio__model-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #9a9aa3;
}

.ext-studio__model-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ext-studio__model-meta strong {
  font-size: 12px;
}

.ext-studio__model-meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #9a9aa3;
  font-size: 10px;
}

.ext-studio__model-check {
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
  background: rgba(255, 255, 255, 0.18);
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
  background: #e879f9;
}

.ext-studio__switch.is-on i {
  left: 16px;
}
</style>
