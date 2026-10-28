<script setup lang="ts">
/**
 * 设置 · 推广返利
 *
 * - GET /user/invite/summary：邀请码 / 链接 / 成果
 * - GET /user/invite/records：分页邀请记录（可搜被邀请人）
 * - GET /user/bills/self?biz_type=1,2,6：返利流水
 * - GET /user/withdraw/self：提现记录
 * - GET /user/partner/me：有渠道返佣时引导去提现
 */
import QRCode from 'qrcode/lib/browser.js'
import inviteApi from '~/api/invite'
import partnerApi from '~/api/partner'
import withdrawApi from '~/api/withdraw'
import { rewritePublicLandingUrl } from '~/utils/public-landing-url'
import type { InviteBill, InviteRecord, InviteRecordStatus, InviteSummary } from '~/types/creative'

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { track } = useTrack()
const { growth } = useStudioAppConfig()

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

const PAGE_SIZE = 10
const invite = ref<InviteSummary | null>(null)
const inviteLoading = ref(false)
const inviteError = ref('')

const pane = ref<'records' | 'bills' | 'withdraws'>('records')
const keywordDraft = ref('')
const keyword = ref('')
const records = ref<InviteRecord[]>([])
const recordsTotal = ref(0)
const recordsPage = ref(1)
const recordsLoading = ref(false)

const bills = ref<InviteBill[]>([])
const billsTotal = ref(0)
const billsPage = ref(1)
const billsLoading = ref(false)

const withdraws = ref<any[]>([])
const withdrawTotal = ref(0)
const withdrawPage = ref(1)
const withdrawLoading = ref(false)

const partnerCash = ref(0)
const qrDataUrl = ref('')

async function loadInvite() {
  if (inviteLoading.value)
    return
  inviteLoading.value = true
  inviteError.value = ''
  try {
    const res = await inviteApi.summary()
    if (!res?.success || !res.data) {
      inviteError.value = res?.message || t('加载失败，请稍后重试')
      return
    }
    invite.value = res.data
    await buildQr()
  }
  finally {
    inviteLoading.value = false
  }
}

async function loadRecords(page = 1) {
  recordsLoading.value = true
  try {
    const res = await inviteApi.records({ keyword: keyword.value || undefined, page, page_size: PAGE_SIZE }) as any
    if (!res?.success) {
      notify(res?.message || t('settings.invite.loadFailed'), 'error')
      return
    }
    records.value = Array.isArray(res.data?.items) ? res.data.items : []
    recordsTotal.value = Number(res.data?.total) || 0
    recordsPage.value = page
  }
  finally {
    recordsLoading.value = false
  }
}

async function loadBills(page = 1) {
  billsLoading.value = true
  try {
    const res = await inviteApi.bills({ page, page_size: PAGE_SIZE }) as any
    if (!res?.success) {
      notify(res?.message || t('settings.invite.loadFailed'), 'error')
      return
    }
    bills.value = Array.isArray(res.data?.items) ? res.data.items : []
    billsTotal.value = Number(res.data?.total) || 0
    billsPage.value = page
  }
  finally {
    billsLoading.value = false
  }
}

async function loadWithdraws(page = 1) {
  withdrawLoading.value = true
  try {
    const res = await withdrawApi.list(page, PAGE_SIZE) as any
    if (!res?.success) {
      notify(res?.message || t('settings.invite.loadFailed'), 'error')
      return
    }
    withdraws.value = Array.isArray(res.data?.items) ? res.data.items : []
    withdrawTotal.value = Number(res.data?.total) || 0
    withdrawPage.value = page
  }
  finally {
    withdrawLoading.value = false
  }
}

async function loadPartnerCash() {
  try {
    const res = await partnerApi.me() as any
    const row = res?.data
    if (res?.success && row?.partner?.status === 1)
      partnerCash.value = Number(row.withdrawable) || 0
  }
  catch {
    partnerCash.value = 0
  }
}

function searchRecords() {
  keyword.value = keywordDraft.value.trim()
  void loadRecords(1)
}

function resetSearch() {
  keywordDraft.value = ''
  keyword.value = ''
  void loadRecords(1)
}

watch(pane, (next) => {
  if (next === 'bills' && !bills.value.length && !billsLoading.value)
    void loadBills(1)
  if (next === 'withdraws' && !withdraws.value.length && !withdrawLoading.value)
    void loadWithdraws(1)
})

const inviteePoints = computed(() => invite.value?.invitee_points || growth.value?.invite_invitee_points || 0)
const inviteUrl = computed(() => rewritePublicLandingUrl(invite.value?.invite_url || ''))
const inviteShareText = computed(() => invite.value
  ? t('我在用 EasyTV 做 AI 视频，用我的链接注册送 {n} 积分：{url}', { n: inviteePoints.value, url: inviteUrl.value })
  : '')
const inviteRebatePct = computed(() => Math.round((invite.value?.rebate_rate ?? 0) * 100))

const INVITE_STATUS_LABEL: Record<InviteRecordStatus, string> = {
  registered: t('已注册'),
  effective: t('已生效'),
  paid: t('已付费'),
}

function inviteStatusLabel(status: InviteRecordStatus) {
  return INVITE_STATUS_LABEL[status] ?? status
}

function billTypeLabel(type: number) {
  if (type === 1)
    return t('settings.invite.registerRebate')
  if (type === 2)
    return t('settings.invite.rechargeRebate')
  if (type === 6)
    return t('settings.invite.revoke')
  return t('settings.invite.flow')
}

function withdrawWayLabel(way: string) {
  if (way === 'wechat')
    return t('微信')
  if (way === 'bank')
    return t('银行卡')
  return t('支付宝')
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

function money(n: number | undefined) {
  return `¥${(Number(n) || 0).toFixed(2)}`
}

const inviteShareCopied = ref(false)
let inviteShareCopiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyInviteText(kind: 'code' | 'link' | 'text') {
  const value = kind === 'code' ? invite.value?.aff_code : kind === 'link' ? inviteUrl.value : inviteShareText.value
  if (!value)
    return
  track('share_click', { where: 'invite', kind })
  try {
    await navigator.clipboard.writeText(value)
    notify(kind === 'code' ? t('邀请码已复制') : kind === 'link' ? t('链接已复制') : t('分享文案已复制'), 'success')
    if (kind === 'text') {
      inviteShareCopied.value = true
      if (inviteShareCopiedTimer)
        clearTimeout(inviteShareCopiedTimer)
      inviteShareCopiedTimer = setTimeout(() => {
        inviteShareCopied.value = false
      }, 2000)
    }
  }
  catch {
    notify(value)
  }
}

async function buildQr() {
  if (!inviteUrl.value)
    return
  try {
    qrDataUrl.value = await QRCode.toDataURL(inviteUrl.value, { width: 220, margin: 1 })
  }
  catch {
    qrDataUrl.value = ''
  }
}

function downloadQr() {
  if (!qrDataUrl.value) {
    notify(t('settings.invite.noLink'), 'error')
    return
  }
  try {
    const a = document.createElement('a')
    a.href = qrDataUrl.value
    a.download = `easytv-invite-${invite.value?.aff_code || 'qr'}.png`
    a.click()
    notify(t('settings.invite.qrDownloaded'), 'success')
  }
  catch {
    notify(t('settings.invite.qrDownloadFailed'), 'error')
  }
}

onMounted(() => {
  void loadInvite()
  void loadRecords(1)
  void loadPartnerCash()
})

onUnmounted(() => {
  if (inviteShareCopiedTimer)
    clearTimeout(inviteShareCopiedTimer)
})
</script>

<template>
  <section v-if="inviteLoading && !invite" class="wallet-card">
    <p class="settings-lead">{{ t('加载中…') }}</p>
  </section>
  <section v-else-if="!invite" class="wallet-card">
    <p class="settings-lead">{{ inviteError || t('加载失败，请稍后重试') }}</p>
    <button type="button" class="plan-btn plan-btn--ghost invite-retry" @click="loadInvite">{{ t('重试') }}</button>
  </section>
  <template v-else>
    <section class="wallet-card">
      <h3>
        {{ t('settings.invite.title') }}
        <small>{{ t('settings.invite.lead') }}</small>
      </h3>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('我的邀请码') }}</span>
        <div class="settings-row__field">
          <code class="settings-code">{{ invite.aff_code || '—' }}</code>
          <button type="button" class="plan-btn plan-btn--solid" @click="copyInviteText('code')">{{ t('复制') }}</button>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('邀请链接') }}</span>
        <div class="settings-row__field">
          <input :value="inviteUrl" readonly class="settings-input invite-url" @focus="($event.target as HTMLInputElement).select()">
          <button type="button" class="plan-btn plan-btn--solid" @click="copyInviteText('link')">{{ t('复制链接') }}</button>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('分享文案') }}</span>
        <div class="settings-row__field invite-share">
          <input
            :value="inviteShareText"
            readonly
            class="settings-input invite-share__text"
            @focus="($event.target as HTMLInputElement).select()"
          >
          <button
            type="button"
            class="plan-btn plan-btn--solid"
            :disabled="inviteShareCopied"
            @click="copyInviteText('text')"
          >
            {{ inviteShareCopied ? t('已复制') : t('复制文案') }}
          </button>
        </div>
      </div>
      <div v-if="qrDataUrl" class="invite-qr">
        <img :src="qrDataUrl" :alt="t('settings.invite.qr')" width="110" height="110">
        <button type="button" class="plan-btn plan-btn--ghost" @click="downloadQr">{{ t('settings.invite.downloadQr') }}</button>
      </div>
    </section>

    <section class="wallet-card">
      <h3>{{ t('邀请成果') }}</h3>
      <div class="invite-stats">
        <div class="invite-stat">
          <dt>{{ t('已邀请') }}</dt>
          <dd>{{ invite.invited }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('已生效') }}</dt>
          <dd>{{ invite.effective }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('累计积分') }}</dt>
          <dd>{{ invite.points_total.toLocaleString() }}</dd>
        </div>
        <div class="invite-stat">
          <dt>{{ t('首充返利') }}</dt>
          <dd>{{ invite.rebate_points.toLocaleString() }}<small v-if="invite.rebate_cap">/ {{ invite.rebate_cap.toLocaleString() }}</small></dd>
        </div>
      </div>
      <ul class="wallet-card__meta invite-rules">
        <li>{{ t('好友注册并完成首条视频，你得 {n} 积分', { n: invite.inviter_points }) }}</li>
        <li>{{ t('好友完成首条视频得 {n} 积分', { n: invite.invitee_points }) }}</li>
        <li v-if="inviteRebatePct > 0">{{ t('好友首充按 {pct}% 返积分，累计上限 {n} 积分', { pct: inviteRebatePct, n: invite.rebate_cap }) }}</li>
        <li>{{ t('settings.invite.pointsOnly') }}</li>
      </ul>
      <p v-if="partnerCash > 0" class="settings-hint invite-partner-cash">
        {{ t('settings.invite.partnerCash', { amount: money(partnerCash) }) }}
        <NuxtLink :to="localePath({ path: '/settings', query: { tab: 'partner-program' } })" class="settings-link">{{ t('settings.invite.withdrawNow') }}</NuxtLink>
      </p>
    </section>

    <section class="wallet-card">
      <div class="invite-panes" role="tablist">
        <button type="button" :class="{ 'is-on': pane === 'records' }" @click="pane = 'records'">{{ t('邀请记录') }}</button>
        <button type="button" :class="{ 'is-on': pane === 'bills' }" @click="pane = 'bills'">{{ t('settings.invite.bills') }}</button>
        <button type="button" :class="{ 'is-on': pane === 'withdraws' }" @click="pane = 'withdraws'">{{ t('提现记录') }}</button>
      </div>

      <template v-if="pane === 'records'">
        <form class="invite-filter" @submit.prevent="searchRecords">
          <input v-model="keywordDraft" class="settings-input" :placeholder="t('settings.invite.keyword')" @keyup.enter="searchRecords">
          <button type="submit" class="plan-btn plan-btn--solid">{{ t('settings.invite.search') }}</button>
          <button type="button" class="plan-btn plan-btn--ghost" @click="resetSearch">{{ t('重置') }}</button>
        </form>
        <p v-if="recordsLoading" class="settings-lead">{{ t('加载中…') }}</p>
        <StudioEmpty
          v-else-if="!records.length"
          compact
          :title="t('还没有邀请记录')"
          :description="t('把链接分享给好友吧')"
        />
        <ul v-else class="invite-records">
          <li v-for="r in records" :key="`${r.user_id}-${r.created_at}`">
            <span class="invite-records__name">{{ r.nickname || `#${r.user_id}` }}</span>
            <i class="invite-badge" :class="`is-${r.status}`">{{ inviteStatusLabel(r.status) }}</i>
            <b class="invite-records__points">{{ r.points > 0 ? `+${r.points.toLocaleString()}` : '—' }}</b>
            <time class="invite-records__time">{{ fmt(r.created_at) }}</time>
          </li>
        </ul>
        <div v-if="recordsTotal > PAGE_SIZE" class="invite-pager">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="recordsPage <= 1 || recordsLoading" @click="loadRecords(recordsPage - 1)">{{ t('上一页') }}</button>
          <span>{{ t('settings.invite.total', { n: recordsTotal }) }}</span>
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="recordsPage * PAGE_SIZE >= recordsTotal || recordsLoading" @click="loadRecords(recordsPage + 1)">{{ t('下一页') }}</button>
        </div>
      </template>

      <template v-else-if="pane === 'bills'">
        <p v-if="billsLoading" class="settings-lead">{{ t('加载中…') }}</p>
        <StudioEmpty
          v-else-if="!bills.length"
          compact
          :title="t('settings.invite.noBills')"
          :description="t('settings.invite.noBillsHint')"
        />
        <div v-else class="creator-table-wrap">
          <table class="creator-table">
            <thead>
              <tr>
                <th>{{ t('时间') }}</th>
                <th>{{ t('类型') }}</th>
                <th>{{ t('settings.invite.fromUser') }}</th>
                <th>{{ t('settings.invite.points') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in bills" :key="b.id">
                <td>{{ fmt(b.created_at) }}</td>
                <td>{{ billTypeLabel(b.biz_type) }}</td>
                <td>{{ b.from_nickname || (b.from_user_id ? `#${b.from_user_id}` : '—') }}</td>
                <td :class="{ 'invite-records__points': b.amount > 0, 'invite-records__points is-neg': b.amount < 0 }">
                  {{ b.amount > 0 ? `+${b.amount}` : b.amount }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="billsTotal > PAGE_SIZE" class="invite-pager">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="billsPage <= 1 || billsLoading" @click="loadBills(billsPage - 1)">{{ t('上一页') }}</button>
          <span>{{ t('settings.invite.total', { n: billsTotal }) }}</span>
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="billsPage * PAGE_SIZE >= billsTotal || billsLoading" @click="loadBills(billsPage + 1)">{{ t('下一页') }}</button>
        </div>
      </template>

      <template v-else>
        <p v-if="withdrawLoading" class="settings-lead">{{ t('加载中…') }}</p>
        <StudioEmpty
          v-else-if="!withdraws.length"
          compact
          :title="t('settings.invite.noWithdraws')"
          :description="t('settings.invite.withdrawHint')"
        />
        <div v-else class="creator-table-wrap">
          <table class="creator-table">
            <thead>
              <tr>
                <th>{{ t('申请时间') }}</th>
                <th>{{ t('settings.invite.withdrawWay') }}</th>
                <th>{{ t('金额') }}</th>
                <th>{{ t('状态') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in withdraws" :key="row.id || row.withdraw_no">
                <td>{{ fmt(Number(row.created_at) || 0) }}</td>
                <td>{{ withdrawWayLabel(String(row.way || '')) }}</td>
                <td>{{ money(row.amount) }}</td>
                <td>{{ withdrawStatusLabel(Number(row.status)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="withdrawTotal > PAGE_SIZE" class="invite-pager">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="withdrawPage <= 1 || withdrawLoading" @click="loadWithdraws(withdrawPage - 1)">{{ t('上一页') }}</button>
          <span>{{ t('settings.invite.total', { n: withdrawTotal }) }}</span>
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="withdrawPage * PAGE_SIZE >= withdrawTotal || withdrawLoading" @click="loadWithdraws(withdrawPage + 1)">{{ t('下一页') }}</button>
        </div>
      </template>
    </section>
  </template>
</template>
