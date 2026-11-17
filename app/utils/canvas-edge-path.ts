import { getBezierPath, type Position } from '@vue-flow/core'

export type CanvasEdgePath = {
  d: string
  labelX: number
  labelY: number
}

const cache = new Map<string, CanvasEdgePath>()
const CACHE_MAX = 2048

function quant(n: number) {
  return Math.round(n)
}

/**
 * 端点四舍五入到 1px 后复用上次的贝塞尔。
 * 平移不改端点；拖卡片时亚像素抖动也不再每帧重算路径。
 */
export function canvasCachedEdgePath(input: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: string
  targetPosition: string
}): CanvasEdgePath {
  const key = [
    quant(input.sourceX),
    quant(input.sourceY),
    quant(input.targetX),
    quant(input.targetY),
    input.sourcePosition,
    input.targetPosition,
  ].join(',')
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const [d, labelX, labelY] = getBezierPath({
    sourceX: input.sourceX,
    sourceY: input.sourceY,
    targetX: input.targetX,
    targetY: input.targetY,
    sourcePosition: input.sourcePosition as Position,
    targetPosition: input.targetPosition as Position,
    curvature: 0.4,
  })
  const next: CanvasEdgePath = { d, labelX: labelX ?? 0, labelY: labelY ?? 0 }
  cache.set(key, next)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest)
      cache.delete(oldest)
  }
  return next
}
