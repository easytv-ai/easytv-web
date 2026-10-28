import growthApi from '~/api/growth'
import type { CheckinResult, CheckinStatus, GrowthTasks } from '~/types/creative'
import { withoutHiddenGrowthTasks } from '~/utils/growth-tasks'

/** 任务刚完成时的提示（钱包面板 / 首页任务卡） */
export type GrowthCompleted = { title: string, points: number, at: number }

/**
 * 新手任务 + 签到的共享状态（API.md 7.3）：首页任务卡、钱包面板、顶栏红点共用。
 * 只在登录态下请求；loadTasks 会对比上次完成数，新完成的任务写到 lastCompleted 供 UI 做提示。
 */
export function useGrowth() {
  const tasks = useState<GrowthTasks | null>('growth-tasks', () => null)
  const checkin = useState<CheckinStatus | null>('growth-checkin', () => null)
  const tasksLoading = useState('growth-tasks-loading', () => false)
  const checkinLoading = useState('growth-checkin-loading', () => false)
  const checkinBusy = useState('growth-checkin-busy', () => false)
  const lastCompleted = useState<GrowthCompleted | null>('growth-last-completed', () => null)
  const { isLoggedIn } = useAuth()
  const { refresh: refreshWallet } = useWallet()
  const { track } = useTrack()
  // useI18n / useToast 只能在 setup 里取，先拿好给事件回调里的 checkinWithToast 用
  const { t } = useI18n()
  const toast = useToast()

  const allDone = computed(() => Boolean(tasks.value && tasks.value.tasks.length > 0 && tasks.value.done >= tasks.value.tasks.length))
  const todayDone = computed(() => checkin.value?.today_done === true)
  /** 已登录且已拿到状态、今日未签：顶栏红点 */
  const checkinPending = computed(() => isLoggedIn.value && checkin.value !== null && !todayDone.value)

  function reset() {
    tasks.value = null
    checkin.value = null
  }

  async function loadTasks() {
    if (!import.meta.client || tasksLoading.value)
      return
    if (!isLoggedIn.value) {
      reset()
      return
    }
    tasksLoading.value = true
    try {
      const res = await growthApi.tasks()
      if (!res?.success || !res.data)
        return
      const next = withoutHiddenGrowthTasks(res.data)
      const prev = tasks.value
      if (prev && next.done > prev.done) {
        const doneKeys = new Set(prev.tasks.filter(item => item.status === 1).map(item => item.key))
        const fresh = next.tasks.filter(item => item.status === 1 && !doneKeys.has(item.key))
        if (fresh.length) {
          lastCompleted.value = {
            title: fresh.map(item => item.title).join(' / '),
            points: fresh.reduce((sum, item) => sum + (Number(item.points) || 0), 0),
            at: Date.now(),
          }
        }
      }
      tasks.value = next
    }
    finally {
      tasksLoading.value = false
    }
  }

  /** 签到状态；默认每次会话只拉一次（顶栏红点），force=true 强制刷新 */
  async function loadCheckin(force = false) {
    if (!import.meta.client || checkinLoading.value)
      return
    if (!isLoggedIn.value) {
      reset()
      return
    }
    if (checkin.value && !force)
      return
    checkinLoading.value = true
    try {
      const res = await growthApi.checkinStatus()
      if (res?.success && res.data)
        checkin.value = { ...res.data, month_days: Array.isArray(res.data.month_days) ? res.data.month_days : [] }
    }
    finally {
      checkinLoading.value = false
    }
  }

  /** 签到：先上报 checkin_click，成功后就地更新状态并刷新钱包余额 */
  async function doCheckin(): Promise<{ ok: boolean, message?: string, data?: CheckinResult }> {
    if (!import.meta.client || checkinBusy.value || !isLoggedIn.value)
      return { ok: false }
    track('checkin_click')
    checkinBusy.value = true
    try {
      const res = await growthApi.checkin()
      if (!res?.success || !res.data)
        return { ok: false, message: res?.message }
      const data = res.data
      const today = new Date().getDate()
      const cur = checkin.value
      const monthDays = cur ? [...cur.month_days] : []
      if (!monthDays.includes(today))
        monthDays.push(today)
      checkin.value = {
        today_done: true,
        streak: data.streak || cur?.streak || 0,
        month_days: monthDays,
        next_bonus_in: Math.max(0, (cur?.next_bonus_in ?? 1) - 1),
        points_today: cur?.points_today ?? data.points,
        streak_bonus: cur?.streak_bonus ?? 0,
        month_bonus: cur?.month_bonus ?? 0,
        valid_days: cur?.valid_days ?? 0,
        is_member: cur?.is_member ?? false,
      }
      if (!data.already) {
        void refreshWallet()
        void loadCheckin(true)
      }
      return { ok: true, data }
    }
    finally {
      checkinBusy.value = false
    }
  }

  /** 各入口共用：签到并用 toast 反馈结果（+积分 / 连续奖励 / 今日已签到） */
  async function checkinWithToast() {
    const res = await doCheckin()
    const show = (title: string, color: 'neutral' | 'error' | 'success' = 'neutral', description?: string) =>
      toast.add({ title, description, color, close: false, progress: false, orientation: 'horizontal' })
    if (!res.ok) {
      if (res.message)
        show(res.message, 'error')
      return res
    }
    const data = res.data!
    if (data.already) {
      show(t('今日已签到'))
      return res
    }
    const days = checkin.value?.valid_days || 0
    const bonus = data.bonus_points > 0 ? t('连续签到奖励 +{n} 积分', { n: data.bonus_points }) : undefined
    show(days ? t('+{n} 积分，{d} 天内有效', { n: data.points, d: days }) : t('+{n} 积分', { n: data.points }), 'success', bonus)
    return res
  }

  return {
    tasks,
    checkin,
    tasksLoading,
    checkinLoading,
    checkinBusy,
    lastCompleted,
    allDone,
    todayDone,
    checkinPending,
    loadTasks,
    loadCheckin,
    doCheckin,
    checkinWithToast,
    reset,
  }
}
