<script setup lang="ts">
/** 开关项（对应 open-director 的 inspector-toggle-row，MIT） */
import { useUndoBatch } from '~/utils/director/use-undo-batch'

defineProps<{
  label: string
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { begin, end } = useUndoBatch()

function onChange(event: Event) {
  // 勾一下就是一步，开批次只是为了和别的控件走同一条路径
  begin()
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
  end()
}
</script>

<template>
  <label class="director-toggle">
    <input type="checkbox" :aria-label="label" :checked="modelValue" @change="onChange">
    <span>{{ label }}</span>
  </label>
</template>
