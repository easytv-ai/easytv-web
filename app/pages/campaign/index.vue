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
const showSkeleton = computed(() => loading.value && !list.value)

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

function badgeClass(item: Campaign) {
  if (item.status !== CAMPAIGN_ACTIVE)
    return 'is-past'
  return notStarted(item) ? 'is-soon' : 'is-active'
}
</script>

<template>
  <section class="show-page campaign-page">
    <div class="show-page__inner">
      <header class="campaign-page__head">
        <h1>{{ t('活动中心') }}</h1>
        <p>{{ t('投稿参赛，按点赞榜排名领积分与会员天数') }}</p>
      </header>

      <div v-if="showSkeleton" class="campaign-board" aria-hidden="true">
        <article class="campaign-feature campaign-feature--skeleton">
          <USkeleton class="campaign-feature__media" />
        </article>
        <div class="campaign-archive">
          <article v-for="n in 3" :key="n" class="campaign-archive__card campaign-archive__card--skeleton">
            <USkeleton class="campaign-archive__media" />
            <div class="campaign-archive__copy">
              <USkeleton class="h-4 w-40" />
              <USkeleton class="mt-2 h-3 w-28" />
            </div>
          </article>
        </div>
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

      <div v-else class="campaign-board">
        <div v-if="running.length" class="campaign-live">
          <NuxtLink
            v-for="item in running"
            :key="item.id"
            :to="localePath(`/campaign/${item.slug}`)"
            class="campaign-feature"
          >
            <div class="campaign-feature__media">
              <img v-if="item.banner_url" :src="resolveMediaUrl(item.banner_url)" :alt="item.title" loading="lazy">
              <span v-else class="campaign-card__banner-fallback"><UIcon name="i-lucide-trophy" class="size-10" /></span>
            </div>
            <div class="campaign-feature__copy">
              <div class="campaign-feature__marks">
                <span class="campaign-badge" :class="badgeClass(item)">{{ statusLabel(item) }}</span>
                <span v-if="item.tag" class="campaign-tag">{{ item.tag }}</span>
              </div>
              <h2>{{ item.title }}</h2>
              <div class="campaign-feature__meta">
                <CampaignCountdown :ends-at="item.ends_at" />
                <span><UIcon name="i-lucide-clapperboard" class="size-3.5" />{{ t('{n} 份投稿', { n: item.entries_count }) }}</span>
                <span v-if="prizeSummary(item.prizes)"><UIcon name="i-lucide-gift" class="size-3.5" />{{ prizeSummary(item.prizes) }}</span>
                <span v-if="promoSummary(item)"><UIcon name="i-lucide-sparkles" class="size-3.5" />{{ promoSummary(item) }}</span>
              </div>
              <p v-if="fmtRange(item)" class="campaign-feature__range">{{ fmtRange(item) }}</p>
              <span class="plan-btn plan-btn--solid campaign-feature__cta">{{ t('投稿参赛') }}</span>
            </div>
          </NuxtLink>
        </div>

        <section v-if="finished.length" class="campaign-past-block">
          <h2 class="campaign-section-title">{{ t('往期活动') }}</h2>
          <div class="campaign-archive">
            <NuxtLink
              v-for="item in finished"
              :key="item.id"
              :to="localePath(`/campaign/${item.slug}`)"
              class="campaign-archive__card"
            >
              <div class="campaign-archive__media">
                <img v-if="item.banner_url" :src="resolveMediaUrl(item.banner_url)" :alt="item.title" loading="lazy">
                <span v-else class="campaign-card__banner-fallback"><UIcon name="i-lucide-trophy" class="size-7" /></span>
                <span class="campaign-badge is-past">{{ statusLabel(item) }}</span>
              </div>
              <div class="campaign-archive__copy">
                <h3>
                  {{ item.title }}
                  <span v-if="item.tag" class="campaign-tag">{{ item.tag }}</span>
                </h3>
                <p v-if="fmtRange(item)">{{ fmtRange(item) }}</p>
                <span>{{ t('{n} 份投稿', { n: item.entries_count }) }}</span>
              </div>
            </NuxtLink>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
