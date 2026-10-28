<script setup lang="ts">
// 浏览器构建。包入口在服务端会加载 pngjs，Cloudflare 上 inherits(stream) 会让播放页 500。
import QRCode from 'qrcode/lib/browser.js'
import type { Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'
import { TIKTOK_HASHTAGS, YOUTUBE_HASHTAGS, withHashtags } from '~/utils/share-captions'

const { t, locale } = useI18n()

/**
 * 作品分享弹窗（T29）：复制链接 / 海报 / 文案 三个页签，外加 微信 / 抖音 / 小红书 / X 快捷分享。
 * 链接 = /watch/:id，登录用户带 ?ref=<aff_code>（播放页带 ref 打开会上报 share_open，作者得积分，API.md 8.4）。
 * 海报在 1080×1920 的 canvas 上画：封面（跨域失败退回深色渐变）+ 标题 + 作者 + 品牌标 + 右下角二维码。
 */
const props = defineProps<{
  open: boolean
  work: Work | null
}>()

const emit = defineEmits<{
  close: []
}>()

type Tab = 'link' | 'poster' | 'copy'
type CaptionKind = 'plain' | 'tiktok' | 'youtube'
type ShareKind = 'link' | 'poster' | 'copy' | 'wechat' | 'douyin' | 'xiaohongshu' | 'x' | 'tiktok' | 'youtube'

const toast = useToast()
const localePath = useLocalePath()
const config = useRuntimeConfig()
const { track } = useTrack()
const { isLoggedIn } = useAuth()
const { affCode, load: loadAffCode } = useMyInviteCode()
/** 分享出去的地址用公网站点，不用当前页的 origin。本地是 localhost，手机扫码打不开。 */
const siteUrl = String(config.public.siteUrl || '').replace(/\/$/, '')

const tab = ref<Tab>('link')
const captionKind = ref<CaptionKind>('plain')
const wechatOpen = ref(false)
const qrDataUrl = ref('')
const posterUrl = ref('')
const posterBusy = ref(false)
const isMobile = ref(false)

const link = computed(() => {
  if (!props.work || !import.meta.client)
    return ''
  // 分享链接走 localePath（F6）：英文等非默认语言带 /en 前缀，落地页与分享时看到的一致
  const path = localePath(`/watch/${props.work.id}`)
  const base = `${siteUrl || window.location.origin}${path}`
  return isLoggedIn.value && affCode.value ? `${base}?ref=${encodeURIComponent(affCode.value)}` : base
})

const shareText = computed(() => props.work ? t('我在 EasyTV 用 AI 做了《{title}》，来看看：{url}', { title: props.work.title, url: link.value }) : '')

/** TikTok 分享文案：通用文案（已按界面语言翻译）+ 海外话题标签 */
const tiktokCaption = computed(() => withHashtags(shareText.value, TIKTOK_HASHTAGS))
/** YouTube 分享文案：同上，标签换 Shorts 生态常用的 */
const youtubeCaption = computed(() => withHashtags(shareText.value, YOUTUBE_HASHTAGS))
const activeCaption = computed(() => {
  if (captionKind.value === 'tiktok')
    return tiktokCaption.value
  if (captionKind.value === 'youtube')
    return youtubeCaption.value
  return shareText.value
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function report(kind: ShareKind) {
  track('share_click', { work_id: props.work?.id ?? 0, kind })
}

async function copyText(text: string, done: string) {
  if (!text)
    return false
  try {
    await navigator.clipboard.writeText(text)
    notify(done, 'success')
    return true
  }
  catch {
    notify(t('当前浏览器不支持复制'), 'error')
    return false
  }
}

async function copyLink() {
  report('link')
  await copyText(link.value, t('链接已复制'))
}

async function copyActiveCaption() {
  if (captionKind.value === 'tiktok')
    report('tiktok')
  else if (captionKind.value === 'youtube')
    report('youtube')
  else
    report('copy')
  await copyText(activeCaption.value, t('文案已复制'))
}

// ---- 二维码 / 海报 ----

async function buildQr() {
  if (!link.value)
    return
  try {
    qrDataUrl.value = await QRCode.toDataURL(link.value, { width: 280, margin: 2, errorCorrectionLevel: 'H' })
  }
  catch {
    qrDataUrl.value = ''
  }
}

/** OSS 封面没有 CORS，直接画进 canvas 会失败。先经本站拉成同源图，上面才不是空渐变。 */
async function loadPosterCover(src: string): Promise<HTMLImageElement | null> {
  if (!src)
    return null
  let sameOrigin = false
  try {
    sameOrigin = new URL(src, window.location.origin).origin === window.location.origin
  }
  catch {
    sameOrigin = false
  }
  if (sameOrigin)
    return loadImage(src, false)
  const proxied = await loadImage(`/api/poster-image?url=${encodeURIComponent(src)}`, false)
  if (proxied)
    return proxied
  return loadImage(src, true)
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null)
      return
    }
    const img = new Image()
    if (crossOrigin)
      img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = []
  let current = ''
  for (const ch of Array.from(text)) {
    const next = current + ch
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current)
      current = ch
      if (lines.length === maxLines)
        break
    }
    else {
      current = next
    }
  }
  if (lines.length < maxLines && current)
    lines.push(current)
  if (lines.length === maxLines && ctx.measureText(text).width > maxWidth * maxLines) {
    const last = lines[maxLines - 1] ?? ''
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`
  }
  return lines
}

async function buildPoster() {
  const work = props.work
  if (!work || posterBusy.value || !import.meta.client)
    return
  posterBusy.value = true
  try {
    const W = 1080
    const H = 1920
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#111827')
    bg.addColorStop(1, '#0b0f1a')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    const coverH = 1350
    const cover = await loadPosterCover(resolveMediaUrl(work.cover_url))
    if (cover) {
      const scale = Math.max(W / cover.width, coverH / cover.height)
      const dw = cover.width * scale
      const dh = cover.height * scale
      ctx.drawImage(cover, (W - dw) / 2, (coverH - dh) / 2, dw, dh)
    }
    else {
      const fallback = ctx.createLinearGradient(0, 0, W, coverH)
      fallback.addColorStop(0, '#312e81')
      fallback.addColorStop(1, '#0f766e')
      ctx.fillStyle = fallback
      ctx.fillRect(0, 0, W, coverH)
    }
    const shade = ctx.createLinearGradient(0, coverH - 420, 0, coverH)
    shade.addColorStop(0, 'rgba(17, 24, 39, 0)')
    shade.addColorStop(1, 'rgba(17, 24, 39, 1)')
    ctx.fillStyle = shade
    ctx.fillRect(0, coverH - 420, W, 420)

    ctx.fillStyle = '#ffffff'
    ctx.textBaseline = 'top'
    ctx.font = 'bold 64px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    const titleLines = wrapLines(ctx, work.title || t('成片'), W - 160, 2)
    let y = 1400
    for (const line of titleLines) {
      ctx.fillText(line, 80, y)
      y += 84
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.font = '40px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(`@${work.author?.nickname || t('创作者')}`, 80, y + 12)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.font = '34px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(t('EasyTV · AI 视频工作台'), 80, H - 120)
    ctx.font = '28px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(t('扫码观看'), W - 80 - 260, H - 80 - 260 - 48)

    if (!qrDataUrl.value)
      await buildQr()
    const qr = await loadImage(qrDataUrl.value)
    if (qr) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(W - 80 - 276, H - 80 - 276, 276, 276)
      ctx.drawImage(qr, W - 80 - 268, H - 80 - 268, 260, 260)
    }

    try {
      posterUrl.value = canvas.toDataURL('image/png')
    }
    catch {
      posterUrl.value = ''
      notify(t('海报生成失败，封面图片不允许跨域'), 'error')
    }
  }
  finally {
    posterBusy.value = false
  }
}

function savePoster() {
  if (!posterUrl.value)
    return
  report('poster')
  if (isMobile.value) {
    notify(t('长按图片保存'))
    return
  }
  const a = document.createElement('a')
  a.href = posterUrl.value
  a.download = `easytv-${props.work?.id ?? 'poster'}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ---- 平台快捷分享 ----

function onSharePointerDown(event: PointerEvent) {
  event.stopPropagation()
  if (!wechatOpen.value)
    return
  const target = event.target as Node | null
  const root = event.currentTarget as HTMLElement | null
  if (!target || !root)
    return
  if (root.querySelector('.share-wechat')?.contains(target))
    return
  if (root.querySelector('.share-platform > button')?.contains(target))
    return
  wechatOpen.value = false
}

async function shareWechat() {
  if (wechatOpen.value) {
    wechatOpen.value = false
    return
  }
  report('wechat')
  wechatOpen.value = true
  if (!qrDataUrl.value)
    await buildQr()
}

/** 复制文案后跳到平台发布页（这些平台都没有 web 分享接口，只能人工粘贴） */
const SHARE_SITES: Record<'douyin' | 'xiaohongshu' | 'tiktok' | 'youtube', string> = {
  douyin: 'https://www.douyin.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  tiktok: 'https://www.tiktok.com/upload',
  youtube: 'https://studio.youtube.com/',
}

async function shareTo(kind: 'douyin' | 'xiaohongshu' | 'x' | 'tiktok' | 'youtube') {
  wechatOpen.value = false
  report(kind)
  // TikTok / YouTube 用带话题标签的平台专属文案（F6 分发引导），其余平台用通用文案
  const text = kind === 'tiktok' ? tiktokCaption.value : kind === 'youtube' ? youtubeCaption.value : shareText.value
  const copied = await copyText(text, t('文案已复制，发布时粘贴即可'))
  if (kind === 'x') {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText.value)}`, '_blank', 'noopener')
    return
  }
  if (!copied)
    return
  window.open(SHARE_SITES[kind], '_blank', 'noopener')
}

function selectTab(next: Tab) {
  tab.value = next
  wechatOpen.value = false
  if (next === 'poster' && !posterUrl.value)
    void buildPoster()
}

watch(() => props.open, async (open) => {
  if (!open)
    return
  tab.value = 'link'
  captionKind.value = 'plain'
  wechatOpen.value = false
  qrDataUrl.value = ''
  posterUrl.value = ''
  isMobile.value = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768
  await loadAffCode()
  void buildQr()
})

watch(link, () => {
  qrDataUrl.value = ''
  posterUrl.value = ''
  if (props.open) {
    void buildQr()
    if (tab.value === 'poster')
      void buildPoster()
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open && work" class="studio-modal-mask share-modal-mask" @click.self="emit('close')" @pointerdown="onSharePointerDown">
      <div class="studio-modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="share-title">{{ t('分享作品') }}</h2>
            <p>{{ work.title }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="share-modal__body">
          <div class="agent-tags share-tabs">
            <button type="button" :class="{ 'is-on': tab === 'link' }" @click="selectTab('link')">{{ t('复制链接') }}</button>
            <button type="button" :class="{ 'is-on': tab === 'poster' }" @click="selectTab('poster')">{{ t('海报') }}</button>
            <button type="button" :class="{ 'is-on': tab === 'copy' }" @click="selectTab('copy')">{{ t('文案') }}</button>
          </div>

          <div v-if="tab === 'link'" class="share-panel">
            <label class="publish-field">
              <span>{{ t('作品链接') }}</span>
              <div class="share-copy">
                <input :value="link" readonly @focus="($event.target as HTMLInputElement).select()">
                <button type="button" class="plan-btn plan-btn--solid" @click="copyLink">{{ t('复制') }}</button>
              </div>
            </label>
            <p v-if="isLoggedIn && affCode" class="share-hint">{{ t('链接带你的邀请码，别人通过它观看你会获得积分') }}</p>
          </div>

          <div v-else-if="tab === 'poster'" class="share-panel share-poster">
            <div class="share-poster__preview">
              <img v-if="posterUrl" :src="posterUrl" :alt="t('海报')">
              <div v-else class="share-poster__loading">
                <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
                <span>{{ t('正在生成海报…') }}</span>
              </div>
            </div>
          </div>

          <div v-else class="share-panel share-copy-panel">
            <div class="agent-tags share-caption-tabs">
              <button type="button" :class="{ 'is-on': captionKind === 'plain' }" @click="captionKind = 'plain'">{{ t('通用') }}</button>
              <button type="button" :class="{ 'is-on': captionKind === 'tiktok' }" @click="captionKind = 'tiktok'">TikTok</button>
              <button type="button" :class="{ 'is-on': captionKind === 'youtube' }" @click="captionKind = 'youtube'">YouTube</button>
            </div>
            <label class="publish-field share-caption">
              <span>{{ t('分享文案') }}</span>
              <textarea :value="activeCaption" readonly @focus="($event.target as HTMLTextAreaElement).select()" />
            </label>
            <button type="button" class="plan-btn plan-btn--solid" @click="copyActiveCaption">{{ t('复制文案') }}</button>
          </div>

          <div v-if="tab === 'poster'" class="share-poster__actions">
            <button type="button" class="plan-btn plan-btn--solid" :disabled="!posterUrl" @click="savePoster">{{ t('保存海报') }}</button>
            <p v-if="isMobile && posterUrl" class="share-hint">{{ t('长按图片保存') }}</p>
          </div>

          <div class="share-platforms">
            <div class="share-platform">
              <button type="button" :class="{ 'is-on': wechatOpen }" :aria-expanded="wechatOpen" @click="shareWechat">
                <UIcon name="i-lucide-message-circle" class="size-5" />
                <span>{{ t('微信') }}</span>
              </button>
              <div v-if="wechatOpen" class="share-wechat">
                <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('二维码')">
                <p>{{ t('用微信扫码打开后分享') }}</p>
              </div>
            </div>
            <button type="button" @click="shareTo('douyin')">
              <UIcon name="i-lucide-music-2" class="size-5" />
              <span>{{ t('抖音') }}</span>
            </button>
            <button type="button" @click="shareTo('xiaohongshu')">
              <UIcon name="i-lucide-book-open" class="size-5" />
              <span>{{ t('小红书') }}</span>
            </button>
            <button type="button" @click="shareTo('x')">
              <UIcon name="i-lucide-x" class="size-5" />
              <span>X</span>
            </button>
            <button type="button" @click="shareTo('tiktok')">
              <UIcon name="i-lucide-music-4" class="size-5" />
              <span>TikTok</span>
            </button>
            <button type="button" @click="shareTo('youtube')">
              <UIcon name="i-lucide-youtube" class="size-5" />
              <span>YouTube</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
