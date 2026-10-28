/**
 * 归因与埋点（T2）：
 * - 首次进站读 utm_source / utm_medium / utm_campaign / ref（或 aff）/ code / pcode 写 cookie easytv_attr（首触不覆盖）
 * - 每次路由切换上报 page_view
 */
import { mergeAttribution } from '~/utils/attribution'
import { getAnonId, getDeviceId } from '~/utils/device-id'
import { useTrack } from '~/composables/useTrack'

function first(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw ?? '').trim()
}

export default defineNuxtPlugin({
  name: 'attribution',
  setup(nuxtApp) {
    // 尽早生成匿名 id 与设备指纹，首个请求就能带上 EasyTV-Device
    getAnonId()
    getDeviceId()

    const router = useRouter()
    const { track } = useTrack()

    function capture(query: Record<string, unknown>) {
      mergeAttribution({
        source: first(query.utm_source),
        medium: first(query.utm_medium),
        campaign: first(query.utm_campaign),
        ref: first(query.ref) || first(query.aff),
        code: first(query.code),
        pcode: first(query.pcode),
      })
    }

    capture(router.currentRoute.value.query as Record<string, unknown>)

    // 首次导航（afterEach）与挂载（app:mounted）都会经过这里，按路径去重只报一次
    let lastViewed = ''
    function view(path: string) {
      if (!path || path === lastViewed)
        return
      lastViewed = path
      track('page_view', { path })
    }

    nuxtApp.hook('app:mounted', () => view(router.currentRoute.value.fullPath))

    router.afterEach((to) => {
      // 邀请链接可能在站内二跳才带参数（如 /invite/:code → /register?ref=），每次导航都尝试补齐空字段
      capture(to.query as Record<string, unknown>)
      view(to.fullPath)
    })
  },
})
