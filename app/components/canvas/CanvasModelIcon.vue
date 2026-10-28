<script setup lang="ts">
import { fetchLobeInlineSvg, isExternalIconUrl } from '~/utils/lobe-icon'

const props = withDefaults(defineProps<{
  icon?: string | null
  fallback?: string
}>(), {
  icon: '',
  fallback: '',
})

const loadFailed = ref(false)
const svgHtml = ref('')

const trimmedIcon = computed(() => props.icon?.trim() ?? '')
const externalIconUrl = computed(() =>
  isExternalIconUrl(trimmedIcon.value) ? trimmedIcon.value : '',
)

const letter = computed(() => {
  const mark = props.fallback?.trim()
  if (mark)
    return mark.slice(0, 1).toUpperCase()
  const base = trimmedIcon.value.split('.')[0] || '?'
  return (base[0] || '?').toUpperCase()
})

const showLetter = computed(() => loadFailed.value || (!externalIconUrl.value && !svgHtml.value))

async function loadIcon() {
  loadFailed.value = false
  svgHtml.value = ''
  if (!trimmedIcon.value) {
    loadFailed.value = true
    return
  }
  if (externalIconUrl.value)
    return
  const html = await fetchLobeInlineSvg(trimmedIcon.value)
  if (html) {
    svgHtml.value = html
    return
  }
  loadFailed.value = true
}

function onExternalIconError() {
  loadFailed.value = true
}

watch(() => props.icon, () => {
  void loadIcon()
}, { immediate: true })
</script>

<template>
  <span class="canvas-chat__model-logo" :class="{ 'is-mark': showLetter, 'is-svg': svgHtml && !showLetter }">
    <img
      v-if="externalIconUrl && !showLetter"
      :src="externalIconUrl"
      alt=""
      @error="onExternalIconError"
    >
    <span v-else-if="svgHtml && !showLetter" class="canvas-chat__model-logo-svg" v-html="svgHtml" />
    <template v-else>{{ letter }}</template>
  </span>
</template>
