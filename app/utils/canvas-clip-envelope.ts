import type { CanvasClipEdge, CanvasClipItem } from '~/composables/useCanvasClipboard'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'

/** 系统剪贴板 / localStorage 里的画布复制信封（API.md 36）。后端不解释，纯前端约定。 */
export const CLIP_APP = 'easytv-canvas'
export const CLIP_STORAGE_KEY = 'easytv-canvas-clip'
export const CLIP_VERSION = 1
/** 超过这个体积的文本不当信封解析，免得把整段大文本 JSON.parse 一遍 */
export const CLIP_MAX_BYTES = 2 * 1024 * 1024

export type CanvasClipEnvelope = {
  app: typeof CLIP_APP
  v: typeof CLIP_VERSION
  /** 复制时刻 unix ms，多来源取最新 */
  at: number
  canvas_id: number
  team_id: number
  items: CanvasClipItem[]
  edges: CanvasClipEdge[]
  incoming: CanvasClipEdge[]
}

export function encodeClipEnvelope(input: {
  canvasId: number
  teamId: number
  items: CanvasClipItem[]
  edges: CanvasClipEdge[]
  incoming: CanvasClipEdge[]
  at?: number
}): string {
  const envelope: CanvasClipEnvelope = {
    app: CLIP_APP,
    v: CLIP_VERSION,
    at: input.at ?? Date.now(),
    canvas_id: Number(input.canvasId) || 0,
    team_id: Number(input.teamId) || 0,
    items: input.items,
    edges: input.edges,
    incoming: input.incoming,
  }
  return JSON.stringify(envelope)
}

function isEdge(value: unknown): value is CanvasClipEdge {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as CanvasClipEdge).source === 'string'
    && typeof (value as CanvasClipEdge).target === 'string'
}

function isItem(value: unknown): value is CanvasClipItem {
  if (!value || typeof value !== 'object')
    return false
  const item = value as CanvasClipItem
  return typeof item.id === 'string'
    && typeof item.kind === 'string'
    && typeof item.x === 'number'
    && typeof item.y === 'number'
    && Boolean(item.data) && typeof item.data === 'object'
}

/** 严格解析：不是我们的信封、版本不对、items 不是数组、体积过大都返回 null。 */
export function parseClipEnvelope(text: unknown): CanvasClipEnvelope | null {
  if (typeof text !== 'string')
    return null
  const raw = text.trim()
  if (!raw || raw.length > CLIP_MAX_BYTES || raw[0] !== '{')
    return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null
  const obj = parsed as Record<string, unknown>
  if (obj.app !== CLIP_APP || obj.v !== CLIP_VERSION || !Array.isArray(obj.items))
    return null
  const items = obj.items.filter(isItem)
  if (!items.length)
    return null
  const edges = Array.isArray(obj.edges) ? obj.edges.filter(isEdge) : []
  const incoming = Array.isArray(obj.incoming) ? obj.incoming.filter(isEdge) : []
  return {
    app: CLIP_APP,
    v: CLIP_VERSION,
    at: typeof obj.at === 'number' && Number.isFinite(obj.at) ? obj.at : 0,
    canvas_id: typeof obj.canvas_id === 'number' ? obj.canvas_id : Number(obj.canvas_id) || 0,
    team_id: typeof obj.team_id === 'number' ? obj.team_id : Number(obj.team_id) || 0,
    items,
    edges,
    incoming,
  }
}

/** 多个来源（页面内存 / localStorage / 系统剪贴板）里取 at 最大的一份；相同 at 取先出现的。 */
export function newestEnvelope(candidates: Array<CanvasClipEnvelope | null | undefined>): CanvasClipEnvelope | null {
  let best: CanvasClipEnvelope | null = null
  for (const candidate of candidates) {
    if (!candidate?.items?.length)
      continue
    if (!best || candidate.at > best.at)
      best = candidate
  }
  return best
}

function isAssetIdKey(key: string) {
  return key === 'assetId' || key.endsWith('AssetId')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function walkAssetIds(value: unknown, out: Set<number>) {
  if (Array.isArray(value)) {
    for (const entry of value)
      walkAssetIds(entry, out)
    return
  }
  if (!isPlainObject(value))
    return
  for (const [key, entry] of Object.entries(value)) {
    if (isAssetIdKey(key)) {
      const id = Number(entry)
      if (Number.isInteger(id) && id > 0)
        out.add(id)
      continue
    }
    walkAssetIds(entry, out)
  }
}

/** 收集节点数据里所有资产 id（`assetId` 与任何 `*AssetId`，递归含 `refItems[]`），去重、只留正整数。`subjectIds` 不是资产，不收。 */
export function collectClipAssetIds(items: Array<{ data: unknown }>): number[] {
  const out = new Set<number>()
  for (const item of items)
    walkAssetIds(item?.data, out)
  return [...out]
}

function remapValue(value: unknown, map: Map<number, number>, missing: Set<number>): unknown {
  if (Array.isArray(value))
    return value.map(entry => remapValue(entry, map, missing))
  if (!isPlainObject(value))
    return value
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isAssetIdKey(key)) {
      const id = Number(entry)
      if (Number.isInteger(id) && id > 0) {
        if (missing.has(id))
          continue
        const to = map.get(id)
        next[key] = to && to > 0 ? to : entry
        continue
      }
      next[key] = entry
      continue
    }
    next[key] = remapValue(entry, map, missing)
  }
  return next
}

/**
 * 按素材引入结果改写节点数据：`map` 里的 id 改指向新 id；`missing` 里的把 id 键删掉，
 * 地址（url / content）原样保留，走既有「参考素材不在你的资产库里」的提示路径。返回新对象。
 */
export function remapClipAssetIds<T extends CanvasNodeData | Record<string, unknown>>(
  data: T,
  map: Map<number, number>,
  missing: Set<number>,
): T {
  return remapValue(data, map, missing) as T
}
