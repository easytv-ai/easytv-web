<script setup lang="ts">
import campaignApi, { type CampaignEntrySort } from '~/api/campaign'
import type { CampaignEntry } from '~/types/creative'
import { CAMPAIGN_ACTIVE, CAMPAIGN_SETTLED, useCampaign } from '~/composables/useCampaign'
import { useTrack } from '~/composables/useTrack'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/** 活动详情 + 投稿墙（GET /campaign/:slug，API.md 8.6）：匿名可看，投稿前 requireLogin */
definePageMeta({
  layout: 'studio',
})

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { isLoggedIn, requireLogin } = useRequireLogin()
const { track } = useTrack()
const { statusLabel, notStarted, prizeRank, prizeReward, promoItems, entryStatusLabel } = useCampaign()

const slug = computed(() => String(Array.isArray(route.params.slug) ? route.params.slug[0] : route.params.slug || ''))

const { data: detail, refresh: refreshDetail } = await useAsyncData(
  () => `campaign-${slug.value}`,
  async () => {
    if (!slug.value)
      return null
    const res = await campaignApi.detail(slug.value)
    return res?.success && res.data ? res.data : null
  },
  { watch: [slug] },
)

const settled = computed(() => detail.value?.status === CAMPAIGN_SETTLED)
const canEnter = computed(() => !!detail.value && detail.value.status === CAMPAIGN_ACTIVE && !notStarted(detail.value))
const myEntry = computed(() => detail.value?.my_entry ?? null)
const promos = computed(() => promoItems(detail.value))

/** 投稿墙排序：进行中默认最热，已发奖默认名次 */
const sort = ref<CampaignEntrySort>(settled.value ? 'rank' : 'likes')
const sortOptions = computed(() => {
  const list: { value: CampaignEntrySort, label: string }[] = [
    { value: 'likes', label: t('最热') },
    { value: 'new', label: t('最新') },
  ]
  if (settled.value)
    list.unshift({ value: 'rank', label: t('名次') })
  return list
})

const {
  items: entries,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload: reloadEntries,
  loadMore,
} = useStudioPaged<CampaignEntry>({
  pageSize: 24,
  async fetch(page, pageSize) {
    if (!slug.value)
      return null
    const res = await campaignApi.entries(slug.value, { sort: sort.value, page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

const config = useRuntimeConfig()
const siteUrl = String(config.public.siteUrl || '').replace(/\/$/, '')
function absolute(url: string) {
  const resolved = resolveMediaUrl(url)
  return /^https?:/i.test(resolved) ? resolved : `${siteUrl}${resolved}`
}

useHead({
  title: computed(() => detail.value?.title || t('活动中心')),
})
useSeoMeta({
  description: computed(() => (detail.value?.rules || '').slice(0, 140) || t('参加 EasyTV 创作活动，投稿作品冲榜领积分与会员')),
  ogTitle: computed(() => detail.value?.title || t('活动中心')),
  ogImage: computed(() => detail.value?.banner_url ? absolute(detail.value.banner_url) : `${siteUrl}/images/og-image.png`),
  ogUrl: computed(() => detail.value ? `${siteUrl}/campaign/${detail.value.slug}` : siteUrl),
  twitterCard: 'summary_large_image',
})

const pickerOpen = ref(false)

function openPicker() {
  if (!detail.value)
    return
  track('campaign_enter_click', { slug: slug.value, campaign_id: detail.value.id })
  if (!requireLogin())
    return
  if (!canEnter.value) {
    toast.add({ title: t('活动不在投稿期'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  pickerOpen.value = true
}

async function onEntered() {
  await Promise.all([refreshDetail(), reloadEntries()])
}

function authorName(entry: CampaignEntry) {
  return entry.work?.author?.nickname || entry.user?.nickname || t('创作者')
}

function goAuthor(entry: CampaignEntry) {
  const id = entry.work?.user_id || entry.user_id
  if (id)
    void navigateTo(localePath(`/author/${id}`))
}

/** 前三名给金银铜，其余显示数字 */
function rankClass(rank: number) {
  if (rank === 1)
    return 'is-gold'
  if (rank === 2)
    return 'is-silver'
  if (rank === 3)
    return 'is-bronze'
  return ''
}

function playPreview(event: Event) {
  const video = (event.currentTarget as HTMLElement | null)?.querySelector('video')
  if (!video)
    return
  video.muted = true
  video.playsInline = true
  void video.play().catch(() => {})
}

function stopPreview(event: Event) {
  const video = (event.currentTarget as HTMLElement | null)?.querySelector('video')
  if (!video)
    return
  video.pause()
  video.currentTime = 0
}

watch(sort, () => {
  void reloadEntries()
})

// 换活动（slug 变化）后按新状态回到默认排序
watch(settled, (on) => {
  sort.value = on ? 'rank' : 'likes'
})

// SSR 请求带不上登录态，my_entry 只能在客户端拿到；水合后登录态就绪再补一次详情
watch(isLoggedIn, (on) => {
  if (on && !myEntry.value)
    void refreshDetail()
})

onMounted(() => {
  track('campaign_view', { slug: slug.value })
  if (isLoggedIn.value && !myEntry.value)
    void refreshDetail()
  void reloadEntries()
})
</script>

<template>
  <section class="campaign-detail">
    <div v-if="!detail" class="asset-picker__empty">
      <UIcon name="i-lucide-trophy" class="size-8" />
      <strong>{{ t('活动不存在') }}</strong>
      <NuxtLink :to="localePath('/campaign')" class="asset-picker__cta">{{ t('活动中心') }}</NuxtLink>
    </div>

    <template v-else>
      <header class="campaign-hero">
        <div class="campaign-hero__banner">
          <img v-if="detail.banner_url" :src="resolveMediaUrl(detail.banner_url)" :alt="detail.title">
          <span v-else class="campaign-card__banner-fallback"><UIcon name="i-lucide-trophy" class="size-10" /></span>
        </div>
        <div class="campaign-hero__body">
          <div class="campaign-hero__title">
            <h1>{{ detail.title }}</h1>
            <span v-if="detail.tag" class="campaign-tag">{{ detail.tag }}</span>
            <span
              class="campaign-badge"
              :class="settled ? 'is-past' : detail.status === CAMPAIGN_ACTIVE ? (notStarted(detail) ? 'is-soon' : 'is-active') : 'is-past'"
            >{{ statusLabel(detail) }}</span>
          </div>
          <div class="campaign-hero__meta">
            <CampaignCountdown v-if="canEnter" :ends-at="detail.ends_at" />
            <span><UIcon name="i-lucide-clapperboard" class="size-3.5" />{{ t('{n} 份投稿', { n: detail.entries_count }) }}</span>
          </div>
          <p v-if="myEntry" class="campaign-hero__mine">
            {{ t('我的投稿：{status}', { status: entryStatusLabel(myEntry) }) }}
            <template v-if="myEntry.prize_points > 0"> · {{ t('{n} 积分', { n: myEntry.prize_points }) }}</template>
            <template v-if="myEntry.prize_days > 0"> · {{ t('{n} 天会员', { n: myEntry.prize_days }) }}</template>
          </p>
          <button
            v-if="canEnter"
            type="button"
            class="plan-btn plan-btn--solid campaign-hero__cta"
            @click="openPicker"
          >
            {{ t('投稿参赛') }}
          </button>
        </div>
      </header>

      <div class="campaign-detail__cols">
        <section v-if="detail.rules" class="campaign-block">
          <h2>{{ t('活动规则') }}</h2>
          <p class="campaign-rules">{{ detail.rules }}</p>
        </section>

        <div v-if="detail.prizes?.length || promos.length" class="campaign-detail__side">
          <section v-if="detail.prizes?.length" class="campaign-block">
            <h2>{{ t('奖池') }}</h2>
            <table class="campaign-prizes">
              <thead>
                <tr><th>{{ t('名次') }}</th><th>{{ t('奖励') }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(prize, i) in detail.prizes" :key="i">
                  <td>{{ prizeRank(prize) }}</td>
                  <td>{{ prizeReward(prize) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="promos.length" class="campaign-block">
            <h2>{{ t('活动价') }}</h2>
            <p class="campaign-rules">{{ t('活动期间用这些模型生成，按折后积分扣费') }}</p>
            <ul class="campaign-promos">
              <li v-for="item in promos" :key="item.model">
                <strong>{{ item.model }}</strong>
                <span>{{ item.label || t('活动价') }}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>

      <header class="show-toolbar">
        <div class="show-toolbar__row">
          <h2>{{ t('投稿墙') }}</h2>
          <div class="show-tags">
            <button
              v-for="option in sortOptions"
              :key="option.value"
              type="button"
              :class="{ 'is-on': sort === option.value }"
              @click="sort = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </header>

      <StudioPaging
        grid-class="show-grid campaign-wall"
        :loading="busy"
        :error="failed"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :count="entries.length"
        :empty-title="t('还没有通过审核的投稿')"
        :empty-description="t('投稿审核通过后会显示在这里。')"
        :load-more="loadMore"
      >
        <template #skeleton>
          <article v-for="n in 8" :key="n" class="show-card show-card--skeleton">
            <USkeleton class="show-card__cover" />
            <div class="show-card__meta">
              <USkeleton class="show-card__avatar" />
              <div class="show-card__text">
                <USkeleton class="h-3.5 w-24" />
                <USkeleton class="mt-1.5 h-3 w-40" />
              </div>
            </div>
          </article>
        </template>
        <div class="show-grid campaign-wall">
          <NuxtLink
            v-for="entry in entries"
            :key="entry.id"
            :to="localePath(`/watch/${entry.work_id}`)"
            class="show-card"
            @mouseenter="playPreview"
            @mouseleave="stopPreview"
          >
            <div class="show-card__cover">
              <video
                :src="resolveMediaUrl(entry.work?.video_url)"
                :poster="resolveMediaUrl(entry.work?.cover_url)"
                muted
                loop
                playsinline
                preload="metadata"
              />
              <span v-if="settled && entry.rank > 0" class="campaign-rank" :class="rankClass(entry.rank)">
                <UIcon name="i-lucide-medal" class="size-3.5" />
                {{ t('第 {n} 名', { n: entry.rank }) }}
                <template v-if="entry.prize_points > 0"> · {{ t('{n} 积分', { n: entry.prize_points }) }}</template>
              </span>
              <span class="show-card__likes">
                <UIcon name="i-lucide-heart" class="size-3.5" />
                {{ entry.work?.like_count ?? entry.likes_snapshot }}
              </span>
            </div>
            <div class="show-card__meta">
              <span class="show-card__avatar show-card__avatar--link" role="link" :aria-label="t('查看作者主页')" @click.prevent.stop="goAuthor(entry)">
                {{ authorName(entry).slice(0, 1) }}
                <span class="canvas-tip canvas-tip--up">{{ t('查看作者主页') }}</span>
              </span>
              <div class="show-card__text">
                <strong class="show-card__author-link" role="link" @click.prevent.stop="goAuthor(entry)">{{ authorName(entry) }}</strong>
                <span>{{ entry.work?.title }}</span>
              </div>
            </div>
          </NuxtLink>
        </div>
      </StudioPaging>

      <div v-if="canEnter" class="campaign-sticky">
        <button type="button" class="plan-btn plan-btn--solid" @click="openPicker">{{ t('投稿参赛') }}</button>
      </div>

      <CampaignWorkPicker
        :open="pickerOpen"
        :campaign-id="detail.id"
        @close="pickerOpen = false"
        @entered="onEntered"
      />
    </template>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
