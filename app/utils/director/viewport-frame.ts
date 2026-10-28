/**
 * 取景框的尺寸换算（复刻自 open-director 的 viewportAspectFrame.ts，MIT）。
 *
 * 视口是任意宽高的一块矩形，取景框要按选定比例在里面居中放到最大。
 * 纯数学，单独测比在浏览器里拖窗口试快得多。
 */
import { getViewportAspectRatioValue, type ViewportAspectRatio } from './schema'

/** 取景框四周留白，贴边会看不清框线 */
export const FRAME_PADDING = 40

export interface ViewportFrameRect {
  width: number
  height: number
  left: number
  top: number
}

/**
 * 在给定的矩形里按比例放一个最大的框。
 *
 * bottomPadding 单独给：底部常常压着工具条，留白要比另外三边多。
 */
export function fitFrameWithinViewport(
  width: number,
  height: number,
  ratio: number,
  bottomPadding = FRAME_PADDING,
): ViewportFrameRect {
  const left = FRAME_PADDING
  const top = FRAME_PADDING
  const right = Math.max(width - FRAME_PADDING, left)
  const bottom = Math.max(height - Math.max(bottomPadding, FRAME_PADDING), top)

  const safeWidth = Math.max(right - left, 0)
  const safeHeight = Math.max(bottom - top, 0)

  // 视口小到留白都放不下时给一个零尺寸的框，别让后面算出 NaN
  if (safeWidth === 0 || safeHeight === 0 || ratio <= 0)
    return { width: 0, height: 0, left: (left + right) / 2, top: (top + bottom) / 2 }

  const safeRatio = safeWidth / safeHeight
  // 框比可用区域更宽就顶满宽度，否则顶满高度
  const frameWidth = ratio >= safeRatio ? safeWidth : safeHeight * ratio
  const frameHeight = ratio >= safeRatio ? safeWidth / ratio : safeHeight

  return {
    width: frameWidth,
    height: frameHeight,
    left: left + (safeWidth - frameWidth) / 2,
    top: top + (safeHeight - frameHeight) / 2,
  }
}

/** auto 比例不画框，返回 null */
export function getViewportFrameRect(
  ratio: ViewportAspectRatio,
  width: number,
  height: number,
  bottomPadding = FRAME_PADDING,
): ViewportFrameRect | null {
  const value = getViewportAspectRatioValue(ratio)
  if (!value)
    return null
  return fitFrameWithinViewport(width, height, value, bottomPadding)
}
