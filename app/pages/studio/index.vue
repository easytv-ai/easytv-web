<script setup lang="ts">
import workApi from '~/api/work'
import rankApi from '~/api/rank'
import type { RankWorkItem, Work } from '~/types/creative'
import { formatCount, resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()
const { homeTabs } = useStudioNav()

const localePath = useLocalePath()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({
  title: t('首页'),
})

const toast = useToast()
const keyword = ref('')
const ALL_TAG = '全部'
const activeTag = ref(ALL_TAG)
const { names: baseTags, load: loadCategories } = useContentCategories('work')
const PAGE_SIZE = 24
let keywordTimer: number | undefined

/** 作品语言过滤（F6，GET /work?lang=，API.md 10.7）：'' = 全部 */
const LANG_FILTERS = ['', 'zh', 'en']
const activeLang = ref('')

function langLabel(value: string) {
  if (!value)
    return t('全部')
  return value === 'zh' ? t('中文') : 'English'
}

const {
  items,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
} = useStudioPaged<Work>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await workApi.feed({
      page,
      page_size: pageSize,
      keyword: q || undefined,
      category: activeTag.value === ALL_TAG ? undefined : activeTag.value,
      lang: activeLang.value || undefined,
    })
    if (!res?.success || !res.data) {
      toast.add({ title: res?.message || t('成片加载失败'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return null
    }
    return res.data
  },
})

// ---- 本周热门（GET /rank/works?period=week，API.md 9.2）：只取前 5，不足 3 条不展示 ----
const HOT_LIMIT = 5
const hotRows = ref<RankWorkItem[]>([])
const showHot = computed(() => hotRows.value.length >= 3)

async function loadHot() {
  const res = await rankApi.works('week')
  if (!res?.success || !res.data)
    return
  hotRows.value = (res.data.items ?? []).slice(0, HOT_LIMIT)
}

/** 分类：后台维护的顺序 + 数据里出现的其它分类 */
const tags = computed(() => {
  const extra = items.value.map(item => item.category).filter(c => c && !baseTags.value.includes(c))
  return [ALL_TAG, ...baseTags.value, ...Array.from(new Set(extra))]
})

function authorName(item: Work) {
  return item.author?.nickname || t('创作者')
}

function goAuthor(item: Work) {
  if (item.user_id)
    void navigateTo(localePath(`/author/${item.user_id}`))
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

watch([activeTag, activeLang], () => {
  void reload()
})

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    void reload()
  }, 320)
})

onMounted(() => {
  void loadCategories()
  void loadHot()
  void reload()
})

onBeforeUnmount(() => {
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <section class="show-page">
    <div class="show-tabs-bar">
      <div class="show-page__inner show-tabs-bar__row">
        <h1 class="sr-only">{{ t('首页') }}</h1>
        <StudioSectionTabs :items="homeTabs" :label="t('首页')" />
      </div>
    </div>
    <div class="show-page__inner">
      <StudioHeroCarousel />
      <StudioGrowthTasks />
      <StudioCampaignStrip />
      <StudioRecentProjects />
    </div>

    <header class="show-toolbar">
      <div class="show-page__inner show-toolbar__row">
        <h1>{{ t('精选成片') }}</h1>
        <div class="show-toolbar__right">
          <div class="show-lang-tags" role="group" :aria-label="t('作品语言')">
            <UIcon name="i-lucide-languages" class="size-4 show-lang-tags__icon" />
            <div class="show-lang-tags__pills">
              <button
                v-for="lg in LANG_FILTERS"
                :key="lg || 'all'"
                type="button"
                :class="{ 'is-on': activeLang === lg }"
                @click="activeLang = lg"
              >
                {{ langLabel(lg) }}
              </button>
            </div>
          </div>
          <i class="show-toolbar__split" aria-hidden="true" />
          <div class="show-tags" role="group" :aria-label="t('分类')">
            <button
              v-for="tag in tags"
              :key="tag"
              type="button"
              :class="{ 'is-on': activeTag === tag }"
              @click="activeTag = tag"
            >
              {{ t(tag) }}
            </button>
          </div>
          <label class="projects-search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input
              v-model="keyword"
              type="search"
              :placeholder="t('搜索成片')"
            >
          </label>
        </div>
      </div>
    </header>

    <section v-if="showHot" class="show-page__inner studio-hot" :aria-label="t('本周热门')">
      <div class="studio-hot__head">
        <strong>
          <UIcon name="i-lucide-flame" class="size-4" />
          {{ t('本周热门') }}
        </strong>
        <NuxtLink :to="localePath('/rank')" class="studio-hot__more">{{ t('查看榜单') }}<UIcon name="i-lucide-chevron-right" class="size-3.5" /></NuxtLink>
      </div>
      <ol class="studio-hot__list">
        <li v-for="(row, idx) in hotRows" :key="row.work.id">
          <NuxtLink :to="localePath(`/watch/${row.work.id}`)">
            <i class="studio-hot__rank" :class="{ 'is-top': idx < 3 }">{{ idx + 1 }}</i>
            <img v-if="row.work.cover_url" :src="resolveMediaUrl(row.work.cover_url)" :alt="row.work.title" loading="lazy">
            <span v-else class="studio-hot__thumb-fallback"><UIcon name="i-lucide-clapperboard" class="size-4" /></span>
            <span class="studio-hot__text">
              <b>{{ row.work.title }}</b>
              <small><UIcon name="i-lucide-heart" class="size-3" />{{ formatCount(row.likes_in_period) }} · {{ row.work.author?.nickname || t('创作者') }}</small>
            </span>
          </NuxtLink>
        </li>
      </ol>
    </section>

    <div class="show-page__inner">
      <StudioPaging
        grid-class="show-grid"
        :loading="busy"
        :error="failed"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :count="items.length"
        :empty-title="t('暂无成片')"
        :empty-description="t('换个分类或关键词试试，也可以去创作台生成新的作品。')"
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
        <div class="show-grid">
          <NuxtLink
            v-for="item in items"
            :key="item.id"
            :to="localePath(`/watch/${item.id}`)"
            class="show-card"
            @mouseenter="playPreview"
            @mouseleave="stopPreview"
          >
            <div class="show-card__cover">
              <video
                :src="resolveMediaUrl(item.video_url)"
                :poster="resolveMediaUrl(item.cover_url)"
                muted
                loop
                playsinline
                preload="metadata"
              />
              <span v-if="item.open_source === 1" class="show-card__open">
                <UIcon name="i-lucide-git-fork" class="size-3" />
                {{ t('开源') }}<template v-if="item.clone_count"> · {{ item.clone_count }}</template>
              </span>
              <span class="show-card__likes">
                <UIcon name="i-lucide-heart" class="size-3.5" />
                {{ item.like_count }}
              </span>
            </div>
            <div class="show-card__meta">
              <span class="show-card__avatar show-card__avatar--link" role="link" :aria-label="t('查看作者主页')" @click.prevent.stop="goAuthor(item)">
                {{ authorName(item).slice(0, 1) }}
                <span class="canvas-tip canvas-tip--up">{{ t('查看作者主页') }}</span>
              </span>
              <div class="show-card__text">
                <strong class="show-card__author-link" role="link" @click.prevent.stop="goAuthor(item)">{{ authorName(item) }}</strong>
                <span>{{ item.title }}</span>
              </div>
            </div>
          </NuxtLink>
        </div>
      </StudioPaging>
    </div>
    <StudioWelcomeGift />
  </section>
</template>
