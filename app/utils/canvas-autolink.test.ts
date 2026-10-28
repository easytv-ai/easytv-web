import { describe, expect, it } from 'vitest'
import {
  applyRefMatch,
  applyRefMatches,
  atWordAt,
  newRefNames,
  dedupeRefNames,
  expandRefTokens,
  matchAllRefs,
  matchRefAt,
  refAlias,
  refNamesInPrompt,
  refToken,
  stripRefTokens,
  switchRefToken,
  type RefCandidate,
} from './canvas-autolink'

const refs: RefCandidate[] = [
  { name: '图片1', kind: 'image' },
  { name: '图片2', kind: 'image' },
  { name: '视频1', kind: 'video' },
  { name: '主角站姿', kind: 'image' },
]

describe('refToken 与展开', () => {
  it('素材名带花括号时不出标签', () => {
    expect(refToken('图片1')).toBe('{{ref:图片1}}')
    expect(refToken('图{片}')).toBe('')
    expect(refToken('  ')).toBe('')
  })

  it('提交前展开成 @素材名', () => {
    expect(expandRefTokens('参考{{ref:图片1}}的构图')).toBe('参考@图片1的构图')
  })

  it('剥掉标签与读出标签名', () => {
    expect(stripRefTokens('{{ref:图片1}}黄昏{{ref:视频1}}')).toBe('黄昏')
    expect(refNamesInPrompt('{{ref:图片1}}和{{ref:图片1}}与{{ref:视频1}}')).toEqual(['图片1', '视频1'])
  })
})

describe('matchRefAt', () => {
  it('打完整素材名后给建议', () => {
    const prompt = '参考图片1'
    expect(matchRefAt(prompt, prompt.length, refs)).toEqual({ name: '图片1', start: 2, end: 5 })
  })

  it('打一半也给建议，但单个字符不给', () => {
    expect(matchRefAt('主角', 2, refs)?.name).toBe('主角站姿')
    expect(matchRefAt('图', 1, refs)).toBeNull()
  })

  it('用户主动打 @ 时把 @ 一起吃掉', () => {
    const prompt = '让 @视频1 动起来'
    const hit = matchRefAt(prompt, 6, refs)
    expect(hit).toEqual({ name: '视频1', start: 2, end: 6 })
    expect(applyRefMatch(prompt, hit!).prompt).toBe('让 {{ref:视频1}} 动起来')
  })

  it('已经在标签里的字不再命中', () => {
    const prompt = '{{ref:图片1}}'
    expect(matchRefAt(prompt, prompt.length - 2, refs)).toBeNull()
  })

  it('没有候选素材时不给建议', () => {
    expect(matchRefAt('图片1', 3, [])).toBeNull()
  })

  it('标点后重新起词', () => {
    const prompt = '黄昏，图片2'
    expect(matchRefAt(prompt, prompt.length, refs)).toEqual({ name: '图片2', start: 3, end: 6 })
  })
})

describe('matchAllRefs 与批量确认', () => {
  it('整段里所有完整素材名都能确认', () => {
    const prompt = '图片1 的人物放进 视频1 的场景'
    const all = matchAllRefs(prompt, refs)
    expect(all.map(item => item.name)).toEqual(['图片1', '视频1'])
    expect(applyRefMatches(prompt, all).prompt).toBe('{{ref:图片1}} 的人物放进 {{ref:视频1}} 的场景')
  })

  it('长名优先，不会被短名先吃掉', () => {
    const list: RefCandidate[] = [{ name: '图片', kind: 'image' }, { name: '图片10', kind: 'image' }]
    expect(matchAllRefs('用图片10', list).map(item => item.name)).toEqual(['图片10'])
  })

  it('已有标签不会被重复包一层', () => {
    expect(matchAllRefs('{{ref:图片1}}再来一张图片2', refs).map(item => item.name)).toEqual(['图片2'])
  })
})

describe('dedupeRefNames', () => {
  it('重名补序号，空名按类型兜底', () => {
    expect(dedupeRefNames([
      { name: '参考', kind: 'image' },
      { name: '参考', kind: 'image' },
      { name: '', kind: 'video' },
    ])).toEqual([
      { name: '参考', kind: 'image', url: undefined },
      { name: '参考 2', kind: 'image', url: undefined },
      { name: '视频1', kind: 'video', url: undefined },
    ])
  })

  it('花括号会被去掉，免得毁掉标签', () => {
    expect(dedupeRefNames([{ name: '图{1}', kind: 'image' }])[0]!.name).toBe('图1')
  })
})

describe('refAlias 与 switchRefToken', () => {
  it('按类型给默认名', () => {
    expect(refAlias('image', 1)).toBe('图片1')
    expect(refAlias('video', 2)).toBe('视频2')
    expect(refAlias('audio', 3)).toBe('音频3')
  })

  it('只换第 n 个同名标签', () => {
    expect(switchRefToken('{{ref:图片1}}和{{ref:图片1}}', '图片1', '图片2', 1))
      .toBe('{{ref:图片1}}和{{ref:图片2}}')
  })
})

describe('atWordAt 与 newRefNames（@ 唤起素材）', () => {
  it('刚打了 @ 就命中，范围含 @ 本身', () => {
    expect(atWordAt('让 @', 3)).toEqual({ start: 2, end: 3, text: '' })
    expect(atWordAt('让 @猫', 4)).toEqual({ start: 2, end: 4, text: '猫' })
  })

  it('不是 @ 开头的词不算；@ 在标签里也不算', () => {
    expect(atWordAt('让 猫', 3)).toBeNull()
    expect(atWordAt('{{ref:@x}}', 8)).toBeNull()
    expect(atWordAt('', 0)).toBeNull()
  })

  it('新出现的素材名按顺序给出', () => {
    const before: RefCandidate[] = [{ name: '图片1', kind: 'image' }]
    const after: RefCandidate[] = [{ name: '图片1', kind: 'image' }, { name: '主角', kind: 'image' }, { name: '视频1', kind: 'video' }]
    expect(newRefNames(before, after)).toEqual(['主角', '视频1'])
    expect(newRefNames(after, before)).toEqual([])
  })
})
