<script setup lang="ts">
import billingApi from '~/api/billing'
import taskApi from '~/api/task'
import type { GenerationTask, PointsLog, PointsLot, TaskStatus, TaskType } from '~/types/creative'
import { discountParams } from '~/utils/pricing-plans'

const { t } = useI18n()

/** 积分钱包面板：余额 / 会员 / 到期批次 / 流水，入口在顶栏「积分钱包」。 */
const { wallet, walletOpen, walletTab, closeWallet, refresh, balance, isMember, membership } = useWallet()
const { activeCount, refreshActivity } = useTaskActivity()
const { isTeam } = useWorkspace()
const teamInfo = computed(() => wallet.value?.team ?? null)
const teamLogsHidden = computed(() => isTeam.value && teamInfo.value?.permission !== 'admin')
const { gotoPricing } = usePricingModal()
const { memberDay, memberDayActive, load: loadBillingCatalog } = useBillingCatalog()
const localePath = useLocalePath()
const { tasks: growthTasks, allDone: tasksAllDone, checkin, todayDone, checkinBusy, lastCompleted, loadTasks, loadCheckin, checkinWithToast } = useGrowth()
const { growth } = useStudioAppConfig()

/** 任务刚完成的提示：lastCompleted 变化后在钱包 hero 上闪 4 秒 */
const completedTip = ref<{ title: string, points: number } | null>(null)
let completedTimer: number | undefined
watch(lastCompleted, (v) => {
  if (!v || !import.meta.client)
    return
  completedTip.value = { title: v.title, points: v.points }
  window.clearTimeout(completedTimer)
  completedTimer = window.setTimeout(() => { completedTip.value = null }, 4000)
})

/** 7 天一个周期的签到条：已签 / 今天 / 待签；第 7 格有连续奖励 */
const streakCells = computed(() => {
  const st = checkin.value
  const streak = st?.streak ?? 0
  const done = st?.today_done === true
  const filled = done ? ((Math.max(streak, 1) - 1) % 7) + 1 : streak % 7
  const todayIndex = done ? filled - 1 : filled
  return Array.from({ length: 7 }, (_, i) => ({
    day: i + 1,
    signed: i < filled,
    today: i === todayIndex,
    bonus: i === 6,
  }))
})
const checkinPoints = computed(() => checkin.value?.points_today || growth.value?.checkin_points || 0)
const streakBonus = computed(() => checkin.value?.streak_bonus || growth.value?.checkin_streak_bonus || 0)
const monthSigned = computed(() => checkin.value?.month_days.length ?? 0)

async function onCheckin() {
  const res = await checkinWithToast()
  if (res.ok)
    void reloadLogs()
}

const growthDockOpen = useGrowthDock()

function goTasks() {
  closeWallet()
  growthDockOpen.value = true
}

const lots = ref<PointsLot[]>([])
const loading = ref(false)
const canDismiss = ref(false)

const {
  items: logs,
  busy: logsBusy,
  failed: logsFailed,
  loadingMore: logsLoadingMore,
  hasMore: logsHasMore,
  reload: reloadLogs,
  loadMore: loadMoreLogs,
} = useStudioPaged<PointsLog>({
  pageSize: 20,
  async fetch(page, pageSize) {
    const res = await billingApi.pointsLog({ page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

/** 任务标签：生成任务也在钱包里看（原来的任务中心收到二级页面 /tasks） */
const {
  items: taskItems,
  busy: tasksBusy,
  failed: tasksFailed,
  loadingMore: tasksLoadingMore,
  hasMore: tasksHasMore,
  reload: reloadTaskItems,
  loadMore: loadMoreTaskItems,
} = useStudioPaged<GenerationTask>({
  pageSize: 20,
  async fetch(page, pageSize) {
    const res = await taskApi.list({ page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: t('排队中'),
  running: t('生成中'),
  succeeded: t('已完成'),
  failed: t('失败'),
  cancelled: t('已取消'),
}
const TASK_TYPE_LABEL: Record<TaskType, string> = {
  text: t('文本'),
  image: t('图片'),
  video: t('视频'),
  audio: t('音频'),
}

function taskPoints(task: GenerationTask) {
  if (task.status === 'succeeded')
    return task.cost_points
  if (task.status === 'pending' || task.status === 'running')
    return task.points_frozen
  return 0
}

function openTaskByNo(taskNo: string) {
  closeWallet()
  void navigateTo(localePath({ path: '/tasks', query: taskNo ? { keyword: taskNo } : undefined }))
}

function selectTab(tab: 'overview' | 'logs' | 'tasks') {
  walletTab.value = tab
  if (tab === 'tasks') {
    void reloadTaskItems()
    void refreshActivity()
  }
}

/** 增长域积分来源（point_log.biz_no / 批次 source，API.md 7 节 GrowthReason*） */
const GROWTH_LABEL: Record<string, string> = {
  signup_gift: t('新人红包'),
  task_first_canvas: t('新手任务'),
  task_first_video: t('新手任务'),
  task_first_work: t('新手任务'),
  task_first_invite: t('新手任务'),
  task_bind_wechat: t('新手任务'),
  checkin: t('每日签到'),
  checkin_streak: t('连续签到奖励'),
  checkin_month: t('满勤奖励'),
  invite_invitee: t('邀请奖励'),
  invite_inviter: t('邀请奖励'),
  invite_rebate: t('邀请返利'),
  bonus_code: t('口令红包'),
  bonus_recharge: t('首充加赠'),
}
const SOURCE_LABEL: Record<string, string> = {
  membership_grant: t('会员月发'),
  add_on: t('加购积分'),
  pack: t('积分包'),
  gift: t('赠送'),
  admin: t('运营调整'),
  refund: t('任务退回'),
  ...GROWTH_LABEL,
}

function growthLabel(bizNo: string) {
  const key = String(bizNo ?? '')
  if (GROWTH_LABEL[key])
    return GROWTH_LABEL[key]
  if (key.startsWith('task_'))
    return GROWTH_LABEL.task_first_canvas
  return ''
}
const LOG_LABEL: Record<PointsLog['type'], string> = {
  grant: t('到账'),
  freeze: t('生成扣减'),
  settle: t('结算'),
  unfreeze: t('退回'),
  expire: t('到期作废'),
  adjust: t('调整'),
}

function fmtDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtDateTime(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function daysLeft(ts: number) {
  return Math.max(0, Math.ceil((ts - Date.now() / 1000) / 86400))
}

/** 会员日提示（API.md 9.5）：当天在「充值积分」旁提醒积分包打折 */
const memberDayHint = computed(() => {
  if (!memberDayActive.value)
    return ''
  return t('今天是会员日，积分包 {rate} 折', discountParams(memberDay.value?.pack_discount ?? 1))
})

const lotsFailed = ref(false)

async function load() {
  loading.value = true
  lotsFailed.value = false
  try {
    const [, lotsRes] = await Promise.all([
      refresh(),
      billingApi.pointsLots(),
      reloadLogs(),
      loadTasks(),
      loadCheckin(),
      loadBillingCatalog(),
    ])
    if (lotsRes?.success && Array.isArray(lotsRes.data)) {
      lots.value = lotsRes.data
      lotsFailed.value = false
    }
    else if (!lots.value.length) {
      lotsFailed.value = true
    }
    if (walletTab.value === 'tasks')
      void reloadTaskItems()
  }
  catch {
    lotsFailed.value = lots.value.length === 0
  }
  finally {
    loading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeWallet()
}

function onMaskClick() {
  if (canDismiss.value)
    closeWallet()
}

function goPricing(tab: 'membership' | 'points') {
  closeWallet()
  gotoPricing(tab)
}

watch(walletOpen, (open) => {
  if (!import.meta.client)
    return
  document.body.style.overflow = open ? 'hidden' : ''
  canDismiss.value = false
  if (open) {
    window.setTimeout(() => { canDismiss.value = true }, 80)
    void load()
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(completedTimer)
  if (import.meta.client)
    document.body.style.overflow = ''
})
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div v-if="walletOpen" class="inbox-mask" @click.self="onMaskClick">
        <aside class="inbox-panel wallet-panel" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
          <header class="inbox-panel__head">
            <div>
              <h2 id="wallet-title">{{ isTeam ? t('团队积分') : t('积分钱包') }}</h2>
              <p>{{ isTeam ? t('团队空间里的生成从团队积分池扣，受你的月度额度限制') : t('积分按批次到期，生成时先扣最早到期的') }}</p>
            </div>
            <button type="button" class="inbox-panel__close" :aria-label="t('关闭')" @click="closeWallet">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </header>

          <nav class="wallet-tabs" role="tablist" :aria-label="t('积分钱包')">
            <button type="button" role="tab" :aria-selected="walletTab === 'overview'" :class="{ 'is-on': walletTab === 'overview' }" @click="selectTab('overview')">
              {{ t('概览') }}
            </button>
            <button type="button" role="tab" :aria-selected="walletTab === 'logs'" :class="{ 'is-on': walletTab === 'logs' }" @click="selectTab('logs')">
              {{ t('积分流水') }}
            </button>
            <button type="button" role="tab" :aria-selected="walletTab === 'tasks'" :class="{ 'is-on': walletTab === 'tasks' }" @click="selectTab('tasks')">
              {{ t('任务') }}
              <b v-if="activeCount" class="wallet-tabs__badge">{{ activeCount }}</b>
            </button>
          </nav>

          <div v-show="walletTab === 'overview'" class="wallet-panel__body">
            <button v-if="!isTeam && growthTasks && !tasksAllDone" type="button" class="wallet-tasks" @click="goTasks">
              <UIcon name="i-lucide-list-checks" class="size-4" />
              <span>{{ t('新手任务') }}</span>
              <b>{{ growthTasks.done }}/{{ growthTasks.tasks.length }}</b>
              <small>{{ growthTasks.earned_points.toLocaleString() }} / {{ growthTasks.total_points.toLocaleString() }} {{ t('积分') }}</small>
              <UIcon name="i-lucide-chevron-right" class="size-4 wallet-tasks__arrow" />
            </button>

            <section class="wallet-hero" :class="{ 'is-flash': completedTip }">
              <Transition name="wallet-done">
                <div v-if="completedTip" class="wallet-hero__done">
                  <UIcon name="i-lucide-party-popper" class="size-4" />
                  {{ t('任务完成 +{n} 积分', { n: completedTip.points }) }}
                </div>
              </Transition>
              <div class="wallet-hero__balance">
                <span>{{ isTeam ? t('团队可用积分') : t('可用积分') }}</span>
                <strong>{{ balance.toLocaleString() }}</strong>
                <small v-if="wallet?.frozen">{{ t('生成中占用') }} {{ wallet.frozen }}</small>
                <small v-if="wallet?.expiring_in_7d" class="is-warn">{{ t('7 天内到期') }} {{ wallet.expiring_in_7d }}</small>
                <small v-if="teamInfo">
                  {{ teamInfo.member_left === null
                    ? t('本月我已用 {used} 积分 · 不限额', { used: teamInfo.member_used })
                    : t('本月额度 {limit}，已用 {used}，剩 {left}', { limit: teamInfo.member_limit ?? 0, used: teamInfo.member_used, left: teamInfo.member_left }) }}
                </small>
              </div>
              <div class="wallet-hero__actions">
                <button type="button" class="plan-btn plan-btn--solid" @click="goPricing('points')">
                  {{ t('充值积分') }}
                </button>
                <button type="button" class="plan-btn plan-btn--ghost" @click="goPricing('membership')">
                  {{ isMember ? t('续费会员') : t('开通会员') }}
                </button>
                <small v-if="memberDayHint" class="wallet-hero__promo">
                  <UIcon name="i-lucide-gift" class="size-3.5" />
                  {{ memberDayHint }}
                </small>
              </div>
            </section>

            <p v-if="isTeam" class="wallet-card__empty">{{ t('签到、积分批次与会员在个人空间的钱包里查看。') }}</p>

            <section v-if="!isTeam" class="wallet-card wallet-checkin">
              <h3>
                {{ t('每日签到') }}
                <small v-if="checkin?.streak">{{ t('已连续 {n} 天', { n: checkin.streak }) }}</small>
              </h3>
              <ol class="wallet-checkin__strip" :aria-label="t('连续签到进度')">
                <li
                  v-for="cell in streakCells"
                  :key="cell.day"
                  :class="{ 'is-signed': cell.signed, 'is-today': cell.today, 'is-bonus': cell.bonus }"
                >
                  <span class="wallet-checkin__dot">
                    <UIcon v-if="cell.signed" name="i-lucide-check" class="size-3.5" />
                    <UIcon v-else-if="cell.bonus" name="i-lucide-gift" class="size-3.5" />
                  </span>
                  <span class="wallet-checkin__label">{{ cell.day }}</span>
                </li>
              </ol>
              <p class="wallet-checkin__meta">
                <span v-if="checkinPoints">{{ t('每日 +{n} 积分', { n: checkinPoints }) }}</span>
                <span v-if="streakBonus">{{ t('连续 7 天额外 +{n}', { n: streakBonus }) }}</span>
                <span v-if="monthSigned">{{ t('本月已签 {n} 天', { n: monthSigned }) }}</span>
              </p>
              <button type="button" class="plan-btn plan-btn--solid wallet-checkin__btn" :disabled="todayDone || checkinBusy" @click="onCheckin">
                {{ todayDone ? t('今日已签到') : t('签到') }}
              </button>
            </section>

            <section v-if="!isTeam" class="wallet-card">
              <h3>{{ t('account.payout.title') }}</h3>
              <p class="wallet-card__empty">{{ t('account.payout.walletHint') }}</p>
              <p class="wallet-card__actions">
                <NuxtLink :to="localePath({ path: '/settings', query: { tab: 'partner-program' } })" class="plan-btn plan-btn--ghost" @click="closeWallet">{{ t('account.payout.toPartner') }}</NuxtLink>
                <NuxtLink :to="localePath({ path: '/settings', query: { tab: 'creator' } })" class="plan-btn plan-btn--ghost" @click="closeWallet">{{ t('account.payout.toCreator') }}</NuxtLink>
              </p>
            </section>

            <section v-if="!isTeam" class="wallet-card">
              <h3>{{ t('会员') }}</h3>
              <template v-if="membership">
                <p class="wallet-card__main">
                  <strong>{{ t('{plan}会员', { plan: membership.plan_name }) }}</strong>
                  <span>{{ membership.edition === 'team' ? `${t('团队版')} · ${membership.seats} ${t('席')}` : t('创作版') }}</span>
                </p>
                <ul class="wallet-card__meta">
                  <li>{{ t('有效期至') }} {{ fmtDate(membership.expires_at) }}（{{ t('剩 {n} 天', { n: wallet?.membership_days ?? 0 }) }}）</li>
                  <li>{{ t('每月 {n} 积分，下次到账 {date}', { n: membership.monthly_points.toLocaleString(), date: fmtDate(membership.next_grant_at) }) }}</li>
                  <li>{{ t('模型与积分包按会员价结算') }}</li>
                </ul>
              </template>
              <p v-else class="wallet-card__empty">
                {{ t('还未开通会员。开通后每月到账积分，生成按会员价计费。') }}
              </p>
            </section>

            <section v-if="!isTeam" class="wallet-card">
              <h3>{{ t('积分批次') }} <small>{{ lots.length }}</small></h3>
              <p v-if="lotsFailed && !lots.length" class="wallet-card__empty">{{ t('加载失败，请稍后重试') }}</p>
              <p v-else-if="!loading && !lots.length" class="wallet-card__empty">{{ t('暂无可用积分') }}</p>
              <ul v-else class="wallet-list">
                <li v-for="lot in lots" :key="lot.id">
                  <span class="wallet-list__label">{{ SOURCE_LABEL[lot.source] ?? lot.source }}</span>
                  <span class="wallet-list__num">{{ lot.remaining.toLocaleString() }}<em>/ {{ lot.points.toLocaleString() }}</em></span>
                  <span class="wallet-list__sub" :class="{ 'is-warn': daysLeft(lot.expires_at) <= 7 }">
                    {{ fmtDate(lot.expires_at) }} {{ t('到期') }} · {{ t('剩 {n} 天', { n: daysLeft(lot.expires_at) }) }}
                  </span>
                </li>
              </ul>
            </section>

          </div>

          <div v-if="walletTab === 'logs'" class="wallet-panel__body wallet-panel__body--logs">
            <section class="wallet-card">
              <h3>{{ t('最近流水') }}</h3>
              <StudioPaging
                root=".wallet-panel__body--logs"
                grid-class="wallet-list"
                compact
                :loading="logsBusy"
                :error="logsFailed"
                :loading-more="logsLoadingMore"
                :has-more="logsHasMore"
                :count="logs.length"
:empty-title="teamLogsHidden ? t('团队积分流水仅团队管理员可见') : t('还没有积分变动')"
                :load-more="loadMoreLogs"
              >
                <template #skeleton>
                  <li v-for="n in 5" :key="n">
                    <USkeleton class="h-3.5 w-24" />
                    <USkeleton class="mt-1.5 h-3 w-40" />
                  </li>
                </template>
                <ul class="wallet-list">
                  <li
                    v-for="log in logs"
                    :key="log.id"
                    :class="{ 'is-link': log.biz_type === 'task' && log.biz_no }"
                    :role="log.biz_type === 'task' && log.biz_no ? 'button' : undefined"
                    :tabindex="log.biz_type === 'task' && log.biz_no ? 0 : undefined"
                    :title="log.biz_type === 'task' && log.biz_no ? t('查看对应任务') : undefined"
                    @click="log.biz_type === 'task' && log.biz_no && openTaskByNo(log.biz_no)"
                    @keydown.enter="log.biz_type === 'task' && log.biz_no && openTaskByNo(log.biz_no)"
                  >
                    <span class="wallet-list__label">{{ growthLabel(log.biz_no) || LOG_LABEL[log.type] || log.type }}</span>
                    <span class="wallet-list__num" :class="log.amount > 0 ? 'is-in' : 'is-out'">
                      {{ log.amount > 0 ? '+' : '' }}{{ log.amount.toLocaleString() }}
                    </span>
                    <span class="wallet-list__sub">{{ log.reason }} · {{ fmtDateTime(log.created_at) }}</span>
                  </li>
                </ul>
              </StudioPaging>
            </section>
          </div>

          <div v-if="walletTab === 'tasks'" class="wallet-panel__body wallet-panel__body--tasks">
            <section class="wallet-card">
              <h3>
                {{ t('生成任务') }}
                <small v-if="activeCount">{{ t('{n} 个任务生成中', { n: activeCount }) }}</small>
              </h3>
              <StudioPaging
                root=".wallet-panel__body--tasks"
                grid-class="wallet-list"
                compact
                :loading="tasksBusy"
                :error="tasksFailed"
                :loading-more="tasksLoadingMore"
                :has-more="tasksHasMore"
                :count="taskItems.length"
                :empty-title="t('还没有生成任务')"
                :load-more="loadMoreTaskItems"
              >
                <template #skeleton>
                  <li v-for="n in 5" :key="n">
                    <USkeleton class="h-3.5 w-24" />
                    <USkeleton class="mt-1.5 h-3 w-40" />
                  </li>
                </template>
                <ul class="wallet-list">
                  <li
                    v-for="task in taskItems"
                    :key="task.id"
                    class="is-link"
                    role="button"
                    tabindex="0"
                    @click="openTaskByNo(task.task_no)"
                    @keydown.enter="openTaskByNo(task.task_no)"
                  >
                    <span class="wallet-list__label">
                      {{ TASK_TYPE_LABEL[task.type] || task.type }} · {{ task.model }}
                    </span>
                    <span class="wallet-list__num" :class="task.status === 'succeeded' ? 'is-out' : ''">
                      <template v-if="taskPoints(task)">-{{ taskPoints(task).toLocaleString() }}</template>
                    </span>
                    <span class="wallet-list__sub">
                      <em class="wallet-task-status" :class="`is-${task.status}`">{{ TASK_STATUS_LABEL[task.status] || task.status }}</em>
                      {{ task.prompt.slice(0, 40) }} · {{ fmtDateTime(task.created_at) }}
                    </span>
                  </li>
                </ul>
              </StudioPaging>
              <button type="button" class="wallet-card__more" @click="openTaskByNo('')">
                {{ t('查看全部任务') }}
                <UIcon name="i-lucide-chevron-right" class="size-3.5" />
              </button>
            </section>
          </div>
        </aside>
      </div>
    </Teleport>
  </ClientOnly>
</template>
