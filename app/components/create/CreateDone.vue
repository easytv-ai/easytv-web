<script setup lang="ts">
import type { ComposeJob } from '~/types/creative'
import type { PackageEntry } from '~/utils/production-report'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

defineProps<{
  job: ComposeJob
  title: string
  canvasHref: string
  packageItems: PackageEntry[]
  showPackage: boolean
  canPublish: boolean
}>()

const emit = defineEmits<{
  publish: []
  restart: []
}>()
</script>

<template>
  <div class="create-card create-done">
    <video class="create-done__video" :src="resolveMediaUrl(job.output_url)" controls playsinline preload="metadata" />
    <h2>{{ title || t('一句话成片') }}</h2>
    <p class="create-hint">{{ t('成片已保存到资产库，可以直接发布为作品，或回到画布继续调整。') }}</p>
    <p v-if="job.qc" class="create-hint">{{ t('成片 {w}×{h} · {s} 秒', { w: job.qc.width, h: job.qc.height, s: job.qc.duration }) }}</p>
    <p v-if="job.warning" class="create-hint">{{ job.warning }}</p>
    <div v-if="showPackage" class="create-package">
      <h3>
        <UIcon name="i-lucide-package" class="size-4" />
        {{ t('交付包') }}
      </h3>
      <ul class="create-package__list">
        <li v-for="item in packageItems" :key="item.key">
          <span>{{ item.label }}</span>
          <a v-if="item.url" :href="resolveMediaUrl(item.url)" target="_blank" rel="noopener" download class="studio-chip">
            <UIcon name="i-lucide-download" class="size-3.5" />
            {{ t('下载') }}
          </a>
          <em v-else>{{ t('未生成') }}</em>
        </li>
      </ul>
      <p class="create-hint">{{ t('母版不含字幕、含对白混音；素材清单按镜头列出片段与配音，另一位剪辑师拿到就能替换一句台词重出字幕版。') }}</p>
    </div>
    <div class="create-done__actions">
      <button type="button" class="plan-btn plan-btn--solid" :disabled="!canPublish" @click="emit('publish')">{{ t('发布为作品') }}</button>
      <NuxtLink v-if="canvasHref" :to="canvasHref" class="plan-btn plan-btn--ghost">{{ t('在画布中打开') }}</NuxtLink>
      <button type="button" class="plan-btn plan-btn--ghost" @click="emit('restart')">{{ t('再做一条') }}</button>
    </div>
  </div>
</template>
