import { describe, expect, it } from 'vitest'
import { planPreviewShotPrompts, previewFocalFromFov, previewShotPrompt, previewShotSizeFromFov } from './preview-move-prompt'

describe('预演运镜提示词', () => {
  it('推：前推，别名 push 写出同一句', () => {
    expect(previewShotPrompt({ moves: 'dolly-in' })).toBe('镜头前推')
    expect(previewShotPrompt({ moves: 'push' })).toBe('镜头前推')
  })

  it('摇：左摇和右摇各用词表原文', () => {
    expect(previewShotPrompt({ moves: 'pan-left' })).toBe('镜头左摇')
    expect(previewShotPrompt({ moves: 'pan-right' })).toBe('镜头右摇')
  })

  it('停：固定镜头，hold 和 stop 也写成同一句', () => {
    expect(previewShotPrompt({ moves: 'static' })).toBe('固定镜头，机位保持稳定')
    expect(previewShotPrompt({ moves: 'hold' })).toBe('固定镜头，机位保持稳定')
    expect(previewShotPrompt({ moves: 'stop' })).toBe('固定镜头，机位保持稳定')
  })

  it('词表标签 {{cam:id}} 展开成文案，不留标签', () => {
    expect(previewShotPrompt({ moves: '{{cam:dolly-in}}' })).toBe('镜头前推')
    expect(previewShotPrompt({ action: '热气升起 {{cam:pan-right}}' })).toBe('热气升起 镜头右摇')
  })

  it('动作写在前面，运镜接在后面；动作里已经有这句就不再接', () => {
    expect(previewShotPrompt({ moves: 'dolly-in', action: '热气升起' })).toBe('热气升起\n\n镜头前推')
    expect(previewShotPrompt({ moves: 'dolly-in', action: '镜头前推，热气升起' })).toBe('镜头前推，热气升起')
  })

  it('景别和焦段接在运镜前面；fov 对应特写到远景与焦段档', () => {
    expect(previewShotPrompt({ moves: 'dolly-in', framing: '中景', focal: '24mm' })).toBe('中景，24mm，镜头前推')
    expect(previewShotPrompt({ framing: '近景' })).toBe('近景')
    expect(previewShotSizeFromFov(24)).toBe('特写')
    expect(previewShotSizeFromFov(35)).toBe('近景')
    expect(previewShotSizeFromFov(50)).toBe('中景')
    expect(previewShotSizeFromFov(70)).toBe('全景')
    expect(previewShotSizeFromFov(90)).toBe('远景')
    expect(previewFocalFromFov(24)).toBe('50mm')
    expect(previewFocalFromFov(35)).toBe('35mm')
    expect(previewFocalFromFov(50)).toBe('24mm')
    expect(previewFocalFromFov(70)).toBe('14mm')
    expect(previewFocalFromFov(0)).toBe('')
  })

  it('柯克变焦、盘旋和滚筒用词表原文', () => {
    expect(previewShotPrompt({ moves: 'dolly-zoom' })).toBe('柯克变焦，推进同时拉远焦距')
    expect(previewShotPrompt({ moves: 'spiral-up' })).toBe('盘旋抬升，镜头环绕上升')
    expect(previewShotPrompt({ moves: 'spiral-down' })).toBe('盘旋下降，镜头环绕下落')
    expect(previewShotPrompt({ moves: 'roll' })).toBe('滚筒旋转')
  })

  it('词表里没有的 id 丢掉；按镜头顺序各写一句', () => {
    expect(planPreviewShotPrompts([
      { moves: ['dolly-in', 'not-a-move'], action: '推近招牌' },
      { moves: 'pan-right' },
      { moves: 'hold' },
    ])).toEqual([
      '推近招牌\n\n镜头前推',
      '镜头右摇',
      '固定镜头，机位保持稳定',
    ])
  })
})
