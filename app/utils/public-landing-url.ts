/**
 * 后端短链 /s /i /p 已改成可读路径；展示和复制时把旧前缀换成新的。
 * 只替换独立路径段，避免误伤 /pricing、/prompts。
 */
export function rewritePublicLandingUrl(url: string) {
  return String(url || '')
    .replace(/\/s\/(?=[^/?#]+)/g, '/share/')
    .replace(/\/i\/(?=[^/?#]+)/g, '/invite/')
    .replace(/\/p\/(?=[^/?#]+)/g, '/partner/')
}
