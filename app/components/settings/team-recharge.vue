<script setup lang="ts">
import PayQrModal from '~/components/pricing/PayQrModal.vue'
import rechargeApi from '~/api/recharge'
import type { PayIntent, RechargeInfo, RechargePayMethod } from '~/types/creative'
import { formatYuan } from '~/utils/pricing-plans'
import { isPagePay, openPayPage, rememberRechargeTrade, toRechargePayIntent } from '~/utils/recharge-pay'

const props = defineProps<{
  teamId: number
}>()

const emit = defineEmits<{
  paid: []
}>()

const { t } = useI18n()
const toast = useToast()

const info = ref<RechargeInfo | null>(null)
const loading = ref(false)
const submitting = ref(false)
const amount = ref(0)
const paymentMethod = ref<RechargePayMethod>('wechat_native')
const payOpen = ref(false)
const payIntent = ref<PayIntent | null>(null)

const methods = computed(() => {
  const list = info.value?.pay_methods ?? []
  return list.map(item => ({
    id: item.type,
    label: item.name || item.type,
    enabled: true,
  }))
})

const anyMethod = computed(() => methods.value.length > 0)
const minRecharge = computed(() => Number(info.value?.min_recharge) || 1)
const options = computed(() => (info.value?.amount_options ?? []).filter(n => n >= minRecharge.value))

async function loadInfo() {
  loading.value = true
  try {
    const res = await rechargeApi.info()
    if (!res?.success || !res.data) {
      info.value = null
      return
    }
    info.value = res.data
    if (!amount.value || !options.value.includes(amount.value))
      amount.value = options.value[0] ?? minRecharge.value
    if (!methods.value.some(m => m.id === paymentMethod.value)) {
      const first = methods.value[0]
      if (first)
        paymentMethod.value = first.id
    }
  }
  finally {
    loading.value = false
  }
}

async function submit() {
  if (submitting.value || !anyMethod.value)
    return
  if (amount.value < minRecharge.value) {
    toast.add({ title: t('充值数量不能小于 {n}', { n: minRecharge.value }), color: 'error', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  submitting.value = true
  try {
    const res = await rechargeApi.pay({
      amount: amount.value,
      payment_method: paymentMethod.value,
      team_id: props.teamId,
    })
    if (!res?.success || !res.data?.trade_no) {
      toast.add({ title: res?.message || t('下单失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    rememberRechargeTrade(res.data.trade_no)
    const intent = toRechargePayIntent(res.data, paymentMethod.value)
    if (isPagePay(intent)) {
      if (!openPayPage(intent.payment_url || ''))
        toast.add({ title: t('请允许浏览器打开新窗口以完成支付'), color: 'warning', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    payIntent.value = intent
    payOpen.value = true
  }
  finally {
    submitting.value = false
  }
}

function onPaid() {
  toast.add({
    title: t('团队充值已到账'),
    color: 'success',
    close: false,
    progress: false,
    orientation: 'horizontal',
  })
  emit('paid')
}

function closePay() {
  payOpen.value = false
}

onMounted(() => {
  void loadInfo()
})
</script>

<template>
  <section class="wallet-card">
    <h3>
      {{ t('团队充值') }}
      <small>{{ t('仅所有者可充值，到账进入团队积分池') }}</small>
    </h3>
    <p v-if="loading && !info" class="settings-lead">{{ t('加载中…') }}</p>
    <template v-else>
      <p class="settings-lead">{{ t('选择金额和支付方式。当面付扫码，电脑网站支付会跳转支付宝。') }}</p>
      <div class="settings-row settings-row--top">
        <span class="settings-row__label">{{ t('金额') }}</span>
        <div class="plan-pay-methods settings-pay-options">
          <button
            v-for="n in options"
            :key="n"
            type="button"
            class="plan-pay-method"
            :class="{ 'is-on': amount === n }"
            @click="amount = n"
          >
            {{ formatYuan(n) }}
          </button>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('支付') }}</span>
        <div class="plan-pay-methods settings-pay-options">
          <button
            v-for="m in methods"
            :key="m.id"
            type="button"
            class="plan-pay-method"
            :class="{ 'is-on': paymentMethod === m.id }"
            :disabled="!m.enabled || submitting"
            @click="paymentMethod = m.id"
          >
            {{ m.label }}
          </button>
          <span v-if="!anyMethod" class="settings-hint">{{ t('支付渠道尚未开通，请联系运营。') }}</span>
        </div>
      </div>
      <div class="settings-secure">
        <button
          type="button"
          class="plan-btn plan-btn--solid"
          :disabled="submitting || !anyMethod || !amount"
          @click="submit"
        >
          {{ submitting ? t('下单中…') : t('去支付') }}
        </button>
      </div>
    </template>
    <PayQrModal
      :open="payOpen"
      :pay="payIntent"
      :title="t('团队充值')"
      :price="amount"
      @close="closePay"
      @paid="onPaid"
    />
  </section>
</template>
