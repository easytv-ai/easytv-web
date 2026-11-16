<script setup lang="ts">
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

defineProps<{
  outputUrl: string
  title: string
  canvasHref: string
  canPublish: boolean
}>()

const emit = defineEmits<{
  publish: []
  restart: []
}>()
</script>

<template>
  <div class="create-card create-done">
    <video class="create-done__video" :src="resolveMediaUrl(outputUrl)" controls playsinline preload="metadata" />
    <h2>{{ title || t('一句话成片') }}</h2>
    <p class="create-hint">{{ t('成片已保存到资产库，可以直接发布为作品，或回到画布继续调整。') }}</p>
    <div class="create-done__actions">
      <button type="button" class="plan-btn plan-btn--solid" :disabled="!canPublish" @click="emit('publish')">{{ t('发布为作品') }}</button>
      <NuxtLink v-if="canvasHref" :to="canvasHref" class="plan-btn plan-btn--ghost">{{ t('在画布中打开') }}</NuxtLink>
      <button type="button" class="plan-btn plan-btn--ghost" @click="emit('restart')">{{ t('再做一条') }}</button>
    </div>
  </div>
</template>
