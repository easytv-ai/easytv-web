<script setup lang="ts">
/**
 * 设置 · 账号资料
 *
 * - 头像 / 昵称（上传走 assetApi，setting.avatar 写回 userManagement.update）
 * - 口令红包：已领取展示权益，未领取展示输入框 + 实时校验回显
 * - 额度：并发生成 + 云存储，按套餐限制
 * - 手机号绑定 / 换绑（60s 倒计时验证码）
 * - 退出登录、协议政策、注销账号入口
 */
import { userManagement } from '~/api/user-management'
import { userAuth } from '~/api/user-auth'
import accountApi from '~/api/account'
import assetApi from '~/api/asset'
import { resolveMediaUrl } from '~/utils/media'
import { readSettingAvatar, writeSettingAvatar } from '~/utils/user-setting'
import { isValidCnMobile, normalizeMobile } from '~/utils/phone'
import { formatBonusPreviewText } from '~/utils/bonus-code'
import bonusCodeApi, { BONUS_REWARD_STATUS, isBonusCodeAlreadyClaimedMessage, type BonusCodePreview, type BonusCodeRecord } from '~/api/bonus-code'
import type { UsageView } from '~/api/usage'

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { user, setUser, logout } = useAuth()
const { confirm } = useConfirm()
const { wallet, refresh: refreshWallet } = useWallet()
const { gotoPricing } = usePricingModal()
const { secondsLeft, isActive: countingDown, start: startCountdown } = useAuthCountdown(60)

const props = defineProps<{
  usage: UsageView | null
  /** 父页加载 usage 的状态，用于额度卡显隐 */
  usageReady: boolean
  /** 通知父页打开注销弹窗 */
  requestDeactivate: () => void
}>()

const emit = defineEmits<{ refreshed: [] }>()

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function fmt(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ===== 账号资料 =====
const profile = reactive({ nickname: '', mobile: '', username: '', avatar: '' })
const profileSetting = ref('')
const nicknameSaving = ref(false)
const avatarSaving = ref(false)
const avatarInput = ref<HTMLInputElement | null>(null)
const mobileForm = reactive({ mobile: '', code: '' })
const mobileSaving = ref(false)
const sendingCode = ref(false)
const AVATAR_MAX_BYTES = 4 * 1024 * 1024
const avatarSrc = computed(() => resolveMediaUrl(profile.avatar || String(user.value?.avatar ?? '')))
const avatarLetter = computed(() => (profile.nickname || profile.username || '?').slice(0, 1).toUpperCase())

async function loadProfile() {
  const res = await userManagement.self()
  const data = res?.data ?? {}
  profile.nickname = String(data.nickname ?? user.value?.nickname ?? '')
  profile.username = String(data.username ?? user.value?.username ?? '')
  profile.mobile = String(data.mobile || (isValidCnMobile(profile.username) ? profile.username : ''))
  profileSetting.value = typeof data.setting === 'string' ? data.setting : JSON.stringify(data.setting ?? {})
  profile.avatar = readSettingAvatar(data.setting, String(data.avatar ?? user.value?.avatar ?? ''))
}

defineExpose({ loadProfile })

function pickAvatar() {
  if (avatarSaving.value)
    return
  avatarInput.value?.click()
}

async function onAvatarChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    notify(t('请选择 JPG、PNG 或 WebP 图片'), 'error')
    return
  }
  if (file.size > AVATAR_MAX_BYTES) {
    notify(t('图片不能超过 4MB'), 'error')
    return
  }
  avatarSaving.value = true
  try {
    const uploaded = await assetApi.upload(file)
    if (!uploaded?.success || !uploaded.data?.url) {
      notify(uploaded?.message || t('上传失败'), 'error')
      return
    }
    const url = uploaded.data.url
    const setting = writeSettingAvatar(profileSetting.value, url)
    const res = await userManagement.update({ setting })
    if (!res?.success) {
      notify(res?.message || t('保存失败'), 'error')
      return
    }
    profile.avatar = url
    profileSetting.value = setting
    if (user.value)
      setUser({ ...user.value, avatar: url })
    notify(t('头像已更新'), 'success')
  }
  finally {
    avatarSaving.value = false
  }
}

async function saveNickname() {
  const nickname = profile.nickname.trim()
  if (!nickname) {
    notify(t('昵称不能为空'), 'error')
    return
  }
  nicknameSaving.value = true
  try {
    const res = await userManagement.update({ nickname })
    if (!res?.success) {
      notify(res?.message || t('保存失败'), 'error')
      return
    }
    if (user.value)
      setUser({ ...user.value, nickname })
    notify(t('昵称已更新'), 'success')
  }
  finally {
    nicknameSaving.value = false
  }
}

async function sendCode() {
  const mobile = normalizeMobile(mobileForm.mobile)
  if (!isValidCnMobile(mobile)) {
    notify(t('请输入正确的手机号'), 'error')
    return
  }
  mobileForm.mobile = mobile
  sendingCode.value = true
  try {
    const res = await userAuth.sendSmsVerification({ mobile })
    if (!res?.success) {
      notify(res?.message || t('验证码发送失败'), 'error')
      return
    }
    startCountdown()
    notify(t('验证码已发送'), 'success')
  }
  finally {
    sendingCode.value = false
  }
}

async function bindMobile() {
  const mobile = normalizeMobile(mobileForm.mobile)
  const code = mobileForm.code.trim()
  if (!isValidCnMobile(mobile)) {
    notify(t('请输入正确的手机号'), 'error')
    return
  }
  if (!/^\d{6}$/.test(code)) {
    notify(t('account.profile.codeInvalid'), 'error')
    return
  }
  mobileForm.mobile = mobile
  mobileSaving.value = true
  try {
    const res = await userManagement.bindMobile({ mobile, code })
    if (!res?.success) {
      notify(res?.message || t('绑定失败'), 'error')
      return
    }
    profile.mobile = mobile
    mobileForm.mobile = ''
    mobileForm.code = ''
    notify(t('手机号已更新'), 'success')
  }
  finally {
    mobileSaving.value = false
  }
}

// ===== 口令红包 =====
const bonusRecord = ref<BonusCodeRecord | null>(null)
const bonusRecordLoaded = ref(false)
const bonusRecordFailed = ref(false)
const bonusCode = ref('')
const bonusClaiming = ref(false)
const bonusPreview = ref<BonusCodePreview | null>(null)
const bonusPreviewError = ref('')
let bonusPreviewTimer: ReturnType<typeof setTimeout> | null = null

async function loadBonusRecord() {
  bonusRecordFailed.value = false
  try {
    const res = await bonusCodeApi.record() as any
    if (res?.unauthorized)
      return
    if (!res?.success) {
      bonusRecordFailed.value = !bonusRecord.value
      if (bonusRecordFailed.value)
        notify(res?.message || t('加载失败，请稍后重试'), 'error')
      return
    }
    bonusRecord.value = (res.data as BonusCodeRecord | null)?.id ? res.data as BonusCodeRecord : null
    bonusRecordLoaded.value = true
  }
  catch {
    bonusRecordFailed.value = !bonusRecord.value
    if (bonusRecordFailed.value)
      notify(t('加载失败，请稍后重试'), 'error')
  }
}

const bonusRewardStatusText = computed(() => {
  const r = bonusRecord.value
  if (!r || !(r.reward_rate > 0))
    return ''
  if (r.reward_status === BONUS_REWARD_STATUS.GRANTED)
    return t('已发放 · 额外获得 {n} 积分', { n: r.reward_points })
  if (r.reward_status === BONUS_REWARD_STATUS.EXPIRED)
    return t('已过期')
  if (r.reward_status === BONUS_REWARD_STATUS.INELIGIBLE)
    return t('不符合条件')
  return r.reward_expire_at
    ? t('待生效 · {date} 前首充可用', { date: fmt(r.reward_expire_at).slice(0, 10) })
    : t('待生效 · 首充时自动生效')
})

const bonusPreviewText = computed(() => formatBonusPreviewText(bonusPreview.value, t))

watch(bonusCode, () => {
  bonusPreview.value = null
  bonusPreviewError.value = ''
  if (bonusPreviewTimer)
    clearTimeout(bonusPreviewTimer)
  if (!bonusCode.value.trim())
    return
  bonusPreviewTimer = setTimeout(() => void runBonusPreview(), 400)
})

async function runBonusPreview() {
  const value = bonusCode.value.trim()
  if (!value)
    return
  try {
    const res = await bonusCodeApi.preview(value) as any
    if (bonusCode.value.trim() !== value)
      return
    if (res?.success && res.data) {
      bonusPreview.value = res.data as BonusCodePreview
      bonusPreviewError.value = ''
    }
    else {
      bonusPreview.value = null
      bonusPreviewError.value = res?.message ?? t('console.bonusCode.errNotFound')
    }
  }
  catch {
    bonusPreview.value = null
    bonusPreviewError.value = t('console.bonusCode.errNotFound')
  }
}

async function claimBonus() {
  const value = bonusCode.value.trim()
  if (!value) {
    notify(t('console.bonusCode.toastEmpty'), 'error')
    return
  }
  if (bonusClaiming.value)
    return
  bonusClaiming.value = true
  try {
    const res = await bonusCodeApi.claim(value) as any
    if (res?.unauthorized)
      return
    if (!res?.success) {
      if (isBonusCodeAlreadyClaimedMessage(res?.message)) {
        bonusPreviewError.value = res?.message ?? t('console.bonusCode.errGeneric')
        notify(bonusPreviewError.value, 'error')
        void loadBonusRecord()
        return
      }
      bonusPreviewError.value = res?.message ?? t('console.bonusCode.errGeneric')
      notify(bonusPreviewError.value, 'error')
      return
    }
    notify(t('领取成功'), 'success')
    void loadBonusRecord()
    void refreshWallet()
    emit('refreshed')
  }
  catch {
    bonusPreviewError.value = t('console.bonusCode.errGeneric')
    notify(bonusPreviewError.value, 'error')
  }
  finally {
    bonusClaiming.value = false
  }
}

onMounted(() => {
  void loadProfile()
  void loadBonusRecord()
})

onUnmounted(() => {
  if (bonusPreviewTimer)
    clearTimeout(bonusPreviewTimer)
})

// ===== 退出登录 =====
const leaving = ref(false)

async function onLogout() {
  if (leaving.value)
    return
  if (!(await confirm({
    title: t('退出登录'),
    message: t('退出后需要重新登录才能继续创作。'),
    confirmText: t('退出登录'),
    danger: true,
  })))
    return
  leaving.value = true
  try {
    const res = await logout()
    if (!res.ok) {
      notify(res.message ?? t('退出登录失败'), 'error')
      return
    }
    await navigateTo(localePath('/'))
  }
  finally {
    leaving.value = false
  }
}

// ===== 额度格式化 =====
function formatBytes(n: number) {
  if (!n)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function pct(used: number, limit: number) {
  if (!limit)
    return 0
  return Math.min(100, Math.round((used / limit) * 100))
}
</script>

<template>
  <section class="wallet-card">
    <h3>{{ t('基本信息') }}</h3>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('头像') }}</span>
      <div class="settings-avatar-field">
        <button
          type="button"
          class="settings-avatar"
          :disabled="avatarSaving"
          :aria-label="t('更换头像')"
          @click="pickAvatar"
        >
          <img
            v-if="avatarSrc"
            :src="avatarSrc"
            alt=""
            width="72"
            height="72"
          >
          <span v-else>{{ avatarLetter }}</span>
        </button>
        <div class="settings-avatar-field__meta">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="avatarSaving" @click="pickAvatar">
            {{ avatarSaving ? t('上传中…') : t('更换') }}
          </button>
          <p class="settings-hint">{{ t('建议 200×200，JPG / PNG / WebP') }}</p>
        </div>
        <input
          ref="avatarInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          @change="onAvatarChosen"
        >
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('账号') }}</span>
      <span class="settings-row__value">{{ profile.username }}</span>
    </div>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('昵称') }}</span>
      <div class="settings-row__field">
        <input v-model="profile.nickname" maxlength="20" class="settings-input" :placeholder="t('给自己起个名字')">
        <button type="button" class="plan-btn plan-btn--solid" :disabled="nicknameSaving" @click="saveNickname">
          {{ nicknameSaving ? t('保存中…') : t('保存') }}
        </button>
      </div>
    </div>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('会员') }}</span>
      <span class="settings-row__value">
        <template v-if="wallet?.is_member && wallet.membership">
          {{ t('{plan}会员', { plan: wallet.membership.plan_name }) }} · {{ t('有效期至') }} {{ fmt(wallet.membership.expires_at).slice(0, 10) }}
        </template>
        <template v-else>{{ t('未开通 ·') }} <a href="#" @click.prevent="gotoPricing('membership')">{{ t('去开通') }}</a></template>
      </span>
    </div>
  </section>

  <section class="wallet-card">
    <h3>
      {{ t('口令红包') }}
      <small v-if="bonusRecord">{{ t('已领取') }}</small>
    </h3>
    <template v-if="bonusRecord">
      <div class="settings-bonus">
        <span class="settings-bonus__icon" aria-hidden="true">
          <UIcon name="i-lucide-circle-check" class="size-5" />
        </span>
        <span class="settings-bonus__copy">
          <strong>{{ bonusRecord.code }}</strong>
          <span>{{ t('{date} 领取，每个账号限一次', { date: fmt(bonusRecord.created_at).slice(0, 10) }) }}</span>
        </span>
      </div>
      <ul class="settings-bonus-gifts">
        <li v-if="bonusRecord.bonus_points > 0">
          <span>{{ t('红包积分') }}</span>
          <b>{{ t('{n} 积分', { n: bonusRecord.bonus_points }) }}</b>
        </li>
        <li v-if="bonusRecord.member_days > 0">
          <span>{{ t('会员天数') }}</span>
          <b>{{ t('{n} 天', { n: bonusRecord.member_days }) }}</b>
        </li>
        <li v-if="bonusRecord.reward_rate > 0">
          <span>{{ t('首充权益') }}</span>
          <b>
            {{ t('首充多送 {percent}%', { percent: Math.round(bonusRecord.reward_rate * 100) }) }}
            <template v-if="bonusRecord.reward_cap_points > 0"> · {{ t('封顶 {n} 积分', { n: bonusRecord.reward_cap_points }) }}</template>
          </b>
          <small class="settings-bonus-status">{{ bonusRewardStatusText }}</small>
        </li>
      </ul>
    </template>
    <template v-else>
      <p class="settings-lead">{{ t('console.bonusCode.inputLead') }}</p>
      <div class="settings-row settings-row--top">
        <span class="settings-row__label">{{ t('口令') }}</span>
        <div class="settings-bonus-form">
          <div class="settings-row__field">
            <input
              v-model="bonusCode"
              maxlength="32"
              autocomplete="off"
              class="settings-input"
              :placeholder="t('console.bonusCode.inputPlaceholder')"
              :disabled="!bonusRecordLoaded || bonusClaiming"
              @keydown.enter="claimBonus"
            >
            <button
              type="button"
              class="plan-btn plan-btn--solid"
              :disabled="bonusClaiming || (!bonusRecordFailed && !bonusRecordLoaded) || (bonusRecordLoaded && !bonusCode.trim())"
              @click="bonusRecordFailed ? loadBonusRecord() : claimBonus()"
            >
              {{ bonusRecordFailed ? t('重试') : !bonusRecordLoaded ? t('加载中…') : bonusClaiming ? t('领取中…') : t('立即领取') }}
            </button>
          </div>
          <p v-if="bonusPreviewText" class="settings-bonus-msg is-ok">
            <UIcon name="i-lucide-circle-check" class="size-3.5 shrink-0" />
            <span>{{ bonusPreviewText }}</span>
          </p>
          <p v-else-if="bonusPreviewError" class="settings-bonus-msg is-err">
            <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
            <span>{{ bonusPreviewError }}</span>
          </p>
          <p class="settings-hint">{{ t('console.bonusCode.inputNote') }}</p>
        </div>
      </div>
    </template>
  </section>

  <section v-if="usage" class="wallet-card">
    <h3>
      {{ t('额度') }}
      <small>{{ usage.plan.is_member ? (usage.plan.scope === 'team' ? t('团队共享，{n} 个席位', { n: usage.plan.seats }) : t('{plan}会员', { plan: usage.plan.name })) : t('免费额度') }}</small>
    </h3>
    <div class="quota">
      <div class="quota__row">
        <div class="quota__head">
          <span>{{ t('并发生成') }}</span>
          <strong>{{ usage.concurrent.used }} / {{ usage.concurrent.limit }} {{ t('路') }}</strong>
        </div>
        <div class="quota__bar" :class="{ 'is-full': usage.concurrent.used >= usage.concurrent.limit }"><i :style="{ width: `${pct(usage.concurrent.used, usage.concurrent.limit)}%` }" /></div>
      </div>
      <div class="quota__row">
        <div class="quota__head">
          <span>{{ t('云存储') }}</span>
          <strong>{{ formatBytes(usage.storage.used_bytes) }} / {{ formatBytes(usage.storage.limit_bytes) }}</strong>
        </div>
        <div class="quota__bar" :class="{ 'is-full': pct(usage.storage.used_bytes, usage.storage.limit_bytes) >= 90 }"><i :style="{ width: `${pct(usage.storage.used_bytes, usage.storage.limit_bytes)}%` }" /></div>
      </div>
    </div>
    <p class="settings-hint">
      {{ t('并发和存储按套餐限制，超出后无法新建任务或上传。') }}
      <a v-if="!usage.plan.is_member" href="#" @click.prevent="gotoPricing('membership')">{{ t('升级套餐') }}</a>
    </p>
  </section>

  <section class="wallet-card">
    <h3>{{ t('手机号') }}</h3>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('当前') }}</span>
      <span class="settings-row__value">{{ profile.mobile ? profile.mobile.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : t('未绑定') }}</span>
    </div>
    <div class="settings-row settings-row--top">
      <span class="settings-row__label">{{ profile.mobile ? t('换绑') : t('绑定') }}</span>
      <div class="settings-bind">
        <input v-model="mobileForm.mobile" maxlength="20" inputmode="numeric" class="settings-input" :placeholder="t('新手机号')">
        <input v-model="mobileForm.code" maxlength="6" inputmode="numeric" class="settings-input settings-input--short" :placeholder="t('验证码')" @keydown.enter="bindMobile">
        <button type="button" class="plan-btn plan-btn--ghost" :disabled="sendingCode || countingDown" @click="sendCode">
          {{ sendingCode ? t('发送中…') : countingDown ? `${secondsLeft}s` : t('发送验证码') }}
        </button>
        <button type="button" class="plan-btn plan-btn--solid" :disabled="mobileSaving" @click="bindMobile">
          {{ mobileSaving ? t('提交中…') : t('确认') }}
        </button>
        <p class="settings-hint">{{ t('短信登录的账号换绑后，请用新手机号登录。') }}</p>
      </div>
    </div>
  </section>

  <section class="wallet-card">
    <h3>{{ t('账号安全') }}</h3>
    <div class="settings-row">
      <span class="settings-row__label">{{ t('退出登录') }}</span>
      <div class="settings-secure">
        <p class="settings-hint">{{ t('退出后需要重新登录才能继续创作。') }}</p>
        <button
          type="button"
          class="plan-btn plan-btn--ghost is-danger"
          :disabled="leaving"
          @click="onLogout"
        >
          {{ leaving ? t('退出中…') : t('退出登录') }}
        </button>
      </div>
    </div>
  </section>

  <section class="wallet-card">
    <h3>{{ t('协议与政策') }}</h3>
    <p class="settings-lead legal-links">
      <NuxtLink :to="localePath('/legal/terms')">{{ t('用户服务协议') }}</NuxtLink>
      <NuxtLink :to="localePath('/legal/privacy')">{{ t('隐私政策') }}</NuxtLink>
      <NuxtLink :to="localePath('/legal/ai-guidelines')">{{ t('AI 生成内容规范') }}</NuxtLink>
    </p>
  </section>

  <section class="wallet-card settings-danger">
    <h3>{{ t('注销账号') }} <small>{{ t('不可恢复') }}</small></h3>
    <p class="settings-lead">{{ t('注销后作品全部下架、画布分享失效、退出所在团队，剩余积分与会员权益作废且不退款。邮箱和手机号会释放，可以重新注册。') }}</p>
    <button type="button" class="plan-btn plan-btn--ghost is-danger" @click="requestDeactivate">{{ t('注销账号') }}</button>
  </section>
</template>
