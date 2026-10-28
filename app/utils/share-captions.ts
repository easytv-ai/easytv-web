/**
 * 平台分享文案（F6 分发引导，API.md 10.7）。
 *
 * 微信 / 抖音 / 小红书用通用文案即可；TikTok / YouTube 面向海外流量，
 * 在通用文案（已按界面语言翻译）末尾追加持平台的话题标签。
 * 标签集中在这里，调整投放策略只动一处。
 */
export const TIKTOK_HASHTAGS = '#AIVideo #AIFilm'
export const YOUTUBE_HASHTAGS = '#AIVideo #Shorts'

/** 文案末尾追加话题标签；空文案直接返回标签本身 */
export function withHashtags(text: string, hashtags: string): string {
  const clean = text.trim()
  return clean ? `${clean} ${hashtags}` : hashtags
}
