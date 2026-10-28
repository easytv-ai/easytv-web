import { describe, expect, it } from 'vitest'
import {
  dialogueSummary,
  dropShotCharacter,
  ensureDialogue,
  normalizeDialogue,
  normalizeLangLines,
  normalizeLine,
  normalizeStates,
  planForSave,
  setShotState,
  shotDialogue,
  syncLineFromDialogue,
  voiceSegmentParams,
} from './plan-dialogue'
import type { ScreenplayShot } from '~/types/creative'

function shot(patch: Partial<ScreenplayShot> = {}): ScreenplayShot {
  return { no: 1, scene: 's1', characters: ['c1', 'c2'], prompt: '', motion: '', line: '', seconds: 4, ...patch }
}

describe('plan-dialogue · 归一化', () => {
  it('对白条目：narrator 归成空串，空 emotion / lines 不保留', () => {
    expect(normalizeLine({ speaker: ' narrator ', text: '夜色渐深', emotion: '', lines: {} })).toEqual({ speaker: '', text: '夜色渐深' })
    expect(normalizeLine({ speaker: 'c1', text: '手机呢', emotion: ' 试探 ', lines: { en: 'Where is the phone', '': 'x' } }))
      .toEqual({ speaker: 'c1', text: '手机呢', emotion: '试探', lines: { en: 'Where is the phone' } })
    expect(normalizeLine(null)).toEqual({ speaker: '', text: '' })
  })

  it('dialogue 非数组当空；states 只留非空条目', () => {
    expect(normalizeDialogue(undefined)).toEqual([])
    expect(normalizeDialogue([{ speaker: 'c1', text: 'a' }, 'bad'])).toEqual([{ speaker: 'c1', text: 'a' }, { speaker: '', text: '' }])
    expect(normalizeStates({ c1: ' 穿病号服 ', c2: '', ' ': 'x' })).toEqual({ c1: '穿病号服' })
    expect(normalizeStates({ c2: '  ' })).toBeUndefined()
    expect(normalizeStates(['a'])).toBeUndefined()
    expect(normalizeLangLines({ en: 'hi', '': 'drop' })).toEqual({ en: 'hi' })
    expect(normalizeLangLines([])).toBeUndefined()
  })
})

describe('plan-dialogue · line ↔ dialogue 兼容', () => {
  it('只有 line 的老镜头显示为一条旁白，并带上整镜译文', () => {
    const s = shot({ line: '他推门进来', lines: { en: 'He walks in' } })
    expect(shotDialogue(s)).toEqual([{ speaker: '', text: '他推门进来', lines: { en: 'He walks in' } }])
    expect(shotDialogue(shot({ line: '  ' }))).toEqual([])
    // 有 dialogue 时以 dialogue 为准
    expect(shotDialogue(shot({ line: 'x', dialogue: [{ speaker: 'c1', text: 'y' }] }))).toEqual([{ speaker: 'c1', text: 'y' }])
  })

  it('编辑时才把 line 转成 dialogue，且不共享对象', () => {
    const s = shot({ line: '他推门进来' })
    const list = ensureDialogue(s)
    expect(s.dialogue).toBe(list)
    expect(list).toEqual([{ speaker: '', text: '他推门进来' }])
    list[0]!.text = '改过了'
    syncLineFromDialogue(s)
    expect(s.line).toBe('改过了')
  })

  it('对白改动后 line 由各条正文拼出；清空后 dialogue=[]、line=""', () => {
    const s = shot({ dialogue: [{ speaker: 'c1', text: '手机呢' }, { speaker: 'c2', text: ' 在我这 ' }, { speaker: '', text: '  ' }] })
    syncLineFromDialogue(s)
    expect(s.line).toBe('手机呢 在我这')
    s.dialogue = [{ speaker: 'c1', text: '' }]
    syncLineFromDialogue(s)
    expect(s.dialogue).toEqual([])
    expect(s.line).toBe('')
  })

  it('摘要行：人物名 + 冒号，旁白用给定文案', () => {
    const names: Record<string, string> = { c1: '阿杰', c2: '小雨' }
    const s = shot({ dialogue: [{ speaker: 'c1', text: '手机呢' }, { speaker: 'c2', text: '在我这' }, { speaker: '', text: '（沉默）' }] })
    expect(dialogueSummary(s, k => names[k] ?? k, '旁白')).toBe('阿杰：手机呢 / 小雨：在我这 / 旁白：（沉默）')
    expect(dialogueSummary(shot({ line: '夜' }), k => k, '旁白')).toBe('旁白：夜')
    expect(dialogueSummary(shot(), k => k, '旁白')).toBe('')
  })
})

describe('plan-dialogue · 保存前整理', () => {
  it('去掉空条目并重拼 line；老数据只有 line 时原样保留；删光对白后 line 为空', () => {
    const plan = { title: '', style: '', aspect: '16:9', characters: [], scenes: [], shots: [
      shot({ dialogue: [{ speaker: 'c1', text: '手机呢' }, { speaker: 'c2', text: ' ' }], line: '手机呢', states: { c1: '', c2: ' 淋湿 ' } }),
      shot({ no: 2, line: '旁白整句', dialogue: [] }),
      shot({ no: 3, line: '', dialogue: [{ speaker: 'c1', text: '' }], states: {} }),
    ] }
    const out = planForSave(plan)
    expect(out.shots[0]).toMatchObject({ dialogue: [{ speaker: 'c1', text: '手机呢' }], line: '手机呢', states: { c2: '淋湿' } })
    expect(out.shots[1]).toMatchObject({ dialogue: [], line: '旁白整句' })
    expect(out.shots[2]).toMatchObject({ dialogue: [], line: '' })
    expect('states' in out.shots[2]!).toBe(false)
    // 不动原对象
    expect(plan.shots[0]!.dialogue).toHaveLength(2)
  })
})

describe('plan-dialogue · 本镜人物状态', () => {
  it('写入去空白，清空删键，没条目时去掉 states', () => {
    const s = shot()
    setShotState(s, 'c1', ' 穿病号服，左手缠绷带 ')
    expect(s.states).toEqual({ c1: '穿病号服，左手缠绷带' })
    setShotState(s, 'c2', '淋湿')
    setShotState(s, 'c1', '')
    expect(s.states).toEqual({ c2: '淋湿' })
    setShotState(s, 'c2', '   ')
    expect(s.states).toBeUndefined()
    setShotState(s, 'c9', '')
    expect(s.states).toBeUndefined()
  })

  it('取消勾选人物：移出 characters、删状态；说话人只在整体删除人物时改为旁白', () => {
    const s = shot({ states: { c1: 'a', c2: 'b' }, dialogue: [{ speaker: 'c1', text: 'x' }, { speaker: 'c2', text: 'y' }] })
    dropShotCharacter(s, 'c1')
    expect(s.characters).toEqual(['c2'])
    expect(s.states).toEqual({ c2: 'b' })
    expect(s.dialogue).toEqual([{ speaker: 'c1', text: 'x' }, { speaker: 'c2', text: 'y' }])
    dropShotCharacter(s, 'c2', true)
    expect(s.characters).toEqual([])
    expect(s.states).toBeUndefined()
    expect(s.dialogue).toEqual([{ speaker: 'c1', text: 'x' }, { speaker: '', text: 'y' }])
  })
})

describe('plan-dialogue · 配音分段参数', () => {
  it('只带 speaker / voice / text，空文本跳过，非数组为空', () => {
    expect(voiceSegmentParams([
      { speaker: 'c1', name: '阿杰', voice: ' nova ', style: '沉稳', text: '手机呢', emotion: '试探' },
      { speaker: '', text: '   ' },
      { speaker: 'c2', text: '在我这' },
      null,
    ])).toEqual([
      { speaker: 'c1', voice: 'nova', text: '手机呢' },
      { speaker: 'c2', voice: '', text: '在我这' },
    ])
    expect(voiceSegmentParams(undefined)).toEqual([])
  })
})
