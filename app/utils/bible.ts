import type {
  Bible,
  BibleCharacter,
  BibleEpisode,
  BibleFact,
  BibleProp,
  BibleThread,
  ImpactEpisode,
  ImpactQuery,
  ScreenplayStatus,
} from '~/types/creative'

/**
 * 剧集圣经（API.md 27）的纯函数：接口 JSON ↔ 表单结构的归一化、提交前清理、影响结果格式化。
 * 不依赖 Nuxt 运行时，文案通过 tr 参数接收 t。
 */

export type Translate = (key: string, params?: Record<string, unknown>) => string

/** 与后端 model.Bible 的字数上限一致（Normalize 会截断，这里只用于 maxlength） */
export const BIBLE_LIMITS = {
  title: 60,
  logline: 300,
  name: 30,
  look: 300,
  voice: 40,
  voiceStyle: 40,
  traits: 300,
  relation: 100,
  propName: 40,
  propState: 100,
  note: 300,
  threadTitle: 100,
  factText: 300,
  characters: 20,
  props: 40,
  threads: 60,
  facts: 120,
} as const

/** 场次表三栏各 ≤ 200 字（API.md 27.1） */
export const SCENE_BEAT_MAX = 200

export type ImpactKind = 'character' | 'prop' | 'fact' | 'text'

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function int(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : []
}

export function emptyBible(title = ''): Bible {
  return { title, logline: '', characters: [], props: [], threads: [], facts: [], episodes: [] }
}

/** 接口返回的圣经 → 表单结构：补齐缺省字段与数组，老数据里的 null 都变成空值 */
export function normalizeBible(raw: unknown): Bible {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const characters: BibleCharacter[] = Array.isArray(b.characters)
    ? b.characters.map((c, i) => {
        const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
        return {
          key: str(o.key) || `c${i + 1}`,
          name: str(o.name),
          look: str(o.look),
          voice: str(o.voice),
          voice_style: str(o.voice_style),
          traits: str(o.traits),
          relationships: Array.isArray(o.relationships)
            ? o.relationships.map((r) => {
                const rel = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
                return { to: str(rel.to), relation: str(rel.relation) }
              })
            : [],
          knows: strList(o.knows),
        }
      })
    : []
  const props: BibleProp[] = Array.isArray(b.props)
    ? b.props.map((p, i) => {
        const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
        return { key: str(o.key) || `p${i + 1}`, name: str(o.name), holder: str(o.holder), state: str(o.state), note: str(o.note) }
      })
    : []
  const threads: BibleThread[] = Array.isArray(b.threads)
    ? b.threads.map((t, i) => {
        const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
        const status = o.status === 'resolved' ? 'resolved' : 'open'
        return { key: str(o.key) || `t${i + 1}`, title: str(o.title), status, opened_in: int(o.opened_in), resolved_in: status === 'resolved' ? int(o.resolved_in) : 0 }
      })
    : []
  const facts: BibleFact[] = Array.isArray(b.facts)
    ? b.facts.map((f, i) => {
        const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
        return { key: str(o.key) || `f${i + 1}`, text: str(o.text), revealed_in: int(o.revealed_in), audience_knows: Boolean(o.audience_knows), known_by: strList(o.known_by) }
      })
    : []
  const episodes: BibleEpisode[] = Array.isArray(b.episodes)
    ? b.episodes.map((e, i) => {
        const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
        return {
          no: int(o.no) || i + 1,
          screenplay_id: int(o.screenplay_id),
          title: str(o.title),
          summary: str(o.summary),
          revealed: strList(o.revealed),
          open: strList(o.open),
          relationships: strList(o.relationships),
          prop_changes: Array.isArray(o.prop_changes)
            ? o.prop_changes.map((pc) => {
                const c = (pc && typeof pc === 'object' ? pc : {}) as Record<string, unknown>
                return { prop: str(c.prop), holder: str(c.holder), state: str(c.state) }
              })
            : [],
          characters: strList(o.characters),
          updated_at: Number(o.updated_at) || 0,
        }
      })
    : []
  episodes.sort((a, b) => a.no - b.no)
  return { title: str(b.title), logline: str(b.logline), characters, props, threads, facts, episodes }
}

/**
 * 表单 → 提交结构：去空白、丢掉半空的关系行、把指向已删除对象的引用清掉，
 * 已解决的线索才带 resolved_in。名字为空等校验留给后端，message 原样给用户。
 */
export function bibleForSave(bible: Bible): Bible {
  const trim = (v: unknown) => str(v).trim()
  const charKeys = new Set(bible.characters.map(c => c.key))
  const factKeys = new Set(bible.facts.map(f => f.key))
  const propKeys = new Set(bible.props.map(p => p.key))
  const threadKeys = new Set(bible.threads.map(t => t.key))
  const uniq = (list: string[], allowed: Set<string>) => list.filter((k, i) => allowed.has(k) && list.indexOf(k) === i)
  return {
    title: trim(bible.title),
    logline: trim(bible.logline),
    characters: bible.characters.map(c => ({
      key: trim(c.key),
      name: trim(c.name),
      look: trim(c.look),
      voice: trim(c.voice),
      voice_style: trim(c.voice_style),
      traits: trim(c.traits),
      relationships: c.relationships
        .map(r => ({ to: trim(r.to), relation: trim(r.relation) }))
        .filter(r => r.to && r.relation && charKeys.has(r.to) && r.to !== c.key),
      knows: uniq(c.knows, factKeys),
    })),
    props: bible.props.map(p => ({
      key: trim(p.key),
      name: trim(p.name),
      holder: charKeys.has(trim(p.holder)) ? trim(p.holder) : '',
      state: trim(p.state),
      note: trim(p.note),
    })),
    threads: bible.threads.map(t => ({
      key: trim(t.key),
      title: trim(t.title),
      status: t.status === 'resolved' ? 'resolved' : 'open',
      opened_in: int(t.opened_in),
      resolved_in: t.status === 'resolved' ? int(t.resolved_in) : 0,
    })),
    facts: bible.facts.map(f => ({
      key: trim(f.key),
      text: trim(f.text),
      revealed_in: int(f.revealed_in),
      audience_knows: Boolean(f.audience_knows),
      known_by: uniq(f.known_by, charKeys),
    })),
    episodes: bible.episodes.map(e => ({
      ...e,
      revealed: uniq(e.revealed, factKeys),
      open: uniq(e.open, threadKeys),
      characters: uniq(e.characters, charKeys),
      prop_changes: e.prop_changes.filter(pc => propKeys.has(pc.prop)).map(pc => ({ ...pc, holder: charKeys.has(pc.holder) ? pc.holder : '' })),
    })),
  }
}

/** 下一个未占用的 key：c1 / p1 / t1 / f1…（人物 c、道具 p、线索 t、事实 f） */
export function nextBibleKey(prefix: 'c' | 'p' | 't' | 'f', list: { key: string }[]): string {
  let n = list.length + 1
  while (list.some(item => item.key === `${prefix}${n}`))
    n += 1
  return `${prefix}${n}`
}

export function newCharacter(list: BibleCharacter[]): BibleCharacter {
  return { key: nextBibleKey('c', list), name: '', look: '', voice: '', voice_style: '', traits: '', relationships: [], knows: [] }
}

export function newProp(list: BibleProp[]): BibleProp {
  return { key: nextBibleKey('p', list), name: '', holder: '', state: '', note: '' }
}

export function newThread(list: BibleThread[], openedIn = 0): BibleThread {
  return { key: nextBibleKey('t', list), title: '', status: 'open', opened_in: openedIn, resolved_in: 0 }
}

export function newFact(list: BibleFact[], revealedIn = 0): BibleFact {
  return { key: nextBibleKey('f', list), text: '', revealed_in: revealedIn, audience_knows: true, known_by: [] }
}

/**
 * 删除人物后清掉别处对它的引用（关系 / 知情人 / 道具持有人），否则保存时后端报「指向不存在的人物」。
 * 就地修改并返回同一对象。
 */
export function dropCharacterRefs(bible: Bible, key: string): Bible {
  for (const c of bible.characters)
    c.relationships = c.relationships.filter(r => r.to !== key)
  for (const f of bible.facts)
    f.known_by = f.known_by.filter(k => k !== key)
  for (const p of bible.props) {
    if (p.holder === key)
      p.holder = ''
  }
  return bible
}

/**
 * 「谁知道什么」同时存在人物 knows 与事实 known_by 两处（后端两边都读），编辑器把它当一份关系改：
 * on=true 两边都加，false 两边都删。就地修改并返回同一对象。
 */
export function setKnowledge(bible: Bible, charKey: string, factKey: string, on: boolean): Bible {
  const c = bible.characters.find(x => x.key === charKey)
  const f = bible.facts.find(x => x.key === factKey)
  if (c) {
    c.knows = on ? [...new Set([...c.knows, factKey])] : c.knows.filter(k => k !== factKey)
  }
  if (f) {
    f.known_by = on ? [...new Set([...f.known_by, charKey])] : f.known_by.filter(k => k !== charKey)
  }
  return bible
}

/** 人物是否知道某事实：两处任一记了就算 */
export function knows(bible: Bible, charKey: string, factKey: string): boolean {
  return Boolean(bible.characters.find(x => x.key === charKey)?.knows.includes(factKey))
    || Boolean(bible.facts.find(x => x.key === factKey)?.known_by.includes(charKey))
}

/** 删除事实后把人物「知道」列表里的引用清掉 */
export function dropFactRefs(bible: Bible, key: string): Bible {
  for (const c of bible.characters)
    c.knows = c.knows.filter(k => k !== key)
  return bible
}

/** 人物 / 道具的显示名：没填名字时退回 key */
export function bibleName(list: { key: string, name: string }[], key: string): string {
  const item = list.find(x => x.key === key)
  return item?.name?.trim() || key
}

/** 事实的短标签（下拉 / 标签用）：正文截断到 n 字 */
export function factLabel(fact: BibleFact, n = 24): string {
  const text = fact.text.trim() || fact.key
  return text.length > n ? `${text.slice(0, n)}…` : text
}

/** 集目录状态文案（ScreenplayStatus：0 生成中 1 待确认 2 已建画布 -1 失败） */
export function episodeStatusLabel(status: ScreenplayStatus | number, tr: Translate): string {
  switch (status) {
    case 0: return tr('生成中')
    case 1: return tr('待确认')
    case 2: return tr('已建画布')
    case -1: return tr('失败')
    default: return tr('未知')
  }
}

/** 集号文案：0 = 未编号 */
export function episodeNoLabel(no: number, tr: Translate): string {
  return no > 0 ? tr('第 {n} 集', { n: no }) : tr('未编号')
}

/** 查影响的入参：人物 / 道具 / 事实带 key，文本带原文；空值返回 null */
export function impactQueryOf(kind: ImpactKind, value: string): ImpactQuery | null {
  const v = value.trim()
  if (!v)
    return null
  return { [kind]: v } as ImpactQuery
}

export type ImpactRow = {
  screenplay_id: number
  /** 第 N 集《标题》 */
  head: string
  /** 场次 a、b（没有则空串） */
  scenes: string
  /** 镜 1、3（没有则空串） */
  shots: string
  why: string
  /** 各段用 · 连起来的一行 */
  line: string
}

/** 影响结果 → 展示行：第 N 集《标题》· 场次 · 镜 1、3 · 原因 */
export function formatImpactRow(item: ImpactEpisode, tr: Translate): ImpactRow {
  const title = item.title.trim()
  const head = item.episode_no > 0
    ? (title ? tr('第 {n} 集《{title}》', { n: item.episode_no, title }) : tr('第 {n} 集', { n: item.episode_no }))
    : (title ? `《${title}》` : tr('未编号'))
  const scenes = item.scenes.length ? item.scenes.join('、') : ''
  const shots = item.shots.length ? tr('镜 {list}', { list: [...item.shots].sort((a, b) => a - b).join('、') }) : ''
  const why = item.why.trim()
  return {
    screenplay_id: item.screenplay_id,
    head,
    scenes,
    shots,
    why,
    line: [head, scenes, shots, why].filter(Boolean).join(' · '),
  }
}

export function formatImpact(list: ImpactEpisode[], tr: Translate): ImpactRow[] {
  return [...list].sort((a, b) => a.episode_no - b.episode_no).map(item => formatImpactRow(item, tr))
}

/** 保存冲突（乐观锁）：后端 message 里带「其他地方修改」 */
export function isBibleConflict(message: string | undefined): boolean {
  return /其他地方修改|conflict/i.test(message ?? '')
}
