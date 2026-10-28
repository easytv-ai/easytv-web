/**
 * 发版后旧页面还会去请求已删除的 /_nuxt/*.js，动态 import 失败会变成 Nuxt 500。
 * 整页刷新一次拿到新 HTML；同一标签只自动刷一次，避免坏包死循环。
 */
import { isStaleChunkError } from '~/utils/stale-chunk'

const FLAG = 'easytv-stale-chunk-reload'

export default defineNuxtPlugin({
  name: 'stale-chunk-reload',
  setup(nuxtApp) {
    const reloadOnce = () => {
      try {
        if (sessionStorage.getItem(FLAG) === '1')
          return
        sessionStorage.setItem(FLAG, '1')
      }
      catch {
        // 隐私模式写不了 sessionStorage 时仍刷新一次
      }
      reloadNuxtApp({ persistState: false })
    }

    nuxtApp.hook('app:mounted', () => {
      try {
        sessionStorage.removeItem(FLAG)
      }
      catch {}
    })

    nuxtApp.hook('app:chunkError', () => {
      reloadOnce()
    })
    nuxtApp.hook('app:error', (err) => {
      if (isStaleChunkError(err))
        reloadOnce()
    })

    window.addEventListener('vite:preloadError', (event) => {
      event.preventDefault()
      reloadOnce()
    })
  },
})
