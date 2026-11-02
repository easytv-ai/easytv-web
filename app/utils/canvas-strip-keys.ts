/** 胶片条（续写 / 片段截取 / 分割）的键盘操作：纯计算，组件只负责把结果写回游标 */

export type StripVariant = 'extend' | 'clip' | 'split'

export type StripKeyInput = { key: string, shift?: boolean, alt?: boolean }

export type StripKeyContext = {
  variant: StripVariant
  /** 选区起止（0~1 的比例）；分割模式只用 start */
  start: number
  end: number
  /** 视频时长（秒）；读不到时按 5 秒估 */
  duration: number
  /** 整数秒吸附开着时每步 1 秒，否则 0.1 秒（按住 Shift 也是 1 秒） */
  snap: boolean
  /** 选区最小宽度（比例） */
  minRange: number
}

export type StripKeyResult
  = | { type: 'range', start: number, end: number }
    | { type: 'command', command: 'submit' | 'close' | 'toggle-snap' | 'toggle-loop' }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 点在分割线附近就拖它，否则准备新增。threshold 是比例 */
export function nearestSplitCut(cuts: number[], ratio: number, threshold: number) {
  let best = -1
  let dist = Math.max(0, threshold)
  cuts.forEach((cut, index) => {
    const gap = Math.abs(cut - ratio)
    if (gap <= dist) {
      dist = gap
      best = index
    }
  })
  return best
}

/** 新分割点要离首尾和已有分割点至少 minGap，并且没超过条数 */
export function canInsertSplitCut(cuts: number[], ratio: number, minGap: number, maxCuts: number) {
  if (cuts.length >= maxCuts)
    return false
  const gap = Math.max(0, minGap)
  if (ratio < gap || ratio > 1 - gap)
    return false
  return cuts.every(cut => Math.abs(cut - ratio) >= gap)
}

/**
 * 时间标签太近时错开到下一行。gap 是一条标签的宽度，按胶片条宽度的比例算。
 * 返回值和 cuts 下标对齐。
 */
export function splitLabelRows(cuts: number[], gap: number) {
  const span = Math.max(0.02, gap)
  const lanes: number[][] = []
  const rows = cuts.map(() => 0)
  const order = cuts
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index)
  for (const cut of order) {
    let row = 0
    while (row < cuts.length) {
      const taken = lanes[row] || []
      if (taken.every(pos => Math.abs(pos - cut.value) >= span)) {
        if (!lanes[row])
          lanes[row] = []
        lanes[row].push(cut.value)
        rows[cut.index] = row
        break
      }
      row += 1
    }
    if (row >= cuts.length)
      rows[cut.index] = Math.max(0, cuts.length - 1)
  }
  return rows
}

/** 移动第 index 条分割线，夹在它原来的左右邻居之间，不能越过别的分割线 */
export function moveSplitCut(cuts: number[], index: number, next: number, minGap: number) {
  if (index < 0 || index >= cuts.length)
    return cuts.slice()
  const gap = Math.max(0, minGap)
  const sorted = cuts
    .map((value, item) => ({ value, item }))
    .sort((left, right) => left.value - right.value)
  const order = sorted.findIndex(item => item.item === index)
  const prev = order <= 0 ? 0 : sorted[order - 1]!.value
  const follow = order < 0 || order >= sorted.length - 1 ? 1 : sorted[order + 1]!.value
  const value = Math.min(follow - gap, Math.max(prev + gap, next))
  const out = cuts.slice()
  out[index] = Number.isFinite(value) ? value : cuts[index]!
  return out
}

/** 一步对应的比例：吸附或按住 Shift 走 1 秒，否则 0.1 秒 */
export function stripKeyStep(ctx: Pick<StripKeyContext, 'duration' | 'snap'>, shift: boolean) {
  const seconds = ctx.snap || shift ? 1 : 0.1
  return seconds / (ctx.duration > 0 ? ctx.duration : 5)
}

/**
 * ← → 移动选区（分割点）；Alt + ← → 只动终点；↑ ↓ 两端各放大 / 缩小一步；
 * Enter 确认，Esc 关闭；片段截取另有 S 吸附、L 循环。不认的键返回 null，交还给画布。
 */
export function stripKeyResult(input: StripKeyInput, ctx: StripKeyContext): StripKeyResult | null {
  const step = stripKeyStep(ctx, Boolean(input.shift))
  const span = Math.max(0, ctx.end - ctx.start)
  switch (input.key) {
    case 'Enter':
      return { type: 'command', command: 'submit' }
    case 'Escape':
      return { type: 'command', command: 'close' }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const delta = input.key === 'ArrowLeft' ? -step : step
      if (ctx.variant === 'split') {
        const at = clamp01(ctx.start + delta)
        return { type: 'range', start: at, end: at }
      }
      if (input.alt) {
        const end = Math.min(1, Math.max(ctx.start + ctx.minRange, ctx.end + delta))
        return { type: 'range', start: ctx.start, end }
      }
      const start = Math.min(Math.max(0, ctx.start + delta), Math.max(0, 1 - span))
      return { type: 'range', start, end: start + span }
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      if (ctx.variant === 'split')
        return null
      const delta = input.key === 'ArrowUp' ? step : -step
      let start = clamp01(ctx.start - delta)
      let end = clamp01(ctx.end + delta)
      if (end - start < ctx.minRange) {
        const mid = (ctx.start + ctx.end) / 2
        start = clamp01(mid - ctx.minRange / 2)
        end = clamp01(start + ctx.minRange)
      }
      return { type: 'range', start, end }
    }
    case 's':
    case 'S':
      return ctx.variant === 'clip' ? { type: 'command', command: 'toggle-snap' } : null
    case 'l':
    case 'L':
      return ctx.variant === 'clip' ? { type: 'command', command: 'toggle-loop' } : null
  }
  return null
}

/** 片段裁剪胶片：不跟画布缩放走；格子按当前视频比例完整放下，不裁切 */
export const CLIP_STRIP_FILM_HEIGHT = 44
const CLIP_STRIP_SIDE = 88
const CLIP_STRIP_MIN_ASPECT = 9 / 21
const CLIP_STRIP_MAX_ASPECT = 21 / 9

/** 当前视频宽高比（宽/高）；读不到时按 16:9 */
export function clipStripAspect(width: number, height: number) {
  const w = Number(width)
  const h = Number(height)
  if (!(w > 0) || !(h > 0))
    return 16 / 9
  return Math.min(CLIP_STRIP_MAX_ASPECT, Math.max(CLIP_STRIP_MIN_ASPECT, w / h))
}

export function clipStripMetrics(nodeWidth: number, aspect = 16 / 9) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? clipStripAspect(aspect, 1) : 16 / 9
  const width = Math.max(Math.round(nodeWidth || 0) + 160, 720)
  const filmWidth = Math.max(160, width - CLIP_STRIP_SIDE)
  const cellW = CLIP_STRIP_FILM_HEIGHT * ratio
  const frameCount = Math.max(4, Math.min(28, Math.round(filmWidth / Math.max(8, cellW))))
  return { width, filmHeight: CLIP_STRIP_FILM_HEIGHT, frameCount, aspect: ratio }
}
