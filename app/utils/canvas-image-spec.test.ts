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
    expect(spec.fields[0]).toMatchObject({ kind: 'select', label: '尺寸', defaultValue: '2048x2048', options: ['2048x2048', '1024x1024', '1536x1024', '1024x1536'] })
    expect(spec.fields[1]).toMatchObject({ kind: 'select', options: ['jpeg', 'png'], defaultValue: 'jpeg' })
    expect(spec.fields[2]?.defaultValue).toBe('disabled')
  })

  it('Qwen 没给枚举时按说明里的上限出分辨率，默认用最大方图', () => {
    const spec = canvasImageSpec({
      params: {
        image: {
          properties: {
            size: { type: 'string', description: 'Output resolution in width x height format (e.g. 1024x1024); auto is also supported. Pixel area from 512x512 to 2048x2048' },
            n: { type: 'integer', default: 1, min: 1, max: 6 },
          },
        },
      },
    })
    expect(spec.fields.map(field => field.name)).toEqual(['size'])
    expect(spec.fields[0]).toMatchObject({
      kind: 'select',
      options: ['1024x1024', '1536x1024', '1024x1536', '2048x2048'],
      defaultValue: '2048x2048',
    })
  })

  it('没给默认值的种子留空，不把 0 当成用户选的种子', () => {
    const spec = canvasImageSpec({
      params: {
        image: {
          properties: {
            seed: { type: 'integer', min: 0, max: 2147483647 },
            enable_thinking: { type: 'boolean', default: true },
            negative_prompt: { type: 'string' },
          },
        },
      },
    })
    expect(spec.fields.find(field => field.name === 'seed')).toMatchObject({ kind: 'number', defaultValue: '' })
    expect(spec.fields.find(field => field.name === 'enable_thinking')?.label).toBe('思考模式')
    expect(spec.fields.find(field => field.name === 'negative_prompt')?.label).toBe('反向提示词')
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
