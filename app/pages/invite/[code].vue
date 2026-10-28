<script setup lang="ts">
import appApi from '~/api/app'
import inviteApi from '~/api/invite'
import workApi from '~/api/work'
import type { AuthorProfile, InviteInfo, Work } from '~/types/creative'
import { mergeAttribution } from '~/utils/attribution'
import { normalizeGrowth } from '~/composables/useStudioAppConfig'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/**
 * 邀请落地页：/invite/:code，匿名可看、SSR（GET /invite/:code + GET /author/:id + GET /work?user_id=）。
 * 落地即把邀请码写进归因 cookie，「注册领取」跳 /register?ref=<code>；已登录直接去创作台。
 */
definePageMeta({
  layout: false,
})

const route = useRoute()
const localePath = useLocalePath()
const { isLoggedIn, hydrate } = useAuth()
const { growth, load: loadAppConfig } = useStudioAppConfig()

const code = computed(() => String(Array.isArray(route.params.code) ? route.params.code[0] : route.params.code ?? '').trim().toUpperCase())

const WORK_LIMIT = 6

const { data, pending } = await useAsyncData(
  () => `invite-${code.value}`,
  async () => {
    if (!code.value)
      return null
    const res = await inviteApi.resolve(code.value)
    if (!res?.success || !res.data)
      return null
    const invite = res.data as InviteInfo
    // 礼包数值 SSR 也要有：/app/config 的 growth 在服务端一并取（useStudioAppConfig.load 只在客户端跑）
    const [profileRes, worksRes, configRes] = await Promise.all([
      workApi.author(invite.user_id),
      workApi.feed({ user_id: invite.user_id, page: 1, page_size: WORK_LIMIT }),
      appApi.config().catch(() => null),
    ])
    const rawConfig = configRes?.data ?? configRes ?? {}
    return {
      invite,
      profile: profileRes?.success && profileRes.data ? profileRes.data as AuthorProfile : null,
      works: worksRes?.success && worksRes.data ? (worksRes.data.items ?? []).slice(0, WORK_LIMIT) as Work[] : [],
      growth: normalizeGrowth(rawConfig?.growth),
    }
  },
  { watch: [code] },
)

const invite = computed(() => data.value?.invite ?? null)
const profile = computed(() => data.value?.profile ?? null)
const works = computed(() => data.value?.works ?? [])
const name = computed(() => invite.value?.nickname || profile.value?.nickname || t('创作者'))
const invalid = computed(() => !pending.value && !invite.value)

const signupPoints = computed(() => data.value?.growth?.signup_points || growth.value?.signup_points || 0)
const inviteePoints = computed(() => data.value?.growth?.invite_invitee_points || growth.value?.invite_invitee_points || 100)

const registerHref = computed(() => localePath({ path: '/register', query: { ref: code.value } }))
const loginHref = computed(() => localePath({ path: '/login', query: { ref: code.value } }))

useHead({
  title: computed(() => invite.value ? t('{name} 邀请你加入 EasyTV', { name: name.value }) : t('邀请你加入 EasyTV')),
})
useSeoMeta({
  description: computed(() => signupPoints.value
    ? t('注册即得 {n} 积分新人礼包', { n: signupPoints.value })
    : t('用 EasyTV 画布把想法拆成镜头，一键生成图片与视频')),
  robots: 'noindex, nofollow',
})

function gotoStudio() {
  void navigateTo(localePath('/studio'), { replace: true })
}

onMounted(() => {
  hydrate()
  if (isLoggedIn.value) {
    gotoStudio()
    return
  }
  if (invite.value)
    mergeAttribution({ ref: code.value })
  void loadAppConfig()
})

watch(isLoggedIn, (on) => {
  if (on)
    gotoStudio()
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
  <div class="invite-page">
    <header class="invite-bar">
      <NuxtLink :to="localePath('/')" class="invite-brand">
        <img src="/images/logo.svg" alt="EasyTV" width="22" height="22">
        EasyTV
      </NuxtLink>
      <ThemeToggle />
    </header>

    <main class="invite-main">
      <div v-if="pending && !invite" class="invite-state">{{ t('加载中…') }}</div>

      <div v-else-if="invalid" class="invite-state">
        <UIcon name="i-lucide-link-2-off" class="size-8" />
        <p>{{ t('邀请链接无效或已失效') }}</p>
        <NuxtLink :to="localePath('/')" class="plan-btn plan-btn--ghost invite-state__btn">{{ t('返回首页') }}</NuxtLink>
      </div>

      <template v-else>
        <section class="invite-hero">
          <span class="invite-hero__avatar">{{ name.slice(0, 1) }}</span>
          <h1>{{ t('{name} 邀请你加入 EasyTV', { name }) }}</h1>
          <p class="invite-hero__lead">{{ t('用 EasyTV 画布把想法拆成镜头，一键生成图片与视频') }}</p>
          <dl v-if="profile" class="invite-hero__stats">
            <div><dt>{{ t('作品') }}</dt><dd>{{ profile.work_count }}</dd></div>
            <div><dt>{{ t('喜欢') }}</dt><dd>{{ profile.like_total.toLocaleString() }}</dd></div>
            <div><dt>{{ t('播放') }}</dt><dd>{{ profile.view_total.toLocaleString() }}</dd></div>
          </dl>
        </section>

        <section class="invite-gift">
          <div v-if="signupPoints" class="invite-gift__item">
            <UIcon name="i-lucide-gift" class="size-5" />
            <span>{{ t('注册即得 {n} 积分新人礼包', { n: signupPoints }) }}</span>
          </div>
          <div class="invite-gift__item">
            <UIcon name="i-lucide-clapperboard" class="size-5" />
            <span>{{ t('完成首条视频再得 {n} 积分', { n: inviteePoints }) }}</span>
          </div>
        </section>

        <section v-if="works.length" class="invite-works">
          <h2>{{ t('{name} 的作品', { name }) }}</h2>
          <div class="show-grid invite-works__grid">
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
                  preload="none"
                />
                <span class="show-card__likes">
                  <UIcon name="i-lucide-heart" class="size-3.5" />
                  {{ item.like_count }}
                </span>
              </div>
              <div class="show-card__meta">
                <div class="show-card__text">
                  <strong>{{ item.title }}</strong>
                  <span v-if="item.category">{{ t(item.category) }}</span>
                </div>
              </div>
            </NuxtLink>
          </div>
        </section>
      </template>
    </main>

    <footer v-if="!invalid && invite" class="invite-actions">
      <NuxtLink :to="registerHref" class="plan-btn plan-btn--solid invite-actions__primary">{{ t('注册领取') }}</NuxtLink>
      <NuxtLink :to="loginHref" class="invite-actions__login">{{ t('已有账号，登录') }}</NuxtLink>
    </footer>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/layout.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
