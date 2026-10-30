<script setup lang="ts">
/**
 * 设置 · 发票
 *
 * - 额度：GET /user/invoice/summary（已支付 / 已开票 / 可开票，人民币元）
 * - 申请开票：金额自填（≤ 可开票），弹框里选抬头 / 票种 / 邮箱，POST /user/invoice/apply
 * - 开票记录与详情、抬头管理、票种：持 accessToken 直调发票平台（见 ~/api/invoice）
 */
import InvoiceApplyModal from './invoice-apply-modal.vue'
import InvoiceDetailDrawer from './invoice-detail-drawer.vue'
import { createInvoicePlatform, invoiceApi, normalizeInvoiceSummary, type InvoiceSummary } from '~/api/invoice'
import {
  INVOICE_AMOUNT_ERROR_TEXT,
  formatInvoiceMoney,
  invoiceCategoryShort,
  invoiceNumbers,
  invoiceShowsReason,
  invoiceTone,
  isInvoiceNoData,
  mapInvoiceRecord,
  parseInvoiceAmount,
  platformList,
  resolveInvoiceReason,
  roundCents,
  splitInvoiceTime,
  validateInvoiceAmount,
  type InvoiceRecord,
} from '~/utils/invoice'

const PAGE_SIZE = 10

const { t } = useI18n()
const toast = useToast()
const { user } = useAuth()

function notify(title: string, color: 'neutral' | 'error' | 'success' | 'warning' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const platform = createInvoicePlatform()

/* ── 额度 ── */
const summary = ref<InvoiceSummary | null>(null)
const summaryLoading = ref(false)
const summaryError = ref('')

async function loadSummary() {
  if (summaryLoading.value)
    return
  summaryLoading.value = true
  try {
    const res = await invoiceApi.summary()
    if (!res?.success) {
      summaryError.value = String(res?.message || t('发票信息加载失败，请稍后重试'))
      if (summary.value)
        notify(summaryError.value, 'error')
      return
    }
    summaryError.value = ''
    summary.value = normalizeInvoiceSummary(res.data)
    platform.setServiceUrl(summary.value.service_url)
    // 预热发票平台 token，失败时等真正调用再报
    if (summary.value.enabled)
      void platform.ensureToken().catch(() => '')
  }
  finally {
    summaryLoading.value = false
  }
}

const available = computed(() => summary.value?.available ?? 0)
const invoiceError = computed(() => summary.value?.invoice_error ?? '')

const stats = computed(() => [
  { key: 'paid', label: t('已支付金额'), value: summary.value?.paid ?? 0 },
  { key: 'invoiced', label: t('已开票金额'), value: summary.value?.invoiced ?? 0 },
  { key: 'available', label: t('可开票金额'), value: available.value },
])

const notes = computed(() => [
  t('电子发票开出后发送到填写的邮箱'),
  t('可开票金额 = 已支付订单 − 已申请开票'),
  t('手动补单与已退款订单不可开票'),
  t('开票后发生退款需先联系客服作废发票'),
])

type View = 'apply' | 'records'
const view = ref<View>('apply')

/* ── 申请开票 ── */
const amountInput = ref<string | number>('')
const amountTouched = ref(false)

const amountError = computed(() => validateInvoiceAmount(amountInput.value, available.value))
const amountErrorText = computed(() => {
  const err = amountError.value
  if (!err || (err === 'empty' && !amountTouched.value))
    return ''
  return err === 'exceed'
    ? t('开票金额不能超过可开票金额 {amount}', { amount: formatInvoiceMoney(available.value) })
    : t(INVOICE_AMOUNT_ERROR_TEXT[err])
})

const applyDisabled = computed(() =>
  !summary.value || !!invoiceError.value || available.value < 0.01 || !!amountError.value,
)

function fillAll() {
  amountInput.value = roundCents(available.value).toFixed(2)
  amountTouched.value = true
}

const applyOpen = ref(false)
const applyAmount = ref(0)

function openApply() {
  amountTouched.value = true
  if (invoiceError.value) {
    notify(invoiceError.value, 'warning')
    return
  }
  if (amountErrorText.value) {
    notify(amountErrorText.value, 'warning')
    return
  }
  applyAmount.value = roundCents(parseInvoiceAmount(amountInput.value))
  applyOpen.value = true
}

async function onApplied() {
  applyOpen.value = false
  notify(t('开票申请已提交'), 'success')
  amountInput.value = ''
  amountTouched.value = false
  void loadSummary()
  view.value = 'records'
  await reloadRecords()
}

/* ── 开票记录（发票平台分页，page 从 0 开始） ── */
const records = ref<InvoiceRecord[]>([])
const recordsLoading = ref(false)
const recordsLoadingMore = ref(false)
const recordsLoaded = ref(false)
const recordsHasMore = ref(false)
const recordsTotal = ref(0)
let recordsPage = 0
let recordsSeq = 0
/** 平台 / 配置出错：记录区显示原因，不显示「还没有开票记录」 */
const recordsError = ref('')

async function fetchRecords(page: number) {
  const res = await platform.list(page, PAGE_SIZE)
  if (isInvoiceNoData(res))
    return { list: [] as InvoiceRecord[], last: true, total: 0 }
  if (res.code !== 1) {
    recordsError.value = res.message || t('开票记录加载失败，请稍后重试')
    return null
  }
  recordsError.value = ''
  const list = platformList(res).map((row, i) => mapInvoiceRecord(row, page * PAGE_SIZE + i))
  const total = Number(res.totalElements ?? 0)
  const last = typeof res.last === 'boolean'
    ? res.last
    : list.length < PAGE_SIZE || (total > 0 && (page + 1) * PAGE_SIZE >= total)
  return { list, last, total }
}

async function reloadRecords() {
  const seq = ++recordsSeq
  recordsLoading.value = true
  recordsLoadingMore.value = false
  try {
    const data = await fetchRecords(0)
    if (seq !== recordsSeq)
      return
    if (!data) {
      recordsHasMore.value = false
      return
    }
    records.value = data.list
    recordsTotal.value = data.total
    recordsHasMore.value = !data.last
    recordsPage = 0
    recordsLoaded.value = true
  }
  finally {
    if (seq === recordsSeq)
      recordsLoading.value = false
  }
}

async function loadMoreRecords() {
  if (recordsLoading.value || recordsLoadingMore.value || !recordsHasMore.value)
    return
  const seq = recordsSeq
  recordsLoadingMore.value = true
  try {
    const data = await fetchRecords(recordsPage + 1)
    if (seq !== recordsSeq || !data)
      return
    const seen = new Set(records.value.map(r => r.id))
    records.value = [...records.value, ...data.list.filter(r => !seen.has(r.id))]
    recordsTotal.value = data.total || recordsTotal.value
    recordsHasMore.value = !data.last && data.list.length > 0
    recordsPage += 1
  }
  finally {
    if (seq === recordsSeq)
      recordsLoadingMore.value = false
  }
}

watch(view, (next) => {
  if (next === 'records' && !recordsLoaded.value && !recordsLoading.value)
    void reloadRecords()
})

/* ── 详情 ── */
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<InvoiceRecord | null>(null)
let detailSeq = 0

async function openDetail(row: InvoiceRecord) {
  const seq = ++detailSeq
  detail.value = row
  detailOpen.value = true
  detailLoading.value = true
  try {
    const res = await platform.detail(row.id)
    if (seq !== detailSeq)
      return
    if (res.code === 1 && res.content && typeof res.content === 'object')
      detail.value = mapInvoiceRecord(res.content)
    else if (res.code !== 1)
      notify(res.message || t('发票详情加载失败，请稍后重试'), 'error')
  }
  finally {
    if (seq === detailSeq)
      detailLoading.value = false
  }
}

const defaultEmail = computed(() => String(user.value?.email ?? ''))

onMounted(() => {
  void loadSummary()
})
</script>

<template>
  <section v-if="!summary && (summaryLoading || !summaryError)" class="wallet-card">
    <p class="settings-lead">{{ t('加载中…') }}</p>
  </section>

  <section v-else-if="!summary" class="wallet-card settings-empty-card">
    <h3>{{ t('发票') }}</h3>
    <StudioEmpty compact :title="t('发票信息加载失败')" :description="summaryError">
      <button type="button" class="plan-btn plan-btn--ghost" :disabled="summaryLoading" @click="loadSummary">{{ t('重试') }}</button>
    </StudioEmpty>
  </section>

  <section v-else-if="!summary.enabled" class="wallet-card settings-empty-card">
    <h3>{{ t('发票') }}</h3>
    <StudioEmpty compact :title="t('发票功能暂未开放')" :description="t('开通后可在这里为已支付订单申请电子发票。')" />
  </section>

  <template v-else>
    <section class="wallet-card">
      <h3>{{ t('发票') }}</h3>
      <dl class="invoice-stats">
        <div v-for="s in stats" :key="s.key" class="invoice-stat" :class="`is-${s.key}`">
          <dt>{{ s.label }}</dt>
          <dd>{{ formatInvoiceMoney(s.value) }}</dd>
        </div>
      </dl>
      <div class="invoice-notes">
        <strong>
          <UIcon name="i-lucide-info" class="size-4" />
          {{ t('开票说明') }}
        </strong>
        <ul>
          <li v-for="(note, i) in notes" :key="i">{{ note }}</li>
        </ul>
      </div>
    </section>

    <section class="wallet-card" :class="{ 'settings-empty-card': view === 'records' && recordsLoaded && !recordsLoading && !records.length }">
      <div class="wallet-tabs invoice-tabs" role="tablist" :aria-label="t('发票')">
        <button
          type="button"
          role="tab"
          :aria-selected="view === 'apply'"
          :class="{ 'is-on': view === 'apply' }"
          @click="view = 'apply'"
        >
          {{ t('申请开票') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="view === 'records'"
          :class="{ 'is-on': view === 'records' }"
          @click="view = 'records'"
        >
          {{ t('开票记录') }}
        </button>
      </div>

      <!-- 申请开票 -->
      <div v-if="view === 'apply'" class="invoice-apply-form">
        <div class="settings-row settings-row--top">
          <span class="settings-row__label">{{ t('开票金额') }}</span>
          <div class="settings-row__field settings-row__field--wrap">
            <input
              v-model="amountInput"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              class="settings-input invoice-amount-input"
              :placeholder="t('最多 ¥{n}', { n: roundCents(available).toFixed(2) })"
              :disabled="!!invoiceError || available < 0.01"
              :aria-label="t('开票金额')"
              @blur="amountTouched = true"
              @keydown.enter="openApply"
            >
            <button
              type="button"
              class="plan-btn plan-btn--ghost"
              :disabled="!!invoiceError || available < 0.01"
              @click="fillAll"
            >
              {{ t('全部开出') }}
            </button>
            <p class="settings-hint">{{ t('当前可开票金额 {amount}', { amount: formatInvoiceMoney(available) }) }}</p>
            <p v-if="amountErrorText" class="settings-hint invoice-error-text">{{ amountErrorText }}</p>
          </div>
        </div>
        <p v-if="invoiceError" class="invoice-warn" role="alert">
          <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" />
          <span>{{ invoiceError }}</span>
        </p>
        <div class="settings-secure">
          <span class="settings-hint">{{ t('提交后可在「开票记录」查看进度') }}</span>
          <button type="button" class="plan-btn plan-btn--solid" :disabled="applyDisabled" @click="openApply">
            {{ t('申请开票') }}
          </button>
        </div>
      </div>

      <!-- 开票记录 -->
      <div v-else-if="recordsError && !recordsLoading" class="invoice-records-error">
        <StudioEmpty compact :title="t('开票记录暂时无法加载')" :description="recordsError" />
        <button type="button" class="plan-btn plan-btn--ghost" @click="reloadRecords">{{ t('重试') }}</button>
      </div>
      <StudioPaging
        v-else
        compact
        grid-class="invoice-skeleton"
        :loading="recordsLoading"
        :loading-more="recordsLoadingMore"
        :has-more="recordsHasMore"
        :count="records.length"
        :empty-title="t('还没有开票记录')"
        :empty-description="t('申请开票后，记录会出现在这里。')"
        :load-more="loadMoreRecords"
      >
        <template #skeleton>
          <div v-for="n in 4" :key="n" class="invoice-skeleton__row">
            <USkeleton class="h-3.5 w-2/5" />
            <USkeleton class="mt-2 h-3 w-3/5" />
          </div>
        </template>
        <template #empty>
          <StudioEmpty compact :title="t('还没有开票记录')" :description="t('申请开票后，记录会出现在这里。')">
            <button type="button" class="plan-btn plan-btn--ghost" @click="view = 'apply'">{{ t('申请开票') }}</button>
          </StudioEmpty>
        </template>
        <div class="invoice-table-wrap">
          <table class="invoice-table">
            <thead>
              <tr>
                <th>{{ t('商户订单号') }}</th>
                <th>{{ t('发票类型') }}</th>
                <th>{{ t('申请时间') }}</th>
                <th>{{ t('发票号码') }}</th>
                <th>{{ t('抬头') }}</th>
                <th class="is-num">{{ t('金额') }}</th>
                <th>{{ t('状态') }}</th>
                <th class="is-num">{{ t('操作') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in records" :key="row.id">
                <td class="is-mono">{{ row.outOrderNo || '—' }}</td>
                <td>
                  <span class="invoice-kind" :title="row.category">{{ invoiceCategoryShort(row.category) || '—' }}</span>
                </td>
                <td class="is-time">
                  <template v-if="row.addTime">
                    <span>{{ splitInvoiceTime(row.addTime).date }}</span>
                    <small>{{ splitInvoiceTime(row.addTime).time }}</small>
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="is-mono">
                  <template v-if="invoiceNumbers(row).length">
                    <span v-for="no in invoiceNumbers(row)" :key="no" class="invoice-table__line">{{ no }}</span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="is-title">
                  <span class="invoice-table__line">{{ row.purchaserName || '—' }}</span>
                  <small v-if="row.purchaserTaxpayerNumber" class="is-mono">{{ row.purchaserTaxpayerNumber }}</small>
                </td>
                <td class="is-num">{{ formatInvoiceMoney(row.price) }}</td>
                <td>
                  <span
                    class="invoice-badge"
                    :class="`is-${invoiceTone(row.statements, row.state)}`"
                    :title="invoiceShowsReason(row) ? resolveInvoiceReason(row) : undefined"
                  >
                    {{ t(row.statements) }}
                    <UIcon v-if="invoiceShowsReason(row)" name="i-lucide-circle-help" class="size-3.5" />
                  </span>
                </td>
                <td class="is-num">
                  <button type="button" class="settings-link" @click="openDetail(row)">{{ t('详情') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </StudioPaging>
    </section>

    <InvoiceApplyModal
      :open="applyOpen"
      :amount="applyAmount"
      :summary="summary"
      :platform="platform"
      :default-email="defaultEmail"
      @close="applyOpen = false"
      @submitted="onApplied"
    />
    <InvoiceDetailDrawer
      :open="detailOpen"
      :invoice="detail"
      :loading="detailLoading"
      @close="detailOpen = false"
    />
  </template>
</template>

<style scoped>
.invoice-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 14px;
}

.invoice-stat {
  padding: 12px 14px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-hover);
}

.invoice-stat dt {
  color: var(--st-muted);
  font-size: 12px;
}

.invoice-stat dd {
  margin: 4px 0 0;
  color: var(--st-text);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.invoice-stat.is-available dd {
  color: #16a34a;
}

.invoice-notes {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--st-plan) 28%, transparent);
  border-radius: 12px;
  background: var(--st-plan-soft);
  font-size: 13px;
}

.invoice-notes strong {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--st-plan);
  font-weight: 600;
}

.invoice-notes ul {
  margin: 6px 0 0;
  padding-left: 22px;
  color: var(--st-text-soft);
  line-height: 1.8;
}

.invoice-tabs {
  max-width: 320px;
  margin: 0 0 12px;
}

.invoice-apply-form .settings-row {
  border-top: 0;
  grid-template-columns: 96px minmax(0, 1fr);
}

.invoice-amount-input {
  flex: 0 1 220px;
}

.invoice-error-text {
  color: #dc2626;
}

.invoice-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.1);
  color: #d97706;
  font-size: 13px;
  line-height: 1.55;
}

.invoice-skeleton__row {
  padding: 10px 0;
  border-top: 1px solid var(--st-border);
}

.invoice-skeleton__row:first-child {
  border-top: 0;
}

.invoice-table-wrap {
  overflow-x: auto;
}

.invoice-table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  font-size: 13px;
}

.invoice-table th,
.invoice-table td {
  padding: 10px 8px;
  border-top: 1px solid var(--st-border);
  text-align: left;
  vertical-align: top;
}

.invoice-table th {
  border-top: 0;
  color: var(--st-muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.invoice-table .is-num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.invoice-table .is-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
}

.invoice-table .is-time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.invoice-table .is-time span,
.invoice-table__line {
  display: block;
}

.invoice-table small {
  display: block;
  margin-top: 2px;
  color: var(--st-muted);
  font-size: 11px;
}

.invoice-table .is-title {
  max-width: 220px;
  word-break: break-all;
}

.invoice-kind {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--st-hover);
  color: var(--st-text-soft);
  font-size: 12px;
  white-space: nowrap;
}

.invoice-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.invoice-badge[title] {
  cursor: help;
}

.invoice-badge.is-pending {
  background: rgba(59, 130, 246, 0.14);
  color: #3b82f6;
}

.invoice-badge.is-processing {
  background: rgba(245, 158, 11, 0.14);
  color: #d97706;
}

.invoice-badge.is-success {
  background: rgba(22, 163, 74, 0.14);
  color: #16a34a;
}

.invoice-badge.is-danger {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
}

.invoice-badge.is-muted {
  background: var(--st-hover);
  color: var(--st-muted);
}

@media (max-width: 640px) {
  .invoice-stats {
    grid-template-columns: 1fr;
  }

  .invoice-apply-form .settings-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .invoice-tabs {
    max-width: none;
  }
}

.invoice-records-error {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 12px 0;
}
</style>
