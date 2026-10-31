/** 仓库不放演示大文件。登录页和运镜预览先用这一条远程视频占位。 */
export const PLACEHOLDER_VIDEO_URL = 'https://tv-oss.easyapi.com/easytv/2026/10/27/1793093335600tx4xHL.mp4'

/**
 * 媒体地址解析：
 * - `/upload/...`：后端本地存储，拼 API Base URL
 * - `http(s)://...`：原样
 * - 其它相对路径（如 `/videos/showcase/x.mp4`）：前端 public 目录静态资源，原样
 */
export function resolveMediaUrl(url: string | null | undefined): string {
  const value = String(url ?? '').trim()
  if (!value)
    return ''
  if (/^(https?:|data:|blob:)/i.test(value))
    return value
  if (value.startsWith('/upload/')) {
    const base = String(useRuntimeConfig().public.apiBaseUrl || '').replace(/\/$/, '')
    return `${base}${value}`
  }
  return value
}

/** 是否是可直接播放/展示的媒体地址（生成结果或上传资产） */
export function isMediaUrl(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim()
  return /^(https?:|data:|blob:)/i.test(v) || v.startsWith('/upload/') || v.startsWith('/videos/') || v.startsWith('/images/')
}

/** 1234 → 1.2k */
export function formatCount(n: number | null | undefined): string {
  const v = Number(n) || 0
  if (v >= 1000)
    return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return String(v)
}
