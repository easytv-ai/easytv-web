import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { pathWithoutLocale } from '~/utils/app-path'

type RouteLike = Pick<RouteLocationNormalizedLoaded, 'path' | 'query' | 'hash'>

export function isConsoleAccessPath(path: string): boolean {
  const base = pathWithoutLocale(path)
  return base.startsWith('/console') || base === '/setting' || base.startsWith('/setting/')
}

/** 从路由 query 读取 ticket */
export function readConsoleAccessTicket(route?: RouteLike): string {
  return String(route?.query?.ticket ?? '').trim()
}

export async function clearConsoleAccessTicketFromRoute(route: RouteLike) {
  if (!readConsoleAccessTicket(route))
    return
  const query = { ...route.query } as Record<string, string | undefined>
  delete query.ticket
  await navigateTo({
    path: route.path,
    query,
    hash: route.hash,
  }, { replace: true })
}

export function consoleRootPath(path: string): boolean {
  return pathWithoutLocale(path) === '/console'
}

export function useConsoleAccessTicket() {
  const processing = useState('console-access-ticket-processing', () => false)
  const handledKey = useState('console-access-ticket-handled-key', () => '')
  const { tryExchangeConsoleAccessTicket } = useAuth()

  async function exchangeFromRoute(
    route: RouteLike,
  ): Promise<{ ok: true } | { ok: false, message?: string, skipped?: boolean }> {
    const ticket = readConsoleAccessTicket(route)
    if (!ticket)
      return { ok: false, skipped: true }

    const key = ticket
    if (key === handledKey.value || processing.value)
      return { ok: false, skipped: true }

    processing.value = true
    handledKey.value = key
    try {
      const res = await tryExchangeConsoleAccessTicket(ticket)
      if (!res.ok)
        return res

      await clearConsoleAccessTicketFromRoute(route)
      return { ok: true }
    }
    finally {
      processing.value = false
    }
  }

  return {
    processing,
    exchangeFromRoute,
    readConsoleAccessTicket,
  }
}
