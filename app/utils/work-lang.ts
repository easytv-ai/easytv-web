/**
 * 作品语种映射（F6 出海，API.md 10.7）。
 *
 * 后端 CreateWork 要求「作品语种由前端按界面语言传」（controller/work.go），
 * NormalizeLang 只认 zh / en / ja / ko / es / fr，未知语种置空（空 = 中文广场）。
 *
 * 界面里有、后端也认的才传：en / ja / fr。
 * zh 是默认，不传。zh-tw / vi / ru 后端还不认，传了会被当成中文广场。
 */
const WORK_LANGS = new Set(['en', 'ja', 'fr'])
/** 界面有、后端还不认：发布后会进中文广场 */
const CHINESE_PLAZA_LOCALES = new Set(['zh-tw', 'vi', 'ru'])

export function workLangForLocale(locale: string): string | undefined {
  return WORK_LANGS.has(locale) ? locale : undefined
}

export function workLangUsesChinesePlaza(locale: string): boolean {
  return CHINESE_PLAZA_LOCALES.has(locale)
}
