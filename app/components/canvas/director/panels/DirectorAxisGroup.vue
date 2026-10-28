<script setup lang="ts">
/**
 * X / Y / Z 三轴输入（复刻自 open-director 的 InspectorAxisGroup，MIT）。
 *
 * 轴名本身是个拖动把手：按住 X 左右拖就能调数值，不用瞄准小输入框。
 * 一次拖动只占一步撤销 —— 拖的过程会提交几十次，不合批的话撤销键要按到手酸。
 */
import { ref } from 'vue'
import { useUndoBatch } from '~/utils/director/use-undo-batch'
import { valueAfterDrag } from '~/utils/director/number-field'
import { startPointerDrag } from '~/utils/director/pointer-drag'
import DirectorNumberInput from './DirectorNumberInput.vue'

const props = withDefaults(defineProps<{
  label: string
  /** 三个轴的当前值 */
  modelValue: [number, number, number]
  /** 读屏标签前缀，读屏会念成「位置 X」；命名理由见 DirectorNumberInput */
  srPrefix: string
  step?: number
  min?: number
  max?: number
}>(), { step: 0.1 })

const emit = defineEmits<{
  'update:modelValue': [value: [number, number, number]]
}>()

const AXES = ['X', 'Y', 'Z'] as const

const { t } = useI18n()
const { begin, end } = useUndoBatch()

/** 正在拖的轴下标，用来给把手加高亮 */
const draggingAxis = ref<number | null>(null)

function setAxis(index: number, value: number) {
  const next: [number, number, number] = [...props.modelValue]
  next[index] = value
  emit('update:modelValue', next)
}

function onHandleDown(event: PointerEvent, index: number) {
  // 只认左键；右键要留给上下文菜单
  if (event.button !== 0)
    return

  event.preventDefault()

  const startX = event.clientX
  const startValue = props.modelValue[index] ?? 0
  draggingAxis.value = index
  begin()

  startPointerDrag({
    target: event.currentTarget as HTMLButtonElement,
    pointerId: event.pointerId,
    fallback: window,
    handlers: {
      onMove: (moveEvent) => {
        setAxis(index, valueAfterDrag({
          startValue,
          deltaPixels: moveEvent.clientX - startX,
          step: props.step,
          min: props.min,
          max: props.max,
        }))
      },
      onEnd: () => {
        draggingAxis.value = null
        end()
      },
    },
  })
}

/** 把手聚焦时方向键也能调，拖动对键盘用户不可用 */
function onHandleKey(event: KeyboardEvent, index: number) {
  const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
  if (!direction)
    return
  event.preventDefault()
  setAxis(index, valueAfterDrag({
    startValue: props.modelValue[index] ?? 0,
    deltaPixels: direction * 10,
    step: props.step,
    min: props.min,
    max: props.max,
  }))
}
</script>

<template>
  <div class="director-field director-field--axis" role="group" :aria-label="label">
    <span class="director-field__label">{{ label }}</span>
    <div class="director-axis-row">
      <div
        v-for="(axis, index) in AXES"
        :key="axis"
        class="director-axis"
        :class="{ 'is-dragging': draggingAxis === index }"
      >
        <button
          type="button"
          class="director-axis__handle"
          :aria-label="`${srPrefix} ${axis} ${t('拖动调整')}`"
          @pointerdown="onHandleDown($event, index)"
          @keydown="onHandleKey($event, index)"
        >
          {{ axis }}
        </button>
        <DirectorNumberInput
          :model-value="modelValue[index] ?? 0"
          :sr-label="`${srPrefix} ${axis}`"
          :step="step"
          :min="min"
          :max="max"
          @update:model-value="setAxis(index, $event)"
          @focus="begin()"
          @blur="end()"
        />
      </div>
    </div>
  </div>
</template>
