/**
 * 已下线的 /console、/setting 以及登录 ticket 兑换。
 * 旧地址统一进工作室；未登录先去登录页。
 */
import {
  clearConsoleAccessTicketFromRoute,
  isConsoleAccessPath,
  readConsoleAccessTicket,
  useConsoleAccessTicket,
} from '~/composables/useConsoleAccessTicket'
import { pathWithoutLocale } from '~/utils/app-path'
import { buildLoginRedirectQuery } from '~/utils/auth-login-redirect'

function isRetiredConsolePath(path: string): boolean {
  const base = pathWithoutLocale(path)
  return base.startsWith('/console') || base === '/setting' || base.startsWith('/setting/')
}

function stripTicketFromFullPath(fullPath: string): string {
  const [pathAndQuery = '', hash = ''] = fullPath.split('#')
  const [pathname = '', search = ''] = pathAndQuery.split('?')
  if (!search)
    return fullPath
  const params = new URLSearchParams(search)
  params.delete('ticket')
  const nextSearch = params.toString()
  const nextPath = nextSearch ? `${pathname}?${nextSearch}` : pathname
  return hash ? `${nextPath}#${hash}` : nextPath
}

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server)
    return

  if (!isConsoleAccessPath(to.path))
    return

  const localePath = useLocalePath()
  const { user, hydrate } = useAuth()
  const { exchangeFromRoute, processing } = useConsoleAccessTicket()
  hydrate()

  const ticket = readConsoleAccessTicket(to)

  if (ticket || processing.value) {
    const res = await exchangeFromRoute(to)
    hydrate()

    if (res.ok) {
      if (isRetiredConsolePath(to.path))
        return navigateTo(localePath('/studio'), { replace: true })
      return
    }

    if (res.skipped && user.value) {
      if (ticket)
        await clearConsoleAccessTicketFromRoute(to)
      if (isRetiredConsolePath(to.path))
        return navigateTo(localePath('/studio'), { replace: true })
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
      const redirectPath = stripTicketFromFullPath(to.fullPath) || '/'
      return navigateTo(localePath({
        path: '/login',
        query: buildLoginRedirectQuery(redirectPath),
      }), { replace: true })
    }
  }

  if (user.value) {
    if (isRetiredConsolePath(to.path))
      return navigateTo(localePath('/studio'), { replace: true })
    return
  }

  return navigateTo(localePath({
    path: '/login',
    query: buildLoginRedirectQuery(to.fullPath),
  }))
})
