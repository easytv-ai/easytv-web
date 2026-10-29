<script setup lang="ts">
import workApi from '~/api/work'
import rankApi from '~/api/rank'
import type { RankWorkItem, Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

/** 成片信息流：分类 / 语言 / 搜索 + 本周热门 + 成片网格（GET /work、GET /rank/works） */
const props = withDefaults(defineProps<{
  /** 只看运营精选（GET /work?featured=1），首页用；探索页看全部已发布 */
  featured?: boolean
  /** 是否展示本周热门 */
  hot?: boolean
  title?: string
}>(), {
  featured: false,
  hot: true,
  title: '',
})

const { t } = useI18n()
const localePath = useLocalePath()
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
      featured: props.featured ? 1 : undefined,
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
const showHot = computed(() => props.hot && hotRows.value.length >= 3)
const heading = computed(() => props.title || t('精选成片'))
const emptyTitle = computed(() => props.featured ? t('暂无精选成片') : t('暂无成片'))
const emptyDescription = computed(() => props.featured
  ? t('去探索页看看全部作品。')
  : t('换个分类或关键词试试，也可以去创作台生成新的作品。'))

async function loadHot() {
  try {
    const res = await rankApi.works('week')
    if (!res?.success || !res.data)
      return
    hotRows.value = (res.data.items ?? []).slice(0, HOT_LIMIT)
  }
  catch {
    hotRows.value = []
  }
}

/** 分类：后台维护的顺序 + 数据里出现的其它分类 */
const tags = computed(() => {
  const extra = items.value.map(item => item.category).filter(c => c && !baseTags.value.includes(c))
  return [ALL_TAG, ...baseTags.value, ...Array.from(new Set(extra))]
})

function authorName(item: Work) {
  return item.author?.nickname || t('创作者')
}

function gotoAuthor(item: Work) {
  if (item.user_id)
    void navigateTo(localePath(`/author/${item.user_id}`))
}

/** 和播放页「查看制作过程」同一判断：作者公开了过程或开源了画布 */
function hasProcess(item: Work) {
  return Boolean((item.show_process && item.canvas_id) || item.open_source === 1)
}

function gotoProcess(item: Work) {
  void navigateTo(localePath(`/process/${item.id}`))
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
  if (props.hot)
    void loadHot()
  void reload()
})

onBeforeUnmount(() => {
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <section v-if="showHot" class="show-page__inner studio-hot" :aria-label="t('本周热门')">
    <div class="studio-hot__head">
      <h2>{{ t('本周热门') }}</h2>
      <NuxtLink :to="localePath('/rank')" class="studio-hot__more">{{ t('查看榜单') }}<UIcon name="i-lucide-chevron-right" class="size-3.5" /></NuxtLink>
    </div>
    <ol class="studio-hot__list">
      <li v-for="(row, idx) in hotRows" :key="row.work.id">
        <NuxtLink :to="localePath(`/watch/${row.work.id}`)" class="studio-hot__card">
          <span class="studio-hot__cover">
            <img v-if="row.work.cover_url" :src="resolveMediaUrl(row.work.cover_url)" :alt="row.work.title" loading="lazy">
            <UIcon v-else name="i-lucide-clapperboard" class="size-6" />
            <i class="studio-hot__rank" :class="idx === 0 ? 'is-gold' : idx === 1 ? 'is-silver' : idx === 2 ? 'is-bronze' : undefined">TOP {{ idx + 1 }}</i>
          </span>
          <span class="studio-hot__text">
            <b>{{ row.work.title }}</b>
          </span>
        </NuxtLink>
      </li>
    </ol>
  </section>

  <header class="show-toolbar">
    <div class="show-page__inner show-toolbar__row">
      <div class="show-toolbar__title">
        <h2>{{ heading }}</h2>
        <NuxtLink v-if="featured" :to="localePath('/explore')" class="studio-hot__more">
          {{ t('查看全部') }}<UIcon name="i-lucide-chevron-right" class="size-3.5" />
        </NuxtLink>
      </div>
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

  <div class="show-page__inner">
    <StudioPaging
      grid-class="show-grid"
      :loading="busy"
      :error="failed"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :count="items.length"
      :empty-title="emptyTitle"
      :empty-description="emptyDescription"
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
            <StudioWorkLike :work="item" />
          </div>
          <div class="show-card__meta">
            <span class="show-card__avatar show-card__avatar--link" role="link" :aria-label="t('查看作者主页')" @click.prevent.stop="gotoAuthor(item)">
              {{ authorName(item).slice(0, 1) }}
              <span class="canvas-tip canvas-tip--up">{{ t('查看作者主页') }}</span>
            </span>
            <div class="show-card__text">
              <strong>{{ item.title }}</strong>
              <span class="show-card__author-link" role="link" @click.prevent.stop="gotoAuthor(item)">{{ authorName(item) }}</span>
            </div>
            <button
              v-if="hasProcess(item)"
              type="button"
              class="show-card__process"
              :aria-label="t('查看创作过程')"
              @click.prevent.stop="gotoProcess(item)"
            >
              <UIcon name="i-lucide-git-fork" class="size-4" />
              <span class="canvas-tip canvas-tip--up">{{ t('查看创作过程') }}</span>
            </button>
          </div>
        </NuxtLink>
      </div>
    </StudioPaging>
  </div>
</template>
