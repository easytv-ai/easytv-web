import { CANVAS_NODE_ITEMS } from '~/utils/canvas-node-kinds'

export type CanvasFindItem = {
  id: string
  label: string
  kind: string
  /** 已翻译的类型名，列表展示和检索都用它 */
  kindLabel?: string
  prompt: string
}

/** 和节点卡片同一套类型文案 */
export function findKindLabel(kind: string, tr: (key: string) => string = key => key) {
  if (kind === 'group')
    return tr('组')
  const item = CANVAS_NODE_ITEMS.find(entry => entry.kind === kind)
  return item ? tr(item.label) : kind
}

/** 按名称 / 类型 / 提示词 / id 过滤，最多 20 条 */
export function filterFindableNodes(list: CanvasFindItem[], query: string): CanvasFindItem[] {
  const q = query.trim().toLowerCase()
  const pool = q
    ? list.filter((item) => {
      return item.label.toLowerCase().includes(q)
        || item.kind.toLowerCase().includes(q)
        || (item.kindLabel || '').toLowerCase().includes(q)
        || item.prompt.toLowerCase().includes(q)
        || item.id.toLowerCase().includes(q)
    })
    : list
  return pool.slice(0, 20)
}

/** 在当前命中列表里按 delta 走一格，没有当前项时从两端进 */
export function stepFindableIndex(hits: Array<{ id: string }>, currentId: string | undefined, delta: number): number {
  if (!hits.length)
    return -1
  const idx = hits.findIndex(item => item.id === currentId)
  const from = idx >= 0 ? idx : (delta > 0 ? -1 : 0)
  const next = (from + delta + hits.length * 10) % hits.length
  return next
}
