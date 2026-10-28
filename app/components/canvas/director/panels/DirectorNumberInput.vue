<script setup lang="ts">
/**
 * 面板里的数字输入框。
 *
 * 上游（open-director 的 InspectorControls.tsx，MIT）让父组件拿字符串当真值，
 * 绕开「边打字边解析」的问题。我们让父组件只管数字，字符串留在这里当草稿：
 * 聚焦期间输入框显示用户打的原文，失焦才按真值重排 —— 不然打 `-` 或 `1.`
 * 的瞬间会被解析成 NaN 或 1，输入的内容会被自己提交的值顶掉。
 */
import { computed, ref, watch } from 'vue'
import { clampFieldValue, formatFieldValue, precisionOfStep } from '~/utils/director/number-field'

const props = withDefaults(defineProps<{
  modelValue: number
  /**
   * 读屏标签。
   *
   * 不叫 ariaLabel：和原生 aria-label 同名的 prop，vue-tsc 会认成 HTML 属性，
   * 不往 prop 上匹配，模板里写 :aria-label 会报「缺少必填 prop」。
   */
  srLabel: string
  step?: number
  min?: number
  max?: number
  /** 显示时保留几位小数，默认按 step 推 */
  precision?: number
}>(), { step: 1 })

const emit = defineEmits<{
  'update:modelValue': [value: number]
  focus: []
  blur: []
}>()

const precision = computed(() => props.precision ?? precisionOfStep(props.step))

const draft = ref(formatFieldValue(props.modelValue, precision.value))
const editing = ref(false)

// 编辑期间不要拿外部值覆盖草稿，否则自己打的字会被自己提交的值顶掉
watch(() => props.modelValue, (value) => {
  if (!editing.value)
    draft.value = formatFieldValue(value, precision.value)
})

function onInput(event: Event) {
  const text = (event.target as HTMLInputElement).value
  draft.value = text
  if (!text.trim())
    return
  const parsed = Number(text)
  if (Number.isFinite(parsed))
    emit('update:modelValue', clampFieldValue(parsed, props.min, props.max))
}

function onFocus() {
  editing.value = true
  emit('focus')
}

function onBlur() {
  editing.value = false
  draft.value = formatFieldValue(props.modelValue, precision.value)
  emit('blur')
}
</script>

<template>
  <input
    :aria-label="srLabel"
    class="director-number"
    type="number"
    :value="draft"
    :step="step"
    :min="min"
    :max="max"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
  >
</template>
