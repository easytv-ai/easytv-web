<script setup lang="ts">
/**
 * 文本输入（复刻自 open-director 的 InspectorTextField，MIT）。
 * 聚焦到失焦之间的连续输入合成一步撤销，不然改个名字要撤十几下。
 */
import { useUndoBatch } from '~/utils/director/use-undo-batch'

defineProps<{
  label: string
  modelValue: string
  /** 读屏标签，命名理由见 DirectorNumberInput */
  srLabel: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { begin, end } = useUndoBatch()
</script>

<template>
  <label class="director-field">
    <span class="director-field__label">{{ label }}</span>
    <input
      class="director-text"
      type="text"
      :aria-label="srLabel"
      :value="modelValue"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="begin()"
      @blur="end()"
    >
  </label>
</template>
