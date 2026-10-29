<script setup lang="ts">
import { LOGIN_MODAL_REQUIRED, OPEN_LOGIN_COOKIE, type LoginModalTab } from '~/utils/login-modal'

const { t } = useI18n()
const config = useRuntimeConfig()
const route = useRoute()
const { hydrate, isLoggedIn } = useAuth()
const { open, openLogin } = useLoginModal()
const openLoginCookie = useCookie<string | null>(OPEN_LOGIN_COOKIE, { path: '/', maxAge: 60 })
const loginRequiredPath = useState(LOGIN_MODAL_REQUIRED, () => '')

function routeNeedsAuth() {
  const middleware = route.meta.middleware
  const list = Array.isArray(middleware) ? middleware : middleware ? [middleware] : []
  return list.some(item => item === 'auth')
}

/** 受保护页面和旧登录地址都在当前页弹出登录框。 */
function syncLoginModal() {
  if (!import.meta.client)
    return
  hydrate()
  const tabCookie = String(openLoginCookie.value ?? '')
  if (isLoggedIn.value) {
    if (tabCookie)
      openLoginCookie.value = null
    return
  }
  if (tabCookie === 'login' || tabCookie === 'register' || tabCookie === 'forgot') {
    openLoginCookie.value = null
    openLogin({ tab: tabCookie as LoginModalTab, redirect: route.fullPath })
    return
  }
  if (!open.value && (routeNeedsAuth() || loginRequiredPath.value === route.fullPath))
    openLogin({ redirect: route.fullPath })
}

onMounted(syncLoginModal)
watch(() => route.fullPath, () => syncLoginModal())

/** 创作台内部切页：内容区淡入，侧栏和顶栏不动。登录 / 画布等自己关过渡。 */
const pageTransition = computed(() => {
  if (route.meta.pageTransition === false)
    return false
  if (route.meta.layout === 'studio')
    return { name: 'studio-page' }
  return false
})

const siteName = config.public.siteName as string
const siteUrl = String(config.public.siteUrl ?? '').replace(/\/$/, '')

const description = computed(() => t('meta.description'))
const keywords = computed(() => t('meta.keywords'))

/** canonical + hreflang alternate + og:locale，htmlAttrs.lang 也由 i18n 接管 */
const i18nHead = useLocaleHead({ lang: true, dir: false, seo: true })

useHead({
  titleTemplate: (titleChunk) => {
    return titleChunk ? `${titleChunk} · ${siteName}` : siteName
  },
  htmlAttrs: {
    lang: computed(() => i18nHead.value.htmlAttrs?.lang ?? 'zh'),
  },
  meta: computed(() => [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'description', content: description.value },
    { name: 'keywords', content: keywords.value },
    ...(i18nHead.value.meta ?? []),
  ]),
  link: computed(() => [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ...(i18nHead.value.link ?? []),
  ]),
})

useSeoMeta({
  ogSiteName: siteName,
  ogType: 'website',
  ogDescription: description,
  ogImage: `${siteUrl}/images/og-image.png`,
  twitterCard: 'summary_large_image',
  twitterDescription: description,
  twitterImage: `${siteUrl}/images/og-image.png`,
})
</script>

<template>
  <UApp :toaster="{ position: 'top-center', progress: false, duration: 2500, class: 'ea-compact-toaster' }">
    <div class="sr-only" aria-hidden="true">
      <UIcon name="i-lucide-circle-check" />
      <UIcon name="i-lucide-circle-alert" />
      <UIcon name="i-lucide-triangle-alert" />
      <UIcon name="i-lucide-info" />
    </div>
    <AuthWechatOAuthHandler />
    <StudioConfirmModal />
    <AuthLoginModal />
    <NuxtLayout>
      <NuxtPage :transition="pageTransition" />
    </NuxtLayout>
  </UApp>
</template>
