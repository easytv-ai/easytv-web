<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  mode: 'smart' | 'box'
  cost?: number
  box?: { left: number, top: number, width: number, height: number } | null
}>(), {
  cost: 0,
  box: null,
})

const emit = defineEmits<{
  close: []
  submit: [regions: Array<{ x: number, y: number, w: number, h: number }>]
}>()

type EraseBox = { id: string, x: number, y: number, w: number, h: number }
type EraseHandle = 'nw' | 'ne' | 'se' | 'sw'

const HANDLES: EraseHandle[] = ['nw', 'ne', 'se', 'sw']
const HANDLE_CURSORS: Record<EraseHandle, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  se: 'nwse-resize',
  sw: 'nesw-resize',
}

const MIN = 0.04
const regions = ref<EraseBox[]>([])
const history = ref<EraseBox[][]>([[]])
const historyAt = ref(0)
const activeId = ref('')
const stageRef = ref<HTMLElement | null>(null)

let drag: {
  kind: 'draw' | 'move' | 'resize'
  handle?: EraseHandle
  id?: string
  start: { x: number, y: number }
  origin?: EraseBox
  draftId?: string
} | null = null

const isBox = computed(() => props.mode === 'box')
const title = computed(() => isBox.value ? t('框选擦除') : t('智能擦除'))
const canUndo = computed(() => historyAt.value > 0)
const canRedo = computed(() => historyAt.value < history.value.length - 1)
const canReset = computed(() => regions.value.length > 0)

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

const barStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  return {
    left: `${box.left + box.width / 2}px`,
    top: `${box.top + box.height + 16}px`,
  }
})

function uid() {
  return `erase-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function clampBox(next: Omit<EraseBox, 'id'> & { id?: string }): EraseBox {
  const w = Math.min(1, Math.max(MIN, next.w))
  const h = Math.min(1, Math.max(MIN, next.h))
  return {
    id: next.id || uid(),
    x: Math.min(1 - w, Math.max(0, next.x)),
    y: Math.min(1 - h, Math.max(0, next.y)),
    w,
    h,
  }
}

function boxStyle(item: EraseBox) {
  return {
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: `${item.w * 100}%`,
    height: `${item.h * 100}%`,
  }
}

function rel(event: PointerEvent) {
  const el = stageRef.value
  if (!el)
    return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / w)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / h)),
  }
}

function pushHistory(next: EraseBox[]) {
  const snap = next.map(item => ({ ...item }))
  history.value = history.value.slice(0, historyAt.value + 1)
  history.value.push(snap)
  historyAt.value = history.value.length - 1
  regions.value = snap
}

function undo() {
  if (!canUndo.value)
    return
  historyAt.value -= 1
  const snap = history.value[historyAt.value]
  if (!snap)
    return
  regions.value = snap.map(item => ({ ...item }))
}

function redo() {
  if (!canRedo.value)
    return
  historyAt.value += 1
  const snap = history.value[historyAt.value]
  if (!snap)
    return
  regions.value = snap.map(item => ({ ...item }))
}

function reset() {
  if (!canReset.value)
    return
  pushHistory([])
  activeId.value = ''
}

function onStageDown(event: PointerEvent) {
  if (!isBox.value || event.button !== 0)
    return
  const point = rel(event)
  const draftId = uid()
  drag = {
    kind: 'draw',
    start: point,
    draftId,
  }
  regions.value = [
    ...regions.value,
    { id: draftId, x: point.x, y: point.y, w: MIN, h: MIN },
  ]
  activeId.value = draftId
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function onMoveDown(event: PointerEvent, item: EraseBox) {
  if (!isBox.value || event.button !== 0)
    return
  event.stopPropagation()
  drag = {
    kind: 'move',
    id: item.id,
    start: rel(event),
    origin: { ...item },
  }
  activeId.value = item.id
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function onHandleDown(event: PointerEvent, item: EraseBox, handle: EraseHandle) {
  if (!isBox.value || event.button !== 0)
    return
  event.stopPropagation()
  drag = {
    kind: 'resize',
    handle,
    id: item.id,
    start: rel(event),
    origin: { ...item },
  }
  activeId.value = item.id
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragUp)
  window.addEventListener('pointercancel', onDragUp)
}

function onDragMove(event: PointerEvent) {
  if (!drag)
    return
  const point = rel(event)
  if (drag.kind === 'draw' && drag.draftId) {
    const x1 = Math.min(drag.start.x, point.x)
    const y1 = Math.min(drag.start.y, point.y)
    const x2 = Math.max(drag.start.x, point.x)
    const y2 = Math.max(drag.start.y, point.y)
    const next = clampBox({
      id: drag.draftId,
      x: x1,
      y: y1,
      w: Math.max(MIN, x2 - x1),
      h: Math.max(MIN, y2 - y1),
    })
    regions.value = regions.value.map(item => item.id === drag!.draftId ? next : item)
    return
  }
  if (!drag.origin || !drag.id)
    return
  const dx = point.x - drag.start.x
  const dy = point.y - drag.start.y
  if (drag.kind === 'move') {
    const next = clampBox({
      ...drag.origin,
      x: drag.origin.x + dx,
      y: drag.origin.y + dy,
    })
    regions.value = regions.value.map(item => item.id === drag!.id ? next : item)
    return
  }
  if (drag.kind === 'resize' && drag.handle) {
    let { x, y, w, h } = drag.origin
    const right = x + w
    const bottom = y + h
    if (drag.handle.includes('w')) {
      x = Math.min(right - MIN, Math.max(0, drag.origin.x + dx))
      w = right - x
    }
    if (drag.handle.includes('e'))
      w = Math.min(1 - x, Math.max(MIN, drag.origin.w + dx))
    if (drag.handle.includes('n')) {
      y = Math.min(bottom - MIN, Math.max(0, drag.origin.y + dy))
      h = bottom - y
    }
    if (drag.handle.includes('s'))
      h = Math.min(1 - y, Math.max(MIN, drag.origin.h + dy))
    const next = clampBox({ id: drag.id, x, y, w, h })
    regions.value = regions.value.map(item => item.id === drag!.id ? next : item)
  }
}

function onDragUp() {
  if (!drag) {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragUp)
    window.removeEventListener('pointercancel', onDragUp)
    return
  }
  const wasDraw = drag.kind === 'draw'
  const draftId = drag.draftId
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragUp)
  window.removeEventListener('pointercancel', onDragUp)
  if (wasDraw && draftId) {
    const item = regions.value.find(r => r.id === draftId)
    if (!item || item.w < MIN * 1.5 || item.h < MIN * 1.5) {
      regions.value = regions.value.filter(r => r.id !== draftId)
      return
    }
  }
  pushHistory(regions.value)
}

function onSubmit() {
  emit('submit', regions.value.map(({ x, y, w, h }) => ({ x, y, w, h })))
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey)
      redo()
    else
      undo()
  }
}

watch(() => props.open, (on) => {
  if (!on) {
    regions.value = []
    history.value = [[]]
    historyAt.value = 0
    activeId.value = ''
    onDragUp()
    return
  }
  regions.value = []
  history.value = [[]]
  historyAt.value = 0
})

watch(() => props.mode, () => {
  regions.value = []
  history.value = [[]]
  historyAt.value = 0
})

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  onDragUp()
})
</script>

<template>
  <Teleport to="body">
    <template v-if="open && layerStyle && barStyle">
      <div
        v-if="isBox"
        class="canvas-erase-layer nodrag nopan"
        :style="layerStyle"
      >
        <div
          ref="stageRef"
          class="canvas-erase__stage"
          @pointerdown="onStageDown"
        >
          <div
            v-for="item in regions"
            :key="item.id"
            class="canvas-erase__box"
            :class="{ 'is-on': item.id === activeId }"
            :style="boxStyle(item)"
            @pointerdown.stop="onMoveDown($event, item)"
          >
            <i
              v-for="handle in HANDLES"
              :key="handle"
              class="canvas-erase__handle"
              :class="`is-${handle}`"
              :style="{ cursor: HANDLE_CURSORS[handle] }"
              @pointerdown.stop="onHandleDown($event, item, handle)"
            />
          </div>
        </div>
      </div>

      <div
        class="canvas-erase-bar nodrag nopan nowheel"
        :class="{ 'is-box': isBox }"
        :style="barStyle"
        @pointerdown.stop
      >
        <button type="button" class="canvas-erase__x" :aria-label="t('关闭')" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-4" />
          <span class="canvas-tip canvas-tip--up">{{ t('关闭') }}</span>
        </button>
        <span class="canvas-erase__split" />
        <span class="canvas-erase__title">
          {{ title }}
          <button
            v-if="isBox"
            type="button"
            class="canvas-erase__info"
            :aria-label="t('使用方法')"
          >
            <UIcon name="i-lucide-circle-help" class="size-3.5" />
            <span class="canvas-tip canvas-tip--up canvas-erase__help-tip">
              <strong>{{ t('使用方法') }}</strong>
              <ul>
                <li>{{ t('在画面上拖拽鼠标，框选要擦除的区域') }}</li>
                <li>{{ t('支持框选多个区域，所有框内文字将被擦除') }}</li>
                <li>{{ t('擦除作用于整段视频，不仅是当前帧') }}</li>
              </ul>
            </span>
          </button>
        </span>

        <template v-if="isBox">
          <span class="canvas-erase__split" />
          <button type="button" class="canvas-erase__tool is-on" :aria-label="t('框选')">
            <UIcon name="i-lucide-square-dashed" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('框选') }}</span>
          </button>
          <button
            type="button"
            class="canvas-erase__tool"
            :disabled="!canUndo"
            :aria-label="t('撤销')"
            @click="undo"
          >
            <UIcon name="i-lucide-undo-2" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('撤销') }}</span>
          </button>
          <button
            type="button"
            class="canvas-erase__tool"
            :disabled="!canRedo"
            :aria-label="t('重做')"
            @click="redo"
          >
            <UIcon name="i-lucide-redo-2" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('重做') }}</span>
          </button>
          <button
            type="button"
            class="canvas-erase__tool"
            :disabled="!canReset"
            :aria-label="t('重置')"
            @click="reset"
          >
            <UIcon name="i-lucide-rotate-ccw" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('重置') }}</span>
          </button>
        </template>

        <span class="canvas-erase__cost" :aria-label="t('积分')">
          <UIcon name="i-lucide-zap" class="size-3.5" />
          {{ cost }}
        </span>
        <button
          type="button"
          class="canvas-erase__send"
          :aria-label="t('生成')"
          :disabled="isBox && !regions.length"
          @click="onSubmit"
        >
          <UIcon name="i-lucide-arrow-up" class="size-4" />
          <span class="canvas-tip canvas-tip--up">{{ t('生成') }}</span>
        </button>
      </div>
    </template>
  </Teleport>
</template>
