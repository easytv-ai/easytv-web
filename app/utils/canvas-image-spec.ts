/**
 * 画布图片参数卡：按模型详情 params.image.properties 出控件。
 * 跟模型广场一样，提示词、参考图、流式和返回格式不进参数区。
 * 详情没有可用字段时 declared 为 false，检查器继续用原来的画质 / 清晰度 / 比例。
 */

export type CanvasImageFieldKind = 'select' | 'boolean' | 'text' | 'number'

export interface CanvasImageField {
  name: string
  kind: CanvasImageFieldKind
  /** 中文文案键，交给 t() */
  label: string
  options: string[]
  defaultValue: string | boolean | number
  min?: number
  max?: number
}

export interface CanvasImageSpec {
  declared: boolean
  fields: CanvasImageField[]
}

export interface CanvasParamEnum {
  values: string[]
  defaultValue: string
}

const IMAGE_KEYS = ['image', 'images', 'image_generation']
const AUDIO_KEYS = ['audio', 'speech', 'tts', 'audio_speech']
const SKIP = new Set([
  'model',
  'messages',
  'prompt',
  'input',
  'instructions',
  'input_references',
  'images',
  'image',
  'mask',
  'file',
  'files',
  'stream',
  'partial_images',
  'webhook_url',
  'metadata',
  'response_format',
  'user',
  'safety_identifier',
])

const LABEL_KEYS: Record<string, string> = {
  size: '尺寸',
  n: '数量',
  quality: '画质',
  background: '背景',
  output_format: '输出格式',
  output_compression: '压缩',
  moderation: '审核',
  aspect_ratio: '比例',
  ratio: '比例',
  sequential_image_generation: '组图',
  seed: '种子',
  watermark: '水印',
  voice: '音色',
}

const FIELD_ORDER = [
  'size',
  'n',
  'quality',
  'aspect_ratio',
  'ratio',
  'background',
  'output_format',
  'output_compression',
  'moderation',
  'sequential_image_generation',
  'seed',
  'watermark',
]

type ParamProp = {
  type?: string
  enum?: unknown[]
  default?: unknown
  min?: unknown
  max?: unknown
  description?: string
}

type DetailLike = {
  params?: Record<string, { properties?: Record<string, ParamProp> }>
} | null | undefined

function propertiesOf(detail: DetailLike, keys: string[]): Record<string, ParamProp> | null {
  const params = detail?.params
  if (!params)
    return null
  for (const key of keys) {
    const properties = params[key]?.properties
    if (properties && Object.keys(properties).length)
      return properties
  }
  return null
}

function enumStrings(prop: ParamProp | undefined): string[] {
  if (!Array.isArray(prop?.enum))
    return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of prop.enum) {
    const value = String(item ?? '').trim()
    const key = value.toLowerCase()
    if (!value || seen.has(key))
      continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function fieldLabel(name: string, prop: ParamProp): string {
  if (LABEL_KEYS[name])
    return LABEL_KEYS[name]
  const desc = String(prop.description ?? '').trim().split(/[，,。；;]/)[0]?.trim() || ''
  if (desc && desc.length <= 12 && /[\u4e00-\u9fff]/.test(desc))
    return desc
  return name
}

function buildField(name: string, prop: ParamProp, skip: Set<string>): CanvasImageField | null {
  if (skip.has(name))
    return null
  const type = String(prop.type || '').toLowerCase()
  if (type === 'object' || type === 'array')
    return null
  const options = enumStrings(prop)
  const label = fieldLabel(name, prop)
  if (options.length) {
    const raw = String(prop.default ?? '').trim()
    const hit = options.find(item => item.toLowerCase() === raw.toLowerCase())
    return {
      name,
      kind: 'select',
      label,
      options,
      defaultValue: hit || options[0] || '',
    }
  }
  if (type === 'boolean') {
    return {
      name,
      kind: 'boolean',
      label,
      options: [],
      defaultValue: prop.default === true,
    }
  }
  if (type === 'integer' || type === 'number') {
    const min = Number(prop.min)
    const max = Number(prop.max)
    const fallback = Number(prop.default)
    return {
      name,
      kind: 'number',
      label,
      options: [],
      defaultValue: Number.isFinite(fallback) ? fallback : (Number.isFinite(min) ? min : 0),
      min: Number.isFinite(min) ? min : undefined,
      max: Number.isFinite(max) ? max : undefined,
    }
  }
  if (name === 'size' || type === 'string' || type === '') {
    return {
      name,
      kind: 'text',
      label,
      options: [],
      defaultValue: String(prop.default ?? '').trim(),
    }
  }
  return null
}

/** 按参数表出控件。skipExtra 用来去掉画布已经单独画过的字段（比例、时长等）。 */
export function canvasDynamicFields(detail: DetailLike, keys: string[], skipExtra: readonly string[] = []): CanvasImageField[] {
  const properties = propertiesOf(detail, keys)
  if (!properties)
    return []
  const skip = new Set([...SKIP, ...skipExtra])
  const fields: CanvasImageField[] = []
  for (const [name, prop] of Object.entries(properties)) {
    const field = buildField(name, prop ?? {}, skip)
    if (field)
      fields.push(field)
  }
  fields.sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a.name)
    const ib = FIELD_ORDER.indexOf(b.name)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
  })
  return fields
}

export function canvasImageSpec(detail: DetailLike): CanvasImageSpec {
  const fields = canvasDynamicFields(detail, IMAGE_KEYS)
  return { declared: fields.length > 0, fields }
}

/** 音频等参数表里的字符串枚举。没有这个字段时返回 null。 */
export function canvasParamEnum(detail: DetailLike, group: 'audio', name: string): CanvasParamEnum | null {
  const properties = propertiesOf(detail, group === 'audio' ? AUDIO_KEYS : IMAGE_KEYS)
  const prop = properties?.[name]
  const values = enumStrings(prop)
  if (!values.length)
    return null
  const raw = String(prop?.default ?? '').trim()
  const hit = values.find(item => item.toLowerCase() === raw.toLowerCase())
  return { values, defaultValue: hit || values[0] || '' }
}
