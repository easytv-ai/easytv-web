<script setup lang="ts">
/**
 * 活动倒计时：「剩余 3 天 5 时」，每秒重算（tick 参与表达式即可触发）。
 * 时间基准走 useServerClock()，见 useCampaign().countdownText。
 */
const props = defineProps<{
  endsAt: number
}>()

const { t } = useI18n()
const { countdownText } = useCampaign()

const tick = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

const text = computed(() => {
  // 读一次 tick 让计算属性每秒失效
  void tick.value
  return countdownText(props.endsAt)
})

onMounted(() => {
  timer = setInterval(() => {
    tick.value += 1
  }, 1000)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
})
</script>

<template>
  <!-- 倒计时依赖本机时间，放 ClientOnly 里避免 SSR 与水合文案不一致 -->
  <ClientOnly>
    <span v-if="text" class="campaign-countdown" :aria-label="t('活动倒计时')">
      <UIcon name="i-lucide-timer" class="size-3.5" />
      {{ text }}
    </span>
  </ClientOnly>
</template>
