/** 发版后旧 HTML 还去拉已删除的 /_nuxt 哈希文件时，浏览器 / Nuxt 会抛这类错。 */

const STALE_CHUNK_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w.-]+ failed|Unable to preload CSS/i

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error
    ? `${err.name} ${err.message}`
    : typeof err === 'string'
      ? err
      : String((err as { message?: string } | null)?.message ?? err ?? '')
  return STALE_CHUNK_RE.test(msg)
}
