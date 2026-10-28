<script setup lang="ts">
const { t } = useI18n()

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  back: []
  close: []
}>()
</script>

<template>
  <div v-if="open" class="canvas-mark-bar" role="status">
    <span class="canvas-mark-bar__icon">
      <UIcon name="i-lucide-sparkles" class="size-4" />
    </span>
    <span class="canvas-mark-bar__copy">
      <strong>{{ t('元素选择模式') }}</strong>
      <small>{{ t('canvas.mark.pickHint') }}</small>
    </span>
    <button type="button" class="canvas-mark-bar__back" @click="emit('back')">
      {{ t('返回节点') }}
    </button>
    <button type="button" class="canvas-mark-bar__x" :aria-label="t('关闭')" @click="emit('close')">
      <UIcon name="i-lucide-x" class="size-4" />
    </button>
  </div>
</template>
