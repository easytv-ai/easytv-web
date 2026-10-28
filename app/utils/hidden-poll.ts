/**
 * 页签藏起来时不打接口。重新可见时立刻再查一次，不必干等到下一个间隔。
 */
export function pageHidden() {
  return typeof document !== 'undefined' && document.hidden
}

export function startHiddenAwarePoll(
  run: () => void | Promise<void>,
  ms: number,
  isHidden: () => boolean = pageHidden,
) {
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const tick = () => {
    if (stopped || isHidden())
      return
    void run()
  }

  const onChange = () => {
    if (!isHidden())
      tick()
  }

  timer = setInterval(tick, ms)
  const target = typeof document === 'undefined' ? null : document
  target?.addEventListener('visibilitychange', onChange)

  return () => {
    stopped = true
    if (timer)
      clearInterval(timer)
    timer = null
    target?.removeEventListener('visibilitychange', onChange)
  }
}
