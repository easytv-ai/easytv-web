import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 创作台文案以中文原文作 key，zh 一般不需要词条；但 vue-i18n 找不到 key 时原样返回、不做插值，
 * 带 {name} 参数的 key 缺了 zh 词条就会把「作者 {author}」直接显示出来。这里扫源码兜住。
 */
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

describe('zh 词条', () => {
  it('带插值参数的中文 key 都在 zh.json 里', () => {
    const zh = JSON.parse(readFileSync('i18n/locales/zh.json', 'utf8')) as Record<string, unknown>
    const pattern = /\b(?:t|tr|\$t)\(\s*'([^'\n]*\{[a-zA-Z_]+\}[^'\n]*)'/g
    const missing: string[] = []
    for (const file of walk('app')) {
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        const key = match[1]!
        if (/[一-鿿]/.test(key) && !(key in zh))
          missing.push(`${key}（${file}）`)
      }
    }
    expect(missing).toEqual([])
  })
})
