import { getAccessToken, getUserId } from '~/utils/auth-user'
import { canvasLiveSocketUrl, parseCanvasLiveMessage, type CanvasLivePerson } from '~/utils/canvas-live-collab'

export type CanvasLivePeer = CanvasLivePerson & {
  x: number
  y: number
  at: number
  seen: boolean
}

/**
 * 同一张画布上的在线光标和卡片拖动。
 * 令牌放在升级后的第一帧，不放进地址。
 */
export function useCanvasCollab(opts: {
  canvasId: () => number
  enabled: () => boolean
  onNodes: (items: { id: string, x: number, y: number }[]) => void
  onSaved: (version: number) => void
}) {
  const peers = ref<CanvasLivePeer[]>([])
  const clock = ref(Date.now())
  let session = 0
  let retry = 0
  let ready = false
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let clockTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  function clearTimers() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function shutdown() {
    session += 1
    ready = false
    clearTimers()
    const current = socket
    socket = null
    if (current && current.readyState < WebSocket.CLOSING)
      current.close()
    peers.value = []
  }

  function upsert(person: CanvasLivePerson) {
    const found = peers.value.find(item => item.id === person.id)
    if (found) {
      found.name = person.name
      found.color = person.color
      return
    }
    peers.value.push({ ...person, x: 0, y: 0, at: 0, seen: false })
  }

  function send(payload: unknown) {
    if (!ready || !socket || socket.readyState !== WebSocket.OPEN)
      return
    socket.send(JSON.stringify(payload))
  }

  function open() {
    if (!import.meta.client || stopped)
      return
    const canvasId = opts.canvasId()
    const token = getAccessToken()
    const uid = Number(getUserId())
    const base = String(useRuntimeConfig().public.apiBaseUrl || '')
    const url = canvasLiveSocketUrl(base, canvasId)
    if (!url || !token || !Number.isFinite(uid) || uid <= 0 || !opts.enabled())
      return
    const mine = session
    const ws = new WebSocket(url)
    socket = ws
    ws.onopen = () => {
      if (mine !== session)
        return
      ws.send(JSON.stringify({ op: 'auth', token, uid }))
      pingTimer = setInterval(() => {
        if (mine !== session || ws.readyState !== WebSocket.OPEN)
          return
        ws.send('{"op":"ping"}')
      }, 20000)
    }
    ws.onmessage = (event) => {
      if (mine !== session || typeof event.data !== 'string')
        return
      const msg = parseCanvasLiveMessage(event.data)
      if (!msg)
        return
      if (msg.op === 'hello') {
        retry = 0
        ready = true
        peers.value = msg.peers.map((person) => {
          const placed = person.x != null && person.y != null
          return {
            id: person.id,
            name: person.name,
            color: person.color,
            x: person.x ?? 0,
            y: person.y ?? 0,
            at: placed ? Date.now() : 0,
            seen: placed,
          }
        })
        return
      }
      if (msg.op === 'join') {
        upsert(msg.user)
        return
      }
      if (msg.op === 'leave') {
        peers.value = peers.value.filter(item => item.id !== msg.id)
        return
      }
      if (msg.op === 'cursor') {
        let peer = peers.value.find(item => item.id === msg.id)
        if (!peer) {
          peers.value.push({
            id: msg.id,
            name: msg.name || String(msg.id),
            color: msg.color,
            x: msg.x,
            y: msg.y,
            at: Date.now(),
            seen: true,
          })
          return
        }
        if (msg.name)
          peer.name = msg.name
        peer.color = msg.color
        peer.x = msg.x
        peer.y = msg.y
        peer.at = Date.now()
        peer.seen = true
        return
      }
      if (msg.op === 'nodes') {
        opts.onNodes(msg.items)
        return
      }
      opts.onSaved(msg.version)
    }
    ws.onclose = () => {
      if (mine !== session)
        return
      socket = null
      clearTimers()
      peers.value = []
      retry += 1
      if (stopped || retry > 8 || !opts.enabled())
        return
      const wait = Math.min(8000, Math.round(1500 * 1.5 ** (retry - 1)))
      reconnectTimer = setTimeout(() => {
        if (mine === session)
          open()
      }, wait)
    }
  }

  function reconnect() {
    retry = 0
    shutdown()
    if (stopped || !import.meta.client || !opts.enabled() || opts.canvasId() <= 0)
      return
    open()
  }

  watch(() => [opts.canvasId(), opts.enabled()] as const, () => reconnect(), { immediate: true })

  onMounted(() => {
    clockTimer = setInterval(() => {
      clock.value = Date.now()
    }, 2000)
  })
  onScopeDispose(() => {
    stopped = true
    shutdown()
    if (clockTimer)
      clearInterval(clockTimer)
  })

  return {
    peers,
    clock,
    sendCursor(x: number, y: number) {
      if (!Number.isFinite(x) || !Number.isFinite(y))
        return
      send({ op: 'cursor', x, y })
    },
    sendNodes(items: { id: string, x: number, y: number }[]) {
      if (!items.length)
        return
      send({ op: 'nodes', items })
    },
  }
}
