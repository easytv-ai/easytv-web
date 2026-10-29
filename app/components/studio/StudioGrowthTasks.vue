<script setup lang="ts">
const { t } = useI18n()

/**
 * 首页「新手任务」卡（GET /user/growth/tasks）：进度、积分、有效期、任务与签到入口。
 * 匿名或全部完成时自动隐藏；页面 keepalive 回到首页时刷新。
 */
const { isLoggedIn } = useAuth()
const { tasks, allDone, checkin, todayDone, checkinBusy, loadTasks, loadCheckin, checkinWithToast } = useGrowth()
const { growth, load: loadConfig } = useStudioAppConfig()
const route = useRoute()

const visible = computed(() => isLoggedIn.value && Boolean(tasks.value) && !allDone.value)
const total = computed(() => tasks.value?.tasks.length ?? 0)
const percent = computed(() => total.value ? Math.round(((tasks.value?.done ?? 0) / total.value) * 100) : 0)
const validDays = computed(() => tasks.value?.valid_days || growth.value?.task_valid_days || 0)
const checkinPoints = computed(() => checkin.value?.points_today || growth.value?.checkin_points || 0)

const TASK_ICON: Record<string, string> = {
  first_canvas: 'i-lucide-layout-grid',
  first_video: 'i-lucide-clapperboard',
  first_work: 'i-lucide-upload',
  first_invite: 'i-lucide-user-plus',
}

async function onCheckin() {
  await checkinWithToast()
  void loadTasks()
}

/** 钱包面板「新手任务」入口带 #tasks 跳过来：卡片渲染后滚到可见位置 */
function scrollIfHash() {
  if (!import.meta.client || route.hash !== '#tasks')
    return
  nextTick(() => {
    document.getElementById('tasks')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

async function refresh() {
  if (!isLoggedIn.value)
    return
  void loadCheckin()
  void loadConfig()
  await loadTasks()
  scrollIfHash()
}

onMounted(refresh)
onActivated(refresh)
watch(isLoggedIn, (on) => {
  if (on)
    refresh()
})
</script>

<template>
  <section v-if="visible && tasks" id="tasks" class="growth-tasks" :aria-label="t('新手任务')">
    <header class="growth-tasks__head">
      <div class="growth-tasks__title">
        <h2>{{ t('新手任务') }}</h2>
        <span class="growth-tasks__count">{{ tasks.done }}/{{ total }}</span>
        <small v-if="validDays">{{ t('剩余天数有效', { n: validDays }) }}</small>
      </div>
      <div class="growth-tasks__points">
        <strong>{{ tasks.earned_points.toLocaleString() }}</strong>
        <span>/ {{ tasks.total_points.toLocaleString() }} {{ t('积分') }}</span>
      </div>
    </header>
    <div class="growth-tasks__bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
      <i :style="{ width: `${percent}%` }" />
    </div>
    <div class="growth-tasks__body">
      <ul class="growth-tasks__list">
        <li v-for="item in tasks.tasks" :key="item.key" :class="{ 'is-done': item.status === 1 }">
          <UIcon :name="TASK_ICON[item.key] || 'i-lucide-circle-dot'" class="size-4 growth-tasks__icon" />
          <span class="growth-tasks__name">{{ t(item.title) }}</span>
          <b class="growth-tasks__reward">+{{ item.points }}</b>
          <UIcon :name="item.status === 1 ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-4 growth-tasks__check" />
        </li>
      </ul>
      <div class="growth-tasks__checkin">
        <UIcon name="i-lucide-calendar-check" class="size-5" />
        <strong>{{ todayDone ? t('今日已签到') : t('每日签到') }}</strong>
        <small v-if="checkin?.streak">{{ t('已连续 {n} 天', { n: checkin.streak }) }}</small>
        <small v-else-if="checkinPoints">{{ t('签到得 {n} 积分', { n: checkinPoints }) }}</small>
        <button type="button" class="plan-btn" :class="todayDone ? 'plan-btn--ghost' : 'plan-btn--solid'" :disabled="todayDone || checkinBusy" @click="onCheckin">
          {{ todayDone ? t('已签到') : t('签到') }}
        </button>
      </div>
    </div>
  </section>
</template>
