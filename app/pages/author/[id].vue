<script setup lang="ts">
import workApi from '~/api/work'
import type { AuthorProfile, Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/**
 * 作者主页：GET /author/:id + GET /work?user_id=，匿名可看；
 * 本人额外有草稿（GET /user/work?status=0）与赞过（GET /user/work/likes），仅自己可见。
 */
definePageMeta({
  layout: 'studio',
})

type Tab = 'published' | 'drafts' | 'likes'

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { user } = useAuth()

const authorId = computed(() => Number(Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) || 0)
const profile = ref<AuthorProfile | null>(null)
const error = ref('')
const PAGE_SIZE = 24
const profileLoading = ref(true)
const tab = ref<Tab>('published')

const published = useStudioPaged<Work>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await workApi.feed({ user_id: authorId.value, page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

const drafts = useStudioPaged<Work>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await workApi.mine({ status: 0, page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

const likes = useStudioPaged<Work>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await workApi.likes({ page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

const lists = { published, drafts, likes }

const name = computed(() => profile.value?.nickname || t('创作者'))
const mine = computed(() => Boolean(profile.value?.mine))
/** 接口不返回头像，本人主页用登录态里的头像，其余用昵称首字 */
const avatar = computed(() => mine.value ? String(user.value?.avatar || '') : '')
/** 关注按钮只对别人的主页显示（后端 mine 为真时隐藏） */
const canFollow = computed(() => !!profile.value && !mine.value && authorId.value > 0)
const current = computed(() => lists[tab.value])

const stats = computed(() => {
  const p = profile.value
  if (!p)
    return []
  return [
    { label: t('粉丝'), value: p.followers ?? 0 },
    { label: t('关注'), value: p.following_count ?? 0 },
    { label: t('获赞'), value: p.like_total },
    { label: t('播放'), value: p.view_total },
  ]
})

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

function fmtCount(n: number) {
  return n.toLocaleString()
}

async function loadProfile() {
  const res = await workApi.author(authorId.value)
  if (!res?.success || !res.data) {
    error.value = res?.message || t('作者不存在')
    return
  }
  profile.value = res.data
}

function selectTab(next: Tab) {
  if (tab.value === next)
    return
  tab.value = next
  const list = lists[next]
  if (!list.loaded.value)
    void list.reload()
}

async function shareProfile() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.add({ title: t('链接已复制'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
  }
  catch {
    toast.add({ title: t('复制失败'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
  }
}

onMounted(async () => {
  profileLoading.value = true
  await Promise.all([loadProfile(), published.reload()])
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
    <div v-else class="author-layout">
      <aside class="author-side">
        <template v-if="profile">
          <div class="author-side__id">
            <img v-if="avatar" :src="avatar" :alt="name" class="author-side__avatar">
            <span v-else class="author-side__avatar">{{ name.slice(0, 1) }}</span>
            <div class="author-side__name">
              <h1 :title="name">{{ name }}</h1>
              <p>{{ t('{time} 加入 EasyTV', { time: fmtDate(profile.joined_at) }) }}</p>
            </div>
          </div>
          <dl class="author-side__stats">
            <div v-for="s in stats" :key="s.label">
              <dd>{{ fmtCount(s.value) }}</dd>
              <dt>{{ s.label }}</dt>
            </div>
          </dl>
          <div class="author-side__actions">
            <ClientOnly>
              <StudioFollowButton
                v-if="canFollow"
                :author-id="authorId"
                :name="name"
                :following="!!profile.is_following"
                :followers="profile.followers ?? 0"
                @change="onFollowChange"
              />
            </ClientOnly>
            <NuxtLink v-if="mine" :to="localePath('/settings')" class="author-side__btn">
              <UIcon name="i-lucide-user-pen" class="size-4" />
              {{ t('author.editProfile') }}
            </NuxtLink>
            <button type="button" class="author-side__btn" @click="shareProfile">
              <UIcon name="i-lucide-share-2" class="size-4" />
              {{ t('author.share') }}
            </button>
          </div>
          <NuxtLink v-if="mine" :to="localePath('/settings?tab=works')" class="author-side__link">
            <UIcon name="i-lucide-layout-list" class="size-4" />
            <span>{{ t('管理我的作品') }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-4" />
          </NuxtLink>
        </template>
        <div v-else-if="profileLoading" class="author-side__id" aria-busy="true">
          <USkeleton class="size-16 shrink-0 rounded-full" />
          <div class="author-side__name">
            <USkeleton class="h-4 w-28" />
            <USkeleton class="mt-2 h-3 w-24" />
          </div>
        </div>
      </aside>

      <div class="author-main">
        <nav class="author-tabs" :aria-label="t('作品')">
          <button type="button" :class="{ 'is-on': tab === 'published' }" @click="selectTab('published')">
            {{ t('author.published') }}
            <small v-if="profile">{{ profile.work_count }}</small>
          </button>
          <button
            v-if="mine"
            type="button"
            :class="{ 'is-on': tab === 'drafts' }"
            :title="t('author.onlyMe')"
            @click="selectTab('drafts')"
          >
            {{ t('author.drafts') }}
            <UIcon name="i-lucide-lock" class="size-3.5" />
          </button>
          <button
            v-if="mine"
            type="button"
            :class="{ 'is-on': tab === 'likes' }"
            :title="t('author.onlyMe')"
            @click="selectTab('likes')"
          >
            {{ t('author.likes') }}
            <UIcon name="i-lucide-lock" class="size-3.5" />
          </button>
        </nav>

        <StudioPaging
          :key="tab"
          grid-class="show-grid author-grid"
          :loading="current.busy.value"
          :error="current.failed.value"
          :loading-more="current.loadingMore.value"
          :has-more="current.hasMore.value"
          :count="current.items.value.length"
          :load-more="current.loadMore"
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
          <template #empty>
            <StudioEmpty
              v-if="tab === 'drafts'"
              :title="t('author.draftsEmpty')"
              :description="t('author.onlyMe')"
            />
            <StudioEmpty
              v-else-if="tab === 'likes'"
              :title="t('author.likesEmpty')"
              :description="t('author.likesEmptyHint')"
            >
              <NuxtLink :to="localePath('/explore')" class="plan-btn plan-btn--solid">{{ t('去逛逛成片') }}</NuxtLink>
            </StudioEmpty>
            <StudioEmpty
              v-else-if="mine"
              :title="t('还没有公开作品')"
              :description="t('author.mineEmptyHint')"
            >
              <NuxtLink :to="localePath('/create')" class="plan-btn plan-btn--solid">{{ t('开始创作') }}</NuxtLink>
            </StudioEmpty>
            <StudioEmpty
              v-else
              :title="t('还没有公开作品')"
              :description="t('作者发布作品后会显示在这里。')"
            />
          </template>

          <div v-if="tab !== 'drafts'" class="show-grid author-grid">
            <NuxtLink
              v-for="item in current.items.value"
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
                <i class="show-card__play" aria-hidden="true">
                  <span><UIcon name="i-lucide-play" class="size-5" /></span>
                </i>
                <span v-if="item.open_source === 1" class="show-card__open">
                  <UIcon name="i-lucide-git-fork" class="size-3" />
                  {{ t('开源') }}<template v-if="item.clone_count"> · {{ item.clone_count }}</template>
                </span>
                <StudioWorkLike :work="item" />
              </div>
              <div class="show-card__meta">
                <div class="show-card__text">
                  <strong>{{ item.title }}</strong>
                  <span v-if="tab === 'likes'">{{ item.author?.nickname || t('创作者') }}</span>
                  <span v-else>{{ item.category ? t(item.category) : '' }}<template v-if="item.category && item.comment_count"> · </template><template v-if="item.comment_count">{{ t('{n} 条评论', { n: item.comment_count }) }}</template></span>
                </div>
              </div>
            </NuxtLink>
          </div>

          <div v-else class="show-grid author-grid">
            <NuxtLink
              v-for="item in drafts.items.value"
              :key="item.id"
              :to="localePath('/settings?tab=works')"
              class="show-card"
            >
              <div class="show-card__cover">
                <img v-if="item.cover_url" :src="resolveMediaUrl(item.cover_url)" :alt="item.title" loading="lazy">
                <span class="author-draft-badge">
                  <UIcon name="i-lucide-lock" class="size-3" />
                  {{ t('author.drafts') }}
                </span>
              </div>
              <div class="show-card__meta">
                <div class="show-card__text">
                  <strong>{{ item.title }}</strong>
                  <span>{{ item.category ? t(item.category) : '' }}</span>
                </div>
              </div>
            </NuxtLink>
          </div>
        </StudioPaging>
      </div>
    </div>
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
