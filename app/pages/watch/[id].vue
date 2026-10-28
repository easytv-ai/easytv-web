<script setup lang="ts">
import workApi from '~/api/work'
import type { ClonePreview, Work, WorkProcess } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'
import { buildLoginRedirectQuery } from '~/utils/auth-login-redirect'
import { useTrack } from '~/composables/useTrack'
import { getUserId } from '~/utils/auth-user'
import { workLangForLocale } from '~/utils/work-lang'
import { classifyPublicWorkResponse } from '~/utils/watch-load'

const { t, locale } = useI18n()

/** 播放页匿名可看（GET /work/:id 走 TryUserAuth）；点赞 / 评论 / 举报等动作前用 requireLogin 拦截 */
definePageMeta({
  layout: false,
  // 同一播放页换 id 不重建组件，底部推荐条才不会先空掉、把上面的画面撑高
  key: 'watch-player',
})

const localePath = useLocalePath()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { isLoggedIn, requireLogin, loginPath } = useRequireLogin()
const { track } = useTrack()

/** 头部「登录 / 注册」链接：登录后回到本页 */
const loginHref = computed(() => loginPath(route.fullPath))
const registerHref = computed(() => localePath({ path: '/register', query: buildLoginRedirectQuery(route.fullPath) }))

const workId = computed(() => Number(Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) || 0)

const { data: watchLoad, pending: loading, refresh: refreshWork } = await useAsyncData(
  () => `watch-work-${workId.value}`,
  async () => {
    if (!workId.value)
      return classifyPublicWorkResponse<Work>({ success: false, message: '无效的作品 ID' })
    const res = await workApi.detail(workId.value)
    return classifyPublicWorkResponse(res)
  },
  { watch: [workId] },
)

/** 切下一条时 useAsyncData 会先清空当前详情。画面先留着，新数据到了再换，避免舞台闪成「加载中」。 */
const shown = ref<Work | null>(null)
watch(watchLoad, (load) => {
  if (load?.state === 'ok' && load.work?.id === workId.value)
    shown.value = load.work
}, { immediate: true })
const current = computed(() => shown.value)
const watchError = computed(() => {
  if (loading.value || watchLoad.value?.state !== 'error')
    return ''
  return watchLoad.value.message || t('作品加载失败')
})


const rail = useState<Work[]>('watch-rail', () => [])

const config = useRuntimeConfig()
const siteUrl = String(config.public.siteUrl || '').replace(/\/$/, '')
function absolute(url: string) {
  const resolved = resolveMediaUrl(url)
  return /^https?:/i.test(resolved) ? resolved : `${siteUrl}${resolved}`
}

useHead({
  title: computed(() => current.value?.title || t('成片')),
})
useSeoMeta({
  description: computed(() => current.value?.description || (current.value
    ? t('{author} 在 EasyTV 创作的 AI 视频《{title}》', {
        author: current.value.author?.nickname || t('创作者'),
        title: current.value.title,
      })
    : t('EasyTV 精选成片'))),
  ogType: 'video.other',
  ogTitle: computed(() => current.value?.title || t('成片')),
  ogDescription: computed(() => current.value?.description || ''),
  ogImage: computed(() => current.value?.cover_url ? absolute(current.value.cover_url) : `${siteUrl}/images/og-image.png`),
  ogUrl: computed(() => current.value ? `${siteUrl}${localePath(`/watch/${current.value.id}`)}` : siteUrl),
  twitterCard: 'summary_large_image',
})

const videoRef = ref<HTMLVideoElement | null>(null)
/** 点过播放后才揭开封面。没播之前一直显示作者选的封面，不用视频首帧顶掉。 */
const played = ref(false)
const railRef = ref<HTMLElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const muted = ref(false)
const liked = ref(false)
const liking = ref(false)
const hover = ref(false)

const authorName = computed(() => current.value?.author?.nickname || t('创作者'))

// ---- 关注作者（API.md 9.2，M11）：只在客户端补一次作者档案拿 is_following / followers ----
const authorFollowing = ref(false)
const authorFollowers = ref(0)
const isMine = computed(() => !!current.value?.user_id && String(current.value.user_id) === getUserId())
const canFollowAuthor = computed(() => !!current.value?.user_id && !isMine.value)

async function loadAuthorFollow(userId: number) {
  const res = await workApi.author(userId)
  if (!res?.success || !res.data)
    return
  if (res.data.mine)
    return
  authorFollowing.value = !!res.data.is_following
  authorFollowers.value = Number(res.data.followers ?? 0)
}

function onAuthorFollowChange(following: boolean, followers: number) {
  authorFollowing.value = following
  authorFollowers.value = followers
}

watch(current, (work) => {
  if (!import.meta.client || !work?.user_id || String(work.user_id) === getUserId())
    return
  void loadAuthorFollow(work.user_id)
}, { immediate: true })
const fullTitle = computed(() => current.value ? t('概念短片《{title}》', { title: current.value.title }) : '')
const videoSrc = computed(() => resolveMediaUrl(current.value?.video_url))
const poster = computed(() => resolveMediaUrl(current.value?.cover_url))

function formatDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

async function loadRail() {
  // 推荐栏按界面语言过滤（F6，API.md 10.7）：英文界面只推英文作品；中文不传，兼容历史空 lang 数据
  const res = await workApi.feed({ page: 1, page_size: 30, lang: workLangForLocale(locale.value) })
  if (res?.success && res.data)
    rail.value = res.data.items
}

watch(current, (work, prev) => {
  liked.value = Boolean(work?.liked)
  if (!work || work.id === prev?.id)
    return
  playing.value = false
  played.value = false
  currentTime.value = 0
  duration.value = 0
  nextTick(() => {
    videoRef.value?.pause()
  })
}, { immediate: true })

watch([loading, watchLoad, workId], async ([busy, load, id]) => {
  if (busy || !id || load?.state !== 'missing')
    return
  notify(t('作品不存在或已下架'), 'error')
  await router.replace(localePath('/studio'))
})

async function retryWork() {
  if (loading.value)
    return
  await refreshWork()
}

function formatTime(value: number) {
  const total = Math.max(0, Math.floor(value || 0))
  const minutes = String(Math.floor(total / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function onTimeUpdate() {
  const video = videoRef.value
  if (!video)
    return
  currentTime.value = video.currentTime
  duration.value = video.duration || 0
}

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2]
const playbackRate = ref(1)

function applyPlaybackRate(rate: number) {
  playbackRate.value = rate
  if (videoRef.value)
    videoRef.value.playbackRate = rate
}

function cyclePlaybackRate() {
  const index = PLAYBACK_RATES.indexOf(playbackRate.value)
  applyPlaybackRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1)
}

function seekBy(delta: number) {
  const video = videoRef.value
  if (!video || !duration.value)
    return
  video.currentTime = Math.min(duration.value, Math.max(0, video.currentTime + delta))
  currentTime.value = video.currentTime
}

function onLoaded() {
  const video = videoRef.value
  if (!video)
    return
  duration.value = video.duration || 0
  video.playbackRate = playbackRate.value
}

async function togglePlay() {
  const video = videoRef.value
  if (!video)
    return
  if (video.paused) {
    played.value = true
    await video.play().catch(() => {})
    playing.value = !video.paused
    if (video.paused)
      played.value = false
  }
  else {
    video.pause()
    playing.value = false
  }
}

function seek(event: Event) {
  const video = videoRef.value
  const input = event.target as HTMLInputElement
  if (!video || !duration.value)
    return
  video.currentTime = (Number(input.value) / 1000) * duration.value
}

function toggleMute() {
  const video = videoRef.value
  if (!video)
    return
  video.muted = !video.muted
  muted.value = video.muted
}

async function toggleFullscreen() {
  const video = videoRef.value
  if (!video)
    return
  if (document.fullscreenElement)
    await document.exitFullscreen()
  else
    await video.requestFullscreen().catch(() => {})
}

function openShow(id: number) {
  if (id === current.value?.id)
    return
  const cached = rail.value.find(item => item.id === id)
  if (cached) {
    played.value = false
    shown.value = cached
  }
  void router.replace(localePath(`/watch/${id}`))
}

function scrollRail(dir: -1 | 1) {
  railRef.value?.scrollBy({ left: dir * 280, behavior: 'smooth' })
}

async function toggleLike() {
  if (!current.value || liking.value)
    return
  if (!requireLogin())
    return
  liking.value = true
  try {
    const res = await workApi.like(current.value.id)
    if (!res?.success || !res.data) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    liked.value = res.data.liked
    current.value.like_count = res.data.like_count
  }
  finally {
    liking.value = false
  }
}

const processOpen = ref(false)

// ---- 做同款（POST /user/work/:id/clone，API.md 7.3）----
const isOpenSource = computed(() => {
  const work = current.value
  if (!work || work.open_source !== 1)
    return false
  return Boolean(work.source?.canvas_id || work.source_canvas_id)
})
const cloneCount = computed(() => Number(current.value?.source?.clone_count ?? current.value?.clone_count ?? 0) || 0)
const cloning = ref(false)

// 做同款先看预览（API.md 14.3），确认后再复制
const clonePreviewOpen = ref(false)
const clonePreviewLoading = ref(false)
const clonePreview = ref<ClonePreview | null>(null)

async function onClone() {
  const work = current.value
  if (!work || cloning.value)
    return
  track('watch_clone_click', { work_id: work.id })
  if (!requireLogin())
    return
  clonePreviewOpen.value = true
  clonePreviewLoading.value = true
  clonePreview.value = null
  try {
    const res = await workApi.clonePreview(work.id)
    if (!res?.success || !res.data) {
      clonePreviewOpen.value = false
      notify(res?.message || t('做同款失败，请稍后重试'), 'error')
      return
    }
    clonePreview.value = res.data
  }
  finally {
    clonePreviewLoading.value = false
  }
}

async function confirmClone() {
  const work = current.value
  if (!work || cloning.value)
    return
  track('watch_clone_confirm', { work_id: work.id, estimate: clonePreview.value?.estimate_points })
  cloning.value = true
  try {
    const res = await workApi.clone(work.id)
    if (!res?.success || !res.data?.canvas_id) {
      notify(res?.message || t('做同款失败，请稍后重试'), 'error')
      return
    }
    if (work.source)
      work.source.clone_count = (work.source.clone_count || 0) + 1
    clonePreviewOpen.value = false
    notify(t('已复制到我的项目，开始创作吧'), 'success')
    await navigateTo(localePath({ path: '/canvas', query: { id: String(res.data.canvas_id), project_id: res.data.project_id ? String(res.data.project_id) : undefined } }))
  }
  finally {
    cloning.value = false
  }
}

/** 开源作品：折叠的「提示词 / 模型」面板，展开时才拉 GET /work/:id/process */
const sourceOpen = ref(false)
const sourceLoading = ref(false)
const sourceError = ref('')
const sourceData = ref<WorkProcess | null>(null)
const sourceNodes = computed(() => {
  if (!sourceData.value)
    return []
  return [...sourceData.value.nodes]
    .filter(node => node.prompt || node.model)
    .sort((a, b) => a.x - b.x || a.y - b.y)
})

async function toggleSource() {
  sourceOpen.value = !sourceOpen.value
  if (!sourceOpen.value || sourceData.value || sourceLoading.value || !current.value)
    return
  sourceLoading.value = true
  sourceError.value = ''
  try {
    const res = await workApi.process(current.value.id)
    if (!res?.success || !res.data) {
      sourceError.value = res?.message || t('制作过程暂不可用')
      return
    }
    sourceData.value = res.data
  }
  finally {
    sourceLoading.value = false
  }
}

async function copyPrompt(text: string) {
  if (!text || !navigator.clipboard?.writeText)
    return
  await navigator.clipboard.writeText(text)
  notify(t('提示词已复制'), 'success')
}

watch(workId, () => {
  sourceOpen.value = false
  sourceData.value = null
  sourceError.value = ''
})

// ---- 评论抽屉 ----
const commentsOpen = ref(false)

function onCommentCount(delta: number) {
  if (current.value)
    current.value.comment_count = Math.max(0, (current.value.comment_count || 0) + delta)
}

// ---- 举报（作品 POST /user/work/:id/report，评论 POST /user/comment/:id/report） ----
const REPORT_REASONS = ['违规内容', '侵权', '垃圾信息', '其他']
const reportOpen = ref(false)
const reporting = ref(false)
const reportForm = reactive({ reason: REPORT_REASONS[0] as string, content: '' })
const reportTarget = ref<{ type: 'work' | 'comment', id: number } | null>(null)

function openReport(target?: { type: 'work' | 'comment', id: number }) {
  if (!requireLogin())
    return
  reportTarget.value = target ?? (current.value ? { type: 'work', id: current.value.id } : null)
  if (!reportTarget.value)
    return
  reportForm.reason = REPORT_REASONS[0] as string
  reportForm.content = ''
  reportOpen.value = true
}

function onReportComment(commentId: number) {
  openReport({ type: 'comment', id: commentId })
}

async function submitReport() {
  const target = reportTarget.value
  if (!target || reporting.value)
    return
  reporting.value = true
  try {
    const payload = { reason: reportForm.reason, content: reportForm.content.trim() }
    const res = target.type === 'comment'
      ? await workApi.reportComment(target.id, payload)
      : await workApi.report(target.id, payload)
    if (!res?.success) {
      notify(res?.message || t('提交失败'), 'error')
      return
    }
    reportOpen.value = false
    notify(t('已收到举报，我们会尽快处理'))
  }
  finally {
    reporting.value = false
  }
}

// ---- 分享弹窗（T29）与分享回流（API.md 8.4）----
const shareOpen = ref(false)

function onShare() {
  if (!current.value)
    return
  shareOpen.value = true
}

/** 带 ?ref= 打开且访客不是作者本人：每次页面加载只上报一次 share_open，服务端给作者加积分 */
let shareOpenTracked = false
watch(current, (work) => {
  if (!import.meta.client || shareOpenTracked || !work)
    return
  const ref = String(Array.isArray(route.query.ref) ? route.query.ref[0] : route.query.ref ?? '').trim()
  if (!ref || String(work.user_id) === getUserId())
    return
  shareOpenTracked = true
  track('share_open', { work_id: work.id, ref })
}, { immediate: true })

const progress = computed(() => duration.value ? (currentTime.value / duration.value) * 1000 : 0)

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el)
    return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

function playerOverlayOpen() {
  return commentsOpen.value || processOpen.value || clonePreviewOpen.value || shareOpen.value || reportOpen.value
}

/** 快捷键：Esc 返回；空格播放；←/→ 快进退；M 静音；F 全屏；L 点赞。弹层或输入中不触发。 */
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey)
    return
  if (isTypingTarget(event.target))
    return

  if (event.key === 'Escape') {
    if (reportOpen.value) {
      if (!reporting.value)
        reportOpen.value = false
      return
    }
    if (commentsOpen.value || processOpen.value || clonePreviewOpen.value || shareOpen.value)
      return
    goBack()
    return
  }

  if (playerOverlayOpen() || !current.value)
    return

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === ' ' || key === 'k') {
    event.preventDefault()
    void togglePlay()
    return
  }
  if (key === 'ArrowLeft' || key === 'j') {
    event.preventDefault()
    seekBy(-5)
    return
  }
  if (key === 'ArrowRight') {
    event.preventDefault()
    seekBy(5)
    return
  }
  if (key === 'm') {
    event.preventDefault()
    toggleMute()
    return
  }
  if (key === 'f') {
    event.preventDefault()
    void toggleFullscreen()
    return
  }
  if (key === 'l') {
    event.preventDefault()
    void toggleLike()
    return
  }
  if (key === '>' || (key === '.' && event.shiftKey)) {
    event.preventDefault()
    cyclePlaybackRate()
  }
}

/** 返回：有站内来路就走浏览器历史（列表页保留滚动位置），否则回创作台首页 */
function goBack() {
  if (import.meta.client && window.history.state?.back)
    router.back()
  else
    void router.push(localePath('/studio'))
}

onMounted(() => {
  void loadRail()
  window.addEventListener('keydown', onGlobalKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <div class="watch-page">
    <header class="watch-bar">
      <div class="watch-bar__left">
        <button type="button" class="watch-back" @click="goBack">
          <UIcon name="i-lucide-chevron-left" class="size-4" />
          {{ t('返回') }}
        </button>
        <NuxtLink v-if="current?.user_id" :to="localePath(`/author/${current.user_id}`)" class="watch-author">
          <span class="watch-avatar">{{ authorName.slice(0, 1) }}</span>
          <strong>{{ authorName }}</strong>
        </NuxtLink>
        <template v-else>
          <span class="watch-avatar">{{ authorName.slice(0, 1) }}</span>
          <strong>{{ authorName }}</strong>
        </template>
        <ClientOnly>
          <StudioFollowButton
            v-if="canFollowAuthor"
            :author-id="current?.user_id ?? 0"
            :name="authorName"
            :following="authorFollowing"
            :followers="authorFollowers"
            size="compact"
            @change="onAuthorFollowChange"
          />
        </ClientOnly>
        <span class="watch-bar__split" />
        <h1>{{ fullTitle }}</h1>
      </div>
      <div class="watch-bar__end">
        <div v-if="current" class="watch-bar__right">
          <p>{{ t('更新时间') }}: {{ formatDate(current.published_at || current.updated_at) }}</p>
          <p>{{ t('含 AI 生成内容') }}</p>
        </div>
        <!-- 登录态只在客户端有（localStorage），用 ClientOnly 避免 SSR 与客户端首帧不一致 -->
        <ClientOnly>
          <div v-if="!isLoggedIn" class="watch-bar__auth">
            <NuxtLink :to="loginHref" class="watch-auth-link">{{ t('登录') }}</NuxtLink>
            <span class="watch-bar__auth-split" aria-hidden="true">/</span>
            <NuxtLink :to="registerHref" class="watch-auth-link is-solid">{{ t('注册') }}</NuxtLink>
          </div>
        </ClientOnly>
      </div>
    </header>

    <div
      class="watch-stage"
      @mouseenter="hover = true"
      @mouseleave="hover = false"
    >
      <div v-if="!current && loading" class="watch-fallback">
        <p>{{ t('加载中…') }}</p>
      </div>
      <div v-else-if="watchError" class="watch-fallback">
        <p>{{ watchError }}</p>
        <button type="button" class="watch-chip" :disabled="loading" @click="retryWork">
          {{ loading ? t('加载中…') : t('重试') }}
        </button>
      </div>

      <video
        v-if="current"
        ref="videoRef"
        :src="videoSrc"
        playsinline
        :preload="poster ? 'metadata' : 'auto'"
        @click="togglePlay"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoaded"
        @ended="playing = false"
      />
      
      <img
        v-if="current && poster"
        class="watch-poster"
        :class="{ 'is-off': played }"
        :src="poster"
        alt=""
      >

      <div v-if="current && !playing" class="watch-hero">
        <h2>{{ current.title }}</h2>
        <div class="watch-hero__actions">
          <button type="button" class="watch-play" :aria-label="t('播放')" @click="togglePlay">
            <UIcon name="i-lucide-play" class="size-6" />
          </button>
          <button v-if="isOpenSource" type="button" class="watch-chip watch-chip--primary" :disabled="cloning" @click="onClone">
            <UIcon name="i-lucide-copy-plus" class="size-4" />
            {{ cloning ? t('复制中…') : t('做同款') }}
            <b v-if="cloneCount > 0" class="watch-chip__count">· {{ cloneCount }}</b>
          </button>
          <button v-if="(current.show_process && current.canvas_id) || isOpenSource" type="button" class="watch-chip" @click="processOpen = true">
            <UIcon name="i-lucide-file-text" class="size-4" />
            {{ t('查看制作过程') }}
          </button>
          <div class="watch-hero__tools">
            <button type="button" class="watch-icon" :class="{ 'is-on': liked }" :aria-label="liked ? t('取消喜欢') : t('喜欢')" :disabled="liking" @click="toggleLike">
              <UIcon name="i-lucide-heart" class="size-4" />
              <span v-if="current.like_count" class="watch-icon__count">{{ current.like_count }}</span>
              <span class="canvas-tip canvas-tip--up">{{ liked ? t('取消喜欢') : t('喜欢') }}</span>
            </button>
            <button type="button" class="watch-icon" :class="{ 'is-on': commentsOpen }" :aria-label="t('评论')" @click="commentsOpen = true">
              <UIcon name="i-lucide-message-circle" class="size-4" />
              <span v-if="current.comment_count" class="watch-icon__count">{{ current.comment_count }}</span>
              <span class="canvas-tip canvas-tip--up">{{ t('评论') }}</span>
            </button>
            <button type="button" class="watch-icon" :aria-label="t('分享')" @click="onShare">
              <UIcon name="i-lucide-share-2" class="size-4" />
              <span class="canvas-tip canvas-tip--up">{{ t('分享') }}</span>
            </button>
            <button type="button" class="watch-icon" :aria-label="t('举报')" @click="openReport()">
              <UIcon name="i-lucide-octagon-alert" class="size-4" />
              <span class="canvas-tip canvas-tip--up">{{ t('举报') }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="current" class="watch-controls" :class="{ 'is-on': hover }">
        <button type="button" :aria-label="t('播放或暂停')" @click="togglePlay">
          <UIcon :name="playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-4" />
        </button>
        <span>{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
        <input
          type="range"
          min="0"
          max="1000"
          :value="progress"
          @input="seek"
        >
        <button type="button" class="watch-controls__rate" :aria-label="t('watch.player.rate', { n: playbackRate })" @click="cyclePlaybackRate">
          {{ t('watch.player.rate', { n: playbackRate }) }}
        </button>
        <button type="button" :aria-label="t('静音')" @click="toggleMute">
          <UIcon :name="muted ? 'i-lucide-volume-off' : 'i-lucide-volume-2'" class="size-4" />
        </button>
        <button type="button" :aria-label="t('全屏')" @click="toggleFullscreen">
          <UIcon name="i-lucide-maximize" class="size-4" />
        </button>
      </div>
    </div>

    <section v-if="current && isOpenSource" class="watch-source" :class="{ 'is-open': sourceOpen }">
      <button type="button" class="watch-source__head" :aria-expanded="sourceOpen" @click="toggleSource">
        <span class="watch-source__badge">{{ t('开源') }}</span>
        <strong>{{ t('提示词 / 模型') }}</strong>
        <small>{{ t('作者已开源创作过程，可直接做同款') }}</small>
        <UIcon name="i-lucide-chevron-down" class="size-4 watch-source__arrow" />
      </button>
      <div v-if="sourceOpen" class="watch-source__body">
        <p v-if="sourceLoading" class="watch-source__empty">{{ t('加载中…') }}</p>
        <p v-else-if="sourceError" class="watch-source__empty">{{ sourceError }}</p>
        <p v-else-if="!sourceNodes.length" class="watch-source__empty">{{ t('这个作品没有可展示的提示词') }}</p>
        <ul v-else class="watch-source__list">
          <li v-for="node in sourceNodes" :key="node.id">
            <div class="watch-source__meta">
              <strong>{{ node.label || node.kind }}</strong>
              <span v-if="node.model" class="watch-source__model">{{ node.model }}</span>
              <button v-if="node.prompt" type="button" class="watch-source__copy" @click="copyPrompt(node.prompt)">
                <UIcon name="i-lucide-copy" class="size-3.5" />
                {{ t('复制') }}
              </button>
            </div>
            <p v-if="node.prompt" class="watch-source__prompt">{{ node.prompt }}</p>
          </li>
        </ul>
      </div>
    </section>

    <div class="watch-rail">
      <button type="button" class="watch-rail__arrow" :aria-label="t('上一组')" @click="scrollRail(-1)">
        <UIcon name="i-lucide-chevron-left" class="size-4" />
      </button>
      <div ref="railRef" class="watch-rail__list">
        <button
          v-for="item in rail"
          :key="item.id"
          type="button"
          class="watch-thumb"
          :class="{ 'is-on': item.id === current?.id }"
          @mousedown.prevent
          @click="openShow(item.id)"
        >
          <img :src="resolveMediaUrl(item.cover_url)" :alt="item.title">
          <span>{{ item.title }}</span>
        </button>
      </div>
      <button type="button" class="watch-rail__arrow" :aria-label="t('下一组')" @click="scrollRail(1)">
        <UIcon name="i-lucide-chevron-right" class="size-4" />
      </button>
    </div>

  <WatchProcessModal :open="processOpen" :work-id="current?.id ?? 0" @close="processOpen = false" />
  <WatchClonePreview :open="clonePreviewOpen" :preview="clonePreview" :loading="clonePreviewLoading" :cloning="cloning" @close="clonePreviewOpen = false" @confirm="confirmClone" />
  <StudioShareModal :open="shareOpen" :work="current ?? null" @close="shareOpen = false" />
  <WatchCommentsPanel
    :open="commentsOpen"
    :work-id="current?.id ?? 0"
    :owner-id="current?.user_id ?? 0"
    @close="commentsOpen = false"
    @count-change="onCommentCount"
    @report="onReportComment"
  />
  <Teleport to="body">
    <div v-if="reportOpen" class="studio-modal-mask watch-report-mask" @click.self="!reporting && (reportOpen = false)">
      <div class="studio-modal publish-modal watch-report" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="report-title">{{ reportTarget?.type === 'comment' ? t('举报评论') : t('举报作品') }}</h2>
            <p>{{ reportTarget?.type === 'comment' ? t('举报成立后评论会被隐藏，请如实填写') : t('举报成立后作品会被下架，请如实填写') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="reporting" @click="reportOpen = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="publish-modal__form">
          <label class="publish-field">
            <span>{{ t('原因') }}</span>
            <div class="publish-tags">
              <button
                v-for="r in REPORT_REASONS"
                :key="r"
                type="button"
                :class="{ 'is-on': reportForm.reason === r }"
                @click="reportForm.reason = r"
              >
                {{ t(r) }}
              </button>
            </div>
          </label>
          <label class="publish-field">
            <span>{{ t('补充说明') }}</span>
            <textarea v-model="reportForm.content" rows="3" maxlength="500" :placeholder="t('选填，描述具体问题')" />
          </label>
        </div>
        <footer class="plan-confirm__actions publish-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="reporting" @click="reportOpen = false">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid is-danger" :disabled="reporting" @click="submitReport">
            {{ reporting ? t('提交中…') : t('提交举报') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio.css';
</style>
