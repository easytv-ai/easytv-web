import { describe, expect, it } from 'vitest'
import { canvasActiveVideoMode, canvasModeLimitText, canvasRefInputAllowed, canvasRefSupport, canvasThumbIssue, canvasVideoModes, filterCanvasModeInputs, filterUnsupportedRefInputs } from './canvas-reference-support'

describe('canvasRefSupport', () => {
  it('Kling 只有首尾帧和参考图时，参考视频不支持', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: {
                type: 'array',
                items: {
                  properties: {
                    type: { enum: ['image'] },
                    role: { enum: ['first_frame', 'last_frame', 'reference_image'] },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(support.known).toBe(true)
    expect(support.roles.has('first_frame')).toBe(true)
    expect(support.roles.has('last_frame')).toBe(true)
    expect(support.roles.has('reference_image')).toBe(true)
    expect(support.roles.has('reference_video')).toBe(false)
    expect(support.roles.has('reference_audio')).toBe(false)
  })

  it('role 里有 reference_video 才收参考视频', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: {
                items: {
                  properties: {
                    role: { enum: ['first_frame', 'reference_image', 'reference_video', 'reference_audio'] },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(support.roles.has('reference_video')).toBe(true)
    expect(support.roles.has('last_frame')).toBe(false)
  })

  it('只声明 type=video 时推出参考视频，不带首尾帧', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: { items: { properties: { type: { enum: ['video'] } } } },
            },
          },
        },
      },
    })
    expect([...support.roles]).toEqual(['reference_video'])
  })

  it('素材表没有枚举时按全部图片视频音频槽', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: { properties: { input_references: { type: 'array' } } },
        },
      },
    })
    expect(support.roles.size).toBe(5)
  })

  it('详情没到时不下结论', () => {
    expect(canvasRefSupport({ kind: 'video', detail: null }).known).toBe(false)
  })

  it('图片模型按 image_input：none 不收参考图，url 只收参考图', () => {
    const none = canvasRefSupport({ kind: 'image', imageInput: 'none' })
    expect(none.known).toBe(true)
    expect(none.roles.size).toBe(0)
    const url = canvasRefSupport({ kind: 'image', imageInput: 'url' })
    expect(url.roles.has('reference_image')).toBe(true)
    expect(url.roles.has('reference_video')).toBe(false)
  })
})

describe('filterUnsupportedRefInputs', () => {
  it('不支持参考视频时拿掉 reference_video，参考图留下', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: {
                items: { properties: { role: { enum: ['reference_image'] } } },
              },
            },
          },
        },
      },
    })
    const inputs = filterUnsupportedRefInputs([
      { asset_id: 1, role: 'reference' },
      { asset_id: 2, role: 'reference_video' },
      { asset_id: 3, role: 'mask' },
    ], support)
    expect(inputs.map(item => item.role)).toEqual(['reference', 'mask'])
    expect(canvasRefInputAllowed(support, 'reference_video')).toBe(false)
  })

  it('还不知道能力时原样提交', () => {
    const support = canvasRefSupport({ kind: 'video', detail: null })
    const inputs = [{ asset_id: 2, role: 'reference_video' }]
    expect(filterUnsupportedRefInputs(inputs, support)).toEqual(inputs)
  })
})

function wanDetail() {
  return {
    kind: 'video' as const,
    detail: {
      params: {
        video: {
          properties: {
            input_references: {
              media_constraints: {
                reference_image: { max_count: 10 },
                reference_video: { max_count: 5 },
                reference_audio: { max_count: 5 },
                first_frame: { max_count: 1 },
                last_frame: { max_count: 1 },
              },
              items: {
                properties: {
                  role: { enum: ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio'] },
                },
              },
            },
          },
        },
      },
    },
  }
}

describe('canvasVideoModes', () => {
  it('万相这种图、视频、音频都能挂的模型，是文生视频、全能参考、首尾帧、视频续写', () => {
    const support = canvasRefSupport(wanDetail())
    expect(canvasVideoModes({ support, nativeAudio: true })).toEqual(['t2v', 'reference', 'fl2v', 'extend', 'talking'])
    expect(support.maxCount).toEqual({
      reference_image: 10,
      reference_video: 5,
      reference_audio: 5,
      first_frame: 1,
      last_frame: 1,
    })
  })

  it('只有参考图、没有参考视频的模型列图片参考，不列全能参考和视频续写', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: {
                items: { properties: { role: { enum: ['first_frame', 'last_frame', 'reference_image'] } } },
              },
            },
          },
        },
      },
    })
    expect(canvasVideoModes({ support, nativeAudio: false })).toEqual(['t2v', 'imageRef', 'fl2v'])
  })

  it('只有首帧、没有尾帧时列图生视频', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: {
                items: { properties: { role: { enum: ['first_frame'] } } },
              },
            },
          },
        },
      },
    })
    expect(canvasVideoModes({ support })).toEqual(['t2v', 'i2v'])
  })

  it('没有素材槽时只有文生视频，能出声再多口播', () => {
    const support = canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: { properties: { prompt: { type: 'string' } } },
        },
      },
    })
    expect(support.known).toBe(true)
    expect(support.roles.size).toBe(0)
    expect(canvasVideoModes({ support, nativeAudio: true })).toEqual(['t2v', 'talking'])
  })

  it('换成没有全能参考的模型时，选中项落到文生视频；只剩参考图时落到图片参考', () => {
    expect(canvasActiveVideoMode('reference', ['t2v'])).toBe('t2v')
    expect(canvasActiveVideoMode('reference', ['t2v', 'imageRef', 'fl2v'])).toBe('imageRef')
    expect(canvasActiveVideoMode('reference', ['t2v', 'reference', 'fl2v'])).toBe('reference')
    expect(canvasActiveVideoMode('extend', ['t2v', 'fl2v'])).toBe('t2v')
  })

  it('详情未到时不猜首尾帧', () => {
    const support = canvasRefSupport({ kind: 'video', detail: null })
    expect(canvasVideoModes({ support, nativeAudio: true, videoReference: true })).toEqual(['t2v', 'reference', 'extend', 'talking'])
    expect(canvasVideoModes({ support })).toEqual(['t2v'])
  })
})

describe('canvas mode associations', () => {
  it('全能参考按上限裁掉多出来的图和视频，首尾帧模式丢掉参考视频', () => {
    const support = canvasRefSupport(wanDetail())
    const many = [
      ...Array.from({ length: 11 }, (_, i) => ({ asset_id: i + 1, role: 'reference' })),
      ...Array.from({ length: 6 }, (_, i) => ({ asset_id: 20 + i, role: 'reference_video' })),
      { asset_id: 40, role: 'reference_audio' },
      { asset_id: 41, role: 'mask' },
    ]
    const kept = filterCanvasModeInputs(many, 'reference', support)
    expect(kept.filter(item => item.role === 'reference')).toHaveLength(10)
    expect(kept.filter(item => item.role === 'reference_video')).toHaveLength(5)
    expect(kept.some(item => item.role === 'reference_audio')).toBe(true)
    expect(kept.some(item => item.role === 'mask')).toBe(true)
    expect(canvasModeLimitText('reference', support)).toBe('参考图最多 10 张，参考视频最多 5 段，参考音频最多 5 段')

    const frames = filterCanvasModeInputs([
      { asset_id: 1, role: 'first_frame' },
      { asset_id: 2, role: 'last_frame' },
      { asset_id: 3, role: 'reference_video' },
    ], 'fl2v', support)
    expect(frames.map(item => item.role)).toEqual(['first_frame', 'last_frame'])
  })

  it('文生视频只留第一张能当首帧的图，图生视频多出来的图打叉', () => {
    const support = canvasRefSupport(wanDetail())
    expect(canvasThumbIssue({ mode: 't2v', kind: 'image', index: 0, support })).toBe('')
    expect(canvasThumbIssue({ mode: 't2v', kind: 'image', index: 1, support })).toBe('文生视频只用一张图当首帧')
    expect(canvasThumbIssue({ mode: 't2v', kind: 'video', index: 0, support })).toBe('文生视频不收参考视频')
    expect(canvasThumbIssue({ mode: 'imageRef', kind: 'video', index: 0, support: canvasRefSupport({
      kind: 'video',
      detail: {
        params: {
          video: {
            properties: {
              input_references: {
                items: { properties: { role: { enum: ['reference_image'] } } },
              },
            },
          },
        },
      },
    }) })).toBe('图片参考不收参考视频')
  })
})
