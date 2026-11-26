import { describe, expect, it } from 'vitest'
import { canvasVideoExtraFields, canvasVideoSpec } from './canvas-video-spec'

describe('canvasVideoSpec', () => {
  it('详情未到时用常用档，有声开关先留着', () => {
    const spec = canvasVideoSpec(null)
    expect(spec.ratios).toContain('16:9')
    expect(spec.ratiosDeclared).toBe(false)
    expect(spec.resolutions).toEqual(['480P', '720P', '1080P'])
    expect(spec.durations).toEqual([5, 10, 15])
    expect(spec.audio).toBe('unknown')
    expect(spec.promptExtendDeclared).toBe(false)
    expect(spec.seedDeclared).toBe(false)
  })

  it('按万相视频参数表出比例、智能时长和附加开关', () => {
    const spec = canvasVideoSpec({
      params: {
        video: {
          properties: {
            aspect_ratio: { type: 'string', default: 'adaptive', enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
            duration: { type: 'integer', default: 5, enum: [-1, 2, 3, 4, 5, 30] },
            resolution: { type: 'string', default: '1080P', enum: ['1080P', '720P', '480P'] },
            generate_audio: { type: 'boolean', default: true },
            prompt_extend: { type: 'boolean', default: true },
            watermark: { type: 'boolean', default: false },
            seed: { type: 'integer', min: -1, max: 2147483647 },
          },
        },
      },
    })
    expect(spec.ratios).toEqual(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
    expect(spec.ratioDefault).toBe('adaptive')
    expect(spec.resolutions).toEqual(['1080P', '720P', '480P'])
    expect(spec.resolutionDefault).toBe('1080P')
    expect(spec.durations).toEqual([2, 3, 4, 5, 30])
    expect(spec.smartDuration).toBe(true)
    expect(spec.durationDefault).toBe(5)
    expect(spec.audio).toBe('show')
    expect(spec.audioDefault).toBe(true)
    expect(spec.promptExtendDeclared).toBe(true)
    expect(spec.watermarkDefault).toBe(false)
    expect(spec.seedDeclared).toBe(true)
    expect(spec.seedMin).toBe(-1)
  })

  it('参数表没有有声字段时不显示开关', () => {
    const spec = canvasVideoSpec({
      params: {
        video: {
          properties: {
            duration: { min: 4, max: 8 },
          },
        },
      },
    })
    expect(spec.audio).toBe('hide')
    expect(spec.durations).toEqual([4, 5, 6, 7, 8])
    expect(spec.ratiosDeclared).toBe(false)
  })

  it('参数卡没画的字段跟图片一样出控件，比例和素材表不重复', () => {
    const fields = canvasVideoExtraFields({
      params: {
        video: {
          properties: {
            aspect_ratio: { type: 'string', enum: ['16:9'] },
            input_references: { type: 'array' },
            return_last_frame: { type: 'boolean', default: false },
            mode: { type: 'string', enum: ['std', 'pro'] },
          },
        },
      },
    })
    expect(fields.map(field => field.name)).toEqual(['return_last_frame'])
    expect(fields[0]).toMatchObject({ kind: 'boolean', defaultValue: false })
  })
})
