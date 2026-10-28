import { describe, expect, it } from 'vitest'
import { workLangForLocale, workLangUsesChinesePlaza } from './work-lang'

describe('workLangForLocale', () => {
  it('英文、日文、法文界面按原样传给后端', () => {
    expect(workLangForLocale('en')).toBe('en')
    expect(workLangForLocale('ja')).toBe('ja')
    expect(workLangForLocale('fr')).toBe('fr')
  })

  it('中文默认不传，后端还不认的界面语种也不传', () => {
    expect(workLangForLocale('zh')).toBeUndefined()
    expect(workLangForLocale('zh-tw')).toBeUndefined()
    expect(workLangForLocale('vi')).toBeUndefined()
    expect(workLangForLocale('ru')).toBeUndefined()
  })

  it('繁中 / 越南语 / 俄语发布会进中文广场', () => {
    expect(workLangUsesChinesePlaza('zh-tw')).toBe(true)
    expect(workLangUsesChinesePlaza('vi')).toBe(true)
    expect(workLangUsesChinesePlaza('ru')).toBe(true)
    expect(workLangUsesChinesePlaza('zh')).toBe(false)
    expect(workLangUsesChinesePlaza('en')).toBe(false)
  })

  it('异常输入安全回落', () => {
    expect(workLangForLocale('')).toBeUndefined()
    expect(workLangForLocale('EN')).toBeUndefined()
  })
})
