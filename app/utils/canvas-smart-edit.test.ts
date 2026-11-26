import { describe, expect, it } from 'vitest'
import { buildSmartEditPrompt, smartEditBBox } from './canvas-smart-edit'

const box = { x: 120, y: 180, w: 520, h: 580 }

describe('smartEditBBox', () => {
  it('把框归一化到 0–999', () => {
    expect(smartEditBBox(box, 1000, 1000)).toBe('<bbox>120 180 640 760</bbox>')
  })

  it('贴边框夹到 999，零面积至少拉开 1', () => {
    expect(smartEditBBox({ x: 0, y: 0, w: 1000, h: 1 }, 1000, 1000)).toBe('<bbox>0 0 999 1</bbox>')
    expect(smartEditBBox({ x: 10, y: 10, w: 0, h: 0 }, 100, 100)).toBe('<bbox>100 100 101 101</bbox>')
  })
})

describe('buildSmartEditPrompt', () => {
  it('gpt-image 单处只留用户原文', () => {
    expect(buildSmartEditPrompt([{ box, text: '换个发型' }], { w: 1000, h: 1000 }, 'edits')).toBe('换个发型')
  })

  it('url 模型把白框写成选区标记，不写百分比', () => {
    const prompt = buildSmartEditPrompt([{ box, text: '换个发型' }], { w: 1000, h: 1000 }, 'url')
    expect(prompt).toBe('把图1<bbox>120 180 640 760</bbox>区域换个发型')
    expect(prompt).not.toContain('%')
    expect(prompt).not.toContain('横向')
  })

  it('多处各自带框，原文原样接在标记后面', () => {
    const prompt = buildSmartEditPrompt([
      { box, text: '换个发型' },
      { box: { x: 0, y: 0, w: 200, h: 200 }, text: '换背景' },
    ], { w: 1000, h: 1000 }, 'url')
    expect(prompt).toBe('把图1<bbox>120 180 640 760</bbox>区域换个发型。把图1<bbox>0 0 200 200</bbox>区域换背景')
  })

  it('没写说明就不提交', () => {
    expect(buildSmartEditPrompt([{ box, text: '  ' }], { w: 1000, h: 1000 }, 'url')).toBe('')
  })
})
