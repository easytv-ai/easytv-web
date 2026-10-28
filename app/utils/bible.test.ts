import { describe, expect, it } from 'vitest'
import {
  bibleForSave,
  dropCharacterRefs,
  dropFactRefs,
  emptyBible,
  episodeNoLabel,
  episodeStatusLabel,
  factLabel,
  formatImpact,
  formatImpactRow,
  impactQueryOf,
  isBibleConflict,
  knows,
  newCharacter,
  newFact,
  newProp,
  newThread,
  nextBibleKey,
  normalizeBible,
  setKnowledge,
} from './bible'
import type { Bible, ImpactEpisode } from '~/types/creative'

const tr = (key: string, params?: Record<string, unknown>) =>
  key.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

function sample(): Bible {
  return {
    title: ' 雨夜 ',
    logline: '一段录音牵出的旧案 ',
    characters: [
      { key: 'c1', name: '阿杰', look: '短发', voice: 'onyx', voice_style: '', traits: '', relationships: [{ to: 'c2', relation: '前女友' }, { to: 'c9', relation: '不存在' }, { to: 'c1', relation: '自己' }, { to: '', relation: '半空' }], knows: ['f1', 'f1', 'f9'] },
      { key: 'c2', name: '小雨', look: '', voice: '', voice_style: '', traits: '', relationships: [], knows: [] },
    ],
    props: [
      { key: 'p1', name: '录音手机', holder: 'c2', state: '屏幕碎了', note: '' },
      { key: 'p2', name: '钥匙', holder: 'c9', state: '', note: '' },
    ],
    threads: [
      { key: 't1', title: '录音里是谁', status: 'open', opened_in: 1, resolved_in: 3 },
      { key: 't2', title: '钥匙开哪扇门', status: 'resolved', opened_in: 1, resolved_in: 2 },
    ],
    facts: [
      { key: 'f1', text: '手机里有录音', revealed_in: 1, audience_knows: true, known_by: ['c2', 'c9', 'c2'] },
    ],
    episodes: [
      { no: 1, screenplay_id: 4, title: '餐厅对峙', summary: '…', revealed: ['f1', 'f9'], open: ['t1', 't9'], relationships: [], prop_changes: [{ prop: 'p1', holder: 'c9', state: '' }, { prop: 'p9', holder: '', state: '' }], characters: ['c1', 'c9'], updated_at: 0 },
    ],
  }
}

describe('normalizeBible', () => {
  it('补齐缺省字段与数组，null 变空值，集记录按集号排', () => {
    const b = normalizeBible({
      title: null,
      characters: [{ key: 'c1', name: '阿杰', relationships: null, knows: null }],
      props: [{ name: '手机' }],
      threads: [{ title: '谁', status: 'weird', opened_in: '2', resolved_in: 5 }, { key: 't2', title: '解了', status: 'resolved', resolved_in: '3' }],
      facts: [{ text: '录音', audience_knows: 1, known_by: ['c1'] }],
      episodes: [{ no: 2, screenplay_id: 5 }, { no: 1, screenplay_id: 4, prop_changes: [{ prop: 'p1' }] }],
    })
    expect(b.title).toBe('')
    expect(b.characters[0]).toEqual({ key: 'c1', name: '阿杰', look: '', voice: '', voice_style: '', traits: '', relationships: [], knows: [] })
    expect(b.props[0]).toEqual({ key: 'p1', name: '手机', holder: '', state: '', note: '' })
    // 非法状态回落 open，open 的线索不带解于第几集
    expect(b.threads[0]).toEqual({ key: 't1', title: '谁', status: 'open', opened_in: 2, resolved_in: 0 })
    expect(b.threads[1]).toMatchObject({ status: 'resolved', resolved_in: 3 })
    expect(b.facts[0]).toEqual({ key: 'f1', text: '录音', revealed_in: 0, audience_knows: true, known_by: ['c1'] })
    expect(b.episodes.map(e => e.no)).toEqual([1, 2])
    expect(b.episodes[0]?.prop_changes).toEqual([{ prop: 'p1', holder: '', state: '' }])
  })

  it('非对象输入得到空圣经', () => {
    expect(normalizeBible(null)).toEqual(emptyBible())
    expect(normalizeBible('x')).toEqual(emptyBible())
  })
})

describe('bibleForSave', () => {
  it('去空白、丢掉半空 / 自指 / 悬空的关系，清掉指向不存在对象的引用', () => {
    const out = bibleForSave(sample())
    expect(out.title).toBe('雨夜')
    expect(out.logline).toBe('一段录音牵出的旧案')
    expect(out.characters[0]?.relationships).toEqual([{ to: 'c2', relation: '前女友' }])
    expect(out.characters[0]?.knows).toEqual(['f1'])
    expect(out.props[0]?.holder).toBe('c2')
    expect(out.props[1]?.holder).toBe('')
    expect(out.facts[0]?.known_by).toEqual(['c2'])
  })

  it('线索：open 不带 resolved_in，resolved 保留', () => {
    const out = bibleForSave(sample())
    expect(out.threads[0]).toEqual({ key: 't1', title: '录音里是谁', status: 'open', opened_in: 1, resolved_in: 0 })
    expect(out.threads[1]).toEqual({ key: 't2', title: '钥匙开哪扇门', status: 'resolved', opened_in: 1, resolved_in: 2 })
  })

  it('每集记录里的悬空引用也清掉，但不改其它内容', () => {
    const out = bibleForSave(sample())
    const ep = out.episodes[0]!
    expect(ep.revealed).toEqual(['f1'])
    expect(ep.open).toEqual(['t1'])
    expect(ep.characters).toEqual(['c1'])
    expect(ep.prop_changes).toEqual([{ prop: 'p1', holder: '', state: '' }])
    expect(ep.title).toBe('餐厅对峙')
  })

  it('不改输入对象', () => {
    const input = sample()
    bibleForSave(input)
    expect(input.title).toBe(' 雨夜 ')
    expect(input.characters[0]?.relationships).toHaveLength(4)
  })
})

describe('key 生成与新条目', () => {
  it('nextBibleKey 跳过已占用的编号', () => {
    expect(nextBibleKey('c', [])).toBe('c1')
    expect(nextBibleKey('c', [{ key: 'c1' }, { key: 'c2' }])).toBe('c3')
    expect(nextBibleKey('p', [{ key: 'p2' }])).toBe('p3')
    expect(nextBibleKey('f', [{ key: 'f1' }, { key: 'f3' }])).toBe('f4')
  })

  it('新条目带完整字段', () => {
    expect(newCharacter([])).toEqual({ key: 'c1', name: '', look: '', voice: '', voice_style: '', traits: '', relationships: [], knows: [] })
    expect(newProp([])).toEqual({ key: 'p1', name: '', holder: '', state: '', note: '' })
    expect(newThread([], 2)).toEqual({ key: 't1', title: '', status: 'open', opened_in: 2, resolved_in: 0 })
    expect(newFact([], 3)).toEqual({ key: 'f1', text: '', revealed_in: 3, audience_knows: true, known_by: [] })
  })
})

describe('删除后的引用清理', () => {
  it('dropCharacterRefs 清关系 / 知情人 / 持有人', () => {
    const b = sample()
    b.characters.splice(1, 1)
    dropCharacterRefs(b, 'c2')
    expect(b.characters[0]?.relationships.some(r => r.to === 'c2')).toBe(false)
    expect(b.facts[0]?.known_by).not.toContain('c2')
    expect(b.props[0]?.holder).toBe('')
  })

  it('dropFactRefs 清人物的知道列表', () => {
    const b = sample()
    dropFactRefs(b, 'f1')
    expect(b.characters[0]?.knows).not.toContain('f1')
  })
})

describe('setKnowledge / knows', () => {
  it('两边同时加、同时删，不重复', () => {
    const b = sample()
    setKnowledge(b, 'c1', 'f1', true)
    expect(b.characters[0]?.knows.filter(k => k === 'f1')).toHaveLength(1)
    expect(b.facts[0]?.known_by).toContain('c1')
    expect(knows(b, 'c1', 'f1')).toBe(true)
    setKnowledge(b, 'c1', 'f1', false)
    expect(b.characters[0]?.knows).not.toContain('f1')
    expect(b.facts[0]?.known_by).not.toContain('c1')
    expect(knows(b, 'c1', 'f1')).toBe(false)
  })

  it('只在一处记着也算知道', () => {
    const b = sample()
    expect(knows(b, 'c2', 'f1')).toBe(true)
    expect(knows(b, 'c9', 'f1')).toBe(true)
    expect(knows(b, 'c2', 'f9')).toBe(false)
  })
})

describe('文案', () => {
  it('episodeStatusLabel / episodeNoLabel', () => {
    expect(episodeStatusLabel(0, tr)).toBe('生成中')
    expect(episodeStatusLabel(1, tr)).toBe('待确认')
    expect(episodeStatusLabel(2, tr)).toBe('已建画布')
    expect(episodeStatusLabel(-1, tr)).toBe('失败')
    expect(episodeNoLabel(3, tr)).toBe('第 3 集')
    expect(episodeNoLabel(0, tr)).toBe('未编号')
  })

  it('factLabel 截断', () => {
    expect(factLabel({ key: 'f1', text: '手机里有录音', revealed_in: 1, audience_knows: true, known_by: [] })).toBe('手机里有录音')
    expect(factLabel({ key: 'f1', text: '一二三四五六', revealed_in: 1, audience_knows: true, known_by: [] }, 3)).toBe('一二三…')
    expect(factLabel({ key: 'f1', text: '  ', revealed_in: 1, audience_knows: true, known_by: [] })).toBe('f1')
  })
})

describe('查影响', () => {
  it('impactQueryOf 四选一，空值 null', () => {
    expect(impactQueryOf('character', ' c1 ')).toEqual({ character: 'c1' })
    expect(impactQueryOf('text', '录音')).toEqual({ text: '录音' })
    expect(impactQueryOf('prop', '  ')).toBeNull()
  })

  it('formatImpactRow：第 N 集《标题》· 场次 · 镜 1、3 · 原因', () => {
    const row = formatImpactRow({ episode_no: 2, screenplay_id: 7, title: '餐厅对峙', scenes: ['餐厅', '走廊'], shots: [3, 1], why: '阿杰出场' }, tr)
    expect(row.head).toBe('第 2 集《餐厅对峙》')
    expect(row.scenes).toBe('餐厅、走廊')
    expect(row.shots).toBe('镜 1、3')
    expect(row.line).toBe('第 2 集《餐厅对峙》 · 餐厅、走廊 · 镜 1、3 · 阿杰出场')
    expect(row.screenplay_id).toBe(7)
  })

  it('没标题 / 没集号 / 没场次时省略对应段', () => {
    expect(formatImpactRow({ episode_no: 0, screenplay_id: 1, title: '', scenes: [], shots: [], why: '' }, tr).line).toBe('未编号')
    expect(formatImpactRow({ episode_no: 1, screenplay_id: 1, title: '', scenes: [], shots: [2], why: '' }, tr).line).toBe('第 1 集 · 镜 2')
    expect(formatImpactRow({ episode_no: 0, screenplay_id: 1, title: '番外', scenes: [], shots: [], why: '提到' }, tr).line).toBe('《番外》 · 提到')
  })

  it('formatImpact 按集号排', () => {
    const list: ImpactEpisode[] = [
      { episode_no: 3, screenplay_id: 3, title: 'c', scenes: [], shots: [], why: '' },
      { episode_no: 1, screenplay_id: 1, title: 'a', scenes: [], shots: [], why: '' },
    ]
    expect(formatImpact(list, tr).map(r => r.screenplay_id)).toEqual([1, 3])
  })

  it('isBibleConflict 认后端的乐观锁提示', () => {
    expect(isBibleConflict('剧集设定已在其他地方修改，请刷新后再保存')).toBe(true)
    expect(isBibleConflict('Version conflict')).toBe(true)
    expect(isBibleConflict('人物 c1 缺少名字')).toBe(false)
    expect(isBibleConflict(undefined)).toBe(false)
  })
})
