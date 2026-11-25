import { describe, expect, it } from 'vitest'
import { canvasImageSpec, canvasParamEnum } from './canvas-image-spec'

describe('canvasImageSpec', () => {
  it('详情没有图片参数时沿用检查器原来的画质和比例', () => {
    expect(canvasImageSpec(null).declared).toBe(false)
    expect(canvasImageSpec({ params: { image: { properties: { prompt: { type: 'string' }, stream: { type: 'boolean' } } } } }).declared).toBe(false)
  })

  it('按通义图像参数表出尺寸、输出格式和组图，跳过参考图和返回格式', () => {
    const spec = canvasImageSpec({
      params: {
        image: {
          properties: {
            images: { type: 'array' },
            prompt: { type: 'string' },
            response_format: { type: 'string', enum: ['url', 'b64_json'], default: 'url' },
            stream: { type: 'boolean', default: false },
            optimize_prompt_options: { type: 'object' },
            output_format: { type: 'string', default: 'jpeg', enum: ['jpeg', 'png'] },
            sequential_image_generation: { type: 'string', default: 'disabled', enum: ['disabled', 'auto'] },
            size: { type: 'string', default: '2048x2048' },
          },
        },
      },
    })
    expect(spec.declared).toBe(true)
    expect(spec.fields.map(field => field.name)).toEqual(['size', 'output_format', 'sequential_image_generation'])
    expect(spec.fields[0]).toMatchObject({ kind: 'text', label: '尺寸', defaultValue: '2048x2048' })
    expect(spec.fields[1]).toMatchObject({ kind: 'select', options: ['jpeg', 'png'], defaultValue: 'jpeg' })
    expect(spec.fields[2]?.defaultValue).toBe('disabled')
  })

  it('尺寸有枚举时做成下拉', () => {
    const spec = canvasImageSpec({
      params: {
        image: {
          properties: {
            size: { type: 'string', default: '2048x2048', enum: ['2048x2048', '4096x4096'] },
          },
        },
      },
    })
    expect(spec.fields[0]).toMatchObject({ kind: 'select', options: ['2048x2048', '4096x4096'] })
  })
})

describe('canvasParamEnum', () => {
  it('读音频音色枚举和默认值', () => {
    const spec = canvasParamEnum({
      params: {
        audio: {
          properties: {
            voice: { type: 'string', default: 'longanlingxin', enum: ['longanlingxin', 'longanlufeng'] },
          },
        },
      },
    }, 'audio', 'voice')
    expect(spec).toEqual({ values: ['longanlingxin', 'longanlufeng'], defaultValue: 'longanlingxin' })
  })
})
