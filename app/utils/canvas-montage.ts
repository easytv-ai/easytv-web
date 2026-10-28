/**
 * 分镜组拼接（L4，API.md 23.3 montage）：选中的图片节点按阅读顺序排好，交给本地 ffmpeg 拼成一张宫格大图。
 * 纯函数，不碰 vue-flow；顺序、列数、结果节点的尺寸都在这里算，工作区只负责提交作业。
 */

export type MontageSource = {
  id: string
  assetId: number
  url: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export type MontageOptions = {
  cols: number
  ratio: MontageRatio
  gap: number
  number: boolean
}

export const MONTAGE_MIN = 2
export const MONTAGE_MAX = 25
export const MONTAGE_COLS_MAX = 10
export const MONTAGE_GAP_MAX = 64
/** 与后端 montageCellDefault 一致，结果节点按它估尺寸 */
export const MONTAGE_CELL = 512

export const MONTAGE_RATIOS = [
  { id: 'original', label: '按第一张' },
  { id: '1:1', label: '1:1' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
] as const

export type MontageRatio = (typeof MONTAGE_RATIOS)[number]['id']

/**
 * 阅读顺序：先按行（中心点 y 相差不到半个节点高就算同一行），行内从左到右。
 * 用中心点而不是左上角，是因为用户手摆的节点高度常常参差不齐。
 */
export function montageOrder<T extends { x: number, y: number, w: number, h: number }>(items: T[]): T[] {
  if (items.length < 2)
    return [...items]
  const byY = [...items].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
  const rows: T[][] = []
  for (const item of byY) {
    const row = rows[rows.length - 1]
    const anchor = row?.[0]
    const tolerance = anchor ? Math.min(anchor.h, item.h) / 2 : 0
    if (anchor && Math.abs((item.y + item.h / 2) - (anchor.y + anchor.h / 2)) <= tolerance)
      row.push(item)
    else
      rows.push([item])
  }
  return rows.flatMap(row => row.sort((a, b) => a.x - b.x))
}

/** 没指定列数时接近正方形：4 张 2 列、9 张 3 列、10 张 4 列（与后端 montageDefaultCols 同口径） */
export function montageDefaultCols(n: number) {
  let cols = 1
  while (cols * cols < n)
    cols++
  return Math.min(MONTAGE_COLS_MAX, cols)
}

export function montageRows(n: number, cols: number) {
  return cols > 0 ? Math.ceil(n / cols) : n
}

/** 能不能拼：都是有资产 id 的图片节点，张数在范围内 */
export function montageReady(items: Array<{ kind?: string, assetId?: number }>) {
  if (items.length < MONTAGE_MIN || items.length > MONTAGE_MAX)
    return false
  return items.every(item => item.kind === 'image' && Number(item.assetId) > 0)
}

/** 单格画幅：original 按第一张节点的显示比例估，其余按声明的比 */
export function montageCellAspect(ratio: MontageRatio, first?: { w: number, h: number }) {
  if (ratio === 'original')
    return first && first.w > 0 && first.h > 0 ? first.w / first.h : 1
  const [a, b] = ratio.split(':').map(Number)
  return a && b ? a / b : 1
}

/**
 * 结果节点的显示尺寸：按整图比例，宽度对齐源节点里最宽的那个再放大一点，
 * 让宫格在画布上一眼能看清，又不至于盖住旁边的节点。
 */
export function montageNodeSize(n: number, opts: MontageOptions, first?: { w: number, h: number }, baseW = 320) {
  const cols = Math.max(1, opts.cols)
  const rows = montageRows(n, cols)
  const cellW = MONTAGE_CELL
  const cellH = Math.round(cellW / montageCellAspect(opts.ratio, first))
  const fullW = cols * cellW + (cols - 1) * opts.gap
  const fullH = rows * cellH + (rows - 1) * opts.gap
  const w = Math.max(baseW, Math.min(640, Math.round(baseW * Math.min(cols, 3) / 2)))
  return { w, h: Math.max(120, Math.round(w * fullH / fullW)) }
}

/** 提交给 POST /user/media/jobs 的 params */
export function montageParams(ordered: MontageSource[], opts: MontageOptions) {
  return {
    asset_ids: ordered.map(item => item.assetId),
    cols: Math.min(MONTAGE_COLS_MAX, Math.max(1, Math.round(opts.cols))),
    ratio: opts.ratio,
    gap: Math.min(MONTAGE_GAP_MAX, Math.max(0, Math.round(opts.gap))),
    number: Boolean(opts.number),
  }
}
