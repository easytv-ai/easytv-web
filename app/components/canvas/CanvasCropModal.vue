<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  variant?: 'image' | 'video'
  box?: { left: number, top: number, width: number, height: number } | null
}>(), {
  variant: 'image',
  box: null,
})

const emit = defineEmits<{
  close: []
  confirm: [box: { x: number, y: number, w: number, h: number, rect: { x: number, y: number, w: number, h: number } }]
}>()

type CropRatio = 'original' | 'free' | '1:1' | '2:3' | '3:4' | '16:9' | '9:16' | '3:2'
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type CropBox = { x: number, y: number, w: number, h: number }

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_CURSORS: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

const RATIO_ITEMS: { id: CropRatio, label: string, icon: string }[] = [
  { id: 'original', label: '原始比例', icon: 'i-lucide-crop' },
  { id: 'free', label: '自定义', icon: 'i-lucide-square-dashed' },
  { id: '1:1', label: '1:1', icon: 'i-lucide-square' },
  { id: '2:3', label: '2:3', icon: 'i-lucide-rectangle-vertical' },
  { id: '3:4', label: '3:4', icon: 'i-lucide-smartphone' },
  { id: '16:9', label: '16:9', icon: 'i-lucide-rectangle-horizontal' },
  { id: '9:16', label: '9:16', icon: 'i-lucide-smartphone' },
  { id: '3:2', label: '3:2', icon: 'i-lucide-monitor' },
]

const MIN = 0.08
const ratio = ref<CropRatio>('original')
const ratioOpen = ref(false)
const crop = ref<CropBox>({ x: 0.12, y: 0.12, w: 0.76, h: 0.76 })
const natural = reactive({ w: 0, h: 0 })
const stageRef = ref<HTMLElement | null>(null)

let drag: { handle: CropHandle | 'move', start: { x: number, y: number }, box: CropBox } | null = null

const layerStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
})

const cropStyle = computed(() => ({
  left: `${crop.value.x * 100}%`,
  top: `${crop.value.y * 100}%`,
  width: `${crop.value.w * 100}%`,
  height: `${crop.value.h * 100}%`,
}))

const isVideo = computed(() => props.variant === 'video')

const naturalW = computed(() => natural.w || props.box?.width || 0)
const naturalH = computed(() => natural.h || props.box?.height || 0)

const cropPxLabel = computed(() => {
  const w = Math.max(1, Math.round(crop.value.w * (naturalW.value || 1)))
  const h = Math.max(1, Math.round(crop.value.h * (naturalH.value || 1)))
  return `${w} × ${h}`
})

const toolsStyle = computed(() => {
  const box = props.box
  if (!box || !isVideo.value)
    return null
  return {
    left: `${box.left + box.width / 2}px`,
    top: `${box.top + box.height + 16}px`,
  }
})

const ratioLabel = computed(() => t(RATIO_ITEMS.find(item => item.id === ratio.value)?.label || '原始比例'))

function clampBox(next: CropBox): CropBox {
  const w = Math.min(1, Math.max(MIN, next.w))
  const h = Math.min(1, Math.max(MIN, next.h))
  return {
    x: Math.min(1 - w, Math.max(0, next.x)),
    y: Math.min(1 - h, Math.max(0, next.y)),
    w,
    h,
  }
}

function pixelRatioOf(id: CropRatio): number | null {
  if (id === 'free')
    return null
  if (id === 'original') {
    if (!natural.w || !natural.h)
      return null
    return natural.w / natural.h
  }
  const [a, b] = id.split(':').map(Number)
  if (!a || !b)
    return null
  return a / b
}

/** 归一化框的宽/高，使像素比例等于目标比例 */
function normK(id: CropRatio): number | null {
  const r = pixelRatioOf(id)
  if (r == null)
    return null
  const ow = props.box?.width || 1
  const oh = props.box?.height || 1
  return r * oh / ow
}

function fitRatio(id: CropRatio, inset = 0.12): CropBox {
  const k = normK(id)
  if (k == null)
    return { x: inset, y: inset, w: 1 - inset * 2, h: 1 - inset * 2 }
  let w: number
  let h: number
  if (k >= 1) {
    w = 1
    h = 1 / k
  }
  else {
    h = 1
    w = k
  }
  const scale = 1 - inset * 2
  w *= scale
  h *= scale
  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    w,
    h,
  }
}

function applyRatio(id: CropRatio) {
  ratio.value = id
  ratioOpen.value = false
  crop.value = clampBox(fitRatio(id))
}

function rel(event: PointerEvent) {
  const el = stageRef.value
  if (!el)
    return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  const w = r.width || 1
  const h = r.height || 1
  return {
    x: Math.min(1, Math.max(0, (event.clientX - r.left) / w)),
    y: Math.min(1, Math.max(0, (event.clientY - r.top) / h)),
  }
}

function keepRatio(next: CropBox, start: CropBox, k: number, handle: CropHandle): CropBox {
  let { x, y, w, h } = next
  const right = start.x + start.w
  const bottom = start.y + start.h
  const cx = start.x + start.w / 2
  const cy = start.y + start.h / 2
  if (handle === 'e' || handle === 'w') {
    w = Math.max(MIN, w)
    h = w / k
    y = cy - h / 2
    if (handle === 'w')
      x = right - w
  }
  else if (handle === 'n' || handle === 's') {
    h = Math.max(MIN, h)
    w = h * k
    x = cx - w / 2
    if (handle === 'n')
      y = bottom - h
  }
  else {
    if (Math.abs(w - start.w) >= Math.abs(h - start.h))
      h = w / k
    else
      w = h * k
    if (handle === 'nw' || handle === 'sw')
      x = right - w
    if (handle === 'nw' || handle === 'ne')
      y = bottom - h
  }
  return { x, y, w, h }
}

function onMoveDown(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  ratioOpen.value = false
  drag = { handle: 'move', start: rel(event), box: { ...crop.value } }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function onHandleDown(event: PointerEvent, handle: CropHandle) {
  event.preventDefault()
  event.stopPropagation()
  ratioOpen.value = false
  drag = { handle, start: rel(event), box: { ...crop.value } }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function onDragMove(event: PointerEvent) {
  if (!drag)
    return
  const p = rel(event)
  const dx = p.x - drag.start.x
  const dy = p.y - drag.start.y
  const start = drag.box
  if (drag.handle === 'move') {
    crop.value = clampBox({ ...start, x: start.x + dx, y: start.y + dy })
    return
  }
  const handle = drag.handle
  let x = start.x
  let y = start.y
  let w = start.w
  let h = start.h
  if (handle === 'w' || handle === 'nw' || handle === 'sw') {
    x = start.x + dx
    w = start.w - dx
  }
  if (handle === 'e' || handle === 'ne' || handle === 'se')
    w = start.w + dx
  if (handle === 'n' || handle === 'nw' || handle === 'ne') {
    y = start.y + dy
    h = start.h - dy
  }
  if (handle === 's' || handle === 'sw' || handle === 'se')
    h = start.h + dy
  if (w < MIN) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw')
      x = start.x + start.w - MIN
    w = MIN
  }
  if (h < MIN) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne')
      y = start.y + start.h - MIN
    h = MIN
  }
  const k = normK(ratio.value)
  let next = { x, y, w, h }
  if (k != null)
    next = keepRatio(next, start, k, handle)
  crop.value = clampBox(next)
}

function onDragUp() {
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  window.removeEventListener('pointercancel', onDragUp)
}

function onProbeLoad(event: Event) {
  const img = event.target as HTMLImageElement
  natural.w = img.naturalWidth
  natural.h = img.naturalHeight
  if (ratio.value === 'original')
    crop.value = clampBox(fitRatio('original'))
}

function onProbeVideo(event: Event) {
  const video = event.target as HTMLVideoElement
  natural.w = video.videoWidth
  natural.h = video.videoHeight
  if (ratio.value === 'original')
    crop.value = clampBox(fitRatio('original'))
}

function confirm() {
  const nw = naturalW.value
  const nh = naturalH.value
  if (!nw || !nh)
    return
  emit('confirm', {
    x: crop.value.x * nw,
    y: crop.value.y * nh,
    w: Math.max(8, crop.value.w * nw),
    h: Math.max(8, crop.value.h * nh),
    rect: { ...crop.value },
  })
}

function onDocPointer(event: PointerEvent) {
  if (!ratioOpen.value)
    return
  const el = event.target as HTMLElement | null
  if (el?.closest('.canvas-crop__ratio'))
    return
  ratioOpen.value = false
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    if (ratioOpen.value) {
      ratioOpen.value = false
      return
    }
    emit('close')
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    confirm()
  }
}

watch(() => props.open, (on) => {
  if (!on) {
    ratioOpen.value = false
    natural.w = 0
    natural.h = 0
    onDragUp()
    return
  }
  ratio.value = 'original'
  crop.value = clampBox(fitRatio('original'))
}, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onDocPointer, true)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onDocPointer, true)
  onDragUp()
})
</script>

<template>
  <Teleport to="body">
    <template v-if="open && layerStyle">
      <video
        v-if="isVideo"
        :src="src"
        muted
        playsinline
        preload="metadata"
        class="canvas-smart__probe"
        @loadedmetadata="onProbeVideo"
      />
      <img
        v-else
        :src="src"
        alt=""
        class="canvas-smart__probe"
        @load="onProbeLoad"
      >
      <div class="canvas-crop-layer nodrag nopan" :class="{ 'is-video': isVideo }" :style="layerStyle">
        <div ref="stageRef" class="canvas-crop__stage" @pointerdown="ratioOpen = false">
          <div
            class="canvas-crop__box"
            :class="{ 'is-grid': isVideo }"
            :style="cropStyle"
            @pointerdown.stop="onMoveDown"
          >
            <span v-if="isVideo" class="canvas-crop__px">{{ cropPxLabel }}</span>
            <i
              v-for="handle in HANDLES"
              :key="handle"
              class="canvas-crop__handle"
              :class="`is-${handle}`"
              :style="{ cursor: HANDLE_CURSORS[handle] }"
              @pointerdown.stop="onHandleDown($event, handle)"
            />
          </div>
        </div>
        <div
          v-if="!isVideo"
          class="canvas-crop__tools nodrag nopan nowheel"
          @pointerdown.stop
        >
          <button type="button" class="canvas-crop__close" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-3.5" />
            <span>{{ t('裁剪') }}</span>
          </button>
          <span class="canvas-smart__split" />
          <div class="canvas-crop__ratio">
            <button type="button" :class="{ 'is-on': ratioOpen }" @click="ratioOpen = !ratioOpen">
              <UIcon name="i-lucide-crop" class="size-3.5" />
              <span>{{ ratioLabel }}</span>
              <UIcon name="i-lucide-chevron-down" class="size-3.5" />
            </button>
            <div v-if="ratioOpen" class="canvas-crop__ratios">
              <button
                v-for="item in RATIO_ITEMS"
                :key="item.id"
                type="button"
                :class="{ 'is-on': ratio === item.id }"
                @click="applyRatio(item.id)"
              >
                <UIcon :name="item.icon" class="size-4" />
                <span>{{ t(item.label) }}</span>
              </button>
            </div>
          </div>
          <button type="button" class="canvas-crop__ok" @click="confirm">
            {{ t('确定') }}
          </button>
        </div>
      </div>
      <div
        v-if="isVideo && toolsStyle"
        class="canvas-crop__bar nodrag nopan nowheel"
        :style="toolsStyle"
        @pointerdown.stop
      >
        <button type="button" class="canvas-crop__bar-x" :aria-label="t('取消')" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <span class="canvas-crop__bar-size">{{ cropPxLabel }}</span>
        <button type="button" class="canvas-crop__bar-ok" :aria-label="t('确定')" @click="confirm">
          <UIcon name="i-lucide-check" class="size-4" />
        </button>
      </div>
    </template>
  </Teleport>
</template>
