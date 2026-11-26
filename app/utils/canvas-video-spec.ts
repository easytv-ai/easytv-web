/**
 * 画布视频参数卡：按模型详情 params.video.properties 出选项。
 * 详情还没到、或这张表没声明时，回落到检查器原来的常用档，不把面板掏空。
 * 比例 / 分辨率 / 时长 / 有声 / 改写 / 水印 / 种子由参数卡固定画；
 * 其余标量字段走 canvasVideoExtraFields，和图片参数同一套控件。
 */
import { canvasDynamicFields, type CanvasImageField } from './canvas-image-spec'

export type CanvasVideoAudio = 'show' | 'hide' | 'unknown'

export interface CanvasVideoSpec {
  ratios: string[]
  ratioDefault: string
  ratiosDeclared: boolean
  resolutions: string[]
  resolutionDefault: string
  resolutionsDeclared: boolean
  /** 正秒数档，不含智能时长 -1 */
  durations: number[]
  /** -1 表示智能时长 */
  durationDefault: number
  smartDuration: boolean
  durationsDeclared: boolean
  /** unknown：详情未到，沿用面板上的有声开关；hide：参数表没声明，不显示也不提交 */
  audio: CanvasVideoAudio
  audioDefault: boolean
  promptExtendDeclared: boolean
  promptExtendDefault: boolean
  watermarkDeclared: boolean
  watermarkDefault: boolean
  seedDeclared: boolean
  seedMin: number
  seedMax: number
}

const FALLBACK_RATIOS = ['1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21']
const FALLBACK_RESOLUTIONS = ['480P', '720P', '1080P']
const FALLBACK_DURATIONS = [5, 10, 15]
const VIDEO_KEYS = ['video', 'videos', 'video_generation', 'text_to_video', 'image_to_video']

type ParamProp = {
  type?: string
  enum?: unknown[]
  default?: unknown
  min?: unknown
  max?: unknown
}

type DetailLike = {
  params?: Record<string, { properties?: Record<string, ParamProp> }>
} | null | undefined

function videoProperties(detail: DetailLike): Record<string, ParamProp> | null {
  const params = detail?.params
  if (!params)
    return null
  for (const key of VIDEO_KEYS) {
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

function defaultIn(options: string[], raw: unknown, fallback: string): string {
  const wanted = String(raw ?? '').trim().toLowerCase()
  if (wanted) {
    const hit = options.find(item => item.toLowerCase() === wanted)
    if (hit)
      return hit
  }
  if (options.includes(fallback))
    return fallback
  return options[0] || fallback
}

function durationOptions(prop: ParamProp | undefined): { values: number[], smart: boolean } {
  const values: number[] = []
  let smart = false
  if (Array.isArray(prop?.enum) && prop.enum.length) {
    const seen = new Set<number>()
    for (const item of prop.enum) {
      const n = typeof item === 'number' ? item : Number(String(item ?? '').trim())
      if (!Number.isInteger(n) || seen.has(n))
        continue
      if (n === -1) {
        smart = true
        continue
      }
      if (n > 0) {
        seen.add(n)
        values.push(n)
      }
    }
    values.sort((a, b) => a - b)
    return { values, smart }
  }
  const min = Number(prop?.min)
  const max = Number(prop?.max)
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min && max - min <= 30) {
    for (let n = Math.ceil(min); n <= Math.floor(max); n++)
      values.push(n)
  }
  return { values, smart }
}

function defaultBool(prop: ParamProp | undefined, fallback: boolean): boolean {
  return typeof prop?.default === 'boolean' ? prop.default : fallback
}

function finiteBound(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function canvasVideoSpec(detail: DetailLike): CanvasVideoSpec {
  const properties = videoProperties(detail)
  const ratioEnum = enumStrings(properties?.aspect_ratio || properties?.ratio)
  const resolutionEnum = enumStrings(properties?.resolution)
  const duration = durationOptions(properties?.duration)
  const ratiosDeclared = ratioEnum.length > 0
  const resolutionsDeclared = resolutionEnum.length > 0
  const durationsDeclared = duration.values.length > 0 || duration.smart
  const ratios = ratiosDeclared ? ratioEnum : [...FALLBACK_RATIOS]
  const resolutions = resolutionsDeclared ? resolutionEnum : [...FALLBACK_RESOLUTIONS]
  const durations = durationsDeclared && duration.values.length ? duration.values : [...FALLBACK_DURATIONS]
  const durationDefaultRaw = Number(properties?.duration?.default)
  let durationDefault = durations.includes(5) ? 5 : durations[0]!
  if (durationDefaultRaw === -1 && duration.smart)
    durationDefault = -1
  else if (durations.includes(durationDefaultRaw))
    durationDefault = durationDefaultRaw

  const audioProp = properties?.generate_audio || properties?.audio
  const audio: CanvasVideoAudio = !properties ? 'unknown' : audioProp ? 'show' : 'hide'
  const seedProp = properties?.seed
  const seedDeclared = Boolean(seedProp && (seedProp.type === 'integer' || seedProp.type === 'number' || seedProp.min != null || seedProp.max != null))

  return {
    ratios,
    ratioDefault: defaultIn(ratios, properties?.aspect_ratio?.default ?? properties?.ratio?.default, '16:9'),
    ratiosDeclared,
    resolutions,
    resolutionDefault: defaultIn(resolutions, properties?.resolution?.default, '720P'),
    resolutionsDeclared,
    durations,
    durationDefault,
    smartDuration: duration.smart,
    durationsDeclared,
    audio,
    audioDefault: defaultBool(audioProp, true),
    promptExtendDeclared: Boolean(properties && 'prompt_extend' in properties),
    promptExtendDefault: defaultBool(properties?.prompt_extend, true),
    watermarkDeclared: Boolean(properties && 'watermark' in properties),
    watermarkDefault: defaultBool(properties?.watermark, false),
    seedDeclared,
    seedMin: finiteBound(seedProp?.min, -1),
    seedMax: finiteBound(seedProp?.max, 2147483647),
  }
}

/** 参数卡已经单独画过的字段，不再进动态行。mode 是画布的生成模式，不能跟参数表的 mode 抢。 */
const VIDEO_HANDLED = [
  'aspect_ratio',
  'ratio',
  'resolution',
  'duration',
  'generate_audio',
  'audio',
  'prompt_extend',
  'watermark',
  'seed',
  'mode',
  'prompt',
  'input_references',
]

export function canvasVideoExtraFields(detail: DetailLike): CanvasImageField[] {
  return canvasDynamicFields(detail, VIDEO_KEYS, VIDEO_HANDLED)
}
