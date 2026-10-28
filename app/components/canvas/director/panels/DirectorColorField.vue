<script setup lang="ts">
/**
 * 颜色选择（复刻自 open-director 的 InspectorColorField，MIT）。
 *
 * 色板负责选，右边的文本框负责粘贴设计稿给的色值。文本框只在写成合法
 * 十六进制时才提交 —— 边打字边提交的话，刚输入 `#f` 就会把对象刷成黑色。
 */
import { ref, watch } from 'vue'
import { useUndoBatch } from '~/utils/director/use-undo-batch'

const props = defineProps<{
  label: string
  modelValue: string
  /** 读屏标签，命名理由见 DirectorNumberInput */
  srLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const HEX_PATTERN = /^#[0-9a-f]{6}$/i

const { begin, end } = useUndoBatch()

const draft = ref(props.modelValue)
const editing = ref(false)

watch(() => props.modelValue, (value) => {
  if (!editing.value)
    draft.value = value
})

function onHexInput(event: Event) {
  const text = (event.target as HTMLInputElement).value
  draft.value = text
  if (HEX_PATTERN.test(text))
    emit('update:modelValue', text.toLowerCase())
}

function onHexBlur() {
  editing.value = false
  // 半截色值不算数，失焦时退回真值
  draft.value = props.modelValue
  end()
}
</script>

<template>
  <div class="director-field director-field--color">
    <span class="director-field__label">{{ label }}</span>
    <div class="director-color-row">
      <input
        class="director-color__swatch"
        type="color"
        :aria-label="srLabel"
        :value="modelValue"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @focus="begin()"
        @blur="end()"
      >
      <input
        class="director-color__hex"
        type="text"
        :aria-label="`${srLabel} ${$t('色值')}`"
        :value="draft"
        spellcheck="false"
        @input="onHexInput"
        @focus="editing = true; begin()"
        @blur="onHexBlur"
      >
    </div>
  </div>
</template>
