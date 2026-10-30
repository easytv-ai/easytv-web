<script setup lang="ts">
/**
 * 发票详情抽屉：状态与原因、预览 / 下载、基本信息、购买方、开票明细、备注
 */
import {
  formatInvoiceMoney,
  invoiceTone,
  resolveInvoiceReason,
  type InvoiceItem,
  type InvoiceRecord,
} from '~/utils/invoice'

const props = defineProps<{
  open: boolean
  invoice: InvoiceRecord | null
  loading?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const { state: confirmState } = useConfirm()
const previewOpen = ref(false)

const reason = computed(() => (props.invoice ? resolveInvoiceReason(props.invoice) : ''))
const tone = computed(() => (props.invoice ? invoiceTone(props.invoice.statements, props.invoice.state) : 'muted'))

function join(...parts: string[]) {
  return parts.map(p => p.trim()).filter(Boolean).join(' ')
}

const buyerAddressPhone = computed(() => join(props.invoice?.purchaserAddress ?? '', props.invoice?.purchaserPhone ?? ''))
const buyerBank = computed(() => join(props.invoice?.purchaserBank ?? '', props.invoice?.purchaserBankAccount ?? ''))

const basicRows = computed(() => {
  const d = props.invoice
  if (!d)
    return []
  return [
    { label: t('申请时间'), value: d.addTime, mono: false },
    { label: t('开票时间'), value: d.printTime, mono: false },
    { label: t('发票类型'), value: d.category ? t(d.category) : '', mono: false },
    { label: t('数电票号码'), value: d.allElectronicInvoiceNumber, mono: true },
    { label: t('发票代码'), value: d.code, mono: true },
    { label: t('发票号码'), value: d.number, mono: true },
    { label: t('商户订单号'), value: d.outOrderNo, mono: true },
    { label: t('接收邮箱'), value: d.email, mono: false },
  ].filter(row => row.value)
})

function itemName(item: InvoiceItem) {
  if (item.category && item.name)
    return `*${item.category}*${item.name}`
  return item.category || item.name || '—'
}

function itemTaxRate(item: InvoiceItem) {
  if (item.taxRate === 0 && item.preferentialPolicyName)
    return item.preferentialPolicyName
  return `${Math.round(item.taxRate * 10000) / 100}%`
}

function taxText(value: number) {
  return value === 0 ? '***' : formatInvoiceMoney(value)
}

function close() {
  previewOpen.value = false
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.open || confirmState.value.open)
    return
  if (previewOpen.value)
    previewOpen.value = false
  else
    close()
}

watch(() => props.open, (open) => {
  if (!open)
    previewOpen.value = false
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="inbox-mask invoice-drawer-mask" @click.self="close">
      <aside class="inbox-panel invoice-drawer" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title">
        <header class="inbox-panel__head">
          <div>
            <h2 id="invoice-detail-title">{{ t('发票详情') }}</h2>
            <p v-if="invoice?.outOrderNo">{{ invoice.outOrderNo }}</p>
          </div>
          <button type="button" class="inbox-panel__close" :aria-label="t('关闭')" @click="close">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="invoice-drawer__body">
          <p v-if="!invoice" class="invoice-drawer__placeholder">{{ t('加载中…') }}</p>
          <template v-else>
            <!-- 状态 -->
            <section class="invoice-drawer__status" :class="`is-${tone}`">
              <div class="invoice-drawer__status-main">
                <span>{{ t('开票状态') }}</span>
                <strong>
                  {{ t(invoice.statements) }}
                  <UIcon v-if="loading" name="i-lucide-loader-circle" class="size-4 animate-spin" />
                </strong>
                <p v-if="reason">{{ reason }}</p>
              </div>
              <div class="invoice-drawer__actions">
                <button
                  v-if="invoice.electronicInvoiceImg"
                  type="button"
                  class="plan-btn plan-btn--ghost"
                  @click="previewOpen = true"
                >
                  <UIcon name="i-lucide-eye" class="size-4" />
                  {{ t('预览发票') }}
                </button>
                <a
                  v-if="invoice.downloadUrl"
                  :href="invoice.downloadUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="plan-btn plan-btn--solid"
                >
                  <UIcon name="i-lucide-download" class="size-4" />
                  {{ t('下载') }}
                </a>
              </div>
            </section>

            <div class="invoice-drawer__grid">
              <section class="invoice-drawer__card">
                <h3>{{ t('基本信息') }}</h3>
                <dl>
                  <div v-for="row in basicRows" :key="row.label">
                    <dt>{{ row.label }}</dt>
                    <dd :class="{ 'is-mono': row.mono }">{{ row.value }}</dd>
                  </div>
                </dl>
              </section>

              <section class="invoice-drawer__card">
                <h3>{{ t('购买方') }}</h3>
                <dl>
                  <div>
                    <dt>{{ t('名称') }}</dt>
                    <dd>{{ invoice.purchaserName || '—' }}</dd>
                  </div>
                  <div v-if="invoice.purchaserTaxpayerNumber">
                    <dt>{{ t('税号') }}</dt>
                    <dd class="is-mono">{{ invoice.purchaserTaxpayerNumber }}</dd>
                  </div>
                  <div v-if="buyerAddressPhone">
                    <dt>{{ t('地址电话') }}</dt>
                    <dd>{{ buyerAddressPhone }}</dd>
                  </div>
                  <div v-if="buyerBank">
                    <dt>{{ t('开户行及账号') }}</dt>
                    <dd>{{ buyerBank }}</dd>
                  </div>
                  <div class="is-total">
                    <dt>{{ t('金额') }}</dt>
                    <dd>
                      <strong>{{ formatInvoiceMoney(invoice.price) }}</strong>
                      <small>{{ t('税额') }} {{ taxText(invoice.tax) }}</small>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <!-- 明细 -->
            <section>
              <h3 class="invoice-drawer__title">{{ t('开票明细') }}</h3>
              <div class="invoice-drawer__table">
                <div class="invoice-drawer__scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{{ t('开票项目') }}</th>
                        <th class="is-num">{{ t('数量') }}</th>
                        <th class="is-num">{{ t('单价') }}</th>
                        <th class="is-num">{{ t('金额') }}</th>
                        <th class="is-num">{{ t('税率') }}</th>
                        <th class="is-num">{{ t('税额') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, i) in invoice.items" :key="i">
                        <td>{{ itemName(item) }}</td>
                        <td class="is-num">{{ item.number || '—' }}</td>
                        <td class="is-num">{{ item.price || '—' }}</td>
                        <td class="is-num">{{ item.sum }}</td>
                        <td class="is-num">{{ itemTaxRate(item) }}</td>
                        <td class="is-num">{{ item.tax === 0 ? '***' : item.tax }}</td>
                      </tr>
                      <tr v-if="!invoice.items.length">
                        <td colspan="6" class="is-empty">{{ loading ? t('加载中…') : t('暂无明细') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="invoice-drawer__sum">
                  <span>{{ t('合计税额 {tax}', { tax: taxText(invoice.tax) }) }}</span>
                  <strong>{{ t('价税合计 {amount}', { amount: formatInvoiceMoney(invoice.price) }) }}</strong>
                </p>
              </div>
            </section>

            <section v-if="invoice.remark">
              <h3 class="invoice-drawer__title">{{ t('备注') }}</h3>
              <p class="invoice-drawer__remark">{{ invoice.remark }}</p>
            </section>
          </template>
        </div>
      </aside>

      <div v-if="previewOpen && invoice?.electronicInvoiceImg" class="invoice-preview" @click.self="previewOpen = false">
        <div class="invoice-preview__box" role="dialog" aria-modal="true" :aria-label="t('预览发票')">
          <button type="button" class="inbox-panel__close invoice-preview__close" :aria-label="t('关闭')" @click="previewOpen = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
          <img :src="invoice.electronicInvoiceImg" :alt="t('预览发票')">
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.invoice-drawer {
  width: min(680px, 100%);
}

.invoice-drawer__body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  padding: 6px 20px 24px;
  overflow-y: auto;
  font-size: 13px;
}

.invoice-drawer__placeholder {
  margin: 40px 0;
  color: var(--st-muted);
  text-align: center;
}

.invoice-drawer__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-hover);
}

.invoice-drawer__status-main {
  min-width: 0;
  flex: 1 1 220px;
}

.invoice-drawer__status-main > span {
  color: var(--st-muted);
  font-size: 12px;
}

.invoice-drawer__status-main strong {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 16px;
  font-weight: 700;
}

.invoice-drawer__status.is-pending strong {
  color: #3b82f6;
}

.invoice-drawer__status.is-processing strong {
  color: #d97706;
}

.invoice-drawer__status.is-success strong {
  color: #16a34a;
}

.invoice-drawer__status.is-danger strong {
  color: #dc2626;
}

.invoice-drawer__status-main p {
  margin: 4px 0 0;
  color: var(--st-text-soft);
  line-height: 1.55;
}

.invoice-drawer__status.is-danger .invoice-drawer__status-main p,
.invoice-drawer__status.is-muted .invoice-drawer__status-main p {
  color: #dc2626;
}

.invoice-drawer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.invoice-drawer__actions .plan-btn {
  gap: 6px;
  width: auto;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  font-size: 13px;
  text-decoration: none;
}

.invoice-drawer__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.invoice-drawer__card {
  padding: 14px 16px;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-card);
}

.invoice-drawer__card h3,
.invoice-drawer__title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}

.invoice-drawer__card dl {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.invoice-drawer__card dl > div {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  gap: 10px;
}

.invoice-drawer__card dt {
  color: var(--st-muted);
  font-size: 12px;
}

.invoice-drawer__card dd {
  margin: 0;
  word-break: break-all;
}

.invoice-drawer__card dd.is-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.invoice-drawer__card .is-total {
  padding-top: 8px;
  border-top: 1px solid var(--st-border);
}

.invoice-drawer__card .is-total strong {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.invoice-drawer__card .is-total small {
  margin-left: 8px;
  color: var(--st-muted);
  font-size: 12px;
}

.invoice-drawer__table {
  overflow: hidden;
  border: 1px solid var(--st-border);
  border-radius: 14px;
}

.invoice-drawer__scroll {
  overflow-x: auto;
}

.invoice-drawer__table table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
}

.invoice-drawer__table th,
.invoice-drawer__table td {
  padding: 9px 12px;
  border-top: 1px solid var(--st-border);
  text-align: left;
}

.invoice-drawer__table th {
  border-top: 0;
  background: var(--st-hover);
  color: var(--st-muted);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.invoice-drawer__table .is-num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.invoice-drawer__table .is-empty {
  padding: 24px 12px;
  color: var(--st-muted);
  text-align: center;
}

.invoice-drawer__sum {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px 18px;
  margin: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--st-border);
  color: var(--st-text-soft);
  font-variant-numeric: tabular-nums;
}

.invoice-drawer__sum strong {
  color: var(--st-text);
}

.invoice-drawer__remark {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.invoice-preview {
  position: fixed;
  inset: 0;
  z-index: 460;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.6);
}

.invoice-preview__box {
  position: relative;
  max-width: min(960px, 100%);
  max-height: 100%;
  padding: 12px;
  border-radius: 16px;
  background: var(--st-pop);
  box-shadow: var(--st-shadow);
}

.invoice-preview__box img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 96px);
  margin: 0 auto;
  border-radius: 8px;
  background: #fff;
}

.invoice-preview__close {
  position: absolute;
  top: -14px;
  right: -14px;
  border: 1px solid var(--st-border);
  border-radius: 999px;
  background: var(--st-pop);
}

@media (max-width: 640px) {
  .invoice-drawer__grid {
    grid-template-columns: 1fr;
  }

  .invoice-preview__close {
    top: 6px;
    right: 6px;
  }
}
</style>
