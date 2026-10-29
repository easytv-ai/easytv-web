<script setup lang="ts">
import rankApi from '~/api/rank'
import type { RankAuthorItem, RankPeriod, RankSkillItem, RankWorkItem } from '~/types/creative'
import { formatCount, resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()
const { homeTabs } = useStudioNav()

/** 榜单（API.md 9.2，M11）：作品 / 作者 / 技能三榜，周月切换，匿名可看。 */
definePageMeta({
  layout: 'studio',
})

const localePath = useLocalePath()

type Tab = 'works' | 'authors' | 'skills'
const tab = ref<Tab>('works')
const period = ref<RankPeriod>('week')

const workRows = ref<RankWorkItem[]>([])
const authorRows = ref<RankAuthorItem[]>([])
const skillRows = ref<RankSkillItem[]>([])
const loading = ref(false)
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
    <div class="show-tabs-bar">
      <div class="show-page__inner show-tabs-bar__row">
        <h1 class="sr-only">{{ t('榜单') }}</h1>
        <StudioSectionTabs :items="homeTabs" :label="t('首页')" />
        <div class="show-toolbar__right">
          <span class="agent-leader__toggle rank-period">
            <button type="button" :class="{ 'is-on': period === 'week' }" @click="selectPeriod('week')">{{ t('周') }}</button>
            <button type="button" :class="{ 'is-on': period === 'month' }" @click="selectPeriod('month')">{{ t('月') }}</button>
          </span>
        </div>
      </div>
    </div>

    <div class="rank-subbar">
      <div class="show-page__inner">
        <p class="rank-page__hint">{{ period === 'week' ? t('按近 7 天数据统计，每小时更新') : t('按近 30 天数据统计，每小时更新') }}</p>
        <div class="show-tags rank-tabs">
          <button type="button" :class="{ 'is-on': tab === 'works' }" @click="selectTab('works')">{{ t('作品榜') }}</button>
          <button type="button" :class="{ 'is-on': tab === 'authors' }" @click="selectTab('authors')">{{ t('作者榜') }}</button>
          <button type="button" :class="{ 'is-on': tab === 'skills' }" @click="selectTab('skills')">{{ t('技能榜') }}</button>
        </div>
      </div>
    </div>

    <div class="show-page__inner">

    <div v-if="loading && !rows.length" class="rank-list">
      <div v-for="n in 8" :key="n" class="rank-row rank-row--skeleton">
        <USkeleton class="size-7 shrink-0 rounded-full" />
        <USkeleton class="h-12 w-20 shrink-0 rounded-lg" />
        <div class="rank-row__main">
          <USkeleton class="h-3.5 w-40" />
          <USkeleton class="mt-2 h-3 w-24" />
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
      <NuxtLink :to="localePath('/studio')" class="plan-btn plan-btn--solid">{{ t('去逛逛成片') }}</NuxtLink>
    </StudioEmpty>

    <!-- 作品榜 -->
    <ol v-else-if="tab === 'works'" class="rank-list">
      <li v-for="(row, idx) in workRows" :key="row.work.id" class="rank-row">
        <i class="agent-leader__rank rank-row__no" :class="{ 'is-top': idx < 3 }">{{ idx + 1 }}</i>
        <NuxtLink :to="localePath(`/watch/${row.work.id}`)" class="rank-row__thumb">
          <img v-if="row.work.cover_url" :src="resolveMediaUrl(row.work.cover_url)" :alt="row.work.title" loading="lazy">
          <span v-else class="rank-row__thumb-fallback"><UIcon name="i-lucide-clapperboard" class="size-4" /></span>
        </NuxtLink>
        <div class="rank-row__main">
          <NuxtLink :to="localePath(`/watch/${row.work.id}`)" class="rank-row__name">{{ row.work.title }}</NuxtLink>
          <small>
            <NuxtLink v-if="row.work.user_id" :to="localePath(`/author/${row.work.user_id}`)" class="rank-row__author">{{ row.work.author?.nickname || t('创作者') }}</NuxtLink>
            <span v-else>{{ t('创作者') }}</span>
          </small>
        </div>
        <div class="rank-row__stats">
          <span><UIcon name="i-lucide-heart" class="size-3.5" />{{ formatCount(row.likes_in_period) }}</span>
          <span><UIcon name="i-lucide-play" class="size-3.5" />{{ formatCount(row.views) }}</span>
        </div>
      </li>
    </ol>

    <!-- 作者榜 -->
    <ol v-else-if="tab === 'authors'" class="rank-list">
      <li v-for="(row, idx) in authorRows" :key="row.user_id" class="rank-row">
        <i class="agent-leader__rank rank-row__no" :class="{ 'is-top': idx < 3 }">{{ idx + 1 }}</i>
        <NuxtLink :to="localePath(`/author/${row.user_id}`)" class="rank-row__avatar">{{ (row.nickname || '#').slice(0, 1) }}</NuxtLink>
        <div class="rank-row__main">
          <NuxtLink :to="localePath(`/author/${row.user_id}`)" class="rank-row__name">{{ row.nickname || `#${row.user_id}` }}</NuxtLink>
          <small>{{ t('{n} 部作品', { n: row.works }) }} · {{ t('{n} 位粉丝', { n: formatCount(row.followers) }) }} · {{ t('获赞 {n}', { n: formatCount(row.likes) }) }}</small>
        </div>
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

    <!-- 技能榜 -->
    <ol v-else class="rank-list">
      <li v-for="(row, idx) in skillRows" :key="row.skill.id" class="rank-row">
        <i class="agent-leader__rank rank-row__no" :class="{ 'is-top': idx < 3 }">{{ idx + 1 }}</i>
        <NuxtLink :to="localePath(`/skills?skill=${row.skill.id}`)" class="rank-row__thumb">
          <img v-if="row.skill.cover_url" :src="resolveMediaUrl(row.skill.cover_url)" :alt="row.skill.title" loading="lazy">
          <span v-else class="rank-row__thumb-fallback"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
        </NuxtLink>
        <div class="rank-row__main">
          <NuxtLink :to="localePath(`/skills?skill=${row.skill.id}`)" class="rank-row__name">{{ row.skill.title }}</NuxtLink>
          <small>{{ row.skill.category ? t(row.skill.category) : row.skill.author_name }}</small>
        </div>
        <div class="rank-row__stats">
          <span><UIcon name="i-lucide-zap" class="size-3.5" />{{ t('{n} 次调用', { n: formatCount(row.calls) }) }}</span>
          <span><UIcon name="i-lucide-star" class="size-3.5" />{{ formatCount(row.stars) }}</span>
        </div>
      </li>
    </ol>
    </div>
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
