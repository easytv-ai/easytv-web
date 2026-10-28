<script setup lang="ts">
import billingApi from '~/api/billing'
import rechargeApi from '~/api/recharge'
import PayQrModal from '~/components/pricing/PayQrModal.vue'
import type { Order, PayIntent } from '~/types/creative'
import PlanMembership from './PlanMembership.vue'
import PlanPromo from './PlanPromo.vue'
import PlanEnterprise from './PlanEnterprise.vue'
import PlanCompare from './PlanCompare.vue'
import PlanPoints from './PlanPoints.vue'
import PlanFaq from './PlanFaq.vue'
import SubscribeConfirm from '~/components/pricing/SubscribeConfirm.vue'
import {
  type BillingCycle,
  type ConfirmPayload,
  type PlanEdition,
  type ProductTab,
} from '~/utils/pricing-plans'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'

const { t } = useI18n()

const tab = defineModel<ProductTab>('tab', { default: 'membership' })

const route = useRoute()
const toast = useToast()
const { isLoggedIn } = useAuth()
const { goToLogin } = useAuthLoginRedirect()
const { rememberPricingTab } = usePricingModal()

const state = reactive({
  edition: 'creator' as PlanEdition,
  cycle: 'year' as BillingCycle,
  seats: 2,
  confirmOpen: false,
  submitting: false,
  payload: null as ConfirmPayload | null,
})

function gotoLogin() {
  rememberPricingTab(tab.value)
  return goToLogin(route.fullPath)
}

function gotoPointsMarket() {
  tab.value = 'points'
}

function gotoMembership() {
  tab.value = 'membership'
}

function openConfirm(payload: ConfirmPayload) {
  if (!isLoggedIn.value) {
    void gotoLogin()
    return
  }
  state.payload = payload
  state.confirmOpen = true
}

function closeConfirm() {
  if (state.submitting)
    return
  state.confirmOpen = false
}

async function confirmOrder(addOn: boolean, paymentMethod: string) {
  if (state.submitting || !state.payload)
    return
  state.submitting = true
  try {
    const res = await billingApi.createOrder({
      ...state.payload.request,
      add_on: addOn && state.payload.kind === 'membership',
      payment_method: paymentMethod,
    })
    if (!res?.success || !res.data) {
      toast.add({ title: res?.message || t('下单失败，请稍后重试'), color: 'error', icon: 'i-lucide-circle-alert', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    if (!res.data.pay) {
      toast.add({ title: res.data.pay_error || t('支付渠道暂不可用'), color: 'error', icon: 'i-lucide-circle-alert', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    const pay = res.data.pay
    rememberRechargeTrade(pay.trade_no)
    state.confirmOpen = false
    if (isPagePay(pay)) {
      if (!openPayPage(pay.payment_url || ''))
        toast.add({ title: t('请允许浏览器打开新窗口以完成支付'), color: 'warning', close: false, progress: false, orientation: 'horizontal' })
      watchPagePay(res.data.order, pay.trade_no)
      return
    }
    payState.order = res.data.order
    payState.pay = pay
    payState.open = true
  }
  catch {
    toast.add({ title: t('提交失败，请稍后重试'), color: 'error', icon: 'i-lucide-circle-alert', close: false, progress: false, orientation: 'horizontal' })
  }
  finally {
    state.submitting = false
  }
}

const payState = reactive({
  open: false,
  order: null as Order | null,
  pay: null as PayIntent | null,
})

const { refresh: refreshWallet } = useWallet()

function onPaid(order: Order | null) {
  toast.add({
    title: order?.kind === 'points' ? t('积分已到账') : order?.kind === 'membership' ? t('会员已开通') : t('支付成功'),
    description: order?.title,
    color: 'success',
    icon: 'i-lucide-circle-check',
    close: false,
    progress: false,
    orientation: 'horizontal',
  })
  void refreshWallet()
}

function closePay() {
  payState.open = false
}

const PAGE_PAY_POLL_MS = 3000
const PAGE_PAY_MAX = 40
let stopPagePayWatch = () => {}

function watchPagePay(order: Order, tradeNo: string) {
  stopPagePayWatch()
  stopPagePayWatch = () => {}
  let tries = 0
  const stop = startHiddenAwarePoll(async () => {
    tries += 1
    const no = tradeNo || order.order_no
    if (no) {
      const st = await rechargeApi.status(no)
      if (st?.success && st.data?.status === 'success') {
        stop()
        const latest = await billingApi.order(order.id)
        onPaid(latest?.success && latest.data ? latest.data : order)
        return
      }
    }
    const res = await billingApi.order(order.id)
    if (res?.success && res.data?.status === 'paid') {
      stop()
      onPaid(res.data)
      return
    }
    if (tries >= PAGE_PAY_MAX)
      stop()
  }, PAGE_PAY_POLL_MS)
  stopPagePayWatch = stop
}

onUnmounted(() => stopPagePayWatch())

defineExpose({
  isConfirmOpen: () => state.confirmOpen,
})
</script>

<template>
  <div class="plan-page">
    <h2 id="plan-modal-title" class="sr-only">
      {{ tab === 'membership' ? t('开通会员') : t('积分充值') }}
    </h2>
    <PlanPromo />

    <div class="plan-page__body">
      <PlanMembership
        v-if="tab === 'membership'"
        v-model:edition="state.edition"
        v-model:cycle="state.cycle"
        v-model:seats="state.seats"
        @subscribe="openConfirm"
        @market="gotoPointsMarket"
      />
      <PlanPoints
        v-else
        @buy="openConfirm"
        @back="gotoMembership"
      />

      <PlanEnterprise />
      <PlanCompare />
      <PlanFaq />
    </div>

    <SubscribeConfirm
      :open="state.confirmOpen"
      :payload="state.payload"
      :submitting="state.submitting"
      @cancel="closeConfirm"
      @confirm="confirmOrder"
    />
    <PayQrModal
      :open="payState.open"
      :order="payState.order"
      :pay="payState.pay"
      @close="closePay"
      @paid="onPaid"
    />
  </div>
</template>
