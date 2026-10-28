<script setup lang="ts">
/**
 * 设置 · 订单
 *
 * - 订单记录（GET /user/order，分页）：待支付可查单 / 取消
 * - 充值记录（GET /user/recharge，分页）：待支付可查单
 * - 查单调 GET /user/recharge/status/{tradeNo}，到账后刷新列表 + 钱包
 * 支付到账会通知父页刷新钱包（团队充值还要刷团队积分池）。
 */
import billingApi from '~/api/billing'
import rechargeApi from '~/api/recharge'
import { payMethodLabel } from '~/utils/recharge-pay'
import type { Order, RechargeRecord } from '~/types/creative'

const props = defineProps<{
  invoiceEnabled: boolean
}>()

const emit = defineEmits<{
  paid: []
  'goto-invoice': []
  'goto-pricing': [kind: 'membership' | 'points']
}>()

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { refresh: refreshWallet } = useWallet()

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

const ORDER_STATUS: Record<string, string> = { pending: t('待支付'), paid: t('已支付'), closed: t('已关闭'), refunded: t('已退款') }
const {
  items: orders,
  busy: ordersBusy,
  failed: ordersFailed,
  loadingMore: ordersLoadingMore,
  hasMore: ordersHasMore,
  loaded: ordersLoaded,
  reload: reloadOrders,
  loadMore: loadMoreOrders,
} = useStudioPaged<Order>({
  pageSize: 20,
  async fetch(page, pageSize) {
    const res = await billingApi.orders({ page, page_size: pageSize })
    if (!res?.success || !res.data) {
      notify(res?.message || t('订单加载失败'), 'error')
      return null
    }
    return res.data
  },
})

const checkingOrderId = ref<number | null>(null)
const closingOrderId = ref<number | null>(null)
const checkingTradeNo = ref('')
const RECHARGE_STATUS: Record<string, string> = {
  pending: t('待支付'),
  success: t('已支付'),
  failed: t('失败'),
  expired: t('已过期'),
  refunded: t('已退款'),
}
const {
  items: recharges,
  busy: rechargesBusy,
  failed: rechargesFailed,
  loadingMore: rechargesLoadingMore,
  hasMore: rechargesHasMore,
  loaded: rechargesLoaded,
  reload: reloadRecharges,
  loadMore: loadMoreRecharges,
} = useStudioPaged<RechargeRecord>({
  pageSize: 20,
  async fetch(page, pageSize) {
    const res = await rechargeApi.list({ page, page_size: pageSize })
    if (!res?.success || !res.data) {
      notify(res?.message || t('充值记录加载失败'), 'error')
      return null
    }
    return res.data
  },
})

async function closeOrder(o: Order) {
  if (closingOrderId.value || checkingOrderId.value)
    return
  const ok = await confirm({
    title: t('account.order.cancelTitle'),
    message: t('account.order.cancelMessage', { name: o.title || o.order_no }),
    confirmText: t('取消订单'),
    danger: true,
  })
  if (!ok || closingOrderId.value)
    return
  closingOrderId.value = o.id
  try {
    const res = await billingApi.closeOrder(o.id)
    if (!res?.success) {
      notify(res?.message || t('取消失败'), 'error')
      return
    }
    notify(t('account.order.cancelled'), 'success')
    await reloadOrders()
  }
  finally {
    closingOrderId.value = null
  }
}

async function checkOrderPay(o: Order) {
  if (checkingOrderId.value || closingOrderId.value === o.id)
    return
  checkingOrderId.value = o.id
  try {
    const res = await rechargeApi.status(o.order_no)
    if (!res?.success) {
      notify(res?.message || t('查询失败'), 'error')
      return
    }
    if (res.data?.status === 'success') {
      notify(t('支付已到账'), 'success')
      await Promise.all([reloadOrders(), refreshWallet()])
      emit('paid')
      return
    }
    notify(t('尚未支付'))
  }
  finally {
    checkingOrderId.value = null
  }
}

async function checkRechargePay(tradeNo: string) {
  if (checkingTradeNo.value)
    return
  checkingTradeNo.value = tradeNo
  try {
    const res = await rechargeApi.status(tradeNo)
    if (!res?.success) {
      notify(res?.message || t('查询失败'), 'error')
      return
    }
    if (res.data?.status === 'success') {
      notify(t('支付已到账'), 'success')
      await Promise.all([reloadRecharges(), refreshWallet()])
      emit('paid')
      return
    }
    notify(t('尚未支付'))
  }
  finally {
    checkingTradeNo.value = ''
  }
}

onMounted(() => {
  if (!ordersLoaded.value)
    void reloadOrders()
  if (!rechargesLoaded.value)
    void reloadRecharges()
})
</script>

<template>
  <section class="wallet-card" :class="{ 'settings-empty-card': !ordersBusy && !orders.length }">
    <h3>
      {{ t('订单记录') }}
      <button v-if="invoiceEnabled" type="button" class="settings-link settings-invoice-link" @click="$emit('goto-invoice')">
        <UIcon name="i-lucide-file-text" class="size-3.5" />
        {{ t('开发票') }}
      </button>
    </h3>
    <StudioPaging
      compact
      grid-class="wallet-list"
      :loading="ordersBusy"
      :error="ordersFailed"
      :loading-more="ordersLoadingMore"
      :has-more="ordersHasMore"
      :count="orders.length"
      :empty-title="t('还没有订单')"
      :empty-description="t('开通会员或购买积分后，记录会出现在这里。')"
      :load-more="loadMoreOrders"
    >
      <template #skeleton>
        <li v-for="n in 5" :key="n">
          <USkeleton class="h-3.5 w-2/5" />
          <USkeleton class="mt-2 h-3 w-3/5" />
        </li>
      </template>
      <template #empty>
        <StudioEmpty
          compact
          :title="t('还没有订单')"
          :description="t('开通会员或购买积分后，记录会出现在这里。')"
        >
          <button type="button" class="plan-btn plan-btn--ghost" @click="$emit('goto-pricing', 'membership')">{{ t('开通会员') }}</button>
          <button type="button" class="plan-btn plan-btn--solid" @click="$emit('goto-pricing', 'points')">{{ t('购买积分') }}</button>
        </StudioEmpty>
      </template>
      <ul class="wallet-list">
        <li v-for="o in orders" :key="o.id">
          <span class="wallet-list__label">{{ o.title }}</span>
          <span class="wallet-list__num">¥{{ o.price }}</span>
          <span class="wallet-list__sub">
            {{ o.order_no }} · {{ fmt(o.created_at) }} ·
            <b :class="`settings-status is-${o.status}`">{{ ORDER_STATUS[o.status] ?? o.status }}</b>
            <button v-if="o.status === 'pending'" type="button" class="settings-link" :disabled="checkingOrderId === o.id || closingOrderId === o.id" @click="checkOrderPay(o)">{{ checkingOrderId === o.id ? t('查询中…') : t('查单') }}</button>
            <button v-if="o.status === 'pending'" type="button" class="settings-link" :disabled="closingOrderId === o.id || checkingOrderId === o.id" @click="closeOrder(o)">{{ closingOrderId === o.id ? t('account.order.cancelling') : t('取消订单') }}</button>
          </span>
        </li>
      </ul>
    </StudioPaging>
  </section>
  <section class="wallet-card" :class="{ 'settings-empty-card': !rechargesBusy && !recharges.length }">
    <h3>{{ t('充值记录') }}</h3>
    <StudioPaging
      compact
      grid-class="wallet-list"
      :loading="rechargesBusy"
      :error="rechargesFailed"
      :loading-more="rechargesLoadingMore"
      :has-more="rechargesHasMore"
      :count="recharges.length"
      :empty-title="t('还没有充值记录')"
      :empty-description="t('团队充值或扫码支付后，记录会出现在这里。')"
      :load-more="loadMoreRecharges"
    >
      <template #skeleton>
        <li v-for="n in 5" :key="`r-${n}`">
          <USkeleton class="h-3.5 w-2/5" />
          <USkeleton class="mt-2 h-3 w-3/5" />
        </li>
      </template>
      <template #empty>
        <StudioEmpty
          compact
          :title="t('还没有充值记录')"
          :description="t('团队充值或扫码支付后，记录会出现在这里。')"
        />
      </template>
      <ul class="wallet-list">
        <li v-for="r in recharges" :key="r.id">
          <span class="wallet-list__label">{{ r.team_id ? t('团队充值') : t('充值') }} · {{ payMethodLabel(r.payment_method, (k: string) => t(k)) }}</span>
          <span class="wallet-list__num">¥{{ r.money }}</span>
          <span class="wallet-list__sub">
            {{ r.trade_no }} · {{ fmt(r.create_time) }} ·
            <b :class="`settings-status is-${r.status === 'success' ? 'paid' : r.status}`">{{ RECHARGE_STATUS[r.status] ?? r.status }}</b>
            <button v-if="r.status === 'pending'" type="button" class="settings-link" :disabled="checkingTradeNo === r.trade_no" @click="checkRechargePay(r.trade_no)">{{ checkingTradeNo === r.trade_no ? t('查询中…') : t('查单') }}</button>
          </span>
        </li>
      </ul>
    </StudioPaging>
  </section>
</template>
