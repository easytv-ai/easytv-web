import { describe, expect, it } from 'vitest'
import { historyLabel, parseAgentHistory, pushAgentHistory } from './agent-history'

describe('parseAgentHistory', () => {
  it('兼容旧版纯字符串列表', () => {
    expect(parseAgentHistory(['  一座古城  ', '', '一座古城'])).toEqual([
      { prompt: '一座古城' },
    ])
  })

  it('读出技能和素材附件', () => {
    expect(parseAgentHistory([
      { prompt: '夜景', skillId: 3, skillTitle: '电影感', assetId: 9, assetName: '参考图.png' },
      { prompt: '夜景', skillId: 3, assetId: 9 },
    ])).toEqual([
      { prompt: '夜景', skillId: 3, skillTitle: '电影感', assetId: 9, assetName: '参考图.png' },
    ])
  })

  it('只有附件、没有提示词也保留', () => {
    expect(parseAgentHistory([{ skillId: 2, skillTitle: '口播' }])).toEqual([
      { prompt: '', skillId: 2, skillTitle: '口播' },
    ])
  })

  it('脏数据丢掉', () => {
    expect(parseAgentHistory([null, 1, {}, { prompt: '  ' }, { skillId: -1 }])).toEqual([])
  })
})

describe('pushAgentHistory', () => {
  it('相同提示词和附件提到最前，容量封顶', () => {
    const first = pushAgentHistory([], { prompt: 'a' })
    const second = pushAgentHistory(first, { prompt: 'b', skillId: 1, skillTitle: 'S' })
    const again = pushAgentHistory(second, { prompt: 'a' })
    expect(again.map(item => item.prompt)).toEqual(['a', 'b'])
    const filled = Array.from({ length: 25 }, (_, i) => ({ prompt: String(i) }))
    expect(pushAgentHistory(filled, { prompt: 'x' })).toHaveLength(20)
    expect(pushAgentHistory(filled, { prompt: 'x' })[0]?.prompt).toBe('x')
  })
})

describe('historyLabel', () => {
  it('优先提示词，其次技能或素材名', () => {
    expect(historyLabel({ prompt: '夜景', skillTitle: '电影感' })).toBe('夜景')
    expect(historyLabel({ prompt: '', skillTitle: '电影感' })).toBe('电影感')
    expect(historyLabel({ prompt: '', assetName: 'a.png' })).toBe('a.png')
  })
})
