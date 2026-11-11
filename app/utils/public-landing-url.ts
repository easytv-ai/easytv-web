/**
 * 落地页用可读路径 /share /invite /partner；带短前缀 /s /i /p 的老链接在展示和复制时换成可读前缀。
 * 只替换独立路径段，避免误伤 /pricing、/prompts。
 */
export function rewritePublicLandingUrl(url: string) {
  return String(url || '')
    .replace(/\/s\/(?=[^/?#]+)/g, '/share/')
    .replace(/\/i\/(?=[^/?#]+)/g, '/invite/')
    .replace(/\/p\/(?=[^/?#]+)/g, '/partner/')
}
