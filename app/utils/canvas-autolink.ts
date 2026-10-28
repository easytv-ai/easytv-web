/**
 * 智能引用 AutoLink（L1，API.md 31.2）：提示词里打到与参考素材同名的词时，
 * 就地给出一个引用建议，Tab 确认成 {{ref:素材名}} 标签，Shift+Tab 一次确认整段。
 * 标签文案自带素材名，提交前 expandPromptTokens 会展开成 @素材名，后端不需要知道这套。
 */

export type RefCandidate = {
  /** 素材名，也是标签 key；一条提示词里唯一 */
  name: string
  kind: 'image' | 'video' | 'audio'
  /** 缩略图地址，切换引用对象的弹层里展示 */
  url?: string
}

export type RefMatch = {
  name: string
  /** 命中的词在提示词里的起止下标 */
  start: number
  end: number
}

export const REF_TOKEN_RE = /\{\{ref:([^{}]{1,40})\}\}/g

/** 候选词最长比到 12 个字符，再长的短语不再当素材名看 */
const MAX_WORD = 12

export function refToken(name?: string) {
  const key = String(name || '').trim()
  return key && !/[{}]/.test(key) ? `{{ref:${key}}}` : ''
}

export function refNamesInPrompt(prompt?: string) {
  const names: string[] = []
  const re = new RegExp(REF_TOKEN_RE.source, 'g')
  let match: RegExpExecArray | null
  const src = String(prompt || '')
  while ((match = re.exec(src))) {
    const name = (match[1] || '').trim()
    if (name && !names.includes(name))
      names.push(name)
  }
  return names
}

export function stripRefTokens(prompt?: string) {
  return String(prompt || '').replace(new RegExp(REF_TOKEN_RE.source, 'g'), '')
}

/** 发给模型前展开：{{ref:图片1}} → @图片1 */
export function expandRefTokens(prompt?: string) {
  return String(prompt || '').replace(new RegExp(REF_TOKEN_RE.source, 'g'), (_all, name: string) => `@${String(name).trim()}`)
}

/** 同类素材的默认名：图片1 / 视频2 / 音频1 */
export function refAlias(kind: RefCandidate['kind'], index: number) {
  const label = kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'
  return `${label}${index}`
}

/** 名字撞车时加序号，保证一条提示词里 {{ref:名}} 能唯一定位 */
export function dedupeRefNames(items: Array<{ name: string, kind: RefCandidate['kind'], url?: string }>): RefCandidate[] {
  const used = new Set<string>()
  const out: RefCandidate[] = []
  for (const item of items) {
    let name = String(item.name || '').replace(/[{}]/g, '').trim()
    if (!name)
      name = refAlias(item.kind, out.filter(row => row.kind === item.kind).length + 1)
    if (used.has(name)) {
      let n = 2
      while (used.has(`${name} ${n}`))
        n++
      name = `${name} ${n}`
    }
    used.add(name)
    out.push({ name, kind: item.kind, url: item.url })
  }
  return out
}

/** 落在标签里的下标不参与匹配，免得把 {{ref:图片1}} 里的字再当词看 */
function tokenRanges(src: string) {
  const ranges: Array<[number, number]> = []
  const re = new RegExp(/\{\{(?:ref|cam|mark):[^{}]*\}\}/.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(src)))
    ranges.push([match.index, match.index + match[0].length])
  return ranges
}

function inRanges(ranges: Array<[number, number]>, start: number, end: number) {
  return ranges.some(([a, b]) => start < b && end > a)
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, '')
}

const BREAK_RE = /[\s，。、；：！？,.;:!?"'“”‘’()（）【】[\]{}]/

/** 用户主动打的 @ 一起吃掉，确认后不会留下一个孤零零的 @ */
function withAt(src: string, start: number) {
  return start > 0 && src[start - 1] === '@' ? start - 1 : start
}

/** 光标前最长的一段词，遇到空白或标点就停 */
function wordBefore(src: string, caret: number) {
  let start = caret
  while (start > 0 && start > caret - MAX_WORD && !BREAK_RE.test(src[start - 1] || ''))
    start--
  return src.slice(start, caret)
}

/**
 * 光标处的引用建议：先看光标前是不是刚好打完一个素材名（长名优先），
 * 再退一步看有没有素材名以光标前这几个字开头（打到一半也给建议，至少两个字符）。
 */
export function matchRefAt(prompt: string, caret: number, refs: RefCandidate[]): RefMatch | null {
  const src = String(prompt || '')
  const at = Math.max(0, Math.min(caret, src.length))
  if (!refs.length || !at)
    return null
  const ranges = tokenRanges(src)
  const sorted = [...refs].sort((a, b) => b.name.length - a.name.length)
  for (const ref of sorted) {
    const start = at - ref.name.length
    if (start < 0)
      continue
    if (normalize(src.slice(start, at)) !== normalize(ref.name))
      continue
    const from = withAt(src, start)
    if (inRanges(ranges, from, at))
      continue
    return { name: ref.name, start: from, end: at }
  }
  const word = wordBefore(src, at)
  for (let len = word.length; len >= 2; len--) {
    const tail = normalize(word.slice(word.length - len))
    if (tail.length < 2)
      break
    const hit = sorted.find(ref => normalize(ref.name).startsWith(tail))
    if (!hit)
      continue
    const from = withAt(src, at - len)
    if (inRanges(ranges, from, at))
      continue
    return { name: hit.name, start: from, end: at }
  }
  return null
}

/**
 * 光标前是不是刚打了一个 @ 开头的词（L21：@ 唤起素材）。
 * 只在没有素材能匹配时才用得上——有匹配走 matchRefAt 的建议条。
 * 返回 @ 的位置到光标的范围，确认后整段替换成引用标签。
 */
export function atWordAt(prompt: string, caret: number): { start: number, end: number, text: string } | null {
  const src = String(prompt || '')
  const at = Math.max(0, Math.min(caret, src.length))
  let start = at
  while (start > 0 && start > at - MAX_WORD && !BREAK_RE.test(src[start - 1] || '') && src[start - 1] !== '@')
    start--
  if (start === 0 || src[start - 1] !== '@')
    return null
  const from = start - 1
  if (inRanges(tokenRanges(src), from, at))
    return null
  return { start: from, end: at, text: src.slice(start, at) }
}

/** 素材列表变化时新出现的那些名字，按出现顺序 */
export function newRefNames(before: RefCandidate[], after: RefCandidate[]) {
  const seen = new Set(before.map(item => item.name))
  return after.map(item => item.name).filter(name => !seen.has(name))
}

/** 整段里所有能确认的引用（Shift+Tab 用）：只认完整素材名，不做前缀猜测 */
export function matchAllRefs(prompt: string, refs: RefCandidate[]): RefMatch[] {
  const src = String(prompt || '')
  const ranges = tokenRanges(src)
  const out: RefMatch[] = []
  const taken: Array<[number, number]> = []
  // 长名优先，避免「图片1」被「图片」先吃掉
  const sorted = [...refs].sort((a, b) => b.name.length - a.name.length)
  for (const ref of sorted) {
    const needle = ref.name
    if (!needle)
      continue
    let from = 0
    for (;;) {
      const idx = src.indexOf(needle, from)
      if (idx < 0)
        break
      const start = src[idx - 1] === '@' ? idx - 1 : idx
      const end = idx + needle.length
      if (!inRanges(ranges, start, end) && !inRanges(taken, start, end)) {
        out.push({ name: needle, start, end })
        taken.push([start, end])
      }
      from = idx + needle.length
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 把一处命中换成标签，返回新提示词与光标位置 */
export function applyRefMatch(prompt: string, match: RefMatch) {
  const src = String(prompt || '')
  const token = refToken(match.name)
  if (!token)
    return { prompt: src, caret: match.end }
  return {
    prompt: src.slice(0, match.start) + token + src.slice(match.end),
    caret: match.start + token.length,
  }
}

/** 从后往前替换，前面的下标才不会被挪动 */
export function applyRefMatches(prompt: string, matches: RefMatch[]) {
  let src = String(prompt || '')
  const ordered = [...matches].sort((a, b) => b.start - a.start)
  for (const match of ordered)
    src = applyRefMatch(src, match).prompt
  return { prompt: src, caret: src.length }
}

/** 切换标签引用的素材：第 n 个 {{ref:旧名}} 换成新名 */
export function switchRefToken(prompt: string, oldName: string, newName: string, nth = 0) {
  const src = String(prompt || '')
  const from = refToken(oldName)
  const to = refToken(newName)
  if (!from || !to)
    return src
  let seen = -1
  let out = ''
  let last = 0
  for (;;) {
    const idx = src.indexOf(from, last)
    if (idx < 0)
      break
    seen++
    out += src.slice(last, idx) + (seen === nth ? to : from)
    last = idx + from.length
  }
  return out + src.slice(last)
}
