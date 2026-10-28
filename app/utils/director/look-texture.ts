/**
 * 形象贴图加载。
 *
 * 右侧缩略图用 <img> 能出，Three 贴图却空白，常见有两件事：
 * - blob / 同源地址设了 crossOrigin，浏览器会直接拒
 * - 缩略图已经非 CORS 拉过同一张，缓存里那份没有 ACAO，TextureLoader 再拉就失败
 *
 * 跨域图改走 fetch(cache: reload) 再转成本地 blob，避开这两坑。
 */
import { SRGBColorSpace, Texture } from 'three'

function isBlobOrDataUrl(src: string) {
  return /^(blob:|data:)/i.test(src)
}

export function lookTextureNeedsCors(src: string, origin = typeof location === 'undefined' ? '' : location.origin) {
  if (!src || isBlobOrDataUrl(src))
    return false
  if (!origin)
    return true
  try {
    return new URL(src, origin).origin !== new URL(origin).origin
  }
  catch {
    return true
  }
}

function decodeImage(src: string, cors: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    if (cors)
      image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('look-image'))
    image.src = src
  })
}

export async function loadLookTexture(src: string): Promise<Texture> {
  const url = String(src || '').trim()
  if (!url)
    throw new Error('look-image')

  const image = lookTextureNeedsCors(url)
    ? await loadCrossOriginImage(url)
    : await decodeImage(url, false)

  const texture = new Texture(image)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

async function loadCrossOriginImage(src: string) {
  try {
    const res = await fetch(src, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'reload',
    })
    if (!res.ok)
      throw new Error('look-image')
    const objectUrl = URL.createObjectURL(await res.blob())
    try {
      return await decodeImage(objectUrl, false)
    }
    finally {
      URL.revokeObjectURL(objectUrl)
    }
  }
  catch {
    return decodeImage(src, true)
  }
}
