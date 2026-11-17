export type CanvasLivePoint = { id: string, x: number, y: number }

export type CanvasLivePerson = {
  id: number
  name: string
  color: string
}

export type CanvasLiveHello = {
  op: 'hello'
  user: CanvasLivePerson
  peers: CanvasLivePerson[]
}

export type CanvasLiveJoin = {
  op: 'join'
  user: CanvasLivePerson
}

export type CanvasLiveLeave = {
  op: 'leave'
  id: number
}

export type CanvasLiveCursorMsg = {
  op: 'cursor'
  id: number
  x: number
  y: number
}

export type CanvasLiveNodesMsg = {
  op: 'nodes'
  id: number
  items: CanvasLivePoint[]
}

export type CanvasLiveSavedMsg = {
  op: 'saved'
  id: number
  version: number
}

export type CanvasLiveServerMessage =
  | CanvasLiveHello
  | CanvasLiveJoin
  | CanvasLiveLeave
  | CanvasLiveCursorMsg
  | CanvasLiveNodesMsg
  | CanvasLiveSavedMsg

const LIVE_COLORS = new Set(['#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#facc15'])

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function person(raw: unknown): CanvasLivePerson | null {
  if (!raw || typeof raw !== 'object')
    return null
  const item = raw as { id?: unknown, name?: unknown, color?: unknown }
  if (!finite(item.id) || item.id <= 0)
    return null
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, 20) : ''
  if (!name)
    return null
  const color = typeof item.color === 'string' && LIVE_COLORS.has(item.color) ? item.color : '#38bdf8'
  return { id: item.id, name, color }
}

function points(raw: unknown): CanvasLivePoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64)
    return null
  const items: CanvasLivePoint[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object')
      return null
    const item = entry as { id?: unknown, x?: unknown, y?: unknown }
    if (typeof item.id !== 'string' || !item.id || item.id.length > 40)
      return null
    if (!finite(item.x) || !finite(item.y) || Math.abs(item.x) >= 1e7 || Math.abs(item.y) >= 1e7)
      return null
    items.push({ id: item.id, x: item.x, y: item.y })
  }
  return items
}

export function parseCanvasLiveMessage(raw: unknown): CanvasLiveServerMessage | null {
  if (typeof raw !== 'string' || !raw)
    return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (!data || typeof data !== 'object')
    return null
  const msg = data as { op?: unknown, id?: unknown, x?: unknown, y?: unknown, version?: unknown, user?: unknown, peers?: unknown, items?: unknown }
  if (msg.op === 'hello') {
    const user = person(msg.user)
    if (!user || !Array.isArray(msg.peers))
      return null
    const peers: CanvasLivePerson[] = []
    for (const entry of msg.peers) {
      const peer = person(entry)
      if (peer && peer.id !== user.id)
        peers.push(peer)
    }
    return { op: 'hello', user, peers }
  }
  if (msg.op === 'join') {
    const user = person(msg.user)
    return user ? { op: 'join', user } : null
  }
  if (msg.op === 'leave')
    return finite(msg.id) && msg.id > 0 ? { op: 'leave', id: msg.id } : null
  if (msg.op === 'cursor') {
    if (!finite(msg.id) || msg.id <= 0 || !finite(msg.x) || !finite(msg.y))
      return null
    if (Math.abs(msg.x) >= 1e7 || Math.abs(msg.y) >= 1e7)
      return null
    return { op: 'cursor', id: msg.id, x: msg.x, y: msg.y }
  }
  if (msg.op === 'nodes') {
    const items = points(msg.items)
    if (!finite(msg.id) || msg.id <= 0 || !items)
      return null
    return { op: 'nodes', id: msg.id, items }
  }
  if (msg.op === 'saved')
    return finite(msg.id) && msg.id > 0 && finite(msg.version) && msg.version > 0 ? { op: 'saved', id: msg.id, version: msg.version } : null
  return null
}

/** 把 HTTP API 根地址换成这张画布的实时地址。令牌不放在地址里。 */
export function canvasLiveSocketUrl(apiBase: string, canvasId: number) {
  const base = apiBase.trim().replace(/\/$/, '')
  let ws = ''
  if (base.startsWith('https://'))
    ws = `wss://${base.slice('https://'.length)}`
  else if (base.startsWith('http://'))
    ws = `ws://${base.slice('http://'.length)}`
  else if (base.startsWith('wss://') || base.startsWith('ws://'))
    ws = base
  if (!ws || canvasId <= 0)
    return ''
  return `${ws}/user/canvas/${canvasId}/live`
}

/** 别人拖来的坐标。正在被自己拖的卡片、未知卡片、没动的卡片都不改。 */
export function canvasLivePositionUpdates(
  items: CanvasLivePoint[],
  current: CanvasLivePoint[],
  dragging: ReadonlySet<string>,
) {
  const byId = new Map(current.map(node => [node.id, node]))
  const updates: CanvasLivePoint[] = []
  for (const item of items) {
    if (dragging.has(item.id))
      continue
    const node = byId.get(item.id)
    if (!node || (node.x === item.x && node.y === item.y))
      continue
    updates.push(item)
  }
  return updates
}
