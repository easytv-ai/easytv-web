/**
 * 跟练浮层的定位与平滑：一个常驻 rAF 循环 + 帧率无关的指数趋近（见 utils/guide-anim.ts）。
 *
 * 分级节流（掉帧与稳态是这里的两条底线）：
 * - 锚点矩形 + 平滑 + 写 spot + 卡片选位 = 每帧；
 * - refreshZones（硬 / 软禁区与清单几何，全是 querySelectorAll 量出来的）= 每 8 帧（≈7.5Hz，
 *   菜单是点开的，7.5Hz 足够让卡片自己让位）；
 * - 卡片尺寸不在这里量：只有切步与 ResizeObserver 才需要（调用方拿 cardSize 回调给）。
 *
 * 数值没变就不写：spot / card / listRect 都是整对象替换，写之前先比数——稳态下零响应式写入，
 * 否则每帧都会带着整棵卡片子树重渲染。
 *
 * 三个「直落」的时机（都在这里判）：reduced-motion、相机补间在飞（匀速移动的锚点配 90ms 半衰期
 * 会恒定滞后 v*hl/ln2，300px/260ms 时约 150px，聚光框会明显吊在节点后面）、锚点换身份（换步 / 换节点）。
 *
 * 打断即取消：退出跟练时 loadGraph 会还原视口，循环停在会话结束那一刻（enabled 变 false 即停手）。
 */

import { onMounted, onScopeDispose, ref, type Ref } from 'vue'
import {
  GUIDE_CARD_HALF_LIFE_MS,
  GUIDE_SPOT_HALF_LIFE_MS,
  guideApproach,
  guideReducedMotion,
  guideSpotFullscreen,
  guideSpotRect,
} from '~/utils/guide-anim'
import { GUIDE_VIEWPORT_PAD, type GuideCardSize, type GuideRect } from '~/utils/canvas-guide-card'
import { PRACTICE_LIST_WIDTH } from '~/utils/canvas-practice'
import { canvasFlowPaneRect } from '~/utils/canvas-panel-layout'

/** 聚光框比锚点外扩的呼吸位（px） */
const GUIDE_SPOT_PAD = 8
/** 禁区与清单几何的刷新间隔（帧）：这两样都是 querySelectorAll 量出来的，逐帧量太亏 */
const ZONE_EVERY_FRAMES = 8
/** 单帧最大步长（ms）：标签页切回来时 dt 会是几秒，夹住它，免得平滑一步跳完 */
const MAX_FRAME_MS = 64
/** 清单贴画布舞台右上：画布顶栏 12 + 40 之下留 12px 净空（与旧实现同一口径） */
const LIST_TOP_FROM_PANE = 64

export type GuideOverlayAnchor = {
  /** 锚点身份（practiceAnchorKey）：变了就直落，别让聚光从上一个锚点滑过来 */
  key: string
  /** 锚点在视口里的矩形；锚点不在（没渲染 / 还没选中）时给 null，聚光收成全屏遮罩 */
  rect: GuideRect | null
}

export type GuideOverlayOpts = {
  /** 会话在跑才做测量与平滑（最小化时也停：那会儿浮层不在） */
  enabled: () => boolean
  anchor: () => GuideOverlayAnchor
  /** 每 8 帧收一次硬 / 软禁区，并把清单的碰撞结论写进 listCollapsed */
  refreshZones: () => void
  /** 按聚光框选卡片位（硬 / 软禁区与画布舞台都由调用方给） */
  pickCard: (spot: GuideRect) => { left: number, top: number }
  /** 相机补间在飞 → 直落（宿主 camera.tweening） */
  directFall: () => boolean
  cardSize: () => GuideCardSize
  /** 清单展开时的高度：折叠判定永远按「展开态矩形」算，折起后的高度采信会来回抖 */
  listHeight: () => number
}

export type GuideOverlayState = {
  /** 聚光框：恒在（锚点不在 = 整视口，视觉上是洞收拢成全屏遮罩） */
  spot: Ref<GuideRect>
  /** 卡片左上角（平滑后的落点），位置一律由调用方走 transform 写 */
  card: Ref<{ left: number, top: number }>
  /** 卡片正在滑行（CSS 里 pointer-events: none：滑过锚点会吞掉用户一次点击） */
  gliding: Ref<boolean>
  /** 清单的矩形（位置 + 展开态高度），由调用方写 style */
  listRect: Ref<GuideRect>
  /** 清单与 Inspector 的矩形相交（调用方在 refreshZones 里判定并写进来） */
  listCollapsed: Ref<boolean>
  /** 立刻量一轮并落位（切步 / 会话开始用；窗口 resize 由每帧的测量自己兜住） */
  measureNow: () => void
}

function sameRect(a: GuideRect, b: GuideRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

function samePoint(a: { left: number, top: number }, b: { left: number, top: number }): boolean {
  return a.left === b.left && a.top === b.top
}

export function useGuideOverlay(opts: GuideOverlayOpts): GuideOverlayState {
  const spot = ref<GuideRect>({ left: 0, top: 0, width: 0, height: 0 })
  const card = ref({ left: GUIDE_VIEWPORT_PAD, top: GUIDE_VIEWPORT_PAD })
  const gliding = ref(false)
  const listRect = ref<GuideRect>({ left: GUIDE_VIEWPORT_PAD, top: 0, width: PRACTICE_LIST_WIDTH, height: 0 })
  const listCollapsed = ref(false)

  let raf = 0
  let lastTs = 0
  let frames = 0
  /** 平滑的当前插值：自己持有，不每帧回读 spot.value（那是上一帧的写值，会多滞后半帧） */
  let cur: GuideRect | null = null
  let curKey = ''
  let curCard: { left: number, top: number } | null = null
  /** 会话开始 / 手动触发时读一次 reduced-motion（跟练是分钟级会话，不加 matchMedia 监听） */
  let reduced = false

  /** 清单：位置贴画布舞台右上；高度按「展开态」算——折起时高度归零，卡片选位就不会误判 */
  function measureList() {
    const pane = canvasFlowPaneRect()
    const next: GuideRect = {
      left: Math.max(GUIDE_VIEWPORT_PAD, pane.left + (pane.width ?? 0) - PRACTICE_LIST_WIDTH - GUIDE_VIEWPORT_PAD),
      top: pane.top + LIST_TOP_FROM_PANE,
      width: PRACTICE_LIST_WIDTH,
      height: listCollapsed.value ? 0 : opts.listHeight(),
    }
    if (!sameRect(listRect.value, next))
      listRect.value = next
  }

  function step(dt: number) {
    const { key, rect } = opts.anchor()
    const win = { width: window.innerWidth, height: window.innerHeight }
    // 首帧（cur 还没有值）不算「换身份」：那一次要从整视口收到节点框，不是硬跳
    const identityChanged = cur !== null && key !== curKey
    const direct = reduced || opts.directFall() || identityChanged

    const from = cur ?? guideSpotFullscreen(win)
    const target = rect ? guideSpotRect(rect, GUIDE_SPOT_PAD, win) : guideSpotFullscreen(win)
    const nextSpot: GuideRect = direct
      ? target
      : {
          left: guideApproach(from.left, target.left, dt, GUIDE_SPOT_HALF_LIFE_MS),
          top: guideApproach(from.top, target.top, dt, GUIDE_SPOT_HALF_LIFE_MS),
          width: guideApproach(from.width, target.width, dt, GUIDE_SPOT_HALF_LIFE_MS),
          height: guideApproach(from.height, target.height, dt, GUIDE_SPOT_HALF_LIFE_MS),
        }
    const spotWritten = cur === null || !sameRect(cur, nextSpot)
    cur = nextSpot
    if (spotWritten)
      spot.value = nextSpot

    // 卡片贴的是「平滑后的聚光」，不是还没到达的目标位：否则卡片会先跳到终点再等聚光
    const placement = opts.pickCard(nextSpot)
    const nextCard = (!curCard || direct)
      ? placement
      : {
          left: guideApproach(curCard.left, placement.left, dt, GUIDE_CARD_HALF_LIFE_MS),
          top: guideApproach(curCard.top, placement.top, dt, GUIDE_CARD_HALF_LIFE_MS),
        }
    // 只要这一帧还在移动就算滑行：滑过锚点时会吞掉用户一次点击（CSS 里 pointer-events: none）
    const moved = curCard !== null && !samePoint(curCard, nextCard)
    const cardWritten = curCard === null || !samePoint(curCard, nextCard)
    curCard = nextCard
    if (cardWritten)
      card.value = nextCard
    if (moved !== gliding.value)
      gliding.value = moved
  }

  function tick(ts: number) {
    raf = requestAnimationFrame(tick)
    if (!import.meta.client || !opts.enabled()) {
      // 会话不在：时间轴与降级标记复位，下一次会话重新读一次 reduced-motion
      lastTs = 0
      reduced = false
      return
    }
    if (!lastTs) {
      reduced = guideReducedMotion()
      // 进会话的第一帧就把禁区与清单收一遍，别让卡片先落在菜单上
      frames = ZONE_EVERY_FRAMES
    }
    const dt = lastTs ? Math.min(MAX_FRAME_MS, ts - lastTs) : 0
    lastTs = ts
    if (frames >= ZONE_EVERY_FRAMES) {
      frames = 0
      refreshZones()
    }
    frames += 1
    step(dt)
  }

  /** 每 8 帧一条的慢活：禁区 + 清单几何/折叠（都是 querySelectorAll 量出来的） */
  function refreshZones() {
    opts.refreshZones()
    measureList()
  }

  /** 立刻量一轮并落位：切步 / 会话开始用（DOM 刚更新时等下一帧会闪一下旧值） */
  function measureNow() {
    if (!import.meta.client || !opts.enabled())
      return
    reduced = guideReducedMotion()
    frames = 1
    refreshZones()
    step(0)
  }

  onMounted(() => {
    if (!import.meta.client)
      return
    raf = requestAnimationFrame(tick)
  })

  onScopeDispose(() => {
    if (raf)
      cancelAnimationFrame(raf)
    raf = 0
  })

  return { spot, card, gliding, listRect, listCollapsed, measureNow }
}
