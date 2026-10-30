<script setup lang="ts">
/**
 * 设置 · 渠道伙伴计划（API.md 9.3，M12）
 *
 * - GET /user/partner/me：看板（专属码 / 推广链接 / 推广成果 / 最近归属客户）或申请状态
 * - POST /user/partner/apply：提交申请
 * - POST /user/withdraw、GET /user/withdraw/self：已通过的伙伴申请提现并看记录
 * 复制专属码 / 链接。
 */
import partnerApi from '~/api/partner'
import withdrawApi from '~/api/withdraw'
import { rewritePublicLandingUrl } from '~/utils/public-landing-url'
import type { PartnerApplyBody, PartnerDashboard, PartnerKind } from '~/types/creative'

const { t } = useI18n()
const toast = useToast()
const { openSettings } = useSettingsModal()
const { track } = useTrack()
const { confirm } = useConfirm()

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

/** 后端 GrowthPartnerRebateRate 默认值：还没申请时用来展示返佣比例 */
const PARTNER_DEFAULT_REBATE = 0.15
const PARTNER_KINDS: { id: PartnerKind, label: string }[] = [
  { id: 'mcn', label: t('MCN 机构') },
  { id: 'school', label: t('培训机构') },
  { id: 'kol', label: t('达人 / KOL') },
  { id: 'dev', label: t('开发者') },
  { id: 'other', label: t('其它') },
]
const PARTNER_STATUS_LABEL: Record<number, string> = {
  0: t('待审核'),
  1: t('已通过'),
  2: t('已驳回'),
  3: t('已停用'),
}

const partnerProgram = ref<PartnerDashboard | null>(null)
const partnerProgramLoading = ref(false)
const partnerProgramLoaded = ref(false)
const partnerProgramError = ref('')
const partnerApplying = ref(false)
/** 驳回后点「重新申请」把表单重新打开 */
const partnerFormOpen = ref(false)
const partnerForm = reactive<PartnerApplyBody>({ name: '', kind: 'mcn', contact: '', intro: '' })

const partnerRow = computed(() => partnerProgram.value?.partner ?? null)
const partnerStatus = computed(() => partnerRow.value?.status ?? -1)
const partnerRebatePct = computed(() => {
  const rate = partnerProgram.value?.rebate_rate || partnerRow.value?.rebate_rate || PARTNER_DEFAULT_REBATE
  return Math.round(rate * 1000) / 10
})
const partnerLink = computed(() => rewritePublicLandingUrl(partnerProgram.value?.link || ''))

function partnerKindLabel(kind: PartnerKind | undefined) {
  return PARTNER_KINDS.find(k => k.id === kind)?.label ?? t('其它')
}

function partnerCustomerName(row: { nickname?: string, user?: string }) {
  return row.nickname || row.user || t('新客户')
}

function money(n: number | undefined) {
  return `¥${(Number(n) || 0).toFixed(2)}`
}

async function loadPartnerProgram() {
  if (partnerProgramLoading.value)
    return
  partnerProgramLoading.value = true
  partnerProgramError.value = ''
  try {
    const res = await partnerApi.me()
    if (!res?.success) {
      partnerProgramError.value = res?.message || t('加载失败，请稍后重试')
      return
    }
    // 从未申请过时 data 为 null，展示招募说明 + 申请表单
    partnerProgram.value = res.data?.partner ? res.data : null
    partnerProgramLoaded.value = true
    if (partnerProgram.value?.partner) {
      const row = partnerProgram.value.partner
      partnerForm.name = row.name
      partnerForm.kind = row.kind || 'mcn'
      partnerForm.contact = row.contact
      partnerForm.intro = row.intro
    }
  }
  finally {
    partnerProgramLoading.value = false
  }
}

async function submitPartnerApply() {
  if (partnerApplying.value)
    return
  const name = partnerForm.name.trim()
  const contact = partnerForm.contact.trim()
  if (!name) {
    notify(t('请填写机构 / 个人名称'), 'error')
    return
  }
  if (!contact) {
    notify(t('请填写联系方式'), 'error')
    return
  }
  partnerApplying.value = true
  try {
    const res = await partnerApi.apply({ name, kind: partnerForm.kind, contact, intro: partnerForm.intro.trim() })
    if (!res?.success) {
      notify(res?.message || t('提交失败，请稍后重试'), 'error')
      return
    }
    partnerFormOpen.value = false
    notify(t('申请已提交，审核通过后可在这里看到专属码'), 'success')
    await loadPartnerProgram()
  }
  finally {
    partnerApplying.value = false
  }
}

async function copyPartnerText(kind: 'code' | 'link') {
  const value = kind === 'code' ? partnerRow.value?.code : partnerLink.value
  if (!value)
    return
  track('share_click', { where: 'partner', kind })
  try {
    await navigator.clipboard.writeText(value)
    notify(kind === 'code' ? t('专属码已复制') : t('链接已复制'), 'success')
  }
  catch {
    notify(value)
  }
}

const WITHDRAW_PAGE = 10
const WITHDRAW_WAYS = [
  { id: 'alipay', label: '支付宝' },
  { id: 'wechat', label: '微信' },
  { id: 'bank', label: '银行卡' },
] as const

const withdrawOpen = ref(false)
const withdrawing = ref(false)
const withdrawForm = reactive({ amount: '', way: 'alipay', name: '', account: '', bank: '' })
const withdraws = ref<any[]>([])
const withdrawTotal = ref(0)
const withdrawPage = ref(1)
const withdrawLoading = ref(false)
const withdrawLoaded = ref(false)
const withdrawError = ref('')

const withdrawable = computed(() => Number(partnerProgram.value?.withdrawable) || 0)
const withdrawHasMore = computed(() => withdraws.value.length < withdrawTotal.value)

function withdrawWayLabel(way: string) {
  return t(WITHDRAW_WAYS.find(item => item.id === way)?.label ?? '支付宝')
}

function withdrawStatusLabel(status: number) {
  if (status === 1)
    return t('已打款')
  if (status === 2)
    return t('打款中')
  if (status === -1)
    return t('打款失败')
  if (status === -9)
    return t('已驳回')
  return t('待审核')
}

function resetWithdrawForm() {
  withdrawForm.amount = withdrawable.value > 0 ? withdrawable.value.toFixed(2) : ''
  withdrawForm.way = 'alipay'
  withdrawForm.name = ''
  withdrawForm.account = ''
  withdrawForm.bank = ''
}

function openWithdraw() {
  resetWithdrawForm()
  withdrawOpen.value = true
}

async function loadWithdraws(reset = true) {
  if (withdrawLoading.value)
    return
  const page = reset ? 1 : withdrawPage.value + 1
  withdrawLoading.value = true
  if (reset)
    withdrawError.value = ''
  try {
    const res = await withdrawApi.list(page, WITHDRAW_PAGE) as any
    if (!res?.success) {
      const message = res?.message || t('加载失败，请稍后重试')
      if (reset && !withdraws.value.length)
        withdrawError.value = message
      else
        notify(message, 'error')
      return
    }
    const items = Array.isArray(res.data?.items) ? res.data.items : []
    withdrawTotal.value = Number(res.data?.total) || 0
    withdraws.value = reset ? items : withdraws.value.concat(items)
    withdrawPage.value = page
    withdrawLoaded.value = true
  }
  finally {
    withdrawLoading.value = false
  }
}

async function submitWithdraw() {
  if (withdrawing.value)
    return
  const amount = Math.round(Number(withdrawForm.amount) * 100) / 100
  const name = withdrawForm.name.trim()
  const account = withdrawForm.account.trim()
  const bank = withdrawForm.bank.trim()
  if (!Number.isFinite(amount) || amount <= 0) {
    notify(t('请填写提现金额'), 'error')
    return
  }
  if (amount > withdrawable.value + 0.001) {
    notify(t('提现金额不能超过可提现余额'), 'error')
    return
  }
  if (!name) {
    notify(t('请填写收款人姓名'), 'error')
    return
  }
  if (!account) {
    notify(t('请填写收款账号'), 'error')
    return
  }
  if (withdrawForm.way === 'bank' && !bank) {
    notify(t('请填写开户行'), 'error')
    return
  }
  const ok = await confirm({
    title: t('申请提现'),
    message: t('确认提现 {amount} 到{way}？金额会先冻结，审核驳回后退回。', {
      amount: `¥${amount.toFixed(2)}`,
      way: withdrawWayLabel(withdrawForm.way),
    }),
    confirmText: t('申请提现'),
    danger: true,
  })
  if (!ok)
    return
  withdrawing.value = true
  try {
    const accountInfo: Record<string, string> = { name, account }
    if (withdrawForm.way === 'bank')
      accountInfo.bank_name = bank
    const res = await withdrawApi.apply({
      amount,
      way: withdrawForm.way,
      account_info: JSON.stringify(accountInfo),
    }) as any
    if (!res?.success) {
      notify(res?.message || t('提交失败，请稍后重试'), 'error')
      return
    }
    withdrawOpen.value = false
    notify(t('提现申请已提交，请等待审核'), 'success')
    await loadPartnerProgram()
    await loadWithdraws(true)
  }
  finally {
    withdrawing.value = false
  }
}

onMounted(() => {
  void loadPartnerProgram().then(() => {
    if (partnerStatus.value === 1)
      void loadWithdraws(true)
  })
})
</script>

<template>
  <section v-if="partnerProgramLoading && !partnerProgramLoaded" class="wallet-card">
    <p class="settings-lead">{{ t('加载中…') }}</p>
  </section>
  <section v-else-if="partnerProgramError" class="wallet-card">
    <p class="settings-lead">{{ partnerProgramError }}</p>
    <button type="button" class="plan-btn plan-btn--ghost invite-retry" @click="loadPartnerProgram">{{ t('重试') }}</button>
  </section>

  <!-- 已通过：看板 -->
  <template v-else-if="partnerStatus === 1 && partnerProgram">
    <section class="wallet-card">
      <h3>
        {{ t('渠道伙伴') }}
        <small>{{ t('客户实付按 {pct}% 返佣，直接入账可提现余额', { pct: partnerRebatePct }) }}</small>
      </h3>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('专属码') }}</span>
        <div class="settings-row__field">
          <code class="settings-code">{{ partnerRow?.code || '—' }}</code>
          <button type="button" class="plan-btn plan-btn--ghost" @click="copyPartnerText('code')">{{ t('复制') }}</button>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('推广链接') }}</span>
        <div class="settings-row__field">
          <input :value="partnerLink" readonly class="settings-input invite-url" @focus="($event.target as HTMLInputElement).select()">
          <button type="button" class="plan-btn plan-btn--solid" @click="copyPartnerText('link')">{{ t('复制链接') }}</button>
        </div>
      </div>
      <ul class="wallet-card__meta invite-rules">
        <li>{{ t('客户从你的链接注册即绑定归属，30 天内有效') }}</li>
        <li>{{ t('客户首年内的每笔实付都按比例返佣，退款会冲回') }}</li>
      </ul>
    </section>

    <section class="wallet-card">
      <h3>{{ t('推广成果') }}</h3>
      <div class="invite-stats">
        <div class="invite-stat">
          <dt>{{ t('客户数') }}</dt>
          <dd>{{ partnerProgram.customers.toLocaleString() }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('付费客户') }}</dt>
          <dd>{{ partnerProgram.paid_users.toLocaleString() }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('客户累计实付') }}</dt>
          <dd>{{ money(partnerProgram.amount_total) }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('累计返佣') }}</dt>
          <dd>{{ money(partnerProgram.rebate_total) }}</dd>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('可提现金额') }}</span>
        <div class="settings-row__field">
          <b class="partner-withdrawable">{{ money(partnerProgram.withdrawable) }}</b>
          <button
            v-if="!withdrawOpen"
            type="button"
            class="plan-btn plan-btn--solid"
            :disabled="withdrawable <= 0"
            @click="openWithdraw"
          >
            {{ t('申请提现') }}
          </button>
        </div>
      </div>
      <p v-if="!withdrawOpen" class="settings-hint">{{ t('审核通过后会打到你填写的账户') }}</p>
      <p v-if="!withdrawOpen" class="settings-hint">{{ t('account.payout.partnerHint') }}</p>
      <button v-if="!withdrawOpen" type="button" class="settings-link" @click="openSettings('creator')">{{ t('account.payout.toCreator') }}</button>
      <form v-else class="partner-withdraw" @submit.prevent="submitWithdraw">
        <div class="settings-row">
          <span class="settings-row__label">{{ t('提现金额') }} <i>*</i></span>
          <div class="settings-row__field">
            <input v-model="withdrawForm.amount" type="number" min="0.01" step="0.01" class="settings-input settings-input--short" :placeholder="t('提现金额')">
            <button type="button" class="settings-link" :disabled="withdrawing" @click="withdrawForm.amount = withdrawable.toFixed(2)">{{ t('全部') }}</button>
          </div>
        </div>
        <div class="settings-row settings-row--top">
          <span class="settings-row__label">{{ t('收款方式') }} <i>*</i></span>
          <div class="partner-ways" role="radiogroup" :aria-label="t('收款方式')">
            <label
              v-for="item in WITHDRAW_WAYS"
              :key="item.id"
              class="partner-way"
              :class="{ 'is-on': withdrawForm.way === item.id }"
            >
              <input v-model="withdrawForm.way" type="radio" name="withdraw-way" :value="item.id">
              <span>{{ t(item.label) }}</span>
            </label>
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row__label">{{ t('收款人姓名') }} <i>*</i></span>
          <div class="settings-row__field">
            <input v-model="withdrawForm.name" type="text" maxlength="40" class="settings-input" :placeholder="t('收款人姓名')">
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row__label">{{ t('收款账号') }} <i>*</i></span>
          <div class="settings-row__field">
            <input v-model="withdrawForm.account" type="text" maxlength="80" class="settings-input" :placeholder="t('收款账号')">
          </div>
        </div>
        <div v-if="withdrawForm.way === 'bank'" class="settings-row">
          <span class="settings-row__label">{{ t('开户行') }} <i>*</i></span>
          <div class="settings-row__field">
            <input v-model="withdrawForm.bank" type="text" maxlength="80" class="settings-input" :placeholder="t('开户行')">
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row__label" />
          <div class="settings-row__field">
            <button type="submit" class="plan-btn plan-btn--solid" :disabled="withdrawing">{{ withdrawing ? t('提交中…') : t('申请提现') }}</button>
            <button type="button" class="plan-btn plan-btn--ghost" :disabled="withdrawing" @click="withdrawOpen = false">{{ t('取消') }}</button>
          </div>
        </div>
      </form>
    </section>

    <section class="wallet-card" :class="{ 'settings-empty-card': withdrawLoaded && !withdraws.length }">
      <h3>{{ t('提现记录') }}</h3>
      <p v-if="withdrawLoading && !withdrawLoaded" class="settings-lead">{{ t('加载中…') }}</p>
      <template v-else-if="withdrawError">
        <p class="settings-lead">{{ withdrawError }}</p>
        <button type="button" class="plan-btn plan-btn--ghost invite-retry" @click="loadWithdraws(true)">{{ t('重试') }}</button>
      </template>
      <StudioEmpty
        v-else-if="!withdraws.length"
        compact
        :title="t('还没有提现记录')"
        :description="t('审核结果会出现在这里')"
      />
      <template v-else>
        <div class="creator-table-wrap">
          <table class="creator-table">
            <thead>
              <tr>
                <th>{{ t('单号') }}</th>
                <th>{{ t('金额') }}</th>
                <th>{{ t('收款方式') }}</th>
                <th>{{ t('状态') }}</th>
                <th>{{ t('时间') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in withdraws" :key="row.id || row.withdraw_no">
                <td class="creator-table__title">{{ row.withdraw_no }}</td>
                <td class="creator-table__num">{{ money(row.amount) }}</td>
                <td>{{ withdrawWayLabel(row.way) }}</td>
                <td>
                  {{ withdrawStatusLabel(Number(row.status)) }}
                  <small v-if="Number(row.status) === -9 && row.audit_remark" class="partner-audit-remark">{{ row.audit_remark }}</small>
                </td>
                <td class="creator-table__time">{{ fmt(row.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="withdrawHasMore" class="settings-more">
          <button type="button" class="settings-link" :disabled="withdrawLoading" @click="loadWithdraws(false)">
            {{ withdrawLoading ? t('加载中…') : t('加载更多') }}
          </button>
        </p>
        <p v-else class="settings-hint">{{ t('没有更多数据了') }}</p>
      </template>
    </section>

    <section class="wallet-card" :class="{ 'settings-empty-card': !partnerProgram.recent.length }">
      <h3>{{ t('最近归属客户') }}</h3>
      <StudioEmpty
        v-if="!partnerProgram.recent.length"
        compact
        :title="t('还没有付费客户')"
        :description="t('把推广链接发给你的学员或粉丝吧')"
      />
      <div v-else class="creator-table-wrap">
        <table class="creator-table">
          <thead>
            <tr>
              <th>{{ t('客户') }}</th>
              <th>{{ t('实付') }}</th>
              <th>{{ t('返佣') }}</th>
              <th>{{ t('归属时间') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, idx) in partnerProgram.recent" :key="`${r.created_at}-${idx}`">
              <td class="creator-table__title">{{ partnerCustomerName(r) }}</td>
              <td class="creator-table__num">{{ money(r.amount) }}</td>
              <td class="creator-table__num">{{ money(r.rebate) }}</td>
              <td class="creator-table__time">{{ fmt(r.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- 待审 -->
  <section v-else-if="partnerStatus === 0" class="wallet-card">
    <h3>
      {{ t('渠道伙伴') }}
      <small>{{ PARTNER_STATUS_LABEL[0] }}</small>
    </h3>
    <p class="settings-lead">{{ t('申请已收到，我们会在 3 个工作日内审核，通过后这里会出现你的专属码与推广链接。') }}</p>
    <ul class="wallet-card__meta invite-rules">
      <li>{{ t('名称') }}：{{ partnerRow?.name }}</li>
      <li>{{ t('类型') }}：{{ partnerKindLabel(partnerRow?.kind) }}</li>
      <li>{{ t('联系方式') }}：{{ partnerRow?.contact }}</li>
    </ul>
  </section>

  <!-- 已停用 -->
  <section v-else-if="partnerStatus === 3" class="wallet-card">
    <h3>
      {{ t('渠道伙伴') }}
      <small>{{ PARTNER_STATUS_LABEL[3] }}</small>
    </h3>
    <p class="settings-lead">{{ t('合作已暂停，已产生的返佣不受影响。如需恢复请联系运营。') }}</p>
    <p v-if="partnerRow?.remark" class="settings-hint">{{ t('说明') }}：{{ partnerRow.remark }}</p>
  </section>

  <!-- 未申请 / 已驳回：招募说明 + 申请表单 -->
  <template v-else>
    <section class="wallet-card">
      <h3>
        {{ t('渠道伙伴') }}
        <small>{{ t('客户实付按 {pct}% 返佣，首年内有效', { pct: partnerRebatePct }) }}</small>
      </h3>
      <p v-if="partnerStatus === 2" class="settings-lead partner-reject">
        {{ t('上次申请未通过') }}<template v-if="partnerRow?.remark">：{{ partnerRow.remark }}</template>
      </p>
      <ul class="wallet-card__meta invite-rules">
        <li>{{ t('适合谁：MCN 机构、培训机构、达人 / KOL、开发者') }}</li>
        <li>{{ t('拿到专属码与推广链接，客户注册即绑定归属') }}</li>
        <li>{{ t('返佣按客户实付金额结算，直接进可提现余额') }}</li>
      </ul>
      <button
        v-if="partnerStatus === 2 && !partnerFormOpen"
        type="button"
        class="plan-btn plan-btn--solid"
        @click="partnerFormOpen = true"
      >
        {{ t('重新申请') }}
      </button>
    </section>

    <section v-if="partnerStatus !== 2 || partnerFormOpen" class="wallet-card">
      <h3>{{ t('申请成为渠道伙伴') }}</h3>
      <form class="partner-form" @submit.prevent="submitPartnerApply">
        <div class="settings-row">
          <span class="settings-row__label">{{ t('名称') }}</span>
          <div class="settings-row__field">
            <input v-model="partnerForm.name" type="text" class="settings-input" maxlength="60" :placeholder="t('机构或个人名称')">
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row__label">{{ t('类型') }}</span>
          <div class="settings-row__field">
            <StudioSelect
              v-model="partnerForm.kind"
              :options="PARTNER_KINDS.map(item => ({ value: item.id, label: item.label }))"
              :sr-label="t('类型')"
            />
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row__label">{{ t('联系方式') }}</span>
          <div class="settings-row__field">
            <input v-model="partnerForm.contact" type="text" class="settings-input" maxlength="120" :placeholder="t('微信 / 邮箱 / 手机号')">
          </div>
        </div>
        <div class="settings-row settings-row--top">
          <span class="settings-row__label">{{ t('简介') }}</span>
          <div class="settings-row__field">
            <textarea v-model="partnerForm.intro" rows="3" class="settings-input settings-input--area" maxlength="500" :placeholder="t('介绍一下你的资源与推广方式（选填）')" />
          </div>
        </div>
        <div class="settings-row">
          <span class="settings-row__label" />
          <div class="settings-row__field">
            <button type="submit" class="plan-btn plan-btn--solid" :disabled="partnerApplying">{{ partnerApplying ? t('提交中…') : t('提交申请') }}</button>
          </div>
        </div>
      </form>
    </section>
  </template>
</template>
