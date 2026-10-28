/**
 * 导演台卡片封面：离开时从 3D 视口截一张缩小的 JPEG。
 *
 * 不把原图像素写进 graph —— 机位截图已经因为 base64 PNG 撑爆 2MB 上限被摘掉了，
 * 封面走上传后的 URL，节点上只留一条短地址。
 */

export const DIRECTOR_CARD_PREVIEW_MAX_WIDTH = 640
export const DIRECTOR_CARD_PREVIEW_QUALITY = 0.72

export function directorCardPreviewSize(
  width: number,
  height: number,
  maxWidth = DIRECTOR_CARD_PREVIEW_MAX_WIDTH,
) {
  if (width <= 0 || height <= 0)
    return { width: 0, height: 0 }
  const scale = Math.min(1, maxWidth / width)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** 把 WebGL 画布缩成卡片封面。画布被跨域污染时 toDataURL 会抛，调用方自己兜。 */
export function canvasToCardPreview(
  source: HTMLCanvasElement,
  maxWidth = DIRECTOR_CARD_PREVIEW_MAX_WIDTH,
  quality = DIRECTOR_CARD_PREVIEW_QUALITY,
): string {
  const size = directorCardPreviewSize(source.width, source.height, maxWidth)
  if (!size.width || !size.height)
    return ''

  const out = document.createElement('canvas')
  out.width = size.width
  out.height = size.height
  const ctx = out.getContext('2d')
  if (!ctx)
    return ''
  ctx.drawImage(source, 0, 0, size.width, size.height)
  return out.toDataURL('image/jpeg', quality)
}
