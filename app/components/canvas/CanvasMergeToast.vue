<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { canvasMergeProgress } from '~/utils/canvas-merge-state'
import { fillI18n } from '~/utils/i18n-fill'

const { t } = useI18n()
const progress = canvasMergeProgress

const label = computed(() => {
  const current = progress.value
  if (!current)
    return ''
  if (current.phase === 'loading')
    return t('canvas.merge.loading')
  if (current.phase === 'reading') {
    const vars = { n: current.index || 1, total: current.total || 1 }
    return fillI18n(String(t('canvas.merge.reading', vars)), vars)
  }
  if (current.phase === 'uploading')
    return t('canvas.merge.uploading')
  return t('canvas.merge.encoding')
})

const percent = computed(() => Math.max(0, Math.min(100, Math.round(progress.value?.progress || 0))))
</script>

<template>
  <div v-if="progress" class="canvas-merge-toast" role="status">
    <UIcon name="i-lucide-loader-circle" class="size-4 canvas-merge-toast__spin" />
    <span>{{ label }}</span>
    <span class="canvas-merge-toast__pct">{{ percent }}%</span>
    <span class="canvas-merge-toast__bar" aria-hidden="true">
      <i :style="{ width: `${percent}%` }" />
    </span>
  </div>
</template>
