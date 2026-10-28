<script setup lang="ts">
const { t } = useI18n()
/**
 * 全局处理微信扫码登录回调：任意页面 URL 上的 ?evidence= / ?error= 均可完成登录。
 */
const route = useRoute()
const toast = useToast()
const isLoggedIn = useState('isLoggedIn', () => false)
const {
  completeLoginFromEvidenceWithRetry,
  wechatOAuthErrorMessage,
  stopLoginStatusPolling,
  urlHandlerKey,
  urlHandlerProcessing,
  wechatEvidenceHandled,
} = useWeChatOpenLogin()

function readWechatOAuthEvidence(): string {
  const fromRoute = String(route.query.evidence ?? '').trim()
  if (fromRoute)
    return fromRoute
  if (import.meta.client) {
    return String(new URLSearchParams(window.location.search).get('evidence') ?? '').trim()
  }
  return ''
}

function readWechatOAuthError(): string {
  const fromRoute = String(route.query.error ?? '').trim()
  if (fromRoute)
    return fromRoute
  if (import.meta.client) {
    return String(new URLSearchParams(window.location.search).get('error') ?? '').trim()
  }
  return ''
}

async function clearWechatOAuthQuery() {
  const query = { ...route.query } as Record<string, string | undefined>
  delete query.evidence
  delete query.error
  await navigateTo({ path: route.path, query }, { replace: true })
}

async function handleWechatOAuthQuery() {
  const evidence = readWechatOAuthEvidence()
  const oauthError = readWechatOAuthError()
  if (!evidence && !oauthError)
    return

  const key = oauthError ? `error:${oauthError}` : `evidence:${evidence}`
  if (key === urlHandlerKey.value || urlHandlerProcessing.value)
    return

  urlHandlerProcessing.value = true
  urlHandlerKey.value = key

  try {
    if (oauthError) {
      stopLoginStatusPolling()
      toast.add({
        title: wechatOAuthErrorMessage(oauthError, t),
        color: 'error',
      })
      await clearWechatOAuthQuery()
      return
    }

    // 登录与绑定共用 evidence 轮询：已登录用户走绑定，匿名用户走登录
    const res = await completeLoginFromEvidenceWithRetry(evidence)
    if (res.ok) {
      await clearWechatOAuthQuery()
      return
    }
    if (res.message === t('登录尚未完成')) {
      return
    }
    if (res.message) {
      toast.add({ title: res.message, color: 'error' })
    }
    await clearWechatOAuthQuery()
  }
  finally {
    urlHandlerProcessing.value = false
  }
}

/** evidence 被处理（登录或绑定成功）后清理 URL 上的 query */
watch(wechatEvidenceHandled, async (handled) => {
  if (!handled || !readWechatOAuthEvidence())
    return
  if (wechatEvidenceHandled.value !== readWechatOAuthEvidence())
    return
  await clearWechatOAuthQuery()
})

onMounted(() => {
  void handleWechatOAuthQuery()
})

watch(
  () => [route.query.evidence, route.query.error] as const,
  (newVal, oldVal) => {
    if (newVal[0] === oldVal?.[0] && newVal[1] === oldVal?.[1])
      return
    void handleWechatOAuthQuery()
  },
)

watch(isLoggedIn, async (loggedIn) => {
  if (!loggedIn)
    return
  const evidence = readWechatOAuthEvidence()
  if (!evidence)
    return
  // 登录成功后由 redirectAfterAuthLogin 负责跳转，这里仅重置 handler key，
  // 不主动 navigateTo 清理 evidence，避免与 redirectAfterAuthLogin 的跳转发生竞态导致停留在原页面
  urlHandlerKey.value = ''
})
</script>

<template>
  <span class="hidden" aria-hidden="true" />
</template>
