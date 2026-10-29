<script setup lang="ts">
import type { GrowthTask } from '~/types/creative'

const { t } = useI18n()
const localePath = useLocalePath()

/**
 * 右下角「新手任务 / 签到」悬浮球（GET /user/growth/tasks、GET /user/checkin/status）。
 * 圆环是任务进度，今日未签到时带红点；点开面板可签到、去完成任务。
 * 新手任务全部完成后只保留签到；匿名和团队空间不展示。钱包面板通过 useGrowthDock 打开。
 */
const { isLoggedIn } = useAuth()
const { isTeam } = useWorkspace()
const { tasks, allDone, checkin, todayDone, checkinBusy, checkinPending, loadTasks, loadCheckin, checkinWithToast } = useGrowth()
const { growth, load: loadConfig } = useStudioAppConfig()
const { openNewProject } = useStudioNav()
const open = useGrowthDock()
const route = useRoute()
const rootEl = ref<HTMLElement | null>(null)

const hasTasks = computed(() => Boolean(tasks.value?.tasks.length) && !allDone.value)
const visible = computed(() => isLoggedIn.value && !isTeam.value && (hasTasks.value || checkin.value !== null))
const total = computed(() => tasks.value?.tasks.length ?? 0)
const done = computed(() => tasks.value?.done ?? 0)
const percent = computed(() => total.value ? Math.round((done.value / total.value) * 100) : 0)
const validDays = computed(() => tasks.value?.valid_days || growth.value?.task_valid_days || 0)
const checkinPoints = computed(() => checkin.value?.points_today || growth.value?.checkin_points || 0)
const fabLabel = computed(() => hasTasks.value ? t('新手任务') : t('每日签到'))

const RING_RADIUS = 25
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
const ringOffset = computed(() => RING_LENGTH * (1 - percent.value / 100))

const TASK_ICON: Record<string, string> = {
  first_canvas: 'i-lucide-layout-grid',
  first_video: 'i-lucide-clapperboard',
  first_work: 'i-lucide-upload',
  first_invite: 'i-lucide-user-plus',
}

const TASK_TARGET: Record<string, () => void> = {
  first_canvas: openNewProject,
  first_video: () => void navigateTo(localePath('/create')),
  first_work: () => void navigateTo(localePath('/projects')),
  first_invite: () => void navigateTo(localePath({ path: '/settings', query: { tab: 'invite' } })),
}

function gotoTask(item: GrowthTask) {
  open.value = false
  ;(TASK_TARGET[item.key] ?? (() => void navigateTo(localePath('/create'))))()
}

async function onCheckin() {
  await checkinWithToast()
  void loadTasks()
}

function toggle() {
  open.value = !open.value
}

async function refresh() {
  if (!isLoggedIn.value)
    return
  void loadCheckin()
  void loadConfig()
  await loadTasks()
}

function onPointerDown(event: PointerEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(event.target as Node))
    open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    open.value = false
}

watch(open, (value) => {
  if (value)
    void loadTasks()
})

watch(isLoggedIn, (on) => {
  if (on)
    void refresh()
  else
    open.value = false
})

/** 旧链接 /studio#tasks：直接展开面板 */
watch(() => route.hash, (hash) => {
  if (hash === '#tasks')
    open.value = true
}, { immediate: true })

onMounted(() => {
  void refresh()
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="visible" ref="rootEl" class="growth-tasks" :class="{ 'is-open': open }">
    <Transition name="growth-pop">
      <section v-if="open" id="tasks" class="growth-tasks__panel" role="dialog" :aria-label="fabLabel">
        <header class="growth-tasks__head">
          <div class="growth-tasks__title">
            <h2>{{ fabLabel }}</h2>
            <span v-if="hasTasks" class="growth-tasks__count">{{ done }}/{{ total }}</span>
          </div>
          <button type="button" class="growth-tasks__close" :aria-label="t('收起')" @click="open = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div v-if="hasTasks && tasks" class="growth-tasks__summary">
          <div class="growth-tasks__points">
            <span>{{ t('已获得') }}</span>
            <strong>{{ tasks.earned_points.toLocaleString() }}</strong>
            <span>/ {{ tasks.total_points.toLocaleString() }} {{ t('积分') }}</span>
          </div>
          <small v-if="validDays">{{ t('剩余天数有效', { n: validDays }) }}</small>
          <div class="growth-tasks__bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
            <i :style="{ width: `${percent}%` }" />
          </div>
        </div>

        <div class="growth-tasks__checkin" :class="{ 'is-done': todayDone }">
          <span class="growth-tasks__checkin-icon">
            <UIcon name="i-lucide-calendar-check" class="size-5" />
          </span>
          <div class="growth-tasks__checkin-text">
            <strong>{{ todayDone ? t('今日已签到') : t('每日签到') }}</strong>
            <small v-if="checkin?.streak">{{ t('已连续 {n} 天', { n: checkin.streak }) }}</small>
            <small v-else-if="checkinPoints">{{ t('签到得 {n} 积分', { n: checkinPoints }) }}</small>
          </div>
          <button
            type="button"
            class="growth-tasks__checkin-btn"
            :disabled="todayDone || checkinBusy"
            @click="onCheckin"
          >
            {{ checkinBusy ? t('签到中…') : todayDone ? t('已签到') : t('签到') }}
          </button>
        </div>

        <ul v-if="hasTasks && tasks" class="growth-tasks__list">
          <li v-for="item in tasks.tasks" :key="item.key" :class="{ 'is-done': item.status === 1 }">
            <span class="growth-tasks__icon">
              <UIcon :name="TASK_ICON[item.key] || 'i-lucide-circle-dot'" class="size-4" />
            </span>
            <div class="growth-tasks__info">
              <span class="growth-tasks__name">{{ t(item.title) }}</span>
              <b class="growth-tasks__reward">+{{ item.points }} {{ t('积分') }}</b>
            </div>
            <span v-if="item.status === 1" class="growth-tasks__done">
              <UIcon name="i-lucide-circle-check" class="size-4" />
              {{ t('已完成') }}
            </span>
            <button v-else type="button" class="growth-tasks__go" @click="gotoTask(item)">
              {{ t('去完成') }}
            </button>
          </li>
        </ul>
      </section>
    </Transition>

    <button
      type="button"
      class="growth-tasks__fab"
      :class="{ 'is-pending': checkinPending }"
      :aria-label="fabLabel"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg v-if="hasTasks" class="growth-tasks__ring" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" :r="RING_RADIUS" />
        <circle
          class="growth-tasks__ring-value"
          cx="28"
          cy="28"
          :r="RING_RADIUS"
          :stroke-dasharray="RING_LENGTH"
          :stroke-dashoffset="ringOffset"
        />
      </svg>
      <UIcon :name="open ? 'i-lucide-x' : 'i-lucide-gift'" class="size-6" />
      <i v-if="checkinPending" class="growth-tasks__dot" aria-hidden="true" />
    </button>
  </div>
</template>
