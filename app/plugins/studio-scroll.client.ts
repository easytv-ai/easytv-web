/**
 * 创作台列表页滚动位置记忆。
 * 内容区 .studio-content 自己滚动，浏览器和 Nuxt 的 scrollBehavior 管不到它；
 * 离开页面时记下 scrollTop，再回到同一地址时恢复（列表页已 keepalive，数据还在），首次访问回到顶部。
 */
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const positions = new Map<string, number>()
  let restoreTo = 0

  function scroller() {
    return document.querySelector<HTMLElement>('.studio-content')
  }

  router.beforeEach((to, from) => {
    const el = scroller()
    if (el && from.fullPath)
      positions.set(from.fullPath, el.scrollTop)
    restoreTo = positions.get(to.fullPath) ?? 0
  })

  // page:finish 时 keepalive 的列表可能还没重新挂回、图片还没占位，内容高度不够会被浏览器截短；
  // 逐帧重试直到能滚到目标位置，最多约一秒。
  let attempt = 0
  function restore(top: number) {
    const token = ++attempt
    let frames = 0
    const tick = () => {
      if (token !== attempt)
        return
      const el = scroller()
      if (el) {
        el.scrollTop = top
        if (top === 0 || el.scrollHeight - el.clientHeight >= top - 1)
          return
      }
      if (++frames < 60)
        requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  nuxtApp.hook('page:finish', () => {
    restore(restoreTo)
  })
})
