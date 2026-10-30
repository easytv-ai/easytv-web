<script setup lang="ts">
// 浏览器构建。包入口在服务端会加载 pngjs，Cloudflare 上 inherits(stream) 会让播放页 500。
import QRCode from 'qrcode/lib/browser.js'
import type { Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'
import { TIKTOK_HASHTAGS, YOUTUBE_HASHTAGS, withHashtags } from '~/utils/share-captions'

const { t } = useI18n()

/**
 * 分享弹窗（T29）：顶部是带二维码的分享卡片预览，下面是各平台快捷分享、保存海报 / 复制文案、链接栏。
 * 分享作品时链接 = /watch/:id，分享作者主页时 = /author/:id；
 * 登录用户带 ?ref=<aff_code>（播放页带 ref 打开会上报 share_open，作者得积分，API.md 8.4）。
 * 海报在 1080×1920 的 canvas 上画：封面（跨域失败退回深色渐变）+ 标题 + 副标题 + 品牌标 + 右下角二维码。
 */
export type ShareAuthor = {
  id: number
  nickname: string
  workCount: number
  followers: number
  /** 海报封面，取主页第一部作品的封面 */
  cover?: string
}

const props = defineProps<{
  open: boolean
  work?: Work | null
  author?: ShareAuthor | null
}>()

const target = computed(() => {
  if (props.work) {
    const w = props.work
    return { kind: 'work' as const, id: w.id, path: `/watch/${w.id}`, title: w.title, subtitle: `@${w.author?.nickname || t('创作者')}`, cover: w.cover_url }
  }
  if (props.author) {
    const a = props.author
    return {
      kind: 'author' as const,
      id: a.id,
      path: `/author/${a.id}`,
      title: a.nickname,
      subtitle: `${t('{n} 部作品', { n: a.workCount })} · ${t('{n} 位粉丝', { n: a.followers })}`,
      cover: a.cover || '',
    }
  }
  return null
})

const emit = defineEmits<{
  close: []
}>()

type ShareKind = 'link' | 'poster' | 'copy' | 'wechat' | 'douyin' | 'xiaohongshu' | 'x' | 'tiktok' | 'youtube'

const toast = useToast()
const localePath = useLocalePath()
const config = useRuntimeConfig()
const { track } = useTrack()
const { isLoggedIn } = useAuth()
const { affCode, load: loadAffCode } = useMyInviteCode()
/** 分享出去的地址用公网站点，不用当前页的 origin。本地是 localhost，手机扫码打不开。 */
const siteUrl = String(config.public.siteUrl || '').replace(/\/$/, '')

const qrDataUrl = ref('')
const posterUrl = ref('')
const posterBusy = ref(false)
/** 手机上不能直接下载，海报生成后在弹窗里铺开，让用户长按保存 */
const posterView = ref(false)
/** 点「微信」时让卡片上的二维码闪一下，提示用微信扫它 */
const qrPulse = ref(false)
const isMobile = ref(false)

const coverUrl = computed(() => target.value?.cover ? resolveMediaUrl(target.value.cover) : '')
const scanLabel = computed(() => target.value?.kind === 'author' ? t('share.scanVisit') : t('扫码观看'))

const link = computed(() => {
  if (!target.value || !import.meta.client)
    return ''
  // 分享链接走 localePath（F6）：英文等非默认语言带 /en 前缀，落地页与分享时看到的一致
  const path = localePath(target.value.path)
  const base = `${siteUrl || window.location.origin}${path}`
  return isLoggedIn.value && affCode.value ? `${base}?ref=${encodeURIComponent(affCode.value)}` : base
})

const shareText = computed(() => {
  const tg = target.value
  if (!tg)
    return ''
  return tg.kind === 'work'
    ? t('我在 EasyTV 用 AI 做了《{title}》，来看看：{url}', { title: tg.title, url: link.value })
    : t('author.shareText', { name: tg.title, url: link.value })
})

/** TikTok 分享文案：通用文案（已按界面语言翻译）+ 海外话题标签 */
const tiktokCaption = computed(() => withHashtags(shareText.value, TIKTOK_HASHTAGS))
/** YouTube 分享文案：同上，标签换 Shorts 生态常用的 */
const youtubeCaption = computed(() => withHashtags(shareText.value, YOUTUBE_HASHTAGS))

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function report(kind: ShareKind) {
  const tg = target.value
  track('share_click', tg?.kind === 'author' ? { author_id: tg.id, kind } : { work_id: tg?.id ?? 0, kind })
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

async function copyCaption() {
  report('copy')
  await copyText(shareText.value, t('文案已复制'))
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
  const tg = target.value
  if (!tg || posterBusy.value || !import.meta.client)
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
    const cover = await loadPosterCover(resolveMediaUrl(tg.cover))
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
    const titleLines = wrapLines(ctx, tg.title || t('成片'), W - 160, 2)
    let y = 1400
    for (const line of titleLines) {
      ctx.fillText(line, 80, y)
      y += 84
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.font = '40px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(tg.subtitle, 80, y + 12)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.font = '34px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(t('EasyTV · AI 视频工作台'), 80, H - 120)
    ctx.font = '28px "PingFang SC", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(scanLabel.value, W - 80 - 260, H - 80 - 260 - 48)

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

async function savePoster() {
  if (posterBusy.value)
    return
  if (!posterUrl.value)
    await buildPoster()
  if (!posterUrl.value)
    return
  report('poster')
  if (isMobile.value) {
    posterView.value = true
    return
  }
  const a = document.createElement('a')
  a.href = posterUrl.value
  a.download = target.value ? `easytv-${target.value.kind}-${target.value.id}.png` : 'easytv-poster.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ---- 平台快捷分享 ----

type Platform = 'wechat' | 'douyin' | 'xiaohongshu' | 'x' | 'tiktok' | 'youtube'
/** 品牌图标走 Iconify simple-icons；抖音与 TikTok 同一个标 */
const PLATFORMS: { key: Platform, label: string, icon: string, translate: boolean }[] = [
  { key: 'wechat', label: '微信', icon: 'i-simple-icons-wechat', translate: true },
  { key: 'douyin', label: '抖音', icon: 'i-simple-icons-tiktok', translate: true },
  { key: 'xiaohongshu', label: '小红书', icon: 'i-simple-icons-xiaohongshu', translate: true },
  { key: 'x', label: 'X', icon: 'i-simple-icons-x', translate: false },
  { key: 'tiktok', label: 'TikTok', icon: 'i-simple-icons-tiktok', translate: false },
  { key: 'youtube', label: 'YouTube', icon: 'i-simple-icons-youtube', translate: false },
]

const linkLabel = computed(() => target.value?.kind === 'author' ? t('author.shareLink') : t('作品链接'))

let qrPulseTimer: ReturnType<typeof setTimeout> | undefined

async function shareWechat() {
  report('wechat')
  if (!qrDataUrl.value)
    await buildQr()
  notify(t('用微信扫码打开后分享'))
  qrPulse.value = false
  await nextTick()
  qrPulse.value = true
  clearTimeout(qrPulseTimer)
  qrPulseTimer = setTimeout(() => { qrPulse.value = false }, 1600)
}

/** 复制文案后跳到平台发布页（这些平台都没有 web 分享接口，只能人工粘贴） */
const SHARE_SITES: Record<'douyin' | 'xiaohongshu' | 'tiktok' | 'youtube', string> = {
  douyin: 'https://www.douyin.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  tiktok: 'https://www.tiktok.com/upload',
  youtube: 'https://studio.youtube.com/',
}

async function shareTo(kind: 'douyin' | 'xiaohongshu' | 'x' | 'tiktok' | 'youtube') {
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

function onPlatform(key: Platform) {
  if (key === 'wechat')
    void shareWechat()
  else
    void shareTo(key)
}

watch(() => props.open, async (open) => {
  if (!open)
    return
  posterView.value = false
  qrPulse.value = false
  qrDataUrl.value = ''
  posterUrl.value = ''
  isMobile.value = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768
  await loadAffCode()
  void buildQr()
})

watch(link, () => {
  qrDataUrl.value = ''
  posterUrl.value = ''
  posterView.value = false
  if (props.open)
    void buildQr()
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  clearTimeout(qrPulseTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open && target" class="studio-modal-mask share-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <header class="share-modal__head">
          <h2 id="share-title">{{ target.kind === 'work' ? t('分享作品') : t('author.share') }}</h2>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="share-modal__body">
          <div v-if="posterView" class="share-poster-view">
            <img :src="posterUrl" :alt="t('海报')">
            <p class="share-hint">{{ t('长按图片保存') }}</p>
            <button type="button" class="share-action" @click="posterView = false">
              <UIcon name="i-lucide-arrow-left" class="size-4" />
              {{ t('返回') }}
            </button>
          </div>

          <template v-else>
            <div class="share-card">
              <img v-if="coverUrl" :src="coverUrl" alt="" class="share-card__bg" aria-hidden="true">
              <div class="share-card__main">
                <span v-if="target.kind === 'author'" class="share-card__avatar">{{ target.title.slice(0, 1) }}</span>
                <img v-else-if="coverUrl" :src="coverUrl" :alt="target.title" class="share-card__thumb">
                <div class="share-card__text">
                  <strong>{{ target.title }}</strong>
                  <span>{{ target.subtitle }}</span>
                </div>
                <span class="share-card__brand">
                  <UIcon name="i-lucide-play" class="size-3" />
                  EasyTV
                </span>
              </div>
              <div class="share-card__qr" :class="{ 'is-pulse': qrPulse }">
                <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('二维码')">
                <UIcon v-else name="i-lucide-loader-circle" class="size-5 animate-spin" />
                <small>{{ scanLabel }}</small>
              </div>
            </div>

            <section class="share-to">
              <h3>{{ t('share.to') }}</h3>
              <div class="share-to__grid">
                <button
                  v-for="p in PLATFORMS"
                  :key="p.key"
                  type="button"
                  :class="`is-${p.key}`"
                  @click="onPlatform(p.key)"
                >
                  <i><UIcon :name="p.icon" /></i>
                  <span>{{ p.translate ? t(p.label) : p.label }}</span>
                </button>
              </div>
            </section>

            <div class="share-actions">
              <button type="button" class="share-action" :disabled="posterBusy" @click="savePoster">
                <UIcon :name="posterBusy ? 'i-lucide-loader-circle' : 'i-lucide-image-down'" class="size-4" :class="{ 'animate-spin': posterBusy }" />
                {{ posterBusy ? t('正在生成海报…') : t('保存海报') }}
              </button>
              <button type="button" class="share-action" @click="copyCaption">
                <UIcon name="i-lucide-text-quote" class="size-4" />
                {{ t('复制文案') }}
              </button>
            </div>

            <div class="share-link">
              <UIcon name="i-lucide-link" class="share-link__icon" />
              <input :value="link" readonly :aria-label="linkLabel" @focus="($event.target as HTMLInputElement).select()">
              <button type="button" class="share-link__copy" @click="copyLink">{{ t('复制链接') }}</button>
            </div>
            <p v-if="isLoggedIn && affCode" class="share-hint">{{ t('链接带你的邀请码，别人通过它观看你会获得积分') }}</p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
