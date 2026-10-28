<script setup lang="ts">
import rechargeApi from '~/api/recharge'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const toast = useToast()
const { refresh: refreshWallet } = useWallet()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
})

useHead({ title: t('充值结果') })

const POLL_MS = 3000
const MAX_POLLS = 20
const status = ref<'checking' | 'success' | 'pending' | 'error'>('checking')
const message = ref('')
let stopRechargePoll = () => {}
let polls = 0

const tradeNo = computed(() => {
  const fromQuery = String(route.query.out_trade_no || route.query.trade_no || '').trim()
  return fromQuery || readRechargeTrade()
})

function stop() {
  stopRechargePoll()
  stopRechargePoll = () => {}
}

async function checkOnce() {
  const no = tradeNo.value
  if (!no) {
    status.value = 'error'
    message.value = t('没有找到支付单号')
    return false
  }
  const res = await rechargeApi.status(no)
  if (!res?.success) {
    status.value = 'error'
    message.value = res?.message || t('查询失败，请稍后在设置里重试')
    return false
  }
  if (res.data?.status === 'success') {
    status.value = 'success'
    message.value = t('支付已到账')
    clearRechargeTrade()
    void refreshWallet()
    toast.add({ title: t('支付已到账'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    return true
  }
  status.value = 'pending'
  message.value = t('尚未确认到账，正在查询…')
  return false
}

async function start() {
  stop()
  status.value = 'checking'
  polls = 0
  if (await checkOnce())
    return
  stopRechargePoll = startHiddenAwarePoll(async () => {
    polls += 1
    if (await checkOnce() || polls >= MAX_POLLS) {
      stop()
      if (status.value === 'pending')
        message.value = t('暂未确认到账。若已付款，请稍后刷新或到设置查看。')
    }
  }, POLL_MS)
}

onMounted(() => {
  void start()
})

onUnmounted(stop)
</script>

<template>
  <section class="settings-page">
    <div class="show-page__inner">
      <header class="projects-toolbar">
        <div class="projects-toolbar__left">
          <h1>{{ t('充值结果') }}</h1>
        </div>
      </header>
      <section class="wallet-card">
        <h3>{{ status === 'success' ? t('支付成功') : t('支付确认') }}</h3>
        <p class="settings-lead">{{ message || t('正在确认支付结果…') }}</p>
        <p v-if="tradeNo" class="settings-hint">{{ t('订单号') }} {{ tradeNo }}</p>
        <div class="settings-secure">
          <NuxtLink :to="localePath({ path: '/settings', query: { tab: 'team' } })" class="plan-btn plan-btn--solid">
            {{ t('返回团队') }}
          </NuxtLink>
          <NuxtLink :to="localePath({ path: '/settings', query: { tab: 'orders' } })" class="plan-btn plan-btn--ghost">
            {{ t('查看订单') }}
          </NuxtLink>
        </div>
      </section>
    </div>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
