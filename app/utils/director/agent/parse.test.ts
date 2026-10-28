import { describe, expect, it } from 'vitest'
import { CommandParseError, extractCommands } from './parse'

describe('extractCommands', () => {
  it('裸 JSON 数组', () => {
    expect(extractCommands('[{"action":"play"}]')).toEqual([{ action: 'play' }])
  })

  it('```json 代码块包裹', () => {
    const text = '```json\n[{"action":"pause"}]\n```'
    expect(extractCommands(text)).toEqual([{ action: 'pause' }])
  })

  it('不带语言标记的代码块', () => {
    expect(extractCommands('```\n[{"action":"stop"}]\n```')).toEqual([{ action: 'stop' }])
  })

  it('前后有客套话时只取数组那段', () => {
    const text = '好的，我来帮你布置：\n[{"action":"play"}]\n还需要别的吗？'
    expect(extractCommands(text)).toEqual([{ action: 'play' }])
  })

  it('代码块外面的方括号不会干扰 —— 优先看代码块里的', () => {
    const text = '参考 [1] 的做法\n```json\n[{"action":"undo"}]\n```'
    expect(extractCommands(text)).toEqual([{ action: 'undo' }])
  })

  it('保留 args', () => {
    const commands = extractCommands('[{"action":"move_object","args":{"name":"角色01","position":[1,0,2]}}]')
    expect(commands[0]!.args).toEqual({ name: '角色01', position: [1, 0, 2] })
  })

  it('丢掉形状不对的条目，留下能用的', () => {
    const commands = extractCommands('[{"action":"play"},null,42,{"foo":1},{"action":"stop"}]')
    expect(commands).toEqual([{ action: 'play' }, { action: 'stop' }])
  })

  it('完全没有数组时报错，并把原文带上给用户看', () => {
    try {
      extractCommands('我不太明白你的意思')
      expect.unreachable('应该抛错')
    }
    catch (error) {
      expect(error).toBeInstanceOf(CommandParseError)
      expect((error as CommandParseError).raw).toBe('我不太明白你的意思')
    }
  })

  it('JSON 坏掉时报错而不是抛原始的 SyntaxError', () => {
    expect(() => extractCommands('[{"action":]')).toThrow(CommandParseError)
  })

  it('是数组但一条能用的都没有时报错', () => {
    expect(() => extractCommands('[1,2,3]')).toThrow(CommandParseError)
  })

  it('不是数组是对象时报错', () => {
    expect(() => extractCommands('{"action":"play"}')).toThrow(CommandParseError)
  })
})
