<script setup lang="ts">
import appApi from '~/api/app'
import partnerApi from '~/api/partner'
import type { PartnerLanding } from '~/types/creative'
import { mergeAttribution } from '~/utils/attribution'
import { normalizeGrowth } from '~/composables/useStudioAppConfig'

const { t } = useI18n()

/**
 * 渠道伙伴落地页：/partner/:code，匿名可看、SSR（GET /partner/:code）。
 * 落地即把伙伴码写进归因 cookie，「注册开始创作」跳 /register?pcode=<code>；已登录直接去创作台。
 */
definePageMeta({
  layout: false,
})

const route = useRoute()
const localePath = useLocalePath()
const { isLoggedIn, hydrate } = useAuth()
const { growth, load: loadAppConfig } = useStudioAppConfig()

const code = computed(() => String(Array.isArray(route.params.code) ? route.params.code[0] : route.params.code ?? '').trim().toUpperCase())

const { data, pending } = await useAsyncData(
  () => `partner-${code.value}`,
  async () => {
    if (!code.value)
      return null
    const res = await partnerApi.landing(code.value)
    if (!res?.success || !res.data || res.data.valid === false)
      return null
    // 礼包数值 SSR 也要有：useStudioAppConfig.load 只在客户端跑
    const configRes = await appApi.config().catch(() => null)
    const rawConfig = (configRes as any)?.data ?? configRes ?? {}
    return {
      partner: res.data as PartnerLanding,
      growth: normalizeGrowth(rawConfig?.growth),
    }
  },
  { watch: [code] },
)

const partner = computed(() => data.value?.partner ?? null)
const name = computed(() => partner.value?.name || t('渠道伙伴'))
const invalid = computed(() => !pending.value && !partner.value)

const signupPoints = computed(() => data.value?.growth?.signup_points || growth.value?.signup_points || 0)
const inviteePoints = computed(() => data.value?.growth?.invite_invitee_points || growth.value?.invite_invitee_points || 100)

const registerHref = computed(() => localePath({ path: '/register', query: { pcode: code.value } }))
const loginHref = computed(() => localePath({ path: '/login', query: { pcode: code.value } }))

useHead({
  title: computed(() => partner.value ? t('{name} 邀请你加入 EasyTV', { name: name.value }) : t('邀请你加入 EasyTV')),
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
  if (partner.value)
    mergeAttribution({ pcode: code.value })
  void loadAppConfig()
})

watch(isLoggedIn, (on) => {
  if (on)
    gotoStudio()
})
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
      <div v-if="pending && !partner" class="invite-state">{{ t('加载中…') }}</div>

      <div v-else-if="invalid" class="invite-state">
        <UIcon name="i-lucide-link-2-off" class="size-8" />
        <p>{{ t('推广链接无效或已失效') }}</p>
        <NuxtLink :to="localePath('/')" class="plan-btn plan-btn--ghost invite-state__btn">{{ t('返回首页') }}</NuxtLink>
      </div>

      <template v-else>
        <section class="invite-hero">
          <span class="invite-hero__avatar">{{ name.slice(0, 1) }}</span>
          <h1>{{ t('{name} 邀请你加入 EasyTV', { name }) }}</h1>
          <p class="invite-hero__lead">{{ t('用 EasyTV 画布把想法拆成镜头，一键生成图片与视频') }}</p>
          <p v-if="partner?.intro" class="invite-hero__intro">{{ partner.intro }}</p>
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
      </template>
    </main>

    <footer v-if="!invalid && partner" class="invite-actions">
      <NuxtLink :to="registerHref" class="plan-btn plan-btn--solid invite-actions__primary">{{ t('注册开始创作') }}</NuxtLink>
      <NuxtLink :to="loginHref" class="invite-actions__login">{{ t('已有账号，登录') }}</NuxtLink>
    </footer>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/layout.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
