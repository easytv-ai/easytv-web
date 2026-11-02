<script setup lang="ts">
import rankApi from '~/api/rank'
import type { RankAuthorItem, RankPeriod, RankSkillItem, RankWorkItem } from '~/types/creative'
import { formatCount, resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()
const { exploreTabs } = useStudioNav()

/** 榜单（API.md 9.2，M11）：作品 / 作者 / 技能三榜，周月切换，匿名可看。 */
definePageMeta({
  layout: 'studio',
  keepalive: true,
})

const localePath = useLocalePath()

type Tab = 'works' | 'authors' | 'skills'
const tab = ref<Tab>('works')
const period = ref<RankPeriod>('week')

const workRows = ref<RankWorkItem[]>([])
const authorRows = ref<RankAuthorItem[]>([])
const skillRows = ref<RankSkillItem[]>([])
const loading = ref(true)
const failed = ref(false)
/** 当前格子里的数据属于哪一档，失败时不要拿另一档的排名冒充 */
const shownKey = ref('')
/** 已取过数据的 tab+period 组合，切回来不再重复请求 */
const fetched = reactive<Record<string, boolean>>({})
let seq = 0

function markRankFailed(next: Tab, key: string) {
  if (shownKey.value !== key) {
    if (next === 'works')
      workRows.value = []
    else if (next === 'authors')
      authorRows.value = []
    else
      skillRows.value = []
  }
  const count = next === 'works'
    ? workRows.value.length
    : next === 'authors'
      ? authorRows.value.length
      : skillRows.value.length
  failed.value = count === 0
}

useHead({ title: t('榜单') })
useSeoMeta({
  description: t('EasyTV 作品榜、作者榜与技能榜，看看这周大家在创作什么'),
})

async function load(next: Tab, nextPeriod: RankPeriod, force = false) {
  const key = `${next}-${nextPeriod}`
  if (fetched[key] && !force)
    return
  const current = ++seq
  loading.value = true
  failed.value = false
  try {
    if (next === 'works') {
      const res = await rankApi.works(nextPeriod)
      if (current !== seq)
        return
      if (!res?.success || !res.data) {
        markRankFailed(next, key)
        return
      }
      workRows.value = res.data.items ?? []
    }
    else if (next === 'authors') {
      const res = await rankApi.authors(nextPeriod)
      if (current !== seq)
        return
      if (!res?.success || !res.data) {
        markRankFailed(next, key)
        return
      }
      authorRows.value = res.data.items ?? []
    }
    else {
      const res = await rankApi.skills(nextPeriod)
      if (current !== seq)
        return
      if (!res?.success || !res.data) {
        markRankFailed(next, key)
        return
      }
      skillRows.value = res.data.items ?? []
    }
    shownKey.value = key
    fetched[key] = true
    failed.value = false
  }
  catch {
    if (current !== seq)
      return
    markRankFailed(next, key)
  }
  finally {
    if (current === seq)
      loading.value = false
  }
}

function selectTab(next: Tab) {
  if (tab.value === next)
    return
  tab.value = next
  void load(next, period.value)
}

/** 周 / 月 三个榜共用，切换后当前榜重新取数，其余榜等切过去再取 */
function selectPeriod(next: RankPeriod) {
  if (period.value === next)
    return
  period.value = next
  void load(tab.value, next)
}

const rows = computed(() => tab.value === 'works' ? workRows.value : tab.value === 'authors' ? authorRows.value : skillRows.value)
const empty = computed(() => !loading.value && rows.value.length === 0)
const showSkeleton = computed(() => loading.value && rows.value.length === 0)

const workPodium = computed(() => workRows.value.slice(0, 3))
const workRest = computed(() => workRows.value.slice(3))
const authorPodium = computed(() => authorRows.value.slice(0, 3))
const authorRest = computed(() => authorRows.value.slice(3))
const skillPodium = computed(() => skillRows.value.slice(0, 3))
const skillRest = computed(() => skillRows.value.slice(3))

function rankTone(idx: number) {
  if (idx === 0)
    return 'is-gold'
  if (idx === 1)
    return 'is-silver'
  return 'is-bronze'
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

function onAuthorFollowChange(row: RankAuthorItem, following: boolean, followers: number) {
  row.is_following = following
  row.followers = followers
}

onMounted(() => {
  void load(tab.value, period.value)
})
</script>

<template>
  <section class="show-page rank-page">
    <div class="show-sticky">
      <div class="show-tabs-bar">
        <div class="show-page__inner show-tabs-bar__row">
          <h1 class="sr-only">{{ t('榜单') }}</h1>
          <StudioSectionTabs :items="exploreTabs" :label="t('探索')" />
        </div>
      </div>

      <div class="show-toolbar rank-toolbar">
        <div class="show-page__inner show-toolbar__row">
          <div class="show-tags">
            <button type="button" :class="{ 'is-on': tab === 'works' }" @click="selectTab('works')">{{ t('作品榜') }}</button>
            <button type="button" :class="{ 'is-on': tab === 'authors' }" @click="selectTab('authors')">{{ t('作者榜') }}</button>
            <button type="button" :class="{ 'is-on': tab === 'skills' }" @click="selectTab('skills')">{{ t('技能榜') }}</button>
          </div>
          <div class="show-toolbar__right">
            <p class="rank-page__hint">{{ period === 'week' ? t('按近 7 天数据统计，每小时更新') : t('按近 30 天数据统计，每小时更新') }}</p>
            <span class="show-lang-tags__pills">
              <button type="button" :class="{ 'is-on': period === 'week' }" @click="selectPeriod('week')">{{ t('周') }}</button>
              <button type="button" :class="{ 'is-on': period === 'month' }" @click="selectPeriod('month')">{{ t('月') }}</button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="show-page__inner">
      <div v-if="showSkeleton" class="rank-board" aria-hidden="true">
        <div class="rank-podium">
          <div v-for="n in 3" :key="n" class="rank-hero rank-hero--skeleton">
            <USkeleton class="rank-hero__cover" />
            <div class="rank-hero__meta">
              <USkeleton class="h-4 w-3/4" />
              <USkeleton class="mt-2 h-3 w-1/2" />
            </div>
          </div>
        </div>
        <div class="rank-list">
          <div v-for="n in 6" :key="n" class="rank-row rank-row--skeleton">
            <USkeleton class="rank-row__no" />
            <USkeleton class="rank-row__thumb" />
            <div class="rank-row__main">
              <USkeleton class="h-3.5 w-40" />
              <USkeleton class="mt-2 h-3 w-24" />
            </div>
          </div>
        </div>
      </div>

      <StudioEmpty
        v-else-if="failed && !rows.length"
        :title="t('加载失败，请稍后重试')"
      >
        <button type="button" class="plan-btn plan-btn--solid" @click="load(tab, period, true)">{{ t('重试') }}</button>
      </StudioEmpty>

      <StudioEmpty
        v-else-if="empty"
        :title="t('榜单还在统计中')"
        :description="t('有足够的数据后这里会显示排名，先去创作或看看成片吧。')"
      >
        <NuxtLink :to="localePath('/explore')" class="plan-btn plan-btn--solid">{{ t('去逛逛成片') }}</NuxtLink>
      </StudioEmpty>

      <!-- 作品榜 -->
      <div v-else-if="tab === 'works'" class="rank-board">
        <div v-if="workPodium.length" class="rank-podium">
          <NuxtLink
            v-for="(row, idx) in workPodium"
            :key="row.work.id"
            :to="localePath(`/watch/${row.work.id}`)"
            class="rank-hero"
            :class="rankTone(idx)"
            @mouseenter="playPreview"
            @mouseleave="stopPreview"
          >
            <div class="rank-hero__cover">
              <video
                v-if="row.work.video_url"
                :src="resolveMediaUrl(row.work.video_url)"
                :poster="resolveMediaUrl(row.work.cover_url)"
                muted
                playsinline
                preload="none"
              />
              <img v-else-if="row.work.cover_url" :src="resolveMediaUrl(row.work.cover_url)" :alt="row.work.title" loading="lazy">
              <span v-else class="rank-hero__fallback"><UIcon name="i-lucide-clapperboard" class="size-8" /></span>
              <i class="studio-hot__rank" :class="rankTone(idx)">{{ idx + 1 }}</i>
              <span class="rank-hero__chip">
                <UIcon name="i-lucide-heart" class="size-3.5" />
                {{ formatCount(row.likes_in_period) }}
              </span>
            </div>
            <div class="rank-hero__meta">
              <b>{{ row.work.title }}</b>
              <small>
                {{ row.work.author?.nickname || t('创作者') }}
                ·
                <UIcon name="i-lucide-play" class="size-3" />
                {{ formatCount(row.views) }}
              </small>
            </div>
          </NuxtLink>
        </div>
        <ol v-if="workRest.length" class="rank-list">
          <li v-for="(row, idx) in workRest" :key="row.work.id" class="rank-row">
            <i class="rank-row__no">{{ idx + 4 }}</i>
            <NuxtLink
              :to="localePath(`/watch/${row.work.id}`)"
              class="rank-row__hit"
              @mouseenter="playPreview"
              @mouseleave="stopPreview"
            >
              <span class="rank-row__thumb">
                <video
                  v-if="row.work.video_url"
                  :src="resolveMediaUrl(row.work.video_url)"
                  :poster="resolveMediaUrl(row.work.cover_url)"
                  muted
                  playsinline
                  preload="none"
                />
                <img v-else-if="row.work.cover_url" :src="resolveMediaUrl(row.work.cover_url)" :alt="row.work.title" loading="lazy">
                <span v-else class="rank-row__thumb-fallback"><UIcon name="i-lucide-clapperboard" class="size-4" /></span>
              </span>
              <span class="rank-row__main">
                <b class="rank-row__name">{{ row.work.title }}</b>
                <small>{{ row.work.author?.nickname || t('创作者') }}</small>
              </span>
            </NuxtLink>
            <div class="rank-row__stats">
              <span><UIcon name="i-lucide-heart" class="size-3.5" />{{ formatCount(row.likes_in_period) }}</span>
              <span><UIcon name="i-lucide-play" class="size-3.5" />{{ formatCount(row.views) }}</span>
            </div>
          </li>
        </ol>
      </div>

      <!-- 作者榜 -->
      <div v-else-if="tab === 'authors'" class="rank-board">
        <div v-if="authorPodium.length" class="rank-podium">
          <article
            v-for="(row, idx) in authorPodium"
            :key="row.user_id"
            class="rank-hero rank-hero--person"
            :class="rankTone(idx)"
          >
            <NuxtLink :to="localePath(`/author/${row.user_id}`)" class="rank-hero__person">
              <i class="studio-hot__rank" :class="rankTone(idx)">{{ idx + 1 }}</i>
              <span class="rank-hero__avatar">{{ (row.nickname || '#').slice(0, 1) }}</span>
              <b>{{ row.nickname || `#${row.user_id}` }}</b>
              <small>
                {{ t('{n} 部作品', { n: row.works }) }}
                ·
                {{ t('{n} 位粉丝', { n: formatCount(row.followers) }) }}
                ·
                {{ t('获赞 {n}', { n: formatCount(row.likes) }) }}
              </small>
            </NuxtLink>
            <StudioFollowButton
              :author-id="row.user_id"
              :name="row.nickname || ''"
              :following="!!row.is_following"
              :followers="row.followers"
              size="compact"
              @change="(on, followers) => onAuthorFollowChange(row, on, followers)"
            />
          </article>
        </div>
        <ol v-if="authorRest.length" class="rank-list">
          <li v-for="(row, idx) in authorRest" :key="row.user_id" class="rank-row">
            <i class="rank-row__no">{{ idx + 4 }}</i>
            <NuxtLink :to="localePath(`/author/${row.user_id}`)" class="rank-row__hit">
              <span class="rank-row__avatar">{{ (row.nickname || '#').slice(0, 1) }}</span>
              <span class="rank-row__main">
                <b class="rank-row__name">{{ row.nickname || `#${row.user_id}` }}</b>
                <small>{{ t('{n} 部作品', { n: row.works }) }} · {{ t('{n} 位粉丝', { n: formatCount(row.followers) }) }} · {{ t('获赞 {n}', { n: formatCount(row.likes) }) }}</small>
              </span>
            </NuxtLink>
            <StudioFollowButton
              :author-id="row.user_id"
              :name="row.nickname || ''"
              :following="!!row.is_following"
              :followers="row.followers"
              size="compact"
              @change="(on, followers) => onAuthorFollowChange(row, on, followers)"
            />
          </li>
        </ol>
      </div>

      <!-- 技能榜 -->
      <div v-else class="rank-board">
        <div v-if="skillPodium.length" class="rank-podium">
          <NuxtLink
            v-for="(row, idx) in skillPodium"
            :key="row.skill.id"
            :to="localePath(`/skills?skill=${row.skill.id}`)"
            class="rank-hero"
            :class="rankTone(idx)"
            @mouseenter="playPreview"
            @mouseleave="stopPreview"
          >
            <div class="rank-hero__cover">
              <video
                v-if="row.skill.video_url"
                :src="resolveMediaUrl(row.skill.video_url)"
                :poster="resolveMediaUrl(row.skill.cover_url)"
                muted
                playsinline
                preload="none"
              />
              <img v-else-if="row.skill.cover_url" :src="resolveMediaUrl(row.skill.cover_url)" :alt="row.skill.title" loading="lazy">
              <span v-else class="rank-hero__fallback"><UIcon name="i-lucide-sparkles" class="size-8" /></span>
              <i class="studio-hot__rank" :class="rankTone(idx)">{{ idx + 1 }}</i>
              <span class="rank-hero__chip">
                <UIcon name="i-lucide-zap" class="size-3.5" />
                {{ formatCount(row.calls) }}
              </span>
            </div>
            <div class="rank-hero__meta">
              <b>{{ row.skill.title }}</b>
              <small>{{ row.skill.category ? t(row.skill.category) : row.skill.author_name }}</small>
            </div>
          </NuxtLink>
        </div>
        <ol v-if="skillRest.length" class="rank-list">
          <li v-for="(row, idx) in skillRest" :key="row.skill.id" class="rank-row">
            <i class="rank-row__no">{{ idx + 4 }}</i>
            <NuxtLink
              :to="localePath(`/skills?skill=${row.skill.id}`)"
              class="rank-row__hit"
              @mouseenter="playPreview"
              @mouseleave="stopPreview"
            >
              <span class="rank-row__thumb">
                <video
                  v-if="row.skill.video_url"
                  :src="resolveMediaUrl(row.skill.video_url)"
                  :poster="resolveMediaUrl(row.skill.cover_url)"
                  muted
                  playsinline
                  preload="none"
                />
                <img v-else-if="row.skill.cover_url" :src="resolveMediaUrl(row.skill.cover_url)" :alt="row.skill.title" loading="lazy">
                <span v-else class="rank-row__thumb-fallback"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
              </span>
              <span class="rank-row__main">
                <b class="rank-row__name">{{ row.skill.title }}</b>
                <small>{{ row.skill.category ? t(row.skill.category) : row.skill.author_name }}</small>
              </span>
            </NuxtLink>
            <div class="rank-row__stats">
              <span><UIcon name="i-lucide-zap" class="size-3.5" />{{ t('{n} 次调用', { n: formatCount(row.calls) }) }}</span>
              <span><UIcon name="i-lucide-star" class="size-3.5" />{{ formatCount(row.stars) }}</span>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
