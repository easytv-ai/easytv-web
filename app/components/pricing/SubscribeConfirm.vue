<script setup lang="ts">
import billingApi from '~/api/billing'
import rechargeApi from '~/api/recharge'
import type { BillingQuote, RechargePayMethodOption } from '~/types/creative'
import {
  CYCLE_MONTHS,
  cycleLabel,
  formatMoney,
  formatPoints,
  formatYuan,
  type ConfirmPayload,
} from '~/utils/pricing-plans'
import { payMethodBrand, payMethodHint } from '~/utils/recharge-pay'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  payload: ConfirmPayload | null
  submitting: boolean
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [addOn: boolean, paymentMethod: string]
}>()

const addOn = ref(false)
const quote = ref<BillingQuote | null>(null)
const quoting = ref(false)
const payLoading = ref(false)
const payOptions = ref<RechargePayMethodOption[]>([])
const paymentMethod = ref('')

const methods = computed(() => payOptions.value.map(item => ({
  id: item.type,
  label: item.name || item.type,
  brand: payMethodBrand(item.type),
  hint: payMethodHint(item.type, t),
})))
const anyMethod = computed(() => methods.value.length > 0)

/** 打开时向服务端要一次权威报价（会员价、促销是否过期都以服务端为准） */
async function fetchQuote() {
  quote.value = null
  if (!props.payload)
    return
  quoting.value = true
  try {
    const res = await billingApi.quote({ ...props.payload.request, add_on: false })
    if (res?.success && res.data)
      quote.value = res.data
  }
  finally {
    quoting.value = false
  }
}

/** 支付方式跟 easyapi 一样走充值配置接口，后台开了哪些就展示哪些 */
async function fetchPayMethods() {
  payLoading.value = true
  try {
    const res = await rechargeApi.info()
    const list = res?.success && Array.isArray(res.data?.pay_methods) ? res.data.pay_methods : []
    payOptions.value = list.filter(item => item?.type)
    if (!methods.value.some(m => m.id === paymentMethod.value))
      paymentMethod.value = methods.value[0]?.id ?? ''
  }
  finally {
    payLoading.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) {
    addOn.value = false
    void fetchPayMethods()
    void fetchQuote()
  }
})

const canAddOn = computed(() => {
  if (props.payload?.kind !== 'membership')
    return false
  const points = quote.value?.add_on_points ?? props.payload.addOnPoints
  const price = quote.value?.add_on_price ?? props.payload.addOnPrice
  return !!points && !!price
})

const addOnPoints = computed(() => quote.value?.add_on_points ?? props.payload?.addOnPoints ?? 0)
const addOnPrice = computed(() => quote.value?.add_on_price ?? props.payload?.addOnPrice ?? 0)
const basePrice = computed(() => quote.value?.price ?? props.payload?.price ?? 0)
const origin = computed(() => quote.value?.origin ?? props.payload?.origin ?? 0)
const showAddOnPrice = computed(() => canAddOn.value && addOn.value)
const months = computed(() => {
  if (quote.value?.months)
    return quote.value.months
  const cycle = props.payload?.request.cycle
  return cycle ? CYCLE_MONTHS[cycle] : 0
})
const monthlyPrice = computed(() => {
  if (months.value <= 0)
    return 0
  return basePrice.value / months.value
})
const points = computed(() => quote.value?.points ?? 0)
/** 会员日等自动优惠的说明（API.md 9.5 的 quote.discount_label），有就展示，让用户知道价格为什么降了 */
const discountLabel = computed(() => String(quote.value?.discount_label ?? '').trim())
const discount = computed(() => Math.max(0, origin.value - basePrice.value))
const goodsName = computed(() => {
  const cycle = props.payload?.request.cycle
  if (cycle)
    return cycleLabel(cycle, t)
  return props.payload?.title ?? ''
})

const total = computed(() => {
  if (showAddOnPrice.value)
    return basePrice.value + addOnPrice.value
  return basePrice.value
})

function onConfirm() {
  if (props.submitting || payLoading.value || !paymentMethod.value)
    return
  emit('confirm', canAddOn.value && addOn.value, paymentMethod.value)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && payload"
      class="studio-modal-mask plan-confirm-mask"
      @click.self="!submitting && emit('cancel')"
    >
      <div class="plan-checkout" role="dialog" aria-modal="true" aria-labelledby="plan-confirm-title">
        <header class="plan-checkout__head">
          <h2 id="plan-confirm-title">
            {{ payload.kind === 'membership' ? t('确认开通会员') : t('确认购买积分') }}
          </h2>
          <button
            type="button"
            class="plan-checkout__close"
            :aria-label="t('关闭')"
            :disabled="submitting"
            @click="emit('cancel')"
          >
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="plan-checkout__body">
          <div class="plan-checkout__inner">
        <section class="plan-sheet">
          <p class="plan-sheet__label">{{ t('商品信息') }}</p>
          <div class="plan-sheet__card">
            <p class="plan-sheet__name">{{ goodsName }}</p>
            <p v-if="payload.summary" class="plan-sheet__desc">{{ payload.summary }}</p>
            <div class="plan-sheet__price">
              <strong>{{ formatYuan(total) }}</strong>
              <del v-if="origin > basePrice">{{ formatYuan(origin) }}</del>
              <span v-if="discountLabel" class="plan-sheet__promo">{{ discountLabel }}</span>
              <em v-if="quoting" class="plan-checkout__quoting">{{ t('核对价格中…') }}</em>
            </div>
            <p v-if="monthlyPrice > 0" class="plan-sheet__avg">
              {{ formatMoney(monthlyPrice) }}/{{ t('月') }}
            </p>
          </div>
        </section>

        <label v-if="canAddOn" class="plan-checkout__addon" :class="{ 'is-on': addOn }">
          <input v-model="addOn" type="checkbox" :disabled="submitting">
          <span class="plan-checkout__addon-copy">
            <strong>{{ t('加购 {n} 积分', { n: addOnPoints }) }}</strong>
            <small>{{ t('与会员一并支付，即时到账') }}</small>
          </span>
          <em>{{ formatYuan(addOnPrice) }}</em>
        </label>

        <section class="plan-sheet">
          <p class="plan-sheet__label">{{ t('订单明细') }}</p>
          <dl class="plan-sheet__rows">
            <div v-if="points" class="plan-sheet__row">
              <dt>{{ t('积分数量') }}</dt>
              <dd>
                {{ payload.kind === 'membership'
                  ? `${formatPoints(points)}${t('积分')}/${t('月')}`
                  : `${formatPoints(points)}${t('积分')}` }}
              </dd>
            </div>
            <div v-if="origin > 0" class="plan-sheet__row">
              <dt>{{ t('商品原价') }}</dt>
              <dd>{{ formatMoney(origin) }}</dd>
            </div>
            <div v-if="discount > 0" class="plan-sheet__row">
              <dt>{{ t('优惠金额') }}{{ discountLabel ? `（${discountLabel}）` : '' }}</dt>
              <dd>-{{ formatMoney(discount) }}</dd>
            </div>
            <div v-if="showAddOnPrice" class="plan-sheet__row">
              <dt>{{ t('加购积分') }}</dt>
              <dd>{{ formatMoney(addOnPrice) }}</dd>
            </div>
            <div class="plan-sheet__row is-pay">
              <dt>{{ t('应付金额') }}</dt>
              <dd>{{ formatMoney(total) }}</dd>
            </div>
          </dl>
        </section>

        <section class="plan-checkout__pay">
          <p class="plan-checkout__label">{{ t('支付方式') }}</p>
          <p v-if="payLoading && !methods.length" class="plan-checkout__tip">{{ t('加载支付方式中…') }}</p>
          <div v-else class="plan-checkout__methods">
            <button
              v-for="m in methods"
              :key="m.id"
              type="button"
              class="plan-checkout__method"
              :class="[`is-${m.brand}`, { 'is-on': paymentMethod === m.id }]"
              :disabled="submitting"
              @click="paymentMethod = m.id"
            >
              <span class="plan-checkout__brand" aria-hidden="true">
                <img
                  v-if="m.brand === 'wechat'"
                  src="/images/pay/wechatpay.svg"
                  alt=""
                  width="20"
                  height="20"
                >
                <img
                  v-else
                  src="/images/pay/alipay.svg"
                  alt=""
                  width="20"
                  height="20"
                >
              </span>
              <span class="plan-checkout__method-copy">
                <strong>{{ m.label }}</strong>
                <small>{{ m.hint }}</small>
              </span>
            </button>
          </div>
        </section>

        <p class="plan-checkout__tip">
          <template v-if="payLoading && !methods.length">{{ t('正在获取可用支付方式') }}</template>
          <template v-else-if="anyMethod && paymentMethod === 'alipay_pc'">{{ t('确认后将跳转支付宝完成支付，支付完成积分与权益即时到账。') }}</template>
          <template v-else-if="anyMethod">{{ t('确认后生成支付二维码，支付完成积分与权益即时到账。') }}</template>
          <template v-else>{{ t('支付渠道尚未开通，请联系运营。') }}</template>
        </p>
          </div>
        </div>

        <div class="plan-checkout__actions">
          <button
            type="button"
            class="plan-checkout__btn"
            :disabled="submitting"
            @click="emit('cancel')"
          >
            {{ t('取消') }}
          </button>
          <button
            type="button"
            class="plan-checkout__btn is-primary"
            :disabled="submitting || payLoading || !anyMethod"
            @click="onConfirm"
          >
            {{ submitting ? t('生成订单中…') : t('去支付') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
