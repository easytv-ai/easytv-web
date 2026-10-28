import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 创作台文案以中文原文作 key，缺译时回退中文——外语界面里就会夹着中文。
 * 存量中文 key 记在 scripts/i18n-zh-baseline.txt。新文案用 domain.section.key，
 * 不要再往清单里加中文句子；确需复用已有短词（关闭、删除）时才更新清单。
 */
const LOCALES = ['zh', 'zh-TW', 'en', 'fr', 'ja', 'ru', 'vi'] as const
const T_PATTERN = /\b(?:t|tr|\$t)\(\s*'((?:[^'\\\n]|\\.)*)'/g
function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      walk(path, out)
    else if (/\.(vue|ts)$/.test(name) && !name.endsWith('.test.ts'))
      out.push(path)
  }
  return out
}

function chineseKeysInSource() {
  const found = new Set<string>()
  for (const file of walk('app')) {
    for (const match of readFileSync(file, 'utf8').matchAll(T_PATTERN)) {
      const key = match[1]!.replace(/\\'/g, '\'')
      if (/[一-鿿]/.test(key))
        found.add(key)
    }
  }
  return found
}

function messageAt(root: unknown, path: string) {
  let cursor: unknown = root
  for (const part of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in (cursor as Record<string, unknown>)))
      return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return typeof cursor === 'string' ? cursor : undefined
}

function placeholders(text: string) {
  return [...text.matchAll(/\{[A-Za-z0-9_]+\}/g)].map(item => item[0]).sort()
}

describe('创作台文案译文覆盖', () => {
  it("源码里的 t('中文') 都在 en.json 里有译文", () => {
    const en = JSON.parse(readFileSync('i18n/locales/en.json', 'utf8')) as Record<string, unknown>
    const missing = new Set<string>()
    for (const file of walk('app')) {
      for (const match of readFileSync(file, 'utf8').matchAll(T_PATTERN)) {
        const key = match[1]!.replace(/\\'/g, '\'')
        if (/[一-鿿]/.test(key) && !(key in en))
          missing.add(`${key}（${file}）`)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('不再新增中文 key', () => {
    const baseline = new Set(
      readFileSync('scripts/i18n-zh-baseline.txt', 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')),
    )
    const added = [...chineseKeysInSource()].filter(key => !baseline.has(key)).sort()
    expect(added).toEqual([])
  })

  it('structured key（canvas.* / account.* / create.* / watch.* / inbox.* / auth.passwordToggle.*）在每种语言里都能解析，占位符和中文一致', () => {
    const prefixes = ['canvas.', 'account.', 'create.timeline.', 'create.layers.', 'create.leave.', 'watch.', 'inbox.', 'auth.passwordToggle.']
    const keys = new Set<string>()
    for (const file of walk('app')) {
      for (const match of readFileSync(file, 'utf8').matchAll(T_PATTERN)) {
        const key = match[1]!.replace(/\\'/g, '\'')
        if (prefixes.some(prefix => key.startsWith(prefix)))
          keys.add(key)
      }
    }
    expect(keys.size).toBeGreaterThan(0)
    for (const prefix of prefixes)
      expect([...keys].some(key => key.startsWith(prefix))).toBe(true)
    const bundles = Object.fromEntries(LOCALES.map(code => [
      code,
      JSON.parse(readFileSync(`i18n/locales/${code}.json`, 'utf8')) as unknown,
    ]))
    const problems: string[] = []
    for (const key of keys) {
      const zh = messageAt(bundles.zh, key)
      if (!zh) {
        problems.push(`${key} 缺少 zh`)
        continue
      }
      const zhHoles = placeholders(zh).join(',')
      for (const code of LOCALES) {
        const text = messageAt(bundles[code], key)
        if (!text)
          problems.push(`${key} 缺少 ${code}`)
        else if (placeholders(text).join(',') !== zhHoles)
          problems.push(`${key} 的 ${code} 占位符和中文不一致`)
      }
    }
    expect(problems).toEqual([])
  })
})
