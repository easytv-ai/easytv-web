<script setup lang="ts">
import followApi from '~/api/follow'
import workApi from '~/api/work'
import type { FollowedAuthor, Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()
const { homeTabs } = useStudioNav()

/** 关注（API.md 9.2）：一页按作者分段，有公开作品的露出最近 4 部，没有的只留一行。 */
definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  keepalive: true,
})

useHead({ title: t('关注') })

const localePath = useLocalePath()
const toast = useToast()

/** 一屏几位作者。有作品的每位再请求一次公开作品，页不宜过大。 */
const AUTHOR_PAGE = 6
const LATEST = 4

type FollowShelf = FollowedAuthor & { recent: Work[] }

const shelves = ref<FollowShelf[]>([])
const quiet = ref<FollowedAuthor[]>([])
const shelfPage = ref(1)
const shelfLoading = ref(false)
const shelfLoadingMore = ref(false)
const shelfLoaded = ref(false)
const shelfFailed = ref(false)
const shelfHasMore = ref(false)
let shelfSeq = 0

const shownCount = computed(() => shelves.value.length + quiet.value.length)
const shelfBusy = computed(() => !shelfLoaded.value && !shelfFailed.value && shownCount.value === 0)

function mergeById<T extends { id: number }>(base: T[], extra: T[]) {
  const seen = new Set(base.map(row => row.id))
  return [...base, ...extra.filter(row => !seen.has(row.id))]
}

async function withRecent(rows: FollowedAuthor[]): Promise<FollowShelf[]> {
  return Promise.all(rows.map(async (row) => {
    if (row.works <= 0)
      return { ...row, recent: [] as Work[] }
    const res = await workApi.feed({ user_id: row.id, page: 1, page_size: 12 })
    const recent = res?.success && res.data?.items ? res.data.items.slice() : []
    recent.sort((a, b) => (b.published_at || 0) - (a.published_at || 0) || b.id - a.id)
    return { ...row, recent: recent.slice(0, LATEST) }
  }))
}

async function loadShelves(reset: boolean) {
  if (!reset && (shelfLoading.value || shelfLoadingMore.value || !shelfHasMore.value))
    return
  if (reset) {
    shelfLoading.value = true
    shelfLoadingMore.value = false
  }
  else {
    shelfLoadingMore.value = true
  }
  const current = ++shelfSeq
  const page = reset ? 1 : shelfPage.value
  try {
    const res = await followApi.authors({ page, page_size: AUTHOR_PAGE })
    if (current !== shelfSeq)
      return
    if (!res?.success || !res.data) {
      toast.add({ title: res?.message || t('加载失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      if (shownCount.value === 0)
        shelfFailed.value = true
      return
    }
    const rows = res.data.items ?? []
    const detailed = await withRecent(rows)
    if (current !== shelfSeq)
      return
    const nextShelves = detailed.filter(row => row.recent.length > 0)
    const nextQuiet = detailed.filter(row => row.recent.length === 0)
    shelves.value = reset ? nextShelves : mergeById(shelves.value, nextShelves)
    quiet.value = reset ? nextQuiet : mergeById(quiet.value, nextQuiet)
    const total = Number(res.data.total ?? 0)
    shelfPage.value = page + 1
    shelfHasMore.value = rows.length > 0 && page * AUTHOR_PAGE < total
    shelfLoaded.value = true
    shelfFailed.value = false
  }
  finally {
    if (current === shelfSeq) {
      shelfLoading.value = false
      shelfLoadingMore.value = false
    }
  }
}

/** 取关后从这一页拿掉；重新关注要刷新才会回来 */
function dropAuthor(id: number) {
  shelves.value = shelves.value.filter(row => row.id !== id)
  quiet.value = quiet.value.filter(row => row.id !== id)
  if (shownCount.value === 0 && shelfHasMore.value && !shelfLoading.value && !shelfLoadingMore.value)
    void loadShelves(false)
}

function onAuthorFollowChange(row: FollowedAuthor, following: boolean, followers: number) {
  row.is_following = following
  row.followers = followers
  const shelf = shelves.value.find(item => item.id === row.id)
  if (shelf && shelf !== row) {
    shelf.is_following = following
    shelf.followers = followers
  }
  const plain = quiet.value.find(item => item.id === row.id)
  if (plain && plain !== row) {
    plain.is_following = following
    plain.followers = followers
  }
  if (!following)
    dropAuthor(row.id)
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

onMounted(() => {
  void loadShelves(true)
})
</script>

<template>
  <section class="show-page follow-page">
    <div class="show-tabs-bar">
      <div class="show-page__inner show-tabs-bar__row">
        <h1 class="sr-only">{{ t('关注') }}</h1>
        <StudioSectionTabs :items="homeTabs" :label="t('首页')" />
      </div>
    </div>

    <div class="show-page__inner">
      <StudioPaging
        grid-class="follow-shelves"
        :loading="shelfBusy"
        :error="shelfFailed"
        :loading-more="shelfLoadingMore"
        :has-more="shelfHasMore"
        :count="shownCount"
        :load-more="() => loadShelves(false)"
      >
        <template #skeleton>
          <section v-for="n in 2" :key="n" class="follow-shelf" aria-hidden="true">
            <div class="follow-shelf__head">
              <USkeleton class="size-11 shrink-0 rounded-full" />
              <div class="follow-shelf__id">
                <USkeleton class="h-4 w-28" />
                <USkeleton class="mt-2 h-3 w-36" />
              </div>
            </div>
            <div class="follow-shelf__works">
              <article v-for="card in 4" :key="card" class="show-card show-card--skeleton">
                <USkeleton class="show-card__cover" />
                <div class="show-card__meta">
                  <USkeleton class="h-3.5 w-24" />
                </div>
              </article>
            </div>
          </section>
        </template>
        <template #empty>
          <StudioEmpty
            :title="t('还没有关注的作者')"
            :description="t('在成片列表里点头像进作者主页，关注后新作会出现在这里。')"
          >
            <NuxtLink :to="localePath('/studio')" class="plan-btn plan-btn--solid">{{ t('去逛逛成片') }}</NuxtLink>
          </StudioEmpty>
        </template>
        <div class="follow-shelves">
          <section v-for="row in shelves" :key="row.id" class="follow-shelf">
            <header class="follow-shelf__head">
              <NuxtLink :to="localePath(`/author/${row.id}`)" class="follow-shelf__who">
                <span class="follow-shelf__avatar">{{ (row.nickname || '#').slice(0, 1) }}</span>
                <span class="follow-shelf__id">
                  <strong>{{ row.nickname || `#${row.id}` }}</strong>
                  <small>{{ t('{n} 部作品', { n: row.works }) }} · {{ t('{n} 位粉丝', { n: row.followers }) }}</small>
                </span>
              </NuxtLink>
              <div class="follow-shelf__actions">
                <NuxtLink :to="localePath(`/author/${row.id}`)" class="follow-shelf__all">
                  {{ t('查看全部') }}
                  <UIcon name="i-lucide-chevron-right" class="size-3.5" />
                </NuxtLink>
                <StudioFollowButton
                  :author-id="row.id"
                  :name="row.nickname || ''"
                  :following="row.is_following"
                  :followers="row.followers"
                  size="compact"
                  @change="(on, followers) => onAuthorFollowChange(row, on, followers)"
                />
              </div>
            </header>
            <div class="follow-shelf__works">
              <NuxtLink
                v-for="item in row.recent"
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
                  <div class="show-card__text">
                    <strong>{{ item.title }}</strong>
                  </div>
                </div>
              </NuxtLink>
            </div>
          </section>
          <section v-if="quiet.length" class="follow-quiet">
            <h2>{{ t('还没有公开作品') }}</h2>
            <div class="follow-authors">
              <div v-for="row in quiet" :key="row.id" class="follow-author-row">
                <NuxtLink :to="localePath(`/author/${row.id}`)" class="follow-author-row__avatar">{{ (row.nickname || '#').slice(0, 1) }}</NuxtLink>
                <div class="follow-author-row__main">
                  <NuxtLink :to="localePath(`/author/${row.id}`)" class="follow-author-row__name">{{ row.nickname || `#${row.id}` }}</NuxtLink>
                  <small>{{ t('{n} 位粉丝', { n: row.followers }) }}</small>
                </div>
                <StudioFollowButton
                  :author-id="row.id"
                  :name="row.nickname || ''"
                  :following="row.is_following"
                  :followers="row.followers"
                  size="compact"
                  @change="(on, followers) => onAuthorFollowChange(row, on, followers)"
                />
              </div>
            </div>
          </section>
        </div>
      </StudioPaging>
    </div>
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
