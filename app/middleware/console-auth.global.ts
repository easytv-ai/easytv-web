/**
 * 已下线的 /console、/setting 以及登录 ticket 兑换。
 * 旧地址统一进首页；未登录则弹出登录框。
 */
import {
  clearConsoleAccessTicketFromRoute,
  isConsoleAccessPath,
  readConsoleAccessTicket,
  useConsoleAccessTicket,
} from '~/composables/useConsoleAccessTicket'
import { pathWithoutLocale } from '~/utils/app-path'

function isRetiredConsolePath(path: string): boolean {
  const base = pathWithoutLocale(path)
  return base.startsWith('/console') || base === '/setting' || base.startsWith('/setting/')
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server)
    return

  if (!isConsoleAccessPath(to.path))
    return

  const localePath = useLocalePath()
  const { openLogin } = useLoginModal()
  const { user, hydrate } = useAuth()
  const { exchangeFromRoute, processing } = useConsoleAccessTicket()
  hydrate()

  const ticket = readConsoleAccessTicket(to)

  if (ticket || processing.value) {
    const res = await exchangeFromRoute(to)
    hydrate()

    if (res.ok) {
      if (isRetiredConsolePath(to.path))
        return navigateTo(localePath('/agent'), { replace: true })
      return
    }

    if (res.skipped && user.value) {
      if (ticket)
        await clearConsoleAccessTicketFromRoute(to)
      if (isRetiredConsolePath(to.path))
        return navigateTo(localePath('/agent'), { replace: true })
      return
    }

    if (res.skipped)
      return

    if (res.message) {
      const toast = useToast()
      toast.add({
        title: res.message,
        color: 'error',
      })
      openLogin({ redirect: '/agent' })
      return navigateTo(localePath('/agent'), { replace: true })
    }
  }

  if (user.value) {
    if (isRetiredConsolePath(to.path))
      return navigateTo(localePath('/agent'), { replace: true })
    return
  }

  openLogin({ redirect: '/agent' })
  return navigateTo(localePath('/agent'), { replace: true })
})
