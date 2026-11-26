import { describe, expect, it } from 'vitest'
import { buildCanvasTuningMessages, canvasTuningMode, flattenTuningMessages, introducedReferenceTokens, isWanVideoModel } from './canvas-video-tune'

const knowledge = {
  version: '1.0.0',
  sections: {
    common: ['common-rule'],
    domains: { drama: ['drama-rule'], ecommerce: ['shop-rule'] },
    modes: { 'text-to-video': ['t2v-rule'], reference: ['ref-rule'] },
    diagnosis: ['diag-rule'],
    audio: ['audio-rule'],
  },
}

describe('canvasTuningMode', () => {
  it('画布模式对到调优形态', () => {
    expect(canvasTuningMode('t2v')).toBe('text-to-video')
    expect(canvasTuningMode('i2v')).toBe('first-frame')
    expect(canvasTuningMode('fl2v')).toBe('first-last-frame')
    expect(canvasTuningMode('reference')).toBe('reference')
    expect(canvasTuningMode('imageRef')).toBe('reference')
    expect(canvasTuningMode('extend')).toBe('v2v')
    expect(canvasTuningMode('talking')).toBe('text-to-video')
  })
})

describe('flattenTuningMessages', () => {
  it('只保留文本，丢掉图片块', () => {
    expect(flattenTuningMessages([
      { role: 'system', content: '规则' },
      { role: 'user', content: [{ type: 'text', text: '原文' }, { type: 'image_url', image_url: { url: 'https://a' } }] },
    ])).toBe('规则\n\n原文')
  })
})

describe('通用视频调优', () => {
  it('万相 3 才算专用模型', () => {
    expect(isWanVideoModel('wan3.0-video')).toBe(true)
    expect(isWanVideoModel('alibaba/wan3.1')).toBe(true)
    expect(isWanVideoModel('kling-3.0')).toBe(false)
    expect(isWanVideoModel('wan2.7-t2v')).toBe(false)
  })

  it('其他模型走通用规则，不套万相引用', () => {
    const messages = buildCanvasTuningMessages({
      domain: 'general',
      mode: 'reference',
      output: 'quick',
      prompt: '一个人走路',
      targetModel: 'kling-3.0',
      capabilities: { known: true, roles: ['reference_image'], maxCount: { reference_image: 1 } },
      media: [{ kind: 'image', role: 'reference_image', name: '参考图', url: 'https://cdn.example/a.png' }],
    }, knowledge)
    const system = String(messages[0]?.content)
    const user = String(messages[1]?.content)
    expect(system).toContain('do not introduce Wan')
    expect(system).not.toContain('Edit the supplied Wan')
    expect(system).not.toContain('ref-rule')
    expect(user).toContain('"policy":"generic"')
    expect(user).toContain('kling-3.0')
    expect(user).toContain('生成参考1')
    expect(user).not.toContain('https://cdn.example')
  })

  it('万相 3 选短剧时仍用专用规则', () => {
    const messages = buildCanvasTuningMessages({
      domain: 'drama',
      mode: 'text-to-video',
      output: 'quick',
      prompt: '一个人走路',
      targetModel: 'wan3.0-video',
    }, knowledge)
    expect(String(messages[0]?.content)).toContain('Edit the supplied Wan video prompt')
    expect(String(messages[0]?.content)).toContain('drama-rule')
  })

  it('只拦新写出来的引用记号', () => {
    expect(introducedReferenceTokens('沿用 @图片1', '沿用 @图片1，再加 @视频1')).toEqual(['@视频1'])
    expect(introducedReferenceTokens('一个人走路', '镜头推进')).toEqual([])
  })
})
