<script setup lang="ts">
/**
 * OAuth 回调页：Google / GitHub / 微信开放平台等授权完成后回跳至此，
 * 再请求 GET /api/oauth/{provider} 完成登录。
 */
import { useOAuthLogin } from '~/composables/useOAuthLogin'
import { redirectAfterAuthLogin } from '~/composables/usePostLoginRedirect'

const { t } = useI18n()

definePageMeta({
  layout: false,
})

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()

useSeoMeta({
  robots: 'noindex, nofollow',
})

const { completeOAuthLogin } = useOAuthLogin()
const { setUser } = useAuth()
const isLoggedIn = useState('isLoggedIn', () => false)

const statusText = ref('')

function readOAuthCallbackParams() {
  const fromRoute = {
    code: String(route.query.code ?? '').trim(),
    state: String(route.query.state ?? '').trim(),
    error: String(route.query.error ?? '').trim(),
    errorDescription: String(route.query.error_description ?? route.query.error ?? '').trim(),
  }
  if (import.meta.client && (!fromRoute.code || !fromRoute.state)) {
    const params = new URLSearchParams(window.location.search)
    return {
      code: fromRoute.code || String(params.get('code') ?? '').trim(),
      state: fromRoute.state || String(params.get('state') ?? '').trim(),
      error: fromRoute.error || String(params.get('error') ?? '').trim(),
      errorDescription: fromRoute.errorDescription
        || String(params.get('error_description') ?? params.get('error') ?? '').trim(),
    }
  }
  return fromRoute
}

onMounted(async () => {
  statusText.value = t('auth.oauth.callbackProcessing')
  const provider = String(route.params.provider ?? '').trim()
  const { code, state, error, errorDescription } = readOAuthCallbackParams()

  if (error) {
    statusText.value = errorDescription || t('auth.oauth.callbackCancelled')
    toast.add({ title: errorDescription || t('auth.oauth.callbackFailed'), color: 'error', icon: 'i-lucide-x', close: false, progress: false, orientation: 'horizontal' })
    await navigateTo(localePath('/login'))
    return
  }

  if (!provider || !code || !state) {
    statusText.value = t('auth.oauth.callbackInvalid')
    toast.add({ title: t('auth.oauth.callbackInvalid'), color: 'error', icon: 'i-lucide-x', close: false, progress: false, orientation: 'horizontal' })
    await navigateTo(localePath('/login'))
    return
  }

  const res = await completeOAuthLogin(provider, code, state)
  if (res.ok) {
    setUser(res.user)
    isLoggedIn.value = true
    toast.add({ title: t('auth.toast.loginSuccess'), color: 'success', icon: 'i-lucide-check', close: false, progress: false, orientation: 'horizontal' })

    await redirectAfterAuthLogin()
    return
  }

  statusText.value = res.message ?? t('auth.oauth.callbackFailed')
  toast.add({ title: res.message ?? t('auth.oauth.callbackFailed'), color: 'error', icon: 'i-lucide-x', close: false, progress: false, orientation: 'horizontal' })
  await navigateTo(localePath('/login'))
})
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-3 bg-white px-4 dark:bg-zinc-950">
    <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-primary" />
    <p class="text-sm text-gray-600 dark:text-gray-400">
      {{ statusText }}
    </p>
  </div>
</template>
