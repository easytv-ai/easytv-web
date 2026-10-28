<script setup lang="ts">
// 浏览器构建。包入口在服务端会加载 pngjs，Cloudflare 上 inherits(stream) 会让页面 500。
import QRCode from 'qrcode/lib/browser.js'
import billingApi from '~/api/billing'
import rechargeApi from '~/api/recharge'
import type { Order, PayIntent } from '~/types/creative'
import {
  type BillingCycle,
  cycleLabel,
  formatMoney,
  formatPoints,
  formatValidity,
  formatYuan,
} from '~/utils/pricing-plans'
import { isPagePay as isPayUrlOnly, openPayPage, payMethodLabel, payQrContent } from '~/utils/recharge-pay'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'

const { t } = useI18n()
const localePath = useLocalePath()

const props = defineProps<{
  open: boolean
  order?: Order | null
  pay: PayIntent | null
  title?: string
  price?: number
}>()

const emit = defineEmits<{
  close: []
  paid: [order: Order | null]
  expired: []
}>()

const POLL_MS = 3000
const qrDataUrl = ref('')
const status = ref<'waiting' | 'paid' | 'closed'>('waiting')
const remain = ref('')
let stopPayPoll = () => {}
let tickTimer: ReturnType<typeof setInterval> | null = null

const methodLabel = computed(() => payMethodLabel(props.pay?.payment_method ?? '', t))
const isPagePay = computed(() => Boolean(props.pay?.payment_url) && !payQrContent(props.pay))
const displayTitle = computed(() => props.title || props.order?.title || t('充值'))
const displayPrice = computed(() => props.price ?? props.order?.price ?? 0)
const tradeNo = computed(() => props.pay?.trade_no || props.order?.order_no || '')
const payBrand = computed(() => {
  const method = props.pay?.payment_method ?? ''
  return method === 'wechat_native' ? 'wechat' : 'alipay'
})
const cycle = computed<BillingCycle | undefined>(() => {
  const value = props.order?.cycle
  return value === 'month' || value === 'quarter' || value === 'year' ? value : undefined
})
const goodsName = computed(() => {
  if (cycle.value)
    return cycleLabel(cycle.value, t)
  return displayTitle.value
})
const origin = computed(() => props.order?.origin ?? 0)
const discount = computed(() => Math.max(0, origin.value - (props.order?.price ?? displayPrice.value)))
const monthlyPrice = computed(() => {
  const months = props.order?.months ?? 0
  if (months <= 0)
    return 0
  return (props.order?.price ?? 0) / months
})
const pointsText = computed(() => {
  const n = props.order?.points ?? 0
  if (!n)
    return ''
  if (props.order?.kind === 'membership')
    return `${formatPoints(n)}${t('积分')}/${t('月')}`
  return `${formatPoints(n)}${t('积分')}`
})
const renewText = computed(() => {
  if (props.order?.kind === 'points' && props.order.valid_days)
    return formatValidity(props.order.valid_days, t)
  if (cycle.value)
    return cycleLabel(cycle.value, t)
  return ''
})
const headTitle = computed(() => {
  const order = props.order
  if (!order)
    return displayTitle.value
  const pts = order.points ? ` ${formatPoints(order.points)}${t('积分')}` : ''
  if (order.kind === 'membership')
    return `${t('开通')}${order.title}${pts}`
  return `${order.title}${pts}`
})

async function renderQr() {
  qrDataUrl.value = ''
  const content = payQrContent(props.pay)
  if (!content)
    return
  try {
    qrDataUrl.value = await QRCode.toDataURL(content, { width: 240, margin: 1 })
  }
  catch {
    qrDataUrl.value = ''
  }
}

function stop() {
  stopPayPoll()
  stopPayPoll = () => {}
  if (tickTimer)
    clearInterval(tickTimer)
  tickTimer = null
}

function formatRemain(left: number) {
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  if (h > 0)
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function tick() {
  const end = props.pay?.expires_at ?? 0
  const left = Math.max(0, end - Math.floor(Date.now() / 1000))
  remain.value = formatRemain(left)
  if (end && left <= 0 && status.value === 'waiting') {
    status.value = 'closed'
    stop()
    emit('expired')
  }
}

function closeAfterPaid() {
  window.setTimeout(() => emit('close'), 1600)
}

async function markPaid() {
  if (status.value === 'paid')
    return
  if (props.order) {
    const res = await billingApi.order(props.order.id)
    status.value = 'paid'
    stop()
    emit('paid', res?.success && res.data ? res.data : props.order)
    closeAfterPaid()
    return
  }
  status.value = 'paid'
  stop()
  emit('paid', null)
  closeAfterPaid()
}

async function poll() {
  if (status.value !== 'waiting')
    return
  if (tradeNo.value) {
    const st = await rechargeApi.status(tradeNo.value)
    if (st?.success && st.data?.status === 'success') {
      await markPaid()
      return
    }
  }
  if (!props.order)
    return
  const res = await billingApi.order(props.order.id)
  if (!res?.success || !res.data)
    return
  if (res.data.status === 'paid') {
    status.value = 'paid'
    stop()
    emit('paid', res.data)
    closeAfterPaid()
  }
  else if (res.data.status === 'closed' || res.data.status === 'refunded') {
    status.value = 'closed'
    stop()
  }
}

function openPaymentUrl() {
  const url = props.pay?.payment_url
  if (url)
    window.open(url, '_blank', 'noopener,noreferrer')
}

function start() {
  stop()
  status.value = 'waiting'
  void renderQr()
  tick()
  tickTimer = setInterval(tick, 1000)
  void poll()
  stopPayPoll = startHiddenAwarePoll(() => poll(), POLL_MS)
}

watch(() => props.open, (open) => {
  if (open && props.pay && isPayUrlOnly(props.pay)) {
    openPayPage(props.pay.payment_url || '')
    emit('close')
    return
  }
  if (open && props.pay)
    start()
  else
    stop()
}, { immediate: true })

onUnmounted(stop)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && (order || pay) && !isPagePay"
      class="studio-modal-mask plan-confirm-mask"
      @click.self="emit('close')"
    >
      <div class="plan-settle" role="dialog" aria-modal="true" aria-labelledby="pay-qr-title">
        <header class="plan-settle__head">
          <h2 id="pay-qr-title">{{ headTitle }}</h2>
          <button
            type="button"
            class="plan-checkout__close"
            :aria-label="t('关闭')"
            @click="emit('close')"
          >
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="plan-settle__body">
          <div class="plan-settle__left">
            <section class="plan-sheet">
              <p class="plan-sheet__label">{{ t('商品信息') }}</p>
              <div class="plan-sheet__card">
                <p class="plan-sheet__name">{{ goodsName }}</p>
                <div class="plan-sheet__price">
                  <strong>{{ formatYuan(displayPrice) }}</strong>
                  <del v-if="origin > displayPrice">{{ formatYuan(origin) }}</del>
                </div>
                <p v-if="monthlyPrice > 0" class="plan-sheet__avg">
                  {{ formatMoney(monthlyPrice) }}/{{ t('月') }}
                </p>
              </div>
            </section>

            <section class="plan-sheet">
              <p class="plan-sheet__label">{{ t('订单明细') }}</p>
              <dl class="plan-sheet__rows">
                <div v-if="pointsText" class="plan-sheet__row">
                  <dt>{{ t('积分数量') }}</dt>
                  <dd>{{ pointsText }}</dd>
                </div>
                <div v-if="renewText" class="plan-sheet__row">
                  <dt>{{ order?.kind === 'points' ? t('有效期') : t('套餐周期') }}</dt>
                  <dd>{{ renewText }}</dd>
                </div>
                <div v-if="order && origin > 0" class="plan-sheet__row">
                  <dt>{{ t('商品原价') }}</dt>
                  <dd>{{ formatMoney(origin) }}</dd>
                </div>
                <div v-if="discount > 0" class="plan-sheet__row">
                  <dt>{{ t('优惠金额') }}</dt>
                  <dd>-{{ formatMoney(discount) }}</dd>
                </div>
                <div class="plan-sheet__row is-pay">
                  <dt>{{ t('应付金额') }}</dt>
                  <dd>{{ formatMoney(displayPrice) }}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div class="plan-settle__right">
            <p class="plan-settle__scan">
              <span class="plan-settle__scan-icon" :class="`is-${payBrand}`" aria-hidden="true">
                <img
                  v-if="payBrand === 'wechat'"
                  src="/images/pay/wechatpay.svg"
                  alt=""
                  width="16"
                  height="16"
                >
                <img
                  v-else
                  src="/images/pay/alipay.svg"
                  alt=""
                  width="16"
                  height="16"
                >
              </span>
              <template v-if="isPagePay">{{ t('请在新打开的支付宝页面完成支付') }}</template>
              <template v-else>{{ t('{method}扫码支付', { method: `${t('请用')}${methodLabel}` }) }}</template>
            </p>

            <div v-if="isPagePay" class="pay-qr__box pay-qr__box--page" :class="{ 'is-done': status !== 'waiting' }">
              <template v-if="status === 'waiting'">
                <UIcon name="i-lucide-external-link" class="size-10" />
                <p>{{ t('请在新打开的支付宝页面完成支付') }}</p>
              </template>
              <div v-if="status === 'paid'" class="pay-qr__overlay is-paid">
                <UIcon name="i-lucide-circle-check" class="size-10" />
                {{ t('支付成功') }}
              </div>
              <div v-else-if="status === 'closed'" class="pay-qr__overlay">
                <UIcon name="i-lucide-clock" class="size-10" />
                {{ t('支付已超时') }}
              </div>
            </div>
            <div v-else class="pay-qr__box" :class="{ 'is-done': status !== 'waiting' }">
              <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('支付二维码')" width="240" height="240">
              <div v-else class="pay-qr__placeholder">{{ t('二维码生成中…') }}</div>
              <div v-if="status === 'paid'" class="pay-qr__overlay is-paid">
                <UIcon name="i-lucide-circle-check" class="size-10" />
                {{ t('支付成功') }}
              </div>
              <div v-else-if="status === 'closed'" class="pay-qr__overlay">
                <UIcon name="i-lucide-clock" class="size-10" />
                {{ t('二维码已失效') }}
              </div>
            </div>

            <p v-if="status === 'waiting'" class="plan-settle__expire">
              {{ remain }} {{ t('后二维码失效') }}
            </p>
            <p v-else-if="status === 'paid'" class="plan-settle__expire">
              {{ order ? t('积分与会员权益已到账') : t('充值已到账') }}
            </p>
            <p v-else class="plan-settle__expire">
              {{ t('订单已关闭，可重新下单') }}
            </p>

            <p class="plan-settle__legal">
              {{ t('开通即代表同意') }}
              <NuxtLink :to="localePath('/legal/terms')" target="_blank" rel="noopener noreferrer">
                {{ t('《用户服务协议》') }}
              </NuxtLink>
            </p>
            <p v-if="tradeNo" class="pay-qr__no">{{ t('订单号') }} {{ tradeNo }}</p>
            <div v-if="isPagePay && status === 'waiting'" class="plan-settle__actions">
              <button type="button" class="plan-checkout__btn" @click="openPaymentUrl">
                {{ t('重新打开支付宝') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
