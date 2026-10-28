<script setup lang="ts">
import workApi from '~/api/work'
import type { AuthorProfile, Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/** 作者主页：GET /author/:id + GET /work?user_id=，匿名可看。 */
definePageMeta({
  layout: 'studio',
})

const route = useRoute()
const localePath = useLocalePath()

const authorId = computed(() => Number(Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) || 0)
const profile = ref<AuthorProfile | null>(null)
const error = ref('')
const PAGE_SIZE = 24
const profileLoading = ref(true)

const {
  items: works,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
} = useStudioPaged<Work>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await workApi.feed({ user_id: authorId.value, page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})
const name = computed(() => profile.value?.nickname || t('创作者'))
/** 关注按钮只对别人的主页显示（后端 mine 为真时隐藏） */
const canFollow = computed(() => !!profile.value && !profile.value.mine && authorId.value > 0)

function onFollowChange(following: boolean, followers: number) {
  if (!profile.value)
    return
  profile.value = { ...profile.value, is_following: following, followers }
}

useHead({
  title: computed(() => profile.value ? t('{name} 的作品', { name: profile.value.nickname }) : t('作者主页')),
})
useSeoMeta({
  description: computed(() => profile.value ? t('{name} 在 EasyTV 发布了 {n} 部作品', { name: profile.value.nickname, n: profile.value.work_count }) : ''),
})

function fmtDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function loadProfile() {
  const res = await workApi.author(authorId.value)
  if (!res?.success || !res.data) {
    error.value = res?.message || t('作者不存在')
    return
  }
  profile.value = res.data
}

onMounted(async () => {
  profileLoading.value = true
  await Promise.all([loadProfile(), reload()])
  profileLoading.value = false
})

function playPreview(event: MouseEvent) {
  const video = (event.currentTarget as HTMLElement).querySelector('video')
  void video?.play().catch(() => {})
}

function stopPreview(event: MouseEvent) {
  const video = (event.currentTarget as HTMLElement).querySelector('video')
  if (video) {
    video.pause()
    video.currentTime = 0
  }
}
</script>

<template>
  <section class="author-page">
    <div v-if="error" class="asset-picker__empty author-page__error">
      <UIcon name="i-lucide-user-x" class="size-8" />
      {{ error }}
    </div>
    <template v-else>
      <header class="author-hero">
        <span class="author-hero__avatar">{{ name.slice(0, 1) }}</span>
        <div class="author-hero__main">
          <div class="author-hero__name">
            <h1>{{ name }}</h1>
            <ClientOnly>
              <StudioFollowButton
                v-if="canFollow"
                :author-id="authorId"
                :name="name"
                :following="!!profile?.is_following"
                :followers="profile?.followers ?? 0"
                @change="onFollowChange"
              />
            </ClientOnly>
          </div>
          <p v-if="profile">{{ t('{time} 加入 EasyTV', { time: fmtDate(profile.joined_at) }) }}</p>
        </div>
        <dl v-if="profile" class="author-hero__stats">
          <div><dt>{{ t('作品') }}</dt><dd>{{ profile.work_count }}</dd></div>
          <div><dt>{{ t('粉丝') }}</dt><dd>{{ (profile.followers ?? 0).toLocaleString() }}</dd></div>
          <div><dt>{{ t('关注') }}</dt><dd>{{ (profile.following_count ?? 0).toLocaleString() }}</dd></div>
          <div><dt>{{ t('喜欢') }}</dt><dd>{{ profile.like_total.toLocaleString() }}</dd></div>
          <div><dt>{{ t('播放') }}</dt><dd>{{ profile.view_total.toLocaleString() }}</dd></div>
        </dl>
        <NuxtLink v-if="profile?.mine" :to="localePath('/settings?tab=works')" class="plan-btn plan-btn--ghost author-hero__manage">{{ t('管理我的作品') }}</NuxtLink>
      </header>

      <div v-if="profileLoading && !profile" class="asset-picker__empty">{{ t('加载中…') }}</div>
      <div v-else class="show-page__inner">
      <StudioPaging
        grid-class="show-grid"
        :loading="busy"
        :error="failed"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :count="works.length"
        :empty-title="t('还没有公开作品')"
        :empty-description="t('作者发布作品后会显示在这里。')"
        :load-more="loadMore"
      >
        <template #skeleton>
          <article v-for="n in 8" :key="n" class="show-card show-card--skeleton">
            <USkeleton class="show-card__cover" />
            <div class="show-card__meta">
              <div class="show-card__text">
                <USkeleton class="h-3.5 w-32" />
                <USkeleton class="mt-1.5 h-3 w-24" />
              </div>
            </div>
          </article>
        </template>
        <div class="show-grid">
            <NuxtLink
              v-for="item in works"
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
                  <span>{{ item.category ? t(item.category) : '' }}<template v-if="item.category && item.comment_count"> · </template><template v-if="item.comment_count">{{ t('{n} 条评论', { n: item.comment_count }) }}</template></span>
                </div>
              </div>
            </NuxtLink>
          </div>
      </StudioPaging>
      </div>
    </template>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
