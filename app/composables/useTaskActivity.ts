import taskApi from '~/api/task'

/**
 * 进行中的生成任务数：顶栏积分钱包上的角标。任务收进了钱包，
 * 有任务在跑时要在入口上看得见。有进行中的任务时每 20 秒刷新一次，没有就不轮询。
 */
export function useTaskActivity() {
  const activeCount = useState('studio-task-active', () => 0)
  const { isLoggedIn } = useAuth()

  async function refreshActivity() {
    if (!import.meta.client || !isLoggedIn.value)
      return
    try {
      const res = await taskApi.summary()
      if (res?.success && res.data)
        activeCount.value = res.data.active
    }
    catch {}
  }

  return { activeCount, refreshActivity }
}

/** 顶栏挂载一次：登录后拉取，有进行中任务时轮询 */
export function useTaskActivityPolling() {
  const { activeCount, refreshActivity } = useTaskActivity()
  const { isLoggedIn } = useAuth()
  let timer: number | undefined

  function schedule() {
    window.clearTimeout(timer)
    if (!isLoggedIn.value || activeCount.value <= 0)
      return
    timer = window.setTimeout(async () => {
      if (document.visibilityState === 'visible')
        await refreshActivity()
      schedule()
    }, 20000)
  }

  onMounted(async () => {
    await refreshActivity()
    schedule()
  })
  watch(activeCount, schedule)
  watch(isLoggedIn, async (on) => {
    if (on)
      await refreshActivity()
    else
      activeCount.value = 0
    schedule()
  })
  onBeforeUnmount(() => window.clearTimeout(timer))
}
