import type { AuthUser } from '~/utils/auth-login-parse'
import oauth from '~/api/oauth'
import userManagement from '~/api/user-management'
import { parseEmailFromSelfResponse } from '~/composables/useAuthSelfSync'
import { redirectAfterAuthLogin } from '~/composables/usePostLoginRedirect'
import { useAuth } from '~/composables/useAuth'
import { useI18n, useToast } from '#imports'

export const WECHAT_OPEN_PROVIDER = 'wechat-open'

const WX_LOGIN_SCRIPT = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
const WX_LOGIN_CSS_HREF = '/css/wechat-qr.css?v=center4'

const WECHAT_LOGIN_POLL_INTERVAL_MS = 3000
const WECHAT_QR_POLL_TIMEOUT_MS = 60 * 1000
const WECHAT_LOGIN_POLL_TIMEOUT_MS = 5 * 60 * 1000
/** 后端 callback 处理期间短暂删 state 再写入，连续 expired 仍继续轮询的上限 */
const EXPIRED_POLL_MAX_STREAK = 8

const WECHAT_OAUTH_ERROR_I18N: Record<string, string> = {
  access_denied: 'auth.oauth.callbackCancelled',
  invalid_state: 'auth.wechat.stateFailed',
  token_failed: 'auth.oauth.callbackFailed',
  userinfo_failed: 'auth.oauth.callbackFailed',
  user_deleted: 'auth.oauth.callbackFailed',
  user_banned: 'auth.oauth.callbackFailed',
  register_disabled: 'auth.oauth.callbackFailed',
  missing_config: 'auth.wechat.notConfigured',
  already_bound: 'auth.wechat.alreadyBound',
  bind_failed: 'auth.wechat.bindFailed',
  user_not_found: 'auth.wechat.userNotFound',
}

interface WechatPreauthData {
  app_id?: string
  appid?: string
  state?: string
  redirect_uri?: string
  scope?: string
  auth_url?: string
}

interface WechatLoginStatusData {
  status?: string
  action?: string
  access_token?: string
  user?: Record<string, unknown>
  /** status=error 时的失败原因（user_banned / token_failed / ...） */
  error_code?: string
}

let wxLoginScriptPromise: Promise<void> | null = null
let pollEvidence = ''
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollStartedAt = 0
let pollInFlight = false
let pollGeneration = 0
let mountQrCodeToken = 0
/** 模块级硬锁：同一 evidence 的请求在飞行中时，任何二次调用都复用同一个 promise */
let activeLoginStatusEvidence = ''
let activeLoginStatusPromise: Promise<any> | null = null
let activeLoginStatusExpiresAt = 0
/** 防止 URL evidence 处理 / 轮询重复启动 */
let urlEvidencePolling = ''
/** 连续 expired 次数；后端 callback 会先删 state 再写入，短暂返回 expired 属正常 */
let expiredPollStreak = 0

async function fetchWechatLoginStatus(evidence: string): Promise<any> {
  const trimmed = String(evidence ?? '').trim()
  if (!trimmed)
    return null

  // 硬锁：同一 evidence 的请求飞行中或冷却期内，直接复用
  if (activeLoginStatusEvidence === trimmed && activeLoginStatusPromise) {
    if (Date.now() < activeLoginStatusExpiresAt)
      return activeLoginStatusPromise
    // 过期则清除，允许新请求
    if (!pollInFlight) {
      activeLoginStatusEvidence = ''
      activeLoginStatusPromise = null
    }
    else {
      return activeLoginStatusPromise
    }
  }

  const promise = oauth.wechatOAuthLoginStatus({ evidence: trimmed }).finally(() => {
    // 请求结束后保留 800ms 冷却，防止极短时间内重复打
    activeLoginStatusExpiresAt = Date.now() + 800
    setTimeout(() => {
      if (activeLoginStatusPromise === promise) {
        activeLoginStatusEvidence = ''
        activeLoginStatusPromise = null
      }
    }, 800)
  })
  activeLoginStatusEvidence = trimmed
  activeLoginStatusPromise = promise
  return promise
}

function loadWxLoginScript(): Promise<void> {
  if (!import.meta.client)
    return Promise.reject(new Error('client only'))
  if (typeof WxLogin !== 'undefined')
    return Promise.resolve()
  if (wxLoginScriptPromise)
    return wxLoginScriptPromise
  wxLoginScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = WX_LOGIN_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('wxLogin script failed'))
    document.body.appendChild(script)
  })
  return wxLoginScriptPromise
}

function userFromWechatLoginStatus(data: WechatLoginStatusData): AuthUser | null {
  const accessToken = String(data.access_token ?? '').trim()
  const user = data.user
  if (!accessToken || !user)
    return null
  return {
    ...user,
    username: String(user.username ?? ''),
    access_token: accessToken,
    token: accessToken,
  }
}

export function useWeChatOpenLogin() {
  const { setUser } = useAuth()
  const { t } = useI18n()
  const toast = useToast()
  const isLoggedIn = useState('isLoggedIn', () => false)
  const wechatEnabled = useState('wechat-open-enabled', () => true)
  const wechatPanelOpen = useState('wechat-open-panel-open', () => false)
  const wechatEvidenceHandled = useState<string | null>('wechat-evidence-handled', () => null)
  const urlHandlerKey = useState<string>('wechat-url-handler-key', () => '')
  const urlHandlerProcessing = useState<boolean>('wechat-url-handler-processing', () => false)
  const qrLoading = ref(false)
  const qrError = ref<'notConfigured' | 'stateFailed' | 'loadFailed' | 'expired' | 'oauth' | ''>('')
  /** 后端回调失败原因（qrError === 'oauth' 时展示对应文案） */
  const qrErrorCode = ref('')
  const wechatLoginProcessing = ref(false)
  /** 绑定成功时自增，供设置页 watch 后刷新用户信息 */
  const wechatBindSuccessTick = useState<number>('wechat-bind-success-tick', () => 0)
  /** 微信 OAuth 结果处理中（轮询 / 登录 / 跳转），用于 loading 态 */
  const wechatOAuthResolving = useState<boolean>('wechat-oauth-resolving', () => false)

  let mountedContainerId = ''

  function stopLoginStatusPolling() {
    pollGeneration++
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    pollEvidence = ''
    pollStartedAt = 0
    pollInFlight = false
    urlEvidencePolling = ''
    expiredPollStreak = 0
  }

  /** 从 self 接口拉取邮箱（login-status 不含 email，且不能依赖 refresh 间接更新） */
  async function fetchEmailFromSelf(): Promise<string> {
    try {
      const res = await userManagement.self()
      return parseEmailFromSelfResponse(res)
    }
    catch {
      return ''
    }
  }

  function scheduleNextLoginStatusPoll(gen: number) {
    if (gen !== pollGeneration || !pollEvidence || !import.meta.client)
      return
    if (pollTimer)
      clearTimeout(pollTimer)
    pollTimer = setTimeout(() => {
      void pollLoginStatusOnce(gen)
    }, WECHAT_LOGIN_POLL_INTERVAL_MS)
  }

  async function pollLoginStatusOnce(gen: number) {
    if (gen !== pollGeneration || !pollEvidence || !import.meta.client)
      return
    if (pollStartedAt) {
      const limit = urlEvidencePolling ? WECHAT_LOGIN_POLL_TIMEOUT_MS : WECHAT_QR_POLL_TIMEOUT_MS
      if (Date.now() - pollStartedAt > limit) {
        const showReload = !urlEvidencePolling
        stopLoginStatusPolling()
        if (showReload) {
          wechatOAuthResolving.value = false
          qrError.value = 'expired'
        }
        return
      }
    }

    const evidence = pollEvidence
    if (!pollInFlight)
      pollInFlight = true
    try {
      const res = await fetchWechatLoginStatus(evidence)
      if (gen !== pollGeneration || pollEvidence !== evidence)
        return
      const data = (res?.data ?? {}) as WechatLoginStatusData
      const status = String(data.status ?? '').trim()

      if (status === 'success' && res?.success) {
        expiredPollStreak = 0
        wechatOAuthResolving.value = true
        qrError.value = ''
        if (String(data.action ?? '').trim() === 'bind')
          await applyWechatBindSuccess(data, evidence)
        else
          await applyWechatLoginSuccess(data, evidence)
        return
      }
      if (status === 'pending_binding') {
        expiredPollStreak = 0
        wechatOAuthResolving.value = true
        qrError.value = ''
        // 不再绑定邮箱：有 token 则直接登录，否则继续按未注册处理
        const loggedIn = await applyWechatLoginSuccess(data, evidence)
        if (!loggedIn)
          await applyWechatPendingBinding(evidence)
        return
      }
      if (status === 'error') {
        // 回调失败原因由后端写回 state：停止轮询并在面板内展示具体错误
        const fromUrl = Boolean(urlEvidencePolling)
        expiredPollStreak = 0
        stopLoginStatusPolling()
        wechatOAuthResolving.value = false
        qrErrorCode.value = String(data.error_code ?? '').trim()
        qrError.value = 'oauth'
        if (fromUrl) {
          // 顶层 URL 跳转场景没有二维码面板：直接 toast，并标记已处理以便清理 URL 上的 evidence
          wechatEvidenceHandled.value = evidence
          toast.add({ title: wechatOAuthErrorMessage(qrErrorCode.value, t), color: 'error' })
        }
        return
      }
      if (status === 'expired') {
        // 后端处理 callback 时会短暂删 state，轮询可能误报 expired，继续重试
        expiredPollStreak++
        if (expiredPollStreak < EXPIRED_POLL_MAX_STREAK)
          return
        stopLoginStatusPolling()
        wechatOAuthResolving.value = false
        qrError.value = 'stateFailed'
        return
      }

      expiredPollStreak = 0
    }
    catch {
      // 网络抖动时继续轮询
    }
    finally {
      pollInFlight = false
      if (gen === pollGeneration && pollEvidence)
        scheduleNextLoginStatusPoll(gen)
    }
  }

  function startLoginStatusPolling(evidence: string, options?: { fromUrl?: boolean }) {
    const trimmed = String(evidence ?? '').trim()
    if (!trimmed)
      return false
    if (pollEvidence === trimmed && (pollInFlight || pollTimer))
      return false
    if (options?.fromUrl && urlEvidencePolling === trimmed && pollEvidence === trimmed)
      return false

    stopLoginStatusPolling()
    if (options?.fromUrl)
      urlEvidencePolling = trimmed
    expiredPollStreak = 0
    const gen = pollGeneration
    pollEvidence = trimmed
    pollStartedAt = Date.now()
    pollInFlight = true
    void pollLoginStatusOnce(gen)
    return true
  }
  async function applyWechatLoginSuccess(data: WechatLoginStatusData, evidence?: string): Promise<boolean> {
    const authUser = userFromWechatLoginStatus(data)
    if (!authUser?.access_token)
      return false
    wechatOAuthResolving.value = true
    setUser(authUser)
    isLoggedIn.value = true
    stopLoginStatusPolling()
    clearQrCodeWithoutStoppingPoll()
    const email = await fetchEmailFromSelf()
    if (email)
      setUser({ ...authUser, email })
    toast.add({
      title: t('auth.toast.loginSuccess'),
      color: 'success',
      icon: 'i-lucide-check',
      close: false,
      progress: false,
      orientation: 'horizontal',
    })
    await redirectAfterAuthLogin()
    if (evidence)
      wechatEvidenceHandled.value = evidence
    wechatOAuthResolving.value = false
    return true
  }

  /** 绑定模式成功：用户已登录，不重设会话，仅提示并触发设置页刷新用户信息 */
  async function applyWechatBindSuccess(_data: WechatLoginStatusData, evidence?: string): Promise<boolean> {
    if (evidence)
      wechatEvidenceHandled.value = evidence
    stopLoginStatusPolling()
    wechatPanelOpen.value = false
    clearQrCodeWithoutStoppingPoll()
    toast.add({
      title: t('auth.wechat.bindSuccess'),
      color: 'success',
      icon: 'i-lucide-check',
      close: false,
      progress: false,
      orientation: 'horizontal',
    })
    wechatBindSuccessTick.value += 1
    wechatOAuthResolving.value = false
    return true
  }

  /** 微信扫码后该微信号未注册：不再走绑定邮箱，提示用手机号登录 */
  async function applyWechatPendingBinding(evidence: string): Promise<boolean> {
    const trimmed = String(evidence ?? '').trim()
    if (!trimmed)
      return false
    if (wechatEvidenceHandled.value === trimmed)
      return true
    stopLoginStatusPolling()
    clearQrCodeWithoutStoppingPoll()
    wechatPanelOpen.value = false
    toast.add({
      title: t('auth.wechat.unregistered'),
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
      close: false,
      progress: false,
      orientation: 'horizontal',
    })
    wechatEvidenceHandled.value = trimmed
    wechatOAuthResolving.value = false
    return true
  }

  function clearQrCodeWithoutStoppingPoll() {
    if (mountedContainerId && import.meta.client) {
      const container = document.getElementById(mountedContainerId)
      if (container)
        container.innerHTML = ''
    }
    mountedContainerId = ''
  }

  /** WxLogin iframe 首次 load 是二维码页，再次 load 表示已跳到 OAuth callback，提前盖住避免裂图 */
  function bindQrIframeConfirmOverlay(containerId: string) {
    if (!import.meta.client)
      return
    const sizeIframe = (iframe: HTMLIFrameElement) => {
      iframe.style.setProperty('width', '160px', 'important')
      iframe.style.setProperty('height', '160px', 'important')
      iframe.style.setProperty('margin', '0 auto', 'important')
      iframe.style.setProperty('display', 'block', 'important')
      iframe.removeAttribute('width')
      iframe.removeAttribute('height')
    }
    const attach = () => {
      const container = document.getElementById(containerId)
      const iframe = container?.querySelector('iframe')
      if (!iframe)
        return false
      sizeIframe(iframe)
      let loads = 0
      iframe.addEventListener('load', () => {
        sizeIframe(iframe)
        loads += 1
        if (loads < 2 || mountedContainerId !== containerId)
          return
        wechatOAuthResolving.value = true
      })
      return true
    }
    if (attach())
      return
    window.setTimeout(() => {
      attach()
    }, 300)
  }

  function clearQrCode() {
    stopLoginStatusPolling()
    clearQrCodeWithoutStoppingPoll()
  }

  async function tryLoginFromEvidence(
    evidence: string,
  ): Promise<{ ok: true } | { ok: false, message?: string, pending?: boolean }> {
    const trimmed = String(evidence ?? '').trim()
    if (!trimmed)
      return { ok: false, message: t('无效的登录凭证') }
    if (wechatEvidenceHandled.value === trimmed && isLoggedIn.value)
      return { ok: true }

    const res = await fetchWechatLoginStatus(trimmed)
    if (!res) {
      return { ok: false, message: t('微信登录失败') }
    }
    const data = (res?.data ?? {}) as WechatLoginStatusData
    const status = String(data.status ?? '').trim()

    if (status === 'pending_binding') {
      wechatOAuthResolving.value = true
      const loggedIn = await applyWechatLoginSuccess(data, trimmed)
      if (loggedIn)
        return { ok: true }
      void applyWechatPendingBinding(trimmed)
      return { ok: true }
    }
    if (status === 'pending')
      return { ok: false, message: t('登录尚未完成'), pending: true }
    if (status === 'error')
      return { ok: false, message: wechatOAuthErrorMessage(String(data.error_code ?? '').trim(), t) }
    if (status === 'expired')
      return { ok: false, message: t('登录已过期，请重新扫码') }

    if (!res?.success || status !== 'success') {
      return { ok: false, message: String(res?.message ?? t('微信登录失败')) }
    }

    if (String(data.action ?? '').trim() === 'bind') {
      wechatOAuthResolving.value = true
      const ok = await applyWechatBindSuccess(data, trimmed)
      if (!ok) {
        wechatOAuthResolving.value = false
        return { ok: false, message: t('微信绑定失败') }
      }
      return { ok: true }
    }

    wechatOAuthResolving.value = true
    const ok = await applyWechatLoginSuccess(data, trimmed)
    if (!ok) {
      wechatOAuthResolving.value = false
      return { ok: false, message: t('未获取到登录凭证') }
    }
    return { ok: true }
  }

  function parseWechatPreauth(res: any): WechatPreauthData | null {
    if (!res?.success)
      return null
    const data = (res.data ?? res) as WechatPreauthData
    const state = String(data.state ?? '').trim()
    const appId = String(data.app_id ?? data.appid ?? '').trim()
    const redirectUri = String(data.redirect_uri ?? '').trim()
    if (!state || !appId || !redirectUri)
      return null
    return data
  }

  async function fetchWechatPreauth(redirectUrl?: string): Promise<WechatPreauthData | null> {
    const url = redirectUrl ?? (import.meta.client ? window.location.href : '')
    const fromPost = parseWechatPreauth(await oauth.wechatOAuthPreauth({
      redirect_url: url,
    }))
    if (fromPost)
      return fromPost
    return parseWechatPreauth(await oauth.wechat({
      redirect_uri: url,
    }))
  }

  async function completeLoginFromEvidence(evidence: string): Promise<{ ok: true } | { ok: false, message?: string }> {
    const trimmed = String(evidence ?? '').trim()
    if (!trimmed)
      return { ok: false, message: t('无效的登录凭证') }
    if (wechatEvidenceHandled.value === trimmed && isLoggedIn.value)
      return { ok: true }

    wechatLoginProcessing.value = true
    try {
      stopLoginStatusPolling()
      const res = await tryLoginFromEvidence(trimmed)
      if (res.ok)
        return { ok: true }
      return { ok: false, message: res.message }
    }
    finally {
      wechatLoginProcessing.value = false
    }
  }

  /** URL 回调场景：仅启动一条轮询链，避免 tryLogin + poll 连续打两次 */
  async function completeLoginFromEvidenceWithRetry(
    evidence: string,
  ): Promise<{ ok: true } | { ok: false, message?: string }> {
    const trimmed = String(evidence ?? '').trim()
    if (!trimmed)
      return { ok: false, message: t('无效的登录凭证') }
    if (wechatEvidenceHandled.value === trimmed && isLoggedIn.value)
      return { ok: true }

    if (pollEvidence === trimmed && (pollInFlight || pollTimer))
      return { ok: false, message: t('登录尚未完成') }

    const started = startLoginStatusPolling(trimmed, { fromUrl: true })
    if (!started)
      return { ok: false, message: t('登录尚未完成') }

    return { ok: false, message: t('登录尚未完成') }
  }

  async function mountQrCode(containerId: string, redirectUrl?: string) {
    if (!import.meta.client)
      return
    const token = ++mountQrCodeToken
    qrLoading.value = true
    qrError.value = ''
    qrErrorCode.value = ''
    wechatOAuthResolving.value = false
    clearQrCode()
    try {
      const container = document.getElementById(containerId)
      if (container)
        container.innerHTML = ''

      const preauth = await fetchWechatPreauth(redirectUrl)
      if (token !== mountQrCodeToken)
        return
      if (!preauth) {
        qrError.value = 'stateFailed'
        return
      }

      const appId = String(preauth.app_id ?? preauth.appid ?? '').trim()
      const state = String(preauth.state ?? '').trim()
      const redirectUri = String(preauth.redirect_uri ?? '').trim()
      const scope = String(preauth.scope ?? 'snsapi_login').trim() || 'snsapi_login'

      if (!appId) {
        qrError.value = 'notConfigured'
        return
      }

      await loadWxLoginScript()
      if (token !== mountQrCodeToken)
        return

      // self_redirect: true — 回调在 iframe 内跳转至后端 callback，避免手机扫码后
      // 微信脚本操控顶层 window 被浏览器 SecurityError 拦截；父页轮询 login-status 完成登录。
      // eslint-disable-next-line no-new
      new WxLogin({
        self_redirect: true,
        id: containerId,
        appid: appId,
        scope,
        redirect_uri: encodeURIComponent(redirectUri),
        state,
        style: 'black',
        stylelite: 1,
        href: WX_LOGIN_CSS_HREF,
      })
      mountedContainerId = containerId
      // iframe 二次 load = 已跳到后端 callback；立刻盖住二维码区，避免短暂露出裂图
      bindQrIframeConfirmOverlay(containerId)

      // 登录与绑定都靠父页轮询；iframe 内 callback 不再把 evidence 抛到顶层 URL
      startLoginStatusPolling(state)
    }
    catch {
      if (token === mountQrCodeToken)
        qrError.value = 'loadFailed'
    }
    finally {
      if (token === mountQrCodeToken)
        qrLoading.value = false
    }
  }

  function wechatOAuthErrorMessage(errorCode: string, t: (key: string) => string): string {
    const key = WECHAT_OAUTH_ERROR_I18N[errorCode]
    return key ? t(key) : t('auth.oauth.callbackFailed')
  }

  function openWechatPanel() {
    wechatPanelOpen.value = true
  }

  function closeWechatPanel() {
    wechatPanelOpen.value = false
    clearQrCode()
  }

  return {
    wechatEnabled,
    qrLoading,
    qrError,
    qrErrorCode,
    wechatLoginProcessing,
    wechatPanelOpen,
    wechatEvidenceHandled,
    wechatBindSuccessTick,
    wechatOAuthResolving,
    mountQrCode,
    clearQrCode,
    openWechatPanel,
    closeWechatPanel,
    completeLoginFromEvidence,
    completeLoginFromEvidenceWithRetry,
    wechatOAuthErrorMessage,
    stopLoginStatusPolling,
    urlHandlerKey,
    urlHandlerProcessing,
  }
}
