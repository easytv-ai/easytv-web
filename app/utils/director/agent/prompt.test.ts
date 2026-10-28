import { describe, expect, it } from 'vitest'
import { buildAgentPrompt, HISTORY_TURNS } from './prompt'
import { createDirectorStore } from '../store'

const store = createDirectorStore()

describe('buildAgentPrompt', () => {
  it('指令说明在最前，用户要求在最后附近', () => {
    const prompt = buildAgentPrompt({ store, history: [], question: '加个角色' })
    expect(prompt.indexOf('可用指令')).toBe(0)
    expect(prompt.indexOf('用户这次的要求：加个角色')).toBeGreaterThan(prompt.indexOf('当前场景'))
  })

  it('带上场景摘要，模型才知道有哪些名字可用', () => {
    expect(buildAgentPrompt({ store, history: [], question: 'x' })).toContain('角色01')
  })

  it('历史只留最近几轮', () => {
    const history = Array.from({ length: HISTORY_TURNS + 5 }, (_, index) => ({
      role: 'user' as const,
      content: `第${index}句`,
    }))
    const prompt = buildAgentPrompt({ store, history, question: 'x' })

    expect(prompt).not.toContain('第0句')
    expect(prompt).toContain(`第${HISTORY_TURNS + 4}句`)
  })

  it('没有历史时不写「之前的对话」那一段', () => {
    expect(buildAgentPrompt({ store, history: [], question: 'x' })).not.toContain('之前的对话')
  })

  it('结尾提醒只输出 JSON', () => {
    expect(buildAgentPrompt({ store, history: [], question: 'x' }).trimEnd()).toMatch(/只输出 JSON 指令数组。$/)
  })
})

describe('当前这句不会在历史里重复一遍', () => {
  it('历史末尾就是当前问题时把它去掉', () => {
    const prompt = buildAgentPrompt({
      store,
      history: [
        { role: 'user', content: '先加个角色' },
        { role: 'assistant', content: '已添加角色' },
        { role: 'user', content: '再加一台机位' },
      ],
      question: '再加一台机位',
    })

    expect(prompt.match(/再加一台机位/g)).toHaveLength(1)
    // 更早的那几轮要留着
    expect(prompt).toContain('先加个角色')
  })

  it('只是内容碰巧相同的更早一轮不会被误删', () => {
    const prompt = buildAgentPrompt({
      store,
      history: [
        { role: 'user', content: '加个角色' },
        { role: 'assistant', content: '已添加角色' },
      ],
      question: '加个角色',
    })

    expect(prompt.match(/加个角色/g)).toHaveLength(2)
  })
})
