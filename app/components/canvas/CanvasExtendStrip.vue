<script setup lang="ts">
import { stripKeyResult } from '~/utils/canvas-strip-keys'

const { t } = useI18n()

const FRAME_COUNT = 10
const MIN_RANGE = 0.08

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  submitting?: boolean
  variant?: 'extend' | 'retake' | 'clip' | 'split'
  range?: { start: number, end: number } | null
  total?: number
  box?: { left: number, top: number, width: number, height: number } | null
  /** 浏览器读不到视频（OSS 无 CORS 头）时的时长兜底（秒），来自资产库 */
  fallbackDuration?: number
}>(), {
  submitting: false,
  variant: 'extend',
  range: null,
  total: 5,
  box: null,
  fallbackDuration: 0,
})

const emit = defineEmits<{
  close: []
  /** duration 是探测到的源视频时长（秒），0 表示读不到；片段截取按 start/end 比例 × duration 换算成秒 */
  submit: [payload: { seconds: number, start: number, end: number, duration: number }]
  'update:range': [payload: { start: number, end: number, seconds: number, index: number }]
}>()

const duration = ref(0)
const start = ref(0.35)
const end = ref(0.72)
const frames = ref<string[]>([])
/** 浏览器读不到视频帧（跨域）：只能按兜底时长选点 */
const frameError = ref(false)
const grabbing = ref(false)
const snapSec = ref(false)
const loopSel = ref(true)
const stripRef = ref<HTMLElement | null>(null)
const isClip = computed(() => props.variant === 'clip')
const isRetake = computed(() => props.variant === 'retake')
const isExtend = computed(() => props.variant === 'extend')
const isSplit = computed(() => props.variant === 'split')

/** 分割点（秒）：分割模式只用 start 一个游标 */
const cutSeconds = computed(() => (duration.value > 0 ? start.value * duration.value : 0))
const cutLabel = computed(() => `${cutSeconds.value.toFixed(2)} s`)

function setCut(ratio: number) {
  const v = snapRatio(Math.min(1, Math.max(0, ratio)))
  start.value = v
  end.value = v
}

const layerStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  const width = Math.max(box.width, 360)
  return {
    left: `${box.left + box.width / 2 - width / 2}px`,
    top: `${box.top + box.height + 12}px`,
    width: `${width}px`,
  }
})

const selectedSeconds = computed(() => {
  const span = Math.max(0, end.value - start.value)
  if (duration.value > 0)
    return span * duration.value
  return span * 5
})

const selectedLabel = computed(() => {
  const value = selectedSeconds.value
  if (isRetake.value)
    return `${value.toFixed(1)}s`
  if (isClip.value)
    return `${value.toFixed(2)} s`
  return `${value.toFixed(2)}${t('秒')}`
})

const segmentIndex = computed(() => {
  const total = Math.max(1, props.total)
  const mid = (start.value + end.value) / 2
  return Math.min(total, Math.max(1, Math.floor(mid * total) + 1))
})

const segmentLabel = computed(() => `${segmentIndex.value}/${props.total} ${t('个片段')}`)

const rangeStyle = computed(() => ({
  left: `${start.value * 100}%`,
  width: `${Math.max(0, (end.value - start.value) * 100)}%`,
}))

function snapRatio(value: number) {
  if (!snapSec.value || !(duration.value > 0))
    return value
  const sec = Math.round(value * duration.value)
  return Math.min(1, Math.max(0, sec / duration.value))
}

function clampRange(nextStart: number, nextEnd: number) {
  let a = snapRatio(Math.min(1, Math.max(0, nextStart)))
  let b = snapRatio(Math.min(1, Math.max(0, nextEnd)))
  if (b - a < MIN_RANGE) {
    if (a + MIN_RANGE <= 1)
      b = a + MIN_RANGE
    else
      a = Math.max(0, b - MIN_RANGE)
  }
  start.value = a
  end.value = b
  emitRange()
}

function emitRange() {
  emit('update:range', {
    start: start.value,
    end: end.value,
    seconds: selectedSeconds.value,
    index: segmentIndex.value,
  })
}

function pickSegment(index: number) {
  const total = Math.max(1, props.total)
  const i = ((index - 1) % total + total) % total
  clampRange(i / total, (i + 1) / total)
}

function cycleSegment() {
  pickSegment(segmentIndex.value + 1)
}

function ratioAt(event: PointerEvent) {
  const el = stripRef.value
  if (!el)
    return 0
  const rect = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))
}

function onHandleDown(which: 'start' | 'end' | 'move', event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  const el = event.currentTarget as HTMLElement
  try {
    el.setPointerCapture(event.pointerId)
  }
  catch {}
  grabbing.value = true
  if (isSplit.value) {
    // 分割：点哪里游标到哪里，拖动跟手
    setCut(ratioAt(event))
    const onCutMove = (move: PointerEvent) => setCut(ratioAt(move))
    const onCutUp = () => {
      grabbing.value = false
      el.removeEventListener('pointermove', onCutMove)
      el.removeEventListener('pointerup', onCutUp)
      el.removeEventListener('pointercancel', onCutUp)
    }
    el.addEventListener('pointermove', onCutMove)
    el.addEventListener('pointerup', onCutUp)
    el.addEventListener('pointercancel', onCutUp)
    return
  }
  const origin = ratioAt(event)
  const fromStart = start.value
  const fromEnd = end.value
  const span = fromEnd - fromStart

  function onMove(move: PointerEvent) {
    const at = ratioAt(move)
    if (which === 'start') {
      clampRange(Math.min(at, fromEnd - MIN_RANGE), fromEnd)
      return
    }
    if (which === 'end') {
      clampRange(fromStart, Math.max(at, fromStart + MIN_RANGE))
      return
    }
    const nextStart = fromStart + (at - origin)
    clampRange(nextStart, nextStart + span)
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

async function captureFrames(src: string) {
  frames.value = []
  duration.value = 0
  frameError.value = false
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  video.src = src
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('load'))
    })
    duration.value = Number.isFinite(video.duration) ? video.duration : 0
    if (duration.value > 0) {
      if (isRetake.value) {
        clampRange(0, 1)
      }
      else if (isSplit.value) {
        setCut(0.5)
      }
      else if (isClip.value) {
        const window = Math.min(2, Math.max(0.5, duration.value * 0.35))
        const mid = duration.value / 2
        clampRange(
          Math.max(0, (mid - window / 2) / duration.value),
          Math.min(1, (mid + window / 2) / duration.value),
        )
      }
      else {
        const window = Math.min(5, duration.value)
        const mid = duration.value / 2
        clampRange(
          Math.max(0, (mid - window / 2) / duration.value),
          Math.min(1, (mid + window / 2) / duration.value),
        )
      }
    }
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
        video.currentTime = time
        window.setTimeout(done, 400)
      })
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
    frames.value = shots
  }
  catch {
    duration.value = 0
    frameError.value = true
    applyFallbackDuration()
  }
  finally {
    video.src = ''
  }
}

/** 读不到视频时用资产库时长兜底，并把游标放到中间 */
function applyFallbackDuration() {
  if (duration.value > 0 || !(props.fallbackDuration > 0))
    return
  duration.value = props.fallbackDuration
  if (isSplit.value)
    setCut(0.5)
  else if (isRetake.value)
    clampRange(0, 1)
  else
    clampRange(0.35, 0.72)
}

watch(() => props.fallbackDuration, () => {
  if (frameError.value)
    applyFallbackDuration()
})

watch(() => [props.open, props.src] as const, ([open, src]) => {
  if (!open || !src) {
    frames.value = []
    return
  }
  void captureFrames(src)
}, { immediate: true })

watch(() => props.range, (value) => {
  if (!value)
    return
  if (Math.abs(value.start - start.value) < 0.001 && Math.abs(value.end - end.value) < 0.001)
    return
  start.value = value.start
  end.value = value.end
})

/** 键盘操作（续写 / 片段截取 / 分割）：条开着时在捕获阶段拦下方向键等，免得画布把节点挪走或删掉 */
function onKeydown(event: KeyboardEvent) {
  if (!props.open || isRetake.value || event.metaKey || event.ctrlKey)
    return
  const target = event.target as HTMLElement | null
  if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
    return
  const result = stripKeyResult(
    { key: event.key, shift: event.shiftKey, alt: event.altKey },
    {
      variant: isSplit.value ? 'split' : isClip.value ? 'clip' : 'extend',
      start: start.value,
      end: end.value,
      duration: duration.value,
      snap: snapSec.value,
      minRange: MIN_RANGE,
    },
  )
  if (!result)
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (result.type === 'range') {
    if (isSplit.value)
      setCut(result.start)
    else
      clampRange(result.start, result.end)
    return
  }
  if (result.command === 'submit')
    onSubmit()
  else if (result.command === 'close')
    emit('close')
  else if (result.command === 'toggle-snap')
    snapSec.value = !snapSec.value
  else if (result.command === 'toggle-loop')
    loopSel.value = !loopSel.value
}

watch(() => props.open && !isRetake.value, (on) => {
  if (!import.meta.client)
    return
  window.removeEventListener('keydown', onKeydown, true)
  if (on)
    window.addEventListener('keydown', onKeydown, true)
}, { immediate: true })

onBeforeUnmount(() => {
  if (import.meta.client)
    window.removeEventListener('keydown', onKeydown, true)
})

const shortcutLines = computed(() => {
  const lines = [t('← → 移动，按住 Shift 每次 1 秒')]
  if (!isSplit.value) {
    lines.push(t('Alt + ← → 调整终点'))
    lines.push(t('↑ ↓ 放大或缩小选区'))
  }
  if (isClip.value)
    lines.push(t('S 整数秒吸附，L 循环播放'))
  lines.push(t('Enter 确认，Esc 关闭'))
  return lines.join('\n')
})

function onSubmit() {
  if (props.submitting)
    return
  if (isSplit.value) {
    emit('submit', { seconds: Math.round(cutSeconds.value * 100) / 100, start: start.value, end: start.value, duration: duration.value })
    return
  }
  const seconds = Math.round(selectedSeconds.value * 100) / 100
  emit('submit', {
    seconds: isClip.value ? Math.max(0.1, seconds) : Math.max(1, seconds),
    start: start.value,
    end: end.value,
    duration: duration.value,
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && layerStyle"
      class="canvas-extend-strip nodrag nopan nowheel"
      :class="{ 'is-grab': grabbing, 'is-retake': isRetake, 'is-clip': isClip, 'is-split': isSplit }"
      :style="layerStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <div v-if="isExtend || isClip || isSplit" class="canvas-extend-strip__left">
        <button
          type="button"
          class="canvas-extend-strip__close"
          :aria-label="t('关闭')"
          @click="emit('close')"
        >
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <button
          type="button"
          class="canvas-extend-strip__tool"
          :aria-label="t('快捷键')"
        >
          <UIcon name="i-lucide-keyboard" class="size-4" />
          <span class="canvas-tip canvas-tip--up canvas-tip--lines">{{ shortcutLines }}</span>
        </button>
      </div>
      <div
        ref="stripRef"
        class="canvas-extend-strip__film"
        @pointerdown="onHandleDown('move', $event)"
      >
        <div class="canvas-extend-strip__frames">
          <img
            v-for="(item, index) in frames"
            :key="index"
            :src="item"
            alt=""
            draggable="false"
          >
          <span v-if="!frames.length" class="canvas-extend-strip__empty">{{ frameError ? t('浏览器读不到视频帧，按时长选择') : t('读取视频帧…') }}</span>
        </div>
        <div v-if="isSplit" class="canvas-extend-strip__cut" :style="{ left: `${start * 100}%` }">
          <em>{{ cutLabel }}</em>
        </div>
        <i v-if="!isSplit" class="canvas-extend-strip__dim is-left" :style="{ width: `${start * 100}%` }" />
        <i v-if="!isSplit" class="canvas-extend-strip__dim is-right" :style="{ width: `${(1 - end) * 100}%` }" />
        <div v-if="!isSplit" class="canvas-extend-strip__range" :style="rangeStyle">
          <button
            type="button"
            class="canvas-extend-strip__handle"
            :aria-label="t('起点')"
            @pointerdown.stop="onHandleDown('start', $event)"
          />
          <em>{{ selectedLabel }}</em>
          <button
            type="button"
            class="canvas-extend-strip__handle is-end"
            :aria-label="t('终点')"
            @pointerdown.stop="onHandleDown('end', $event)"
          />
        </div>
      </div>
      <div v-if="isClip" class="canvas-extend-strip__right">
        <button
          type="button"
          class="canvas-extend-strip__tool"
          :class="{ 'is-on': snapSec }"
          :aria-label="snapSec ? t('关闭整数秒吸附') : t('开启整数秒吸附')"
          @click="snapSec = !snapSec"
        >
          <UIcon :name="snapSec ? 'i-lucide-magnet' : 'i-lucide-magnet'" class="size-4" />
          <i v-if="!snapSec" class="canvas-extend-strip__slash" />
          <span class="canvas-tip canvas-tip--up">{{ snapSec ? t('关闭整数秒吸附') : t('开启整数秒吸附') }}</span>
        </button>
        <button
          type="button"
          class="canvas-extend-strip__tool"
          :class="{ 'is-on': loopSel }"
          :aria-label="loopSel ? t('关闭选区循环播放') : t('开启选区循环播放')"
          @click="loopSel = !loopSel"
        >
          <UIcon name="i-lucide-repeat-2" class="size-4" />
          <span class="canvas-tip canvas-tip--up">{{ loopSel ? t('关闭选区循环播放') : t('开启选区循环播放') }}</span>
        </button>
        <button
          type="button"
          class="canvas-extend-strip__check"
          :disabled="submitting"
          :aria-label="t('确认截取')"
          @click="onSubmit"
        >
          <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-check'" class="size-4" :class="{ 'animate-spin': submitting }" />
        </button>
      </div>
      <button
        v-else-if="isExtend || isSplit"
        type="button"
        class="canvas-extend-strip__ok"
        :disabled="submitting || (isSplit && !(duration > 0))"
        @click="onSubmit"
      >
        {{ submitting ? t('提交中…') : (isSplit ? t('确认分割') : t('确认续写')) }}
      </button>
      <button
        v-else
        type="button"
        class="canvas-extend-strip__ok"
        @click="cycleSegment"
      >
        {{ segmentLabel }}
      </button>
    </div>
  </Teleport>
</template>
