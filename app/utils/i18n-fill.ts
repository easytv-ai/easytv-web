/**
 * t() 在 locale HMR / 预编译失效时会把 {name} 原样吐出来。
 * 先走一遍官方插值，再把剩下的槽位填上。
 */
export function fillI18n(message: string, vars: Record<string, string | number>) {
  const extra: Record<string, string | number> = { ...vars }
  if (extra.cap != null && extra.capper == null)
    extra.capper = extra.cap

  return String(message ?? '').replace(/\{(\w+)\}/g, (all, key: string) => {
    if (Object.prototype.hasOwnProperty.call(extra, key))
      return String(extra[key])
    return all
  })
}
