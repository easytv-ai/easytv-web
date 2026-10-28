<script setup lang="ts">
/**
 * 登录 / 注册合一卡片：路由 /login、/register 共用本组件，Tab 与路径同步。
 * 登录 / 注册对接 POST /api/user/login、/api/user/register（见 ~/api/user-auth、useAuth）。
 * 邀请注册：URL ?aff= 会作为 aff_code 提交，?pcode= 会作为 pcode 提交（渠道伙伴归属），登录/注册 Tab 切换时保留这两个参数。
 * 推广口令：注册表单可手填口令（URL ?code= 预填），注册并登录后调用领取接口绑定归属并发放红包。
 *   这是无法带链接的渠道（微信群/小红书等）唯一的归属入口，故做成显式可见的输入框。
 * 登录 Tab 底部第三方入口从 GET /api/status 读取已启用的 OAuth（含内置 OIDC / GitHub 与自定义提供商）；注册 Tab 仅邮箱验证码注册。
 */
import { PASSWORD_MAX, PASSWORD_MIN } from '~/utils/password'
import { AUTH_EXPIRED_STORAGE_KEY, getAccessToken } from '~/utils/auth-user'
import { resetSessionExpiryRedirectState } from '~/utils/auth-session-expired'
import { AUTH_LOGIN_REDIRECT_QUERY, sanitizeLoginRedirectPath } from '~/utils/auth-login-redirect'
import { pathWithoutLocale } from '~/utils/app-path'
import { cnMobileError, digitsOnly, isValidCnMobile, normalizeMobile } from '~/utils/phone'
import userAuth, { VERIFICATION_ACTION } from '~/api/user-auth'
import bonusCodeApi, {
  type BonusCodeClaimResult,
  type BonusCodePreview,
  type BonusCodeRecord,
  claimResultFromRecord,
  isBonusCodeAlreadyClaimedMessage,
} from '~/api/bonus-code'
import BonusCodeClaimModal from '~/components/console/BonusCodeClaimModal.vue'
import { formatBonusPreviewText } from '~/utils/bonus-code'
import { buildRegisterAttr, readAttribution } from '~/utils/attribution'
import inviteApi from '~/api/invite'
import { useTrack } from '~/composables/useTrack'
import { useAuth, useAuthCountdown } from '~/composables/useAuth'
import { useAuthLoginRedirect } from '~/composables/useAuthLoginRedirect'
import { redirectAfterAuthLogin } from '~/composables/usePostLoginRedirect'
import { WELCOME_GIFT_SESSION_KEY } from '~/utils/welcome-gift'
import { useToast } from '#imports'

const { t, locale } = useI18n()

/**
 * 海外站（F6，API.md 10.7）：短信验证码只支持 +86，非中文界面走邮箱登录 / 邮箱注册，
 * 不显示手机号表单，并补上「注册 / 忘记密码」入口（中文界面行为不变）。
 */
const isZhLocale = computed(() => String(locale.value ?? '').toLowerCase().startsWith('zh'))

const passwordVisible = reactive({
  login: false,
  register: false,
  registerConfirm: false,
  forgot: false,
  forgotConfirm: false,
})

const props = withDefaults(
  defineProps<{
    /** 与路由不一致时的初始 Tab（通常由 login/register/forgot-password 页传入） */
    initialTab?: 'login' | 'register' | 'forgot'
  }>(),
  { initialTab: 'login' },
)

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const toast = useToast()
const { tryLogin, tryPhoneLogin, tryRegister, hydrate, setUser } = useAuth()
const { persistRedirectFromRoute } = useAuthLoginRedirect()
const isLoggedIn = useState('isLoggedIn', () => false)
const { track } = useTrack()
const { growth, load: loadAppConfig } = useStudioAppConfig()

/** register_start 只报一次：首次聚焦注册表单或首次提交 */
let registerStarted = false
function trackRegisterStart(from: 'focus' | 'submit') {
  if (registerStarted)
    return
  registerStarted = true
  track('register_start', { from })
}

onMounted(() => {
  hydrate()
  void resolveInviter()
  persistRedirectFromRoute()
  if (isLoggedIn.value && !getAccessToken())
    setUser(null)
  if (isLoggedIn.value) {
    void redirectAfterAuthLogin()
    return
  }
  if (sessionStorage.getItem(AUTH_EXPIRED_STORAGE_KEY)) {
    sessionStorage.removeItem(AUTH_EXPIRED_STORAGE_KEY)
    resetSessionExpiryRedirectState()
    tip(t('auth.toast.sessionExpired'), 'warning')
  }
})

const loginLoading = ref(false)
const registerLoading = ref(false)
const forgotLoading = ref(false)
const sendingCode = ref(false)
const { secondsLeft: codeSecondsLeft, isActive: codeCountdownActive, start: startCodeCountdown } = useAuthCountdown(60)

const passwordLengthHint = computed(() => t('auth.passwordLengthHint'))

const codeButtonLabel = computed(() => {
  if (sendingCode.value)
    return t('auth.sendingCode')
  if (codeCountdownActive.value)
    return t('auth.resendAfter', { seconds: codeSecondsLeft.value })
  return t('auth.sendCode')
})

const formTitle = computed(() => {
  if (activeTab.value === 'register')
    return t('注册 EasyTV')
  if (activeTab.value === 'forgot')
    return t('重置密码')
  return t('欢迎使用 EasyTV')
})

const formLead = computed(() => {
  if (activeTab.value === 'register')
    return t('使用邮箱验证码创建账号，开始创作视频')
  if (activeTab.value === 'forgot')
    return t('输入邮箱验证码，设置新密码')
  if (!isZhLocale.value)
    return t('使用邮箱和密码登录，没有账号可以用邮箱注册')
  return t('使用手机号验证码登录，或微信扫码快捷登录')
})

const canSendRegisterCode = computed(() => !sendingCode.value && !codeCountdownActive.value)

function tabFromPath(path: string): 'login' | 'register' | 'forgot' {
  const last = pathWithoutLocale(path).split('/').filter(Boolean).pop() ?? ''
  if (last === 'register')
    return 'register'
  if (last === 'forgot-password')
    return 'forgot'
  if (last === 'login')
    return 'login'
  return props.initialTab
}

const activeTab = ref<'login' | 'register' | 'forgot'>(tabFromPath(route.path))

watch(() => route.path, (path) => {
  const next = tabFromPath(path)
  if (activeTab.value !== next)
    activeTab.value = next
})

watch(activeTab, (tab) => {
  if (tab === 'register')
    void resolveInviter()
})

/** 邀请注册码，来自 URL ?aff= */
const inviteAffCode = computed(() => {
  const aff = route.query.aff
  const raw = Array.isArray(aff) ? aff[0] : aff
  return String(raw ?? '').trim()
})

/** 渠道伙伴邀请码，来自 URL ?pcode=（注册即绑定伙伴归属） */
const invitePartnerCode = computed(() => {
  const pcode = route.query.pcode
  const raw = Array.isArray(pcode) ? pcode[0] : pcode
  return String(raw ?? '').trim()
})

/** 邀请码（增长域）：URL ?ref= 优先，其次 ?aff=，最后落地时写进归因 cookie 的 ref */
const inviteRefQuery = computed(() => {
  const ref = route.query.ref
  const raw = Array.isArray(ref) ? ref[0] : ref
  return String(raw ?? '').trim()
})
const inviterName = ref('')
let inviterResolvedFor = ''

/** 注册页显示「由 xx 邀请」：只解析一次，邀请码无效时静默隐藏 */
async function resolveInviter() {
  if (!import.meta.client || activeTab.value !== 'register')
    return
  const code = inviteRefQuery.value || inviteAffCode.value || readAttribution().ref
  if (!code || code === inviterResolvedFor)
    return
  inviterResolvedFor = code
  inviterName.value = ''
  void loadAppConfig()
  const res = await inviteApi.resolve(code)
  if (res?.success && res.data)
    inviterName.value = String(res.data.nickname ?? '').trim() || t('auth.invite.someone')
}

const inviteePoints = computed(() => growth.value?.invite_invitee_points || 100)

const loginForm = reactive({
  account: '',
  password: '',
})

const phoneLoginForm = reactive({
  phone: '',
  verificationCode: '',
})

const registerForm = reactive({
  email: '',
  verificationCode: '',
  nickname: '',
  password: '',
  confirmPassword: '',
  /** 推广口令（选填）：无法带链接的渠道靠它建立归属，注册成功后自动领取 */
  bonusCode: '',
})

const forgotForm = reactive({
  email: '',
  verificationCode: '',
  password: '',
  confirmPassword: '',
})

/* ---------- 推广口令 ---------- */

const bonusPreview = ref<BonusCodePreview | null>(null)
const bonusPreviewing = ref(false)
const bonusPreviewError = ref('')
const bonusClaimOpen = ref(false)
const bonusClaimResult = ref<BonusCodeClaimResult | null>(null)

let bonusPreviewTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 输入停顿后校验，避免每敲一个字都打接口。
 * 走 watch 而非 @input：UInput 不把原生 input 事件透传到内部 <input>。
 */
watch(() => registerForm.bonusCode, () => {
  bonusPreview.value = null
  bonusPreviewError.value = ''
  if (bonusPreviewTimer)
    clearTimeout(bonusPreviewTimer)
  if (!registerForm.bonusCode.trim())
    return
  bonusPreviewTimer = setTimeout(() => void previewBonusCode(), 400)
})

async function previewBonusCode() {
  const value = registerForm.bonusCode.trim()
  if (!value)
    return
  bonusPreviewing.value = true
  try {
    const res = await bonusCodeApi.preview(value) as any
    if (res?.success && res.data) {
      bonusPreview.value = res.data as BonusCodePreview
      bonusPreviewError.value = ''
    }
    else {
      bonusPreview.value = null
      bonusPreviewError.value = res?.message ?? t('auth.bonusCode.invalid')
    }
  }
  catch {
    bonusPreview.value = null
    bonusPreviewError.value = t('auth.bonusCode.invalid')
  }
  finally {
    bonusPreviewing.value = false
  }
}

/** 口令回显文案：渠道名 + 红包积分 / 首充加赠 / 会员天数（与设置页 / 弹窗共用纯函数） */
const bonusPreviewText = computed(() => formatBonusPreviewText(bonusPreview.value, t))

/**
 * 注册并登录后确认口令领取结果。
 * 注册请求带了 attr.code，后端会在注册成功后自动领取一次，所以这里先查记录；
 * 记录为空（后端没领上）再手动调一次 claim；「只能领取一次」视为已领取。
 * 领取失败不打断注册流程（账号已建好），但必须给出可见提示——
 * 静默失败会让用户以为口令生效了，实际既没拿到红包也没绑定归属。
 */
async function claimBonusCodeAfterRegister() {
  const value = registerForm.bonusCode.trim()
  if (!value)
    return
  const partnerName = bonusPreview.value?.partner_name ?? ''
  try {
    const recordRes = await bonusCodeApi.record() as any
    const record = recordRes?.success ? (recordRes.data as BonusCodeRecord | null) : null
    if (record?.id) {
      bonusClaimResult.value = claimResultFromRecord(record, partnerName)
      bonusClaimOpen.value = true
      return
    }
    const res = await bonusCodeApi.claim(value) as any
    if (res?.success && res.data) {
      bonusClaimResult.value = res.data as BonusCodeClaimResult
      bonusClaimOpen.value = true
      return
    }
    if (isBonusCodeAlreadyClaimedMessage(res?.message)) {
      const again = await bonusCodeApi.record() as any
      const claimed = again?.success ? (again.data as BonusCodeRecord | null) : null
      if (claimed?.id) {
        bonusClaimResult.value = claimResultFromRecord(claimed, partnerName)
        bonusClaimOpen.value = true
      }
      return
    }
    notifyBonusClaimFailed(res?.message)
  }
  catch {
    notifyBonusClaimFailed()
  }
}

/** 领取失败提示：带上后端给的具体原因，并告知可在钱包页补领 */
function notifyBonusClaimFailed(message?: string) {
  toast.add({
    title: t('auth.bonusCode.claimFailed'),
    description: String(message ?? '').trim() || t('auth.bonusCode.claimFailedHint'),
    color: 'warning',
    duration: 8000,
  })
}

/** 红包弹窗关闭后再跳转，避免用户还没看清金额页面就切走了 */
const redirectAfterBonusModal = ref(false)

watch(bonusClaimOpen, (v) => {
  if (!v && redirectAfterBonusModal.value) {
    redirectAfterBonusModal.value = false
    void redirectAfterAuthLogin()
  }
})

/** URL ?code= 预填口令（配合伙伴分发的短链）；没有就用落地时写进归因 cookie 的口令 */
onMounted(() => {
  const raw = route.query.code
  const value = String(Array.isArray(raw) ? raw[0] : (raw ?? '')).trim() || readAttribution().code
  if (value)
    registerForm.bonusCode = value // 赋值触发上面的 watch，自动校验
})

const loginErrors = reactive({
  account: '',
  password: '',
  form: '',
})

const phoneLoginErrors = reactive({
  phone: '',
  verificationCode: '',
  form: '',
})

const registerErrors = reactive({
  email: '',
  verificationCode: '',
  nickname: '',
  password: '',
  confirmPassword: '',
  form: '',
})

const forgotErrors = reactive({
  email: '',
  verificationCode: '',
  password: '',
  confirmPassword: '',
  form: '',
})

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

watch(() => phoneLoginForm.phone, (value) => {
  const next = normalizeMobile(value)
  if (next !== value)
    phoneLoginForm.phone = next
})

watch(() => phoneLoginForm.verificationCode, (value) => {
  const next = digitsOnly(value, 6)
  if (next !== value)
    phoneLoginForm.verificationCode = next
})

const canSendPhoneCode = computed(() =>
  isValidCnMobile(phoneLoginForm.phone) && !sendingCode.value && !codeCountdownActive.value,
)

function validatePhoneLogin(): boolean {
  phoneLoginErrors.phone = ''
  phoneLoginErrors.verificationCode = ''
  phoneLoginErrors.form = ''
  const mobileErr = cnMobileError(phoneLoginForm.phone)
  if (mobileErr) {
    tip(t(mobileErr))
    return false
  }
  const code = digitsOnly(phoneLoginForm.verificationCode, 6)
  if (!code) {
    tip(t('请输入验证码'))
    return false
  }
  if (code.length !== 6) {
    tip(t('auth.errors.verificationCodeInvalid'))
    return false
  }
  return true
}

/*
const authTabItems = computed(() => [
  { label: t('auth.tabLogin'), value: 'login' as const, slot: 'login' as const },
  { label: t('auth.tabRegister'), value: 'register' as const, slot: 'register' as const },
])
*/

function tip(message: string, color: 'error' | 'success' | 'warning' | 'neutral' = 'error') {
  toast.add({
    title: message,
    color,
    icon: color === 'success' ? 'i-lucide-check' : color === 'warning' ? 'i-lucide-triangle-alert' : 'i-lucide-x',
    close: false,
    progress: false,
    orientation: 'horizontal',
    duration: 2200,
  })
}

function validateLogin(): boolean {
  loginErrors.account = ''
  loginErrors.password = ''
  loginErrors.form = ''
  if (!loginForm.account.trim()) {
    tip(t('请输入邮箱'))
    return false
  }
  if (!loginForm.password) {
    tip(t('请输入密码'))
    return false
  }
  return true
}

function validateRegister(): boolean {
  registerErrors.email = ''
  registerErrors.verificationCode = ''
  registerErrors.nickname = ''
  registerErrors.password = ''
  registerErrors.confirmPassword = ''
  registerErrors.form = ''
  if (!emailRe.test(registerForm.email.trim())) {
    tip(t('请输入有效的邮箱地址'))
    return false
  }
  const code = registerForm.verificationCode.trim()
  if (!code) {
    tip(t('请输入验证码'))
    return false
  }
  if (code.length !== 6) {
    tip(t('auth.errors.verificationCodeInvalid'))
    return false
  }
  const nickname = registerForm.nickname.trim()
  if (!nickname) {
    tip(t('请输入昵称'))
    return false
  }
  if (nickname.length > 20) {
    tip(t('auth.errors.nicknameMaxLength'))
    return false
  }
  const len = registerForm.password.length
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) {
    tip(t('auth.errors.passwordLength', { hint: passwordLengthHint.value }))
    return false
  }
  if (registerForm.password !== registerForm.confirmPassword) {
    tip(t('auth.errors.passwordMismatch'))
    return false
  }
  return true
}

function switchTab(tab: 'login' | 'register' | 'forgot') {
  activeTab.value = tab
  const aff = inviteAffCode.value
  const redirect = route.query[AUTH_LOGIN_REDIRECT_QUERY]
  const rawRedirect = Array.isArray(redirect) ? redirect[0] : redirect
  const safeRedirect = sanitizeLoginRedirectPath(String(rawRedirect ?? ''))
  const query: Record<string, string> = {}
  if (aff)
    query.aff = aff
  if (inviteRefQuery.value)
    query.ref = inviteRefQuery.value
  if (invitePartnerCode.value)
    query.pcode = invitePartnerCode.value
  if (safeRedirect)
    query[AUTH_LOGIN_REDIRECT_QUERY] = safeRedirect
  const path = tab === 'register'
    ? '/register'
    : tab === 'forgot'
      ? '/forgot-password'
      : '/login'
  const dest = localePath({ path, query })
  if (pathWithoutLocale(route.path) === path)
    return
  void router.replace(dest)
}

function validateForgot(): boolean {
  forgotErrors.email = ''
  forgotErrors.verificationCode = ''
  forgotErrors.password = ''
  forgotErrors.confirmPassword = ''
  forgotErrors.form = ''
  if (!emailRe.test(forgotForm.email.trim())) {
    tip(t('请输入有效的邮箱地址'))
    return false
  }
  const code = forgotForm.verificationCode.trim()
  if (!code) {
    tip(t('请输入验证码'))
    return false
  }
  if (code.length !== 6) {
    tip(t('auth.errors.verificationCodeInvalid'))
    return false
  }
  const len = forgotForm.password.length
  if (len < PASSWORD_MIN || len > PASSWORD_MAX) {
    tip(t('auth.errors.passwordLength', { hint: passwordLengthHint.value }))
    return false
  }
  if (forgotForm.password !== forgotForm.confirmPassword) {
    tip(t('auth.errors.passwordMismatch'))
    return false
  }
  return true
}

async function sendRegisterCode() {
  await sendCode('register')
}

async function sendForgotCode() {
  await sendCode('forgot')
}

async function sendCode(kind: 'register' | 'forgot') {
  if (sendingCode.value || codeCountdownActive.value)
    return
  const email = kind === 'forgot' ? forgotForm.email.trim() : registerForm.email.trim()
  const errors = kind === 'forgot' ? forgotErrors : registerErrors
  if (!emailRe.test(email)) {
    tip(t('请输入有效的邮箱地址'))
    return
  }
  errors.email = ''
  sendingCode.value = true
  try {
    const params = {
      email,
      action: kind === 'forgot' ? VERIFICATION_ACTION.resetPassword : VERIFICATION_ACTION.register,
    }
    const res = await userAuth.sendEmailVerification(params) as any
    if (res?.success === false) {
      tip(String(res?.message || t('auth.toast.codeSendFailed')))
      return
    }
    tip(t('auth.toast.codeSent'), 'success')
    startCodeCountdown()
  }
  catch {
    tip(t('auth.toast.codeSendRetry'))
  }
  finally {
    sendingCode.value = false
  }
}

function requestAgreement(): Promise<boolean> {
  return Promise.resolve(true)
}

provide('ensureAuthAgreement', requestAgreement)

async function sendPhoneLoginCode() {
  if (sendingCode.value || codeCountdownActive.value)
    return
  const mobile = normalizeMobile(phoneLoginForm.phone)
  const mobileErr = cnMobileError(mobile)
  if (mobileErr) {
    tip(t(mobileErr))
    return
  }
  phoneLoginErrors.phone = ''
  sendingCode.value = true
  try {
    const res = await userAuth.sendSmsVerification({ mobile }) as any
    if (res?.success === false || res?.error === true || (typeof res?.statusCode === 'number' && res.statusCode >= 400)) {
      tip(String(res?.message || res?.statusMessage || t('auth.toast.codeSendFailed')))
      return
    }
    tip(t('auth.toast.codeSent'), 'success')
    startCodeCountdown()
  }
  catch {
    tip(t('auth.toast.codeSendRetry'))
  }
  finally {
    sendingCode.value = false
  }
}

async function onPhoneLoginSubmit() {
  if (!validatePhoneLogin())
    return
  if (!(await requestAgreement()))
    return
  loginLoading.value = true
  phoneLoginErrors.form = ''
  try {
    const res = await tryPhoneLogin(phoneLoginForm.phone, phoneLoginForm.verificationCode)
    if (res.ok) {
      isLoggedIn.value = true
      tip(t('auth.toast.loginSuccess'), 'success')
      await redirectAfterAuthLogin()
    }
    else {
      tip(res.message ?? t('auth.errors.loginFailed'))
    }
  }
  finally {
    loginLoading.value = false
  }
}

async function onLoginSubmit() {
  if (!validateLogin())
    return
  if (!(await requestAgreement()))
    return
  loginLoading.value = true
  loginErrors.form = ''
  try {
    const res = await tryLogin(loginForm.account.trim(), loginForm.password)
    if (res.ok) {
      isLoggedIn.value = true
      tip(t('auth.toast.loginSuccess'), 'success')
      await redirectAfterAuthLogin()
    }
    else {
      tip(res.message ?? t('auth.errors.loginFailed'))
    }
  }
  finally {
    loginLoading.value = false
  }
}

/** 注册成功标记：创作台首页读到后弹一次「新人红包」（StudioWelcomeGift） */
function markWelcomeGift() {
  try {
    sessionStorage.setItem(WELCOME_GIFT_SESSION_KEY, '1')
  }
  catch {
    // 隐私模式等不可用时忽略
  }
}

async function onRegisterSubmit() {
  trackRegisterStart('submit')
  if (!validateRegister())
    return
  if (!(await requestAgreement()))
    return
  registerLoading.value = true
  registerErrors.form = ''
  try {
    const email = registerForm.email.trim().toLowerCase()
    const password = registerForm.password
    const nickname = registerForm.nickname.trim()
    // 归因：cookie 里的 utm / ref / code；表单手填的口令优先，?aff= 只在 cookie 没有 ref 时补位
    const attr = buildRegisterAttr(
      { code: registerForm.bonusCode.trim() },
      { ref: inviteRefQuery.value || inviteAffCode.value, pcode: invitePartnerCode.value },
    )
    // username 即账号邮箱；昵称单独走 nickname 字段
    const res = await tryRegister({
      username: email,
      email,
      nickname,
      password,
      verification_code: registerForm.verificationCode.trim(),
      ...(inviteAffCode.value ? { aff_code: inviteAffCode.value } : {}),
      ...(invitePartnerCode.value ? { pcode: invitePartnerCode.value } : {}),
      attr,
    })
    if (!res.ok) {
      tip(res.message ?? t('auth.errors.registerFailed'))
      return
    }

    const loginRes = await tryLogin(email, password)
    if (loginRes.ok) {
      isLoggedIn.value = true
      tip(t('auth.toast.registerSuccess'), 'success')
      markWelcomeGift()
      // 领取需在清空表单前进行，且要先让用户看到红包再跳转
      await claimBonusCodeAfterRegister()
      registerForm.email = ''
      registerForm.verificationCode = ''
      registerForm.nickname = ''
      registerForm.password = ''
      registerForm.confirmPassword = ''
      registerForm.bonusCode = ''
      if (bonusClaimOpen.value) {
        redirectAfterBonusModal.value = true
        return
      }
      await redirectAfterAuthLogin()
      return
    }

    tip(t('auth.toast.registerSuccess'), 'success')
    loginForm.account = email
    loginForm.password = password
    registerForm.email = ''
    registerForm.verificationCode = ''
    registerForm.nickname = ''
    registerForm.password = ''
    registerForm.confirmPassword = ''
    switchTab('login')
    tip(loginRes.message ?? t('auth.errors.loginFailed'))
  }
  finally {
    registerLoading.value = false
  }
}

async function onForgotSubmit() {
  if (!validateForgot())
    return
  forgotLoading.value = true
  forgotErrors.form = ''
  try {
    const email = forgotForm.email.trim().toLowerCase()
    const code = forgotForm.verificationCode.trim()
    const password = forgotForm.password
    const res = await userAuth.reset({
      email,
      verification_code: code,
      token: code,
      password,
    }) as any
    if (res?.success === false || res?.error === true || (typeof res?.statusCode === 'number' && res.statusCode >= 400)) {
      tip(String(res?.message || res?.statusMessage || t('重置失败，请检查验证码后重试')))
      return
    }
    tip(t('密码已重置'), 'success')
    const loginRes = await tryLogin(email, password)
    if (loginRes.ok) {
      isLoggedIn.value = true
      await redirectAfterAuthLogin()
      return
    }
    loginForm.account = email
    loginForm.password = ''
    forgotForm.email = ''
    forgotForm.verificationCode = ''
    forgotForm.password = ''
    forgotForm.confirmPassword = ''
    switchTab('login')
  }
  finally {
    forgotLoading.value = false
  }
}
</script>

<template>
  <div class="xyq-form" :class="{ 'xyq-form--login': activeTab === 'login' }">
        <NuxtLink :to="localePath('/')" class="xyq-form__icon" :aria-label="t('返回首页')">
          <img src="/images/logo.svg" alt="" width="40" height="40">
        </NuxtLink>
        <h1 class="xyq-form__title">
          {{ formTitle }}
        </h1>
        <p class="xyq-form__lead">
          {{ formLead }}
        </p>

        <div v-if="activeTab === 'login'" class="xyq-login">
          <!-- 非中文界面：邮箱 + 密码登录（短信只支持 +86） -->
          <form v-if="!isZhLocale" class="xyq-login__phone" @submit.prevent="onLoginSubmit">
            <p class="xyq-login__label">{{ t('邮箱登录') }}</p>
            <div class="xyq-field">
              <input
                v-model="loginForm.account"
                class="xyq-input"
                type="email"
                autocomplete="email"
                :placeholder="t('请输入邮箱')"
              >
            </div>
            <div class="xyq-field">
              <div class="xyq-input-wrap is-password">
                <input
                  v-model="loginForm.password"
                  class="xyq-input"
                  :type="passwordVisible.login ? 'text' : 'password'"
                  autocomplete="current-password"
                  :maxlength="PASSWORD_MAX"
                  :placeholder="t('请输入密码')"
                >
                <button
                  type="button"
                  class="xyq-pass-btn"
                  :aria-label="passwordVisible.login ? t('auth.passwordToggle.hide') : t('auth.passwordToggle.show')"
                  @click="passwordVisible.login = !passwordVisible.login"
                >
                  <UIcon :name="passwordVisible.login ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
                </button>
              </div>
            </div>
            <button class="xyq-btn-primary" type="submit" :disabled="loginLoading">
              {{ loginLoading ? t('登录中…') : t('登录') }}
            </button>
            <p class="xyq-switch xyq-switch--inline">
              <button type="button" @click="switchTab('register')">{{ t('邮箱注册') }}</button>
              <span class="mx-2 text-zinc-500">·</span>
              <button type="button" @click="switchTab('forgot')">{{ t('忘记密码') }}</button>
            </p>
          </form>
          <form v-else class="xyq-login__phone" @submit.prevent="onPhoneLoginSubmit">
            <p class="xyq-login__label">{{ t('手机号登录') }}</p>
            <div class="xyq-field">
              <label class="xyq-phone">
                <span>+86</span>
                <input
                  v-model="phoneLoginForm.phone"
                  class="xyq-input"
                  type="tel"
                  inputmode="numeric"
                  autocomplete="tel"
                  maxlength="11"
                  :placeholder="t('请输入手机号')"
                >
              </label>
            </div>
            <div class="xyq-field">
              <div class="xyq-input-wrap">
                <input
                  v-model="phoneLoginForm.verificationCode"
                  class="xyq-input"
                  type="tel"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  :placeholder="t('请输入验证码')"
                >
                <button
                  type="button"
                  class="xyq-code-btn"
                  :disabled="!canSendPhoneCode"
                  @click="sendPhoneLoginCode"
                >
                  {{ codeButtonLabel }}
                </button>
              </div>
            </div>
            <button class="xyq-btn-primary" type="submit" :disabled="loginLoading">
              {{ loginLoading ? t('登录中…') : t('登录') }}
            </button>
          </form>
          <i class="xyq-login__rule" aria-hidden="true" />
          <aside class="xyq-login__qr">
            <ClientOnly>
              <AuthWeChatQrPanel embedded />
              <template #fallback>
                <div class="ea-wechat-qr-fallback">
                  <UIcon name="i-lucide-loader-circle" class="size-7 animate-spin text-[#07c160]" />
                </div>
              </template>
            </ClientOnly>
          </aside>
        </div>

        <p v-if="activeTab === 'register' && inviterName" class="xyq-invite-line">
          <UIcon name="i-lucide-gift" class="size-4 shrink-0" />
          <span>{{ t('auth.invite.by', { name: inviterName, n: inviteePoints }) }}</span>
        </p>
        <form v-if="activeTab === 'register'" @focusin.once="trackRegisterStart('focus')" @submit.prevent="onRegisterSubmit">
          <div class="xyq-field">
            <input
              v-model="registerForm.email"
              class="xyq-input"
              type="email"
              autocomplete="email"
              :placeholder="t('请输入邮箱')"
            >
          </div>
          <div class="xyq-field">
            <div class="xyq-input-wrap">
              <input
                v-model="registerForm.verificationCode"
                class="xyq-input"
                autocomplete="one-time-code"
                maxlength="6"
                :placeholder="t('请输入验证码')"
              >
              <button
                type="button"
                class="xyq-code-btn"
                :disabled="sendingCode || codeCountdownActive"
                @click="sendRegisterCode"
              >
                {{ codeButtonLabel }}
              </button>
            </div>
          </div>
          <div class="xyq-field">
            <input
              v-model="registerForm.nickname"
              class="xyq-input"
              autocomplete="nickname"
              maxlength="20"
              :placeholder="t('请输入昵称')"
            >
          </div>
          <div class="xyq-field">
            <div class="xyq-input-wrap is-password">
              <input
                v-model="registerForm.password"
                class="xyq-input"
                :type="passwordVisible.register ? 'text' : 'password'"
                autocomplete="new-password"
                :maxlength="PASSWORD_MAX"
                :placeholder="t('请输入密码（8-20 位）')"
              >
              <button
                type="button"
                class="xyq-pass-btn"
                :aria-label="passwordVisible.register ? t('auth.passwordToggle.hide') : t('auth.passwordToggle.show')"
                @click="passwordVisible.register = !passwordVisible.register"
              >
                <UIcon :name="passwordVisible.register ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
              </button>
            </div>
          </div>
          <div class="xyq-field">
            <div class="xyq-input-wrap is-password">
              <input
                v-model="registerForm.confirmPassword"
                class="xyq-input"
                :type="passwordVisible.registerConfirm ? 'text' : 'password'"
                autocomplete="new-password"
                :maxlength="PASSWORD_MAX"
                :placeholder="t('再次输入密码')"
              >
              <button
                type="button"
                class="xyq-pass-btn"
                :aria-label="passwordVisible.registerConfirm ? t('auth.passwordToggle.hide') : t('auth.passwordToggle.show')"
                @click="passwordVisible.registerConfirm = !passwordVisible.registerConfirm"
              >
                <UIcon :name="passwordVisible.registerConfirm ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
              </button>
            </div>
          </div>
          <div class="xyq-field">
            <div class="xyq-bonus-wrap">
              <input
                v-model="registerForm.bonusCode"
                class="xyq-input"
                autocomplete="off"
                maxlength="32"
                :placeholder="t('auth.bonusCode.placeholder')"
                :aria-label="t('auth.bonusCode.label')"
              >
              <UIcon v-if="bonusPreviewing" name="i-lucide-loader-circle" class="xyq-bonus-spin size-4 animate-spin" />
            </div>
            <p v-if="bonusPreview" class="xyq-bonus-hint is-ok">
              <UIcon name="i-lucide-circle-check" class="size-3.5 shrink-0" />
              <span>{{ bonusPreviewText }}</span>
            </p>
            <p v-else-if="bonusPreviewError" class="xyq-bonus-hint is-err">
              <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
              <span>{{ bonusPreviewError }}</span>
            </p>
          </div>
          <button class="xyq-btn-primary" type="submit" :disabled="registerLoading">
            {{ registerLoading ? t('注册中…') : t('注册') }}
          </button>
        </form>

        <form v-if="activeTab === 'forgot'" @submit.prevent="onForgotSubmit">
          <div class="xyq-field">
            <input
              v-model="forgotForm.email"
              class="xyq-input"
              type="email"
              autocomplete="email"
              :placeholder="t('请输入邮箱')"
            >
          </div>
          <div class="xyq-field">
            <div class="xyq-input-wrap">
              <input
                v-model="forgotForm.verificationCode"
                class="xyq-input"
                autocomplete="one-time-code"
                maxlength="6"
                :placeholder="t('请输入验证码')"
              >
              <button
                type="button"
                class="xyq-code-btn"
                :disabled="sendingCode || codeCountdownActive"
                @click="sendForgotCode"
              >
                {{ codeButtonLabel }}
              </button>
            </div>
          </div>
          <div class="xyq-field">
            <div class="xyq-input-wrap is-password">
              <input
                v-model="forgotForm.password"
                class="xyq-input"
                :type="passwordVisible.forgot ? 'text' : 'password'"
                autocomplete="new-password"
                :maxlength="PASSWORD_MAX"
                :placeholder="t('请输入新密码（8-20 位）')"
              >
              <button
                type="button"
                class="xyq-pass-btn"
                :aria-label="passwordVisible.forgot ? t('auth.passwordToggle.hide') : t('auth.passwordToggle.show')"
                @click="passwordVisible.forgot = !passwordVisible.forgot"
              >
                <UIcon :name="passwordVisible.forgot ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
              </button>
            </div>
          </div>
          <div class="xyq-field">
            <div class="xyq-input-wrap is-password">
              <input
                v-model="forgotForm.confirmPassword"
                class="xyq-input"
                :type="passwordVisible.forgotConfirm ? 'text' : 'password'"
                autocomplete="new-password"
                :maxlength="PASSWORD_MAX"
                :placeholder="t('再次输入密码')"
              >
              <button
                type="button"
                class="xyq-pass-btn"
                :aria-label="passwordVisible.forgotConfirm ? t('auth.passwordToggle.hide') : t('auth.passwordToggle.show')"
                @click="passwordVisible.forgotConfirm = !passwordVisible.forgotConfirm"
              >
                <UIcon :name="passwordVisible.forgotConfirm ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-4" />
              </button>
            </div>
          </div>
          <button class="xyq-btn-primary" type="submit" :disabled="forgotLoading">
            {{ forgotLoading ? t('重置中…') : t('重置密码') }}
          </button>
        </form>
       

        <!-- 非中文界面：注册 / 重置后能回到邮箱登录（中文界面走手机号验证码，不需要） -->
        <p v-if="!isZhLocale && activeTab !== 'login'" class="xyq-switch">
          {{ t('已有账号？') }}
          <button type="button" @click="switchTab('login')">{{ t('立即登录') }}</button>
        </p>

        <p v-if="activeTab !== 'forgot'" class="xyq-agree">
          {{ t('继续即表示您同意') }}
          <NuxtLink :to="localePath('/legal/terms')">{{ t('《用户服务协议》') }}</NuxtLink>{{ t('、') }}
          <NuxtLink :to="localePath('/legal/privacy')">{{ t('《隐私政策》') }}</NuxtLink>
          {{ t('和') }}
          <NuxtLink :to="localePath('/legal/ai-guidelines')">{{ t('《AI功能使用规范》') }}</NuxtLink>
        </p>

        <!-- <p v-if="activeTab === 'login'" class="xyq-switch">
          <button type="button" @click="switchTab('register')">{{ t('立即注册') }}</button>
          <span class="mx-2 text-zinc-500">·</span>
          <button type="button" @click="switchTab('forgot')">{{ t('忘记密码') }}</button>
        </p>
        <p v-else-if="activeTab === 'register'" class="xyq-switch">
          {{ t('已有账号？') }}
          <button type="button" @click="switchTab('login')">{{ t('立即登录') }}</button>
        </p>
        <p v-else class="xyq-switch">
          <button type="button" @click="switchTab('login')">{{ t('返回登录') }}</button>
          <span class="mx-2 text-zinc-500">·</span>
          <button type="button" @click="switchTab('register')">{{ t('立即注册') }}</button>
        </p> -->

    <BonusCodeClaimModal
      v-model:open="bonusClaimOpen"
      :initial-result="bonusClaimResult"
    />
  </div>
</template>
