/**
 * 时间轴的刻度与坐标换算（复刻自 open-director 的 DirectorTimeline.tsx，MIT）。
 *
 * 全是「秒 ↔ 像素」的换算和标注，纯函数，单独测比在组件里点着看快得多。
 */

/** 左侧留给轨道名的宽度，时间 0 从这里开始 */
export const TRACK_GUTTER_WIDTH = 96

/** 刻度可选的间隔（秒），从密到疏 */
const TICK_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20]

/** 两个刻度至少隔 70 像素，否则数字会叠在一起 */
const MIN_TICK_PIXELS = 70

/** 播放头时间显示成 mm:ss.s */
export function formatPlayheadTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  // padStart 到 4 位是为了 9.5 显示成 09.5，秒数不会跳着变宽
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

/** 当前缩放下用多大的刻度间隔；再疏也不超过表里最大的那档 */
export function getRulerTickStep(zoom: number): number {
  return TICK_STEPS.find(step => step * zoom >= MIN_TICK_PIXELS) ?? TICK_STEPS[TICK_STEPS.length - 1]!
}

export interface RulerTick {
  time: number
  /** 相对轨道左边缘的像素位置，已经算进了左侧留白 */
  left: number
  label: string
}

export function getRulerTicks(total: number, zoom: number): RulerTick[] {
  const step = getRulerTickStep(zoom)
  const count = Math.ceil(Math.max(total, 0) / step) + 1
  return Array.from({ length: count }, (_, index) => {
    const time = Number((index * step).toFixed(6))
    return {
      time,
      left: TRACK_GUTTER_WIDTH + time * zoom,
      // 十秒以内的小数刻度留一位，再往后都是整秒，标注不必带 .0
      label: `${time.toFixed(time < 10 && time % 1 !== 0 ? 1 : 0)}s`,
    }
  })
}

/** 轨道里某个横坐标对应的时间，夹在 [0, total] 内 */
export function timeFromTrackOffset(offsetX: number, zoom: number, total: number): number {
  if (zoom <= 0)
    return 0
  return Math.min(Math.max((offsetX - TRACK_GUTTER_WIDTH) / zoom, 0), Math.max(total, 0))
}

/** 轨道内容的总宽度：末尾多留一截，方便把最后一个节点往后拖 */
export function getTrackContentWidth(total: number, zoom: number): number {
  return Math.max(total * zoom + 320, 480)
}

/**
 * 节点标号：A、B…Z、AA、AB…
 *
 * 上游用的是 String.fromCharCode(65 + index)，超过 26 个节点就开始输出
 * `[`、`\`、`]` 这些字符 —— 一条长运镜路径很容易超。
 */
export function getNodeLabel(index: number): string {
  if (index < 0)
    return ''
  let rest = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (rest % 26)) + label
    rest = Math.floor(rest / 26) - 1
  } while (rest >= 0)
  return label
}
