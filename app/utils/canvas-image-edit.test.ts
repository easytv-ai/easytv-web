import { describe, expect, it } from 'vitest'
import { imageOpCss, imageOpsSwapped, isSameOriginMediaUrl, outpaintFrameSize, outpaintPrompt, parseUpscaleAction, promptReverseInstruction, promptReverseVideoInstruction, upscaleClarity, upscalePrompt, upscaleRatio, upscaleTierSize } from './canvas-image-edit'

describe('isSameOriginMediaUrl', () => {
  const origin = 'https://www.easytv.ai'

  it('blob 和 data URL 按同源处理', () => {
    expect(isSameOriginMediaUrl('blob:https://www.easytv.ai/abc', origin)).toBe(true)
    expect(isSameOriginMediaUrl('data:image/png;base64,xx', origin)).toBe(true)
  })

  it('同站点资源是同源', () => {
    expect(isSameOriginMediaUrl('https://www.easytv.ai/upload/a.jpg', origin)).toBe(true)
    expect(isSameOriginMediaUrl('/images/a.jpg', origin)).toBe(true)
  })

  it('API / CDN 不是当前页同源', () => {
    expect(isSameOriginMediaUrl('https://tv-api.easyapi.com/upload/a.jpg', origin)).toBe(false)
  })
})

describe('imageOpCss', () => {
  it('按点击顺序叠 CSS，且与 canvas 同向', () => {
    expect(imageOpCss(['rotate-right'])).toBe('rotate(90deg)')
    expect(imageOpCss(['rotate-right', 'flip-h'])).toBe('scaleX(-1) rotate(90deg)')
  })
})

describe('imageOpsSwapped', () => {
  it('转奇数次 90 度时对调宽高', () => {
    expect(imageOpsSwapped(['rotate-right'])).toBe(true)
    expect(imageOpsSwapped(['rotate-right', 'rotate-right'])).toBe(false)
    expect(imageOpsSwapped(['flip-h'])).toBe(false)
  })
})

describe('outpaintFrameSize', () => {
  it('方图扩到 16:9 只加左右', () => {
    expect(outpaintFrameSize(320, 320, '16:9')).toEqual({ w: 320 * 16 / 9, h: 320 })
  })

  it('方图扩到 9:16 只加上下', () => {
    expect(outpaintFrameSize(320, 320, '9:16')).toEqual({ w: 320, h: 320 * 16 / 9 })
  })

  it('已经是目标比例时画布不变', () => {
    expect(outpaintFrameSize(320, 180, '16:9')).toEqual({ w: 320, h: 180 })
  })

  it('缺尺寸或比例时回落原图', () => {
    expect(outpaintFrameSize(0, 100, '16:9')).toEqual({ w: 0, h: 100 })
    expect(outpaintFrameSize(100, 100, 'bad')).toEqual({ w: 100, h: 100 })
  })
})

describe('outpaintPrompt', () => {
  it('带上所选比例', () => {
    expect(outpaintPrompt('16:9')).toContain('16:9')
  })
})

describe('promptReverseInstruction', () => {
  it('中文界面出中文，繁体界面注明繁体，其他语言注明目标语言', () => {
    expect(promptReverseInstruction('zh')).not.toMatch(/Write the prompt/)
    expect(promptReverseInstruction('zh-TW')).toMatch(/繁体中文/)
    expect(promptReverseInstruction('en')).toMatch(/in English/)
    expect(promptReverseInstruction('ja')).toMatch(/in Japanese/)
  })
})

describe('promptReverseVideoInstruction', () => {
  const frames = [
    { index: 1, timeSec: 0, startSec: 0, endSec: 1.5 },
    { index: 2, timeSec: 3, startSec: 1.5, endSec: 4 },
  ]

  it('要求 Timestamped prompts 格式并带关键帧时间', () => {
    const text = promptReverseVideoInstruction('zh', frames, 4)
    expect(text).toMatch(/_Timestamped prompts_/)
    expect(text).toMatch(/图1/)
    expect(text).toMatch(/0-3s/)
    expect(text).toMatch(/简体中文/)
  })

  it('英文界面保留标题与时间标签、正文用英文', () => {
    const text = promptReverseVideoInstruction('en', frames, 4)
    expect(text).toMatch(/_Timestamped prompts_/)
    expect(text).toMatch(/in English/)
  })
})

describe('parseUpscaleAction', () => {
  it('只认 2x / 4x，点放大本身不提交', () => {
    expect(parseUpscaleAction('upscale-2x')).toBe(2)
    expect(parseUpscaleAction('upscale-4x')).toBe(4)
    expect(parseUpscaleAction('upscale')).toBe(0)
  })
})

describe('upscalePrompt', () => {
  it('2x 写 2K，4x 写 4K，并要求画面与原图一致', () => {
    expect(upscalePrompt(2)).toContain('2K')
    expect(upscalePrompt(4)).toContain('4K')
    expect(upscalePrompt(2)).toContain('禁止换人')
  })
})

describe('upscaleTierSize', () => {
  it('方图 2x 出 2048，4x 出 4096', () => {
    expect(upscaleTierSize(1536, 1536, 2)).toBe('2048x2048')
    expect(upscaleTierSize(1024, 1024, 2)).toBe('2048x2048')
    expect(upscaleTierSize(1024, 1024, 4)).toBe('4096x4096')
    expect(upscaleClarity(2)).toBe('2K')
    expect(upscaleClarity(4)).toBe('4K')
    expect(upscaleRatio(1536, 1536)).toBe('1:1')
  })

  it('横图竖图跟原图走', () => {
    expect(upscaleTierSize(1920, 1080, 2)).toBe('2560x1440')
    expect(upscaleTierSize(1080, 1920, 4)).toBe('2160x3840')
    expect(upscaleRatio(1920, 1080)).toBe('16:9')
  })
})
