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
