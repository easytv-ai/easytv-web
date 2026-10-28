/**
 * 引导卡片的选位几何（新手跟练 CanvasPracticeTour、三步引导 CanvasGuideTour 都在用）。
 *
 * 纯矩形运算，不碰 DOM。卡片压在什么上都行，唯独不能压这两类：
 * - 硬禁区（任何情况都不压）：被高亮的元素本身、以及从它旁边弹出的菜单/弹层
 *   （.canvas-menu / .canvas-ctx / .canvas-tool-pop 的 z-index 都比引导浮层低，
 *   而卡片是 pointer-events:auto，压住就是真的点不到）；
 * - 软禁区（尽量避）：常驻面板与工具轨（Inspector / 对话栏 / 底部 Dock / 工具轨）。
 *
 * 候选位依次为 下 → 上 → 右近 → 右远 → 左 → 舞台底部居中；
 * 打分先比硬禁区相交面积（0 优先），再比软禁区重叠面积；全遮蔽时退化成"重叠最小的那个"。
 * 卡片真实尺寸由调用方量了传进来——写死的高度（老实现是 210）比真实值矮一截，
 * 翻转分支会把自己推回锚点身上。
 */

export type GuideRect = { left: number, top: number, width: number, height: number }

export type GuideCardSize = { width: number, height: number }

export type GuideViewport = { width: number, height: number }

export type GuideZones = {
  /** 任何情况下都不该压的：被高亮的元素、弹出的菜单 / 弹层 */
  hard?: GuideRect[]
  /** 尽量避开的：常驻面板、工具轨、底部 Dock */
  soft?: GuideRect[]
}

export type GuideCardPlacement = {
  left: number
  top: number
  /** 与硬禁区相交的面积，0 = 一点没压 */
  hardOverlap: number
  /** 与软禁区重叠的面积 */
  softOverlap: number
}

/** 卡片与锚点之间的呼吸位 */
export const GUIDE_CARD_GAP = 12
/** 与窗口四边的最小距离 */
export const GUIDE_VIEWPORT_PAD = 16
/** 卡片默认宽（量不到真实宽度时的兜底） */
export const GUIDE_CARD_WIDTH = 340
/**
 * 「右远」位在「右近」基础上再右移的距离。
 * 加号菜单从按钮右缘 +12 弹出、宽 240（CanvasAddMenu / openMenuAtAdd），要整条让开。
 */
export const GUIDE_MENU_CLEAR = 260

export function guideRectOverlap(a: GuideRect, b: GuideRect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

function guideOverlapSum(rect: GuideRect, zones?: GuideRect[]): number {
  let sum = 0
  for (const zone of zones || [])
    sum += guideRectOverlap(rect, zone)
  return sum
}

/** 夹到窗口内缩 16px 的矩形里；卡片比窗口还大时只保证左 / 上对齐，不把它推到窗外 */
function guideClampToViewport(rect: GuideRect, win: GuideViewport): GuideRect {
  const maxLeft = Math.max(GUIDE_VIEWPORT_PAD, win.width - GUIDE_VIEWPORT_PAD - rect.width)
  const maxTop = Math.max(GUIDE_VIEWPORT_PAD, win.height - GUIDE_VIEWPORT_PAD - rect.height)
  return {
    ...rect,
    left: Math.min(Math.max(GUIDE_VIEWPORT_PAD, rect.left), maxLeft),
    top: Math.min(Math.max(GUIDE_VIEWPORT_PAD, rect.top), maxTop),
  }
}

/** 锚点几乎铺满窗口时，它是「没有可高亮的东西」的遮罩，不该当成禁区 */
function guideAnchorFillsViewport(anchor: GuideRect, win: GuideViewport) {
  return anchor.width >= win.width * 0.85 && anchor.height >= win.height * 0.85
}

/** 候选位（未夹界；数组顺序即打分相同时的优先级） */
export function guideCardCandidates(
  anchor: GuideRect,
  card: GuideCardSize,
  pane?: GuideRect | null,
  win?: GuideViewport,
): Array<{ left: number, top: number }> {
  const centered = anchor.left + anchor.width / 2 - card.width / 2
  const right = anchor.left + anchor.width + GUIDE_CARD_GAP
  const list = [
    { left: centered, top: anchor.top + anchor.height + GUIDE_CARD_GAP }, // 锚点下
    { left: centered, top: anchor.top - card.height - GUIDE_CARD_GAP }, // 锚点上
    { left: right, top: anchor.top }, // 右侧近
    { left: right + GUIDE_MENU_CLEAR, top: anchor.top }, // 右侧远：让开从锚点右边弹出的菜单
    { left: anchor.left - card.width - GUIDE_CARD_GAP, top: anchor.top }, // 左侧
  ]
  if (pane && pane.width > 0 && pane.height > 0) {
    list.push({
      left: pane.left + (pane.width - card.width) / 2,
      top: pane.top + pane.height - card.height - GUIDE_VIEWPORT_PAD,
    })
  }
  /* 开场步没有锚点，聚光是整窗。卡片放到舞台左上、让开左边工具条，别挡空画布中间的入口 */
  if (win && pane && pane.width > 0 && guideAnchorFillsViewport(anchor, win)) {
    list.unshift({
      left: pane.left + 72,
      top: pane.top + 72,
    })
  }
  return list
}

export function pickGuideCardPosition(
  anchor: GuideRect,
  card: GuideCardSize,
  zones: GuideZones | undefined,
  win: GuideViewport,
  pane?: GuideRect | null,
): GuideCardPlacement {
  // 被高亮的元素自己就是第一硬禁区：压上去 = 用户点不到这一步真正要点的东西
  const hard = guideAnchorFillsViewport(anchor, win) ? [...(zones?.hard ?? [])] : [anchor, ...(zones?.hard ?? [])]
  const soft = zones?.soft ?? []
  let best: GuideCardPlacement | null = null
  for (const candidate of guideCardCandidates(anchor, card, pane, win)) {
    const rect = guideClampToViewport({ ...candidate, width: card.width, height: card.height }, win)
    const placement: GuideCardPlacement = {
      left: rect.left,
      top: rect.top,
      hardOverlap: guideOverlapSum(rect, hard),
      softOverlap: guideOverlapSum(rect, soft),
    }
    if (
      !best
      || placement.hardOverlap < best.hardOverlap
      || (placement.hardOverlap === best.hardOverlap && placement.softOverlap < best.softOverlap)
    )
      best = placement
  }
  return best ?? { left: GUIDE_VIEWPORT_PAD, top: GUIDE_VIEWPORT_PAD, hardOverlap: 0, softOverlap: 0 }
}
