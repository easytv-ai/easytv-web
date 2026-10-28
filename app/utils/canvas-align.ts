/** 拖动节点时，跟其他节点的边、中线对齐并吸住 */

export type AlignBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export type AlignGuide = {
  /** v 竖线，h 横线 */
  dir: 'v' | 'h'
  at: number
  from: number
  to: number
}

const EPS = 0.5

function anchors(box: AlignBox, axis: 'x' | 'y') {
  if (axis === 'x')
    return [box.x, box.x + box.w / 2, box.x + box.w]
  return [box.y, box.y + box.h / 2, box.y + box.h]
}

function crossSpan(box: AlignBox, axis: 'x' | 'y') {
  if (axis === 'x')
    return { from: box.y, to: box.y + box.h }
  return { from: box.x, to: box.x + box.w }
}

function mergeGuides(guides: AlignGuide[]) {
  const out: AlignGuide[] = []
  for (const guide of guides) {
    const found = out.find(item => item.dir === guide.dir && Math.abs(item.at - guide.at) < EPS)
    if (!found) {
      out.push({ ...guide })
      continue
    }
    found.from = Math.min(found.from, guide.from)
    found.to = Math.max(found.to, guide.to)
  }
  return out
}

function snapAxis(moving: AlignBox, others: AlignBox[], axis: 'x' | 'y', threshold: number) {
  let best = Number.POSITIVE_INFINITY
  let delta = 0
  const hits: Array<{ at: number, from: number, to: number }> = []
  const mine = anchors(moving, axis)
  for (const other of others) {
    if (other.id === moving.id || other.w <= 0 || other.h <= 0)
      continue
    const theirs = anchors(other, axis)
    for (const from of mine) {
      for (const to of theirs) {
        const next = to - from
        const dist = Math.abs(next)
        if (dist > threshold)
          continue
        if (dist < best - 0.01) {
          best = dist
          delta = next
          hits.length = 0
        }
        if (Math.abs(dist - best) > 0.01)
          continue
        const spanA = crossSpan(moving, axis)
        const spanB = crossSpan(other, axis)
        hits.push({
          at: to,
          from: Math.min(spanA.from, spanB.from),
          to: Math.max(spanA.to, spanB.to),
        })
      }
    }
  }
  const dir = axis === 'x' ? 'v' : 'h'
  return {
    delta: Number.isFinite(best) ? delta : 0,
    guides: mergeGuides(hits.map(hit => ({ dir, at: hit.at, from: hit.from, to: hit.to }))),
  }
}

export type NodeAlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type NodeDistributeAxis = 'horizontal' | 'vertical'

/** 按选区包围盒对齐左上角；少于 2 个原样返回 */
export function alignedPositions(boxes: AlignBox[], mode: NodeAlignMode): Array<{ id: string, x: number, y: number }> {
  if (boxes.length < 2)
    return boxes.map(box => ({ id: box.id, x: box.x, y: box.y }))
  const minX = Math.min(...boxes.map(box => box.x))
  const maxX = Math.max(...boxes.map(box => box.x + box.w))
  const minY = Math.min(...boxes.map(box => box.y))
  const maxY = Math.max(...boxes.map(box => box.y + box.h))
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  return boxes.map((box) => {
    let x = box.x
    let y = box.y
    if (mode === 'left')
      x = minX
    else if (mode === 'right')
      x = maxX - box.w
    else if (mode === 'center')
      x = midX - box.w / 2
    else if (mode === 'top')
      y = minY
    else if (mode === 'bottom')
      y = maxY - box.h
    else
      y = midY - box.h / 2
    return { id: box.id, x, y }
  })
}

function sortBoxes(boxes: AlignBox[], axis: NodeDistributeAxis) {
  return [...boxes].sort((a, b) => {
    const primary = axis === 'horizontal' ? a.x - b.x : a.y - b.y
    if (Math.abs(primary) > EPS)
      return primary
    const secondary = axis === 'horizontal' ? a.y - b.y : a.x - b.x
    if (Math.abs(secondary) > EPS)
      return secondary
    return a.id.localeCompare(b.id)
  })
}

/** 首尾不动，中间按空隙均分；少于 3 个原样返回 */
export function distributedPositions(boxes: AlignBox[], axis: NodeDistributeAxis): Array<{ id: string, x: number, y: number }> {
  if (boxes.length < 3)
    return boxes.map(box => ({ id: box.id, x: box.x, y: box.y }))
  const sorted = sortBoxes(boxes, axis)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const start = axis === 'horizontal' ? first.x : first.y
  const end = axis === 'horizontal' ? last.x + last.w : last.y + last.h
  const total = sorted.reduce((sum, box) => sum + (axis === 'horizontal' ? box.w : box.h), 0)
  const gap = (end - start - total) / (sorted.length - 1)
  let cursor = start
  const next = new Map<string, { id: string, x: number, y: number }>()
  for (const box of sorted) {
    next.set(box.id, axis === 'horizontal'
      ? { id: box.id, x: cursor, y: box.y }
      : { id: box.id, x: box.x, y: cursor })
    cursor += (axis === 'horizontal' ? box.w : box.h) + gap
  }
  return boxes.map(box => next.get(box.id) || { id: box.id, x: box.x, y: box.y })
}

/** 返回吸住后的左上角。threshold 用画布坐标，调用方按缩放换算成屏幕上大约几像素 */
export function snapNodeAlign(moving: AlignBox, others: AlignBox[], threshold: number) {
  const safe = Math.max(0, threshold)
  const x = snapAxis(moving, others, 'x', safe)
  const y = snapAxis(moving, others, 'y', safe)
  return {
    x: moving.x + x.delta,
    y: moving.y + y.delta,
    guides: [...x.guides, ...y.guides],
  }
}
