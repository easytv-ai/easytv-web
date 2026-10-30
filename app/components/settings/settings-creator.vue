<script setup lang="ts">
/**
 * 设置 · 创作者中心
 *
 * - GET /user/creator/summary：调用数 / 累计收益 / 可兑换收益 / 可提现现金 / 分成比例
 * - 兑换收益为积分（POST /user/creator/exchange）：≤ withdrawable，90 天有效
 * - 提现人民币（POST /user/creator/withdraw）：按 points_per_yuan 换成元，走提现审核
 */
import creatorApi from '~/api/creator'
import type { CreatorSummary, CreatorWithdraw, SkillReviewStatus } from '~/types/creative'

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { openSettings } = useSettingsModal()
const { growth } = useStudioAppConfig()
const { refresh: refreshWallet } = useWallet()
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

function money(n: number | undefined) {
  return `¥${(Number(n) || 0).toFixed(2)}`
}

const creator = ref<CreatorSummary | null>(null)
const creatorLoading = ref(false)
const creatorError = ref('')
const exchangeOpen = ref(false)
const exchangePoints = ref<number | null>(null)
const exchanging = ref(false)

const WITHDRAW_PAGE = 10
const WITHDRAW_WAYS = [
  { id: 'alipay', label: '支付宝' },
  { id: 'wechat', label: '微信' },
  { id: 'bank', label: '银行卡' },
] as const

const withdrawOpen = ref(false)
const withdrawing = ref(false)
const withdrawForm = reactive({ amount: '', way: 'alipay', name: '', account: '', bank: '' })
const withdraws = ref<CreatorWithdraw[]>([])
const withdrawTotal = ref(0)
const withdrawPage = ref(1)
const withdrawLoading = ref(false)
const withdrawLoaded = ref(false)
const withdrawError = ref('')

const cashAvailable = computed(() => Number(creator.value?.cash_available) || 0)
const pointsPerYuan = computed(() => Number(creator.value?.points_per_yuan) || 20)
const withdrawHasMore = computed(() => withdraws.value.length < withdrawTotal.value)

async function loadCreator() {
  if (creatorLoading.value)
    return
  creatorLoading.value = true
  creatorError.value = ''
  try {
    const res = await creatorApi.summary()
    if (!res?.success || !res.data) {
      creatorError.value = res?.message || t('加载失败，请稍后重试')
      return
    }
    creator.value = res.data
  }
  finally {
    creatorLoading.value = false
  }
}

/** 分成比例：总览没返回时回落到 /app/config.growth */
const creatorSharePct = computed(() => Math.round((creator.value?.share_rate || growth.value?.skill_author_share || 0) * 100))

/** 技能上架状态（0 私有 1 待审 2 已上架 3 驳回） */
const SKILL_REVIEW_LABEL: Record<SkillReviewStatus, { label: string, cls: string }> = {
  0: { label: t('私有'), cls: 'is-private' },
  1: { label: t('审核中'), cls: 'is-pending' },
  2: { label: t('已上架'), cls: 'is-published' },
  3: { label: t('已驳回'), cls: 'is-rejected' },
}

function skillReviewBadge(status: SkillReviewStatus) {
  return SKILL_REVIEW_LABEL[status] ?? SKILL_REVIEW_LABEL[0]
}

function recordLabel(bizType: number, skillTitle: string) {
  if (bizType === 8)
    return t('兑换为积分')
  if (bizType === 10)
    return t('技能收益提现')
  if (bizType === 11)
    return t('提现已退回')
  return skillTitle || t('技能分成')
}

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

function openExchange() {
  withdrawOpen.value = false
  exchangePoints.value = creator.value?.withdrawable || null
  exchangeOpen.value = true
}

function resetWithdrawForm() {
  withdrawForm.amount = cashAvailable.value > 0 ? cashAvailable.value.toFixed(2) : ''
  withdrawForm.way = 'alipay'
  withdrawForm.name = ''
  withdrawForm.account = ''
  withdrawForm.bank = ''
}

function openWithdraw() {
  exchangeOpen.value = false
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
    const res = await creatorApi.withdraws(page, WITHDRAW_PAGE)
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

/** 收益兑积分（POST /user/creator/exchange）：≤ withdrawable，90 天有效，成功后刷新钱包 */
async function submitExchange() {
  if (exchanging.value)
    return
  const max = creator.value?.withdrawable ?? 0
  const points = Math.floor(Number(exchangePoints.value) || 0)
  if (points <= 0) {
    notify(t('请输入要兑换的积分数'), 'error')
    return
  }
  if (points > max) {
    notify(t('最多可兑换 {n} 积分', { n: max }), 'error')
    return
  }
  exchanging.value = true
  try {
    const res = await creatorApi.exchange(points)
    if (!res?.success) {
      notify(res?.message || t('兑换失败'), 'error')
      return
    }
    notify(t('已兑换 {n} 积分，90 天内有效', { n: points }), 'success')
    exchangeOpen.value = false
    if (creator.value && res.data) {
      creator.value.withdrawable = Number(res.data.withdrawable) || 0
      if (res.data.cash_available != null)
        creator.value.cash_available = Number(res.data.cash_available) || 0
    }
    await Promise.all([loadCreator(), refreshWallet()])
  }
  finally {
    exchanging.value = false
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
  if (amount > cashAvailable.value + 0.001) {
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
      amount: money(amount),
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
    const res = await creatorApi.withdraw({
      amount,
      way: withdrawForm.way,
      account_info: JSON.stringify(accountInfo),
    })
    if (!res?.success) {
      notify(res?.message || t('提交失败，请稍后重试'), 'error')
      return
    }
    withdrawOpen.value = false
    notify(t('提现申请已提交，请等待审核'), 'success')
    await Promise.all([loadCreator(), loadWithdraws(true)])
  }
  finally {
    withdrawing.value = false
  }
}

onMounted(() => {
  void loadCreator()
  void loadWithdraws(true)
})
</script>

<template>
  <section v-if="creatorLoading && !creator" class="wallet-card">
    <p class="settings-lead">{{ t('加载中…') }}</p>
  </section>
  <section v-else-if="!creator" class="wallet-card">
    <p class="settings-lead">{{ creatorError || t('加载失败，请稍后重试') }}</p>
    <button type="button" class="plan-btn plan-btn--ghost invite-retry" @click="loadCreator">{{ t('重试') }}</button>
  </section>
  <template v-else>
    <section class="wallet-card">
      <h3>
        {{ t('创作者中心') }}
        <small>{{ t('技能上架后，他人调用按比例给你分成') }}</small>
      </h3>
      <div class="invite-stats">
        <div class="invite-stat">
          <dt>{{ t('调用数') }}</dt>
          <dd>{{ creator.calls_total.toLocaleString() }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('累计收益') }}</dt>
          <dd>{{ creator.revenue_total.toLocaleString() }}<small>{{ t('积分') }}</small></dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('可兑换收益') }}</dt>
          <dd>{{ creator.withdrawable.toLocaleString() }}<small>{{ t('积分') }}</small></dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('可提现现金') }}</dt>
          <dd>{{ money(cashAvailable) }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('分成比例') }}</dt>
          <dd>{{ creatorSharePct }}%</dd>
        </div>
      </div>
      <div class="creator-exchange">
        <button v-if="!exchangeOpen && !withdrawOpen" type="button" class="plan-btn plan-btn--solid" :disabled="!creator.withdrawable" @click="openExchange">{{ t('兑换为积分') }}</button>
        <button v-if="!exchangeOpen && !withdrawOpen" type="button" class="plan-btn plan-btn--ghost" :disabled="cashAvailable <= 0" @click="openWithdraw">{{ t('提现为人民币') }}</button>
        <form v-else-if="exchangeOpen" class="creator-exchange__form" @submit.prevent="submitExchange">
          <input
            v-model.number="exchangePoints"
            type="number"
            min="1"
            :max="creator.withdrawable"
            step="1"
            class="settings-input settings-input--short"
            :placeholder="t('积分数')"
          >
          <button type="button" class="settings-link" :disabled="exchanging" @click="exchangePoints = creator.withdrawable">{{ t('全部') }}</button>
          <button type="submit" class="plan-btn plan-btn--solid" :disabled="exchanging">{{ exchanging ? t('兑换中…') : t('确认兑换') }}</button>
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="exchanging" @click="exchangeOpen = false">{{ t('取消') }}</button>
        </form>
        <p v-if="!withdrawOpen" class="settings-hint">{{ t('兑换后的积分 90 天内有效，本次最多可兑换 {n} 积分', { n: creator.withdrawable }) }}</p>
        <p class="settings-hint">{{ t('按 {rate} 积分兑换 1 元，本次可提现 {cash}', { rate: pointsPerYuan, cash: money(cashAvailable) }) }}</p>
        <p v-if="!withdrawOpen" class="settings-hint">{{ t('account.payout.creatorHint') }}</p>
        <button v-if="!withdrawOpen" type="button" class="settings-link" @click="openSettings('partner-program')">{{ t('account.payout.toPartner') }}</button>
        <form v-if="withdrawOpen" class="partner-withdraw" @submit.prevent="submitWithdraw">
          <div class="settings-row">
            <span class="settings-row__label">{{ t('提现金额') }} <i>*</i></span>
            <div class="settings-row__field">
              <input v-model="withdrawForm.amount" type="number" min="0.01" step="0.01" class="settings-input settings-input--short" :placeholder="t('提现金额')">
              <button type="button" class="settings-link" :disabled="withdrawing" @click="withdrawForm.amount = cashAvailable.toFixed(2)">{{ t('全部') }}</button>
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
                <input v-model="withdrawForm.way" type="radio" name="creator-withdraw-way" :value="item.id">
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
      </div>
    </section>

    <section class="wallet-card" :class="{ 'settings-empty-card': !creator.skills.length }">
      <h3>{{ t('我的技能') }}</h3>
      <StudioEmpty
        v-if="!creator.skills.length"
        compact
        :title="t('还没有技能')"
        :description="t('把常用的提示词保存成 Skill，提交上架后他人调用就有分成。')"
      >
        <NuxtLink :to="localePath('/skills')" class="plan-btn plan-btn--solid">{{ t('创建技能') }}</NuxtLink>
      </StudioEmpty>
      <div v-else class="creator-table-wrap">
        <table class="creator-table">
          <thead>
            <tr>
              <th>{{ t('技能') }}</th>
              <th>{{ t('状态') }}</th>
              <th>{{ t('调用数') }}</th>
              <th>{{ t('收藏') }}</th>
              <th>{{ t('收益') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sk in creator.skills" :key="sk.id">
              <td class="creator-table__title">{{ sk.title }}</td>
              <td><i class="skill-review-badge" :class="skillReviewBadge(sk.review_status).cls">{{ skillReviewBadge(sk.review_status).label }}</i></td>
              <td class="creator-table__num">{{ sk.calls.toLocaleString() }}</td>
              <td class="creator-table__num">{{ sk.stars.toLocaleString() }}</td>
              <td class="creator-table__num">{{ sk.revenue.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="wallet-card" :class="{ 'settings-empty-card': !creator.records.length }">
      <h3>{{ t('收益记录') }}</h3>
      <StudioEmpty
        v-if="!creator.records.length"
        compact
        :title="t('还没有收益记录')"
        :description="t('技能被他人调用后会出现在这里')"
      />
      <ul v-else class="invite-records creator-records">
        <li v-for="r in creator.records" :key="r.id">
          <span class="invite-records__name">{{ recordLabel(r.biz_type, r.skill_title) }}</span>
          <i v-if="r.from_user" class="invite-badge">{{ r.from_user }}</i>
          <span v-else />
          <b class="invite-records__points" :class="{ 'is-neg': r.points < 0 }">{{ r.points > 0 ? `+${r.points.toLocaleString()}` : r.points.toLocaleString() }}</b>
          <time class="invite-records__time">{{ fmt(r.created_at) }}</time>
        </li>
      </ul>
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
                <td>{{ withdrawStatusLabel(row.status) }}</td>
                <td>{{ fmt(row.created_at) }}</td>
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
  </template>
</template>
