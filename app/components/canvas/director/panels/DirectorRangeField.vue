<script setup lang="ts">
/**
 * 滑块 + 数字框（复刻自 open-director 的 InspectorRangeNumberField，MIT）。
 *
 * 两个控件共用一个值：滑块用来大致找位置，数字框用来敲准确值。
 * 一次拖动合成一步撤销，理由同 DirectorAxisGroup。
 */
import { useUndoBatch } from '~/utils/director/use-undo-batch'
import { clampFieldValue } from '~/utils/director/number-field'
import DirectorNumberInput from './DirectorNumberInput.vue'

const props = withDefaults(defineProps<{
  label: string
  modelValue: number
  /** 读屏标签，命名理由见 DirectorNumberInput */
  srLabel: string
  min: number
  max: number
  step?: number
  /** 数字框右边的单位，比如 ° 或 mm */
  suffix?: string
}>(), { step: 1 })

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const { begin, end } = useUndoBatch()

function onRangeInput(event: Event) {
  const parsed = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(parsed))
    emit('update:modelValue', clampFieldValue(parsed, props.min, props.max))
}
</script>

<template>
  <div class="director-field director-field--range">
    <span class="director-field__label">{{ label }}</span>
    <div class="director-range-row">
      <input
        class="director-range"
        type="range"
        :aria-label="srLabel"
        :value="modelValue"
        :min="min"
        :max="max"
        :step="step"
        @input="onRangeInput"
        @pointerdown="begin()"
        @pointerup="end()"
        @pointercancel="end()"
        @keydown="begin()"
        @blur="end()"
      >
      <DirectorNumberInput
        class="director-range__value"
        :model-value="modelValue"
        :sr-label="srLabel"
        :min="min"
        :max="max"
        :step="step"
        @update:model-value="emit('update:modelValue', $event)"
        @focus="begin()"
        @blur="end()"
      />
      <span v-if="suffix" class="director-range__suffix">{{ suffix }}</span>
    </div>
  </div>
</template>
