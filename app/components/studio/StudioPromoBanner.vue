<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
const { promo, load } = useBillingCatalog()
const { gotoPricing } = usePricingModal()
const { now } = useServerClock()

/**
 * 创作台顶部促销倒计时条：数据来自 GET /billing/plans 的 promo（banner_enabled / banner_link / title / subtitle / ends_at）。
 * 关闭后本次会话不再显示（sessionStorage）；倒计时归零自动卸载。
 */
const CLOSED_KEY = 'easytv_promo_banner_closed'

const closed = ref(true)
const ended = ref(false)
const remain = ref({ days: 0, hours: 0, minutes: 0 })
let timer: ReturnType<typeof setInterval> | undefined

const endsAtMs = computed(() => (promo.value?.ends_at ?? 0) * 1000)

const visible = computed(() => {
  const p = promo.value
  if (!p || closed.value || ended.value)
    return false
  return Boolean(p.banner_enabled) && Boolean(p.enabled) && endsAtMs.value > now()
})

const title = computed(() => String(promo.value?.title ?? '').trim())
const subtitle = computed(() => String(promo.value?.subtitle ?? '').trim())

function tick() {
  const left = endsAtMs.value - now()
  if (left <= 0) {
    ended.value = true
    stop()
    return
  }
  remain.value = {
    days: Math.floor(left / 86400000),
    hours: Math.floor((left % 86400000) / 3600000),
    minutes: Math.floor((left % 3600000) / 60000),
  }
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}

function start() {
  stop()
  if (!endsAtMs.value)
    return
  ended.value = false
  tick()
  timer = setInterval(tick, 1000)
}

function close() {
  closed.value = true
  try {
    sessionStorage.setItem(CLOSED_KEY, '1')
  }
  catch {
    // 隐私模式等不可用时忽略
  }
}

function open() {
  const link = String(promo.value?.banner_link ?? '').trim()
  if (!link) {
    gotoPricing('membership')
    return
  }
  if (/^https?:\/\//i.test(link)) {
    window.open(link, '_blank', 'noopener')
    return
  }
  void navigateTo(localePath(link.startsWith('/') ? link : `/${link}`))
}

onMounted(() => {
  try {
    closed.value = sessionStorage.getItem(CLOSED_KEY) === '1'
  }
  catch {
    closed.value = false
  }
  void load()
})

watch(endsAtMs, (v) => {
  if (v)
    start()
  else
    stop()
}, { immediate: true })

onUnmounted(stop)
</script>

<template>
  <div v-if="visible" class="studio-promo-banner" role="status">
    <UIcon name="i-lucide-sparkles" class="studio-promo-banner__icon size-4" />
    <div class="studio-promo-banner__copy">
      <strong class="studio-promo-banner__title">{{ title }}</strong>
      <span v-if="subtitle" class="studio-promo-banner__sub">{{ subtitle }}</span>
    </div>
    <span class="studio-promo-banner__time" :aria-label="t('活动倒计时')">
      {{ t('剩余 {d} 天 {h} 时 {m} 分', { d: remain.days, h: remain.hours, m: remain.minutes }) }}
    </span>
    <button type="button" class="studio-promo-banner__btn" @click="open">{{ t('立即查看') }}</button>
    <button type="button" class="studio-promo-banner__close" :aria-label="t('关闭')" @click="close">
      <UIcon name="i-lucide-x" class="size-4" />
    </button>
  </div>
</template>
