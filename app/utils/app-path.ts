const LOCALE_PREFIX = /^\/(zh|zh-tw|en|fr|ja|ru|vi)(?=\/|$)/i

/** 去掉语言前缀与末尾斜杠，用于路由匹配（/demo/chat/ → /demo/chat） */
export function pathWithoutLocale(path: string): string {
  return path.replace(LOCALE_PREFIX, '').replace(/\/+$/, '') || '/'
}
