/**
 * 新手跟练的两道闸（跟练标着「不扣点」，这里保证它真的不扣、也不写真实数据）。
 */

type AnyFn = (...args: any[]) => any

/**
 * 把接口对象里会「真建任务 / 真写会话」的方法包一层：跟练期间不发请求，直接回一个失败结果。
 * paths 用点号写嵌套方法（如 'chat.create'）。没列出的方法（查询、取消）原样放行。
 * 对话栏里创建任务的路径很多（普通提问、剧本流水线、结合画布…），在接口这一层拦才不会漏。
 */
export function guardPracticeWrites<T extends object>(api: T, paths: string[], blocked: () => boolean, message: () => string): T {
  const wrap = (target: any, prefix: string): any => {
    const out: any = Object.create(Object.getPrototypeOf(target))
    for (const key of Object.keys(target)) {
      const path = prefix ? `${prefix}.${key}` : key
      const value = target[key]
      if (typeof value === 'function' && paths.includes(path)) {
        out[key] = (...args: unknown[]) => blocked()
          ? Promise.resolve({ success: false, message: message(), data: null })
          : (value as AnyFn).apply(target, args)
      }
      else if (value && typeof value === 'object' && !Array.isArray(value) && paths.some(item => item.startsWith(`${path}.`))) {
        out[key] = wrap(value, path)
      }
      else {
        out[key] = value
      }
    }
    return out
  }
  return wrap(api, '') as T
}

/**
 * 画布外入口（账号菜单 / 帮助弹窗 / ?practice=）置位的「想开跟练」请求，只消费一次。
 * 先复位再启动：只读 / 锁定画布把 start 拒了也不留下置位——否则再点没反应（值没变，监听不触发），
 * 进下一张画布时 immediate 监听还会自己把跟练开起来。
 */
export function consumePracticeRequest(
  wanted: { value: boolean },
  /** 取走菜单里预选的剧本 id（取完由调用方清掉预选） */
  takeScript: () => string,
  start: (scriptId: string) => void,
) {
  if (!wanted.value)
    return false
  const scriptId = takeScript()
  wanted.value = false
  start(scriptId)
  return true
}
