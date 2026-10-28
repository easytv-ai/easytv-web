<script setup lang="ts">
import type { Campaign } from '~/types/creative'
import { CAMPAIGN_ACTIVE, useCampaign } from '~/composables/useCampaign'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/** 活动中心列表（GET /campaign，API.md 8.6）：匿名可看 */
definePageMeta({
  layout: 'studio',
})

const localePath = useLocalePath()
const { list, loading, failed, loadList, statusLabel, prizeSummary, promoSummary, notStarted } = useCampaign()

// SSR 拉一次，list 是 useState，水合时直接复用 payload，不会闪一下空态
await useAsyncData('campaign-list-page', () => loadList(true))

useHead({
  title: t('活动中心'),
})
useSeoMeta({
  description: t('参加 EasyTV 创作活动，投稿作品冲榜领积分与会员'),
})

const running = computed(() => (list.value ?? []).filter(item => item.status === CAMPAIGN_ACTIVE))
const finished = computed(() => (list.value ?? []).filter(item => item.status !== CAMPAIGN_ACTIVE))
const empty = computed(() => !loading.value && !failed.value && (list.value?.length ?? 0) === 0)

function dayText(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtRange(item: Campaign) {
  const from = dayText(item.starts_at)
  const to = dayText(item.ends_at)
  if (from && to)
    return `${from} ~ ${to}`
  return from || to
}
</script>

<template>
  <section class="campaign-page">
    <header class="campaign-page__head">
      <h1>{{ t('活动中心') }}</h1>
      <p>{{ t('投稿参赛，按点赞榜排名领积分与会员天数') }}</p>
    </header>

    <div v-if="loading && !list" class="campaign-list">
      <article v-for="n in 2" :key="n" class="campaign-card campaign-card--skeleton">
        <USkeleton class="campaign-card__banner" />
        <div class="campaign-card__body">
          <USkeleton class="h-5 w-48" />
          <USkeleton class="mt-2 h-3.5 w-64" />
        </div>
      </article>
    </div>

    <StudioEmpty
      v-else-if="failed && !(list?.length)"
      :title="t('加载失败，请稍后重试')"
    >
      <button type="button" class="plan-btn plan-btn--solid campaign-empty__btn" @click="loadList(true)">{{ t('重试') }}</button>
    </StudioEmpty>

    <StudioEmpty
      v-else-if="empty"
      :title="t('暂无进行中的活动')"
      :description="t('新活动上线后会出现在这里，也可以先去创作台生成作品。')"
    >
      <NuxtLink :to="localePath('/create')" class="plan-btn plan-btn--solid campaign-empty__btn">{{ t('去创作') }}</NuxtLink>
    </StudioEmpty>

    <template v-else>
      <div v-if="running.length" class="campaign-list">
        <NuxtLink
          v-for="item in running"
          :key="item.id"
          :to="localePath(`/campaign/${item.slug}`)"
          class="campaign-card"
        >
          <div class="campaign-card__banner">
            <img v-if="item.banner_url" :src="resolveMediaUrl(item.banner_url)" :alt="item.title" loading="lazy">
            <span v-else class="campaign-card__banner-fallback"><UIcon name="i-lucide-trophy" class="size-8" /></span>
            <span class="campaign-badge" :class="notStarted(item) ? 'is-soon' : 'is-active'">{{ statusLabel(item) }}</span>
          </div>
          <div class="campaign-card__body">
            <div class="campaign-card__title">
              <h2>{{ item.title }}</h2>
              <span v-if="item.tag" class="campaign-tag">{{ item.tag }}</span>
            </div>
            <div class="campaign-card__meta">
              <CampaignCountdown :ends-at="item.ends_at" />
              <span><UIcon name="i-lucide-clapperboard" class="size-3.5" />{{ t('{n} 份投稿', { n: item.entries_count }) }}</span>
              <span v-if="prizeSummary(item.prizes)"><UIcon name="i-lucide-gift" class="size-3.5" />{{ prizeSummary(item.prizes) }}</span>
            </div>
            <p v-if="fmtRange(item)" class="campaign-card__range">{{ fmtRange(item) }}</p>
          </div>
          <span class="plan-btn plan-btn--solid campaign-card__cta">{{ t('投稿参赛') }}</span>
        </NuxtLink>
      </div>

      <template v-if="finished.length">
        <h2 class="campaign-section-title">{{ t('往期活动') }}</h2>
        <ul class="campaign-past">
          <li v-for="item in finished" :key="item.id">
            <NuxtLink :to="localePath(`/campaign/${item.slug}`)">
              <strong>{{ item.title }}</strong>
              <span v-if="item.tag" class="campaign-tag">{{ item.tag }}</span>
              <em>{{ fmtRange(item) }}</em>
              <span class="campaign-past__count">{{ t('{n} 份投稿', { n: item.entries_count }) }}</span>
              <span class="campaign-badge is-past">{{ statusLabel(item) }}</span>
            </NuxtLink>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
