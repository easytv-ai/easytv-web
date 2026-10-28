import { describe, expect, it } from 'vitest'
import {
  applyOptimizedPrompt,
  canOptimizePrompt,
  cleanOptimizedPrompt,
  OPTIMIZE_MAX_CHARS,
  promptOptimizeInstruction,
} from './canvas-prompt-optimize'

describe('promptOptimizeInstruction', () => {
  it('把用户原文带进去，图片与视频维度不同', () => {
    const image = promptOptimizeInstruction('image', '  一只橘猫在窗台晒太阳 ')
    expect(image).toContain('用户的提示词：\n一只橘猫在窗台晒太阳')
    expect(image).toContain('AI 图片生成')
    expect(image).toContain('构图、景别与机位')
    expect(image).not.toContain('镜头运动')
    const video = promptOptimizeInstruction('video', '猫跳下窗台')
    expect(video).toContain('AI 视频生成')
    expect(video).toContain('镜头运动与机位')
    expect(video).toContain('节奏与时长感')
  })

  it('要求只输出提示词本身', () => {
    expect(promptOptimizeInstruction('image', 'x')).toMatch(/只输出改写后的提示词本身/)
  })

  it('中文界面不加语言要求，繁体与其他语言按界面语言', () => {
    expect(promptOptimizeInstruction('image', 'x', 'zh')).not.toMatch(/Write the rewritten/)
    expect(promptOptimizeInstruction('image', 'x', 'zh-TW')).toMatch(/繁体中文/)
    expect(promptOptimizeInstruction('image', 'x', 'en')).toMatch(/in English/)
    expect(promptOptimizeInstruction('image', 'x', 'ja-JP')).toMatch(/in Japanese/)
  })
})

describe('cleanOptimizedPrompt', () => {
  it('剥掉代码块、前缀和成对引号', () => {
    expect(cleanOptimizedPrompt('```text\n橘猫，窗台\n```')).toBe('橘猫，窗台')
    expect(cleanOptimizedPrompt('优化后的提示词：橘猫，窗台')).toBe('橘猫，窗台')
    expect(cleanOptimizedPrompt('Prompt: cat')).toBe('cat')
    expect(cleanOptimizedPrompt('“橘猫，窗台”')).toBe('橘猫，窗台')
    expect(cleanOptimizedPrompt('「橘猫」')).toBe('橘猫')
  })

  it('正文里的引号不动', () => {
    expect(cleanOptimizedPrompt('招牌写着"面馆"，暖光')).toBe('招牌写着"面馆"，暖光')
  })

  it('空输入给空串', () => {
    expect(cleanOptimizedPrompt('')).toBe('')
    expect(cleanOptimizedPrompt('   ')).toBe('')
  })
})

describe('canOptimizePrompt 与 applyOptimizedPrompt', () => {
  it('太短或太长不给优化', () => {
    expect(canOptimizePrompt('猫')).toBe(false)
    expect(canOptimizePrompt('橘猫')).toBe(true)
    expect(canOptimizePrompt('x'.repeat(OPTIMIZE_MAX_CHARS + 1))).toBe(false)
  })

  it('替换整段 / 追加在原文后', () => {
    expect(applyOptimizedPrompt('replace', '橘猫', '```\n一只橘猫……\n```')).toBe('一只橘猫……')
    expect(applyOptimizedPrompt('append', '橘猫  ', '一只橘猫……')).toBe('橘猫\n\n一只橘猫……')
    expect(applyOptimizedPrompt('append', '', '一只橘猫……')).toBe('一只橘猫……')
  })

  it('改写结果为空时原文原样保留', () => {
    expect(applyOptimizedPrompt('replace', '橘猫', '   ')).toBe('橘猫')
  })
})
