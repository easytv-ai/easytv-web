/**
 * 口播视频预设（API.md 24.9）：画布视频节点的「口播」模式。
 *
 * 纯函数：台词 → 时长档 / 提示词；模型能力位过滤。不碰 Nuxt 运行时，方便 vitest 直接跑。
 * 文案标签保持中文原文，渲染处用 t(label) 取译文。
 */

export type TalkingTone = 'natural' | 'warm' | 'calm' | 'friendly'
export type TalkingFraming = 'close' | 'medium'

/** 节点上持久化的口播配置（data.talking） */
export type TalkingData = {
  script: string
  tone: TalkingTone
  framing: TalkingFraming
  /** 手动改过的时长档（秒）；不填按台词自动算 */
  duration?: number
}

export const TALKING_SCRIPT_MAX = 300
export const TALKING_PRESET = 'talking'
/** 视频模型能按台词原生出声的能力位（API.md 23.1 model_price.abilities） */
export const NATIVE_AUDIO_ABILITY = 'native_audio'

export const TALKING_TONES: ReadonlyArray<{ id: TalkingTone, label: string }> = [
  { id: 'natural', label: '自然' },
  { id: 'warm', label: '热情' },
  { id: 'calm', label: '沉稳' },
  { id: 'friendly', label: '亲切' },
]

export const TALKING_FRAMINGS: ReadonlyArray<{ id: TalkingFraming, label: string }> = [
  { id: 'close', label: '近景' },
  { id: 'medium', label: '中景' },
]

export function defaultTalkingData(): TalkingData {
  return { script: '', tone: 'natural', framing: 'close' }
}

/** 把节点上可能残缺的旧数据补齐成完整配置 */
export function normalizeTalkingData(raw?: Partial<TalkingData> | null): TalkingData {
  const base = defaultTalkingData()
  if (!raw)
    return base
  const tone = TALKING_TONES.some(item => item.id === raw.tone) ? raw.tone as TalkingTone : base.tone
  const framing = TALKING_FRAMINGS.some(item => item.id === raw.framing) ? raw.framing as TalkingFraming : base.framing
  const duration = Number(raw.duration)
  return {
    script: typeof raw.script === 'string' ? raw.script.slice(0, TALKING_SCRIPT_MAX) : '',
    tone,
    framing,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
  }
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/g
const WORD_RE = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g

const CJK_PER_SECOND = 3.5
const SECONDS_PER_WORD = 0.4
const TAIL_SECONDS = 1
const FREE_MIN = 3
const FREE_MAX = 15

/** 按台词估算需要的秒数：中文 3.5 字/秒，英文单词 0.4 秒/词，再加 1 秒收尾，向上取整 */
export function talkingSeconds(script: string) {
  const text = String(script || '')
  const cjk = (text.match(CJK_RE) || []).length
  const words = (text.replace(CJK_RE, ' ').match(WORD_RE) || []).length
  return Math.ceil(cjk / CJK_PER_SECOND + words * SECONDS_PER_WORD + TAIL_SECONDS)
}

/**
 * 自动时长档：落到模型 durations 里 ≥ 需要秒数的最小档，都不够取最大档；
 * 模型没声明档位就夹在 3~15 秒之间。
 */
export function talkingDuration(script: string, allowedDurations: number[] | null | undefined) {
  const need = talkingSeconds(script)
  const tiers = (allowedDurations || []).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!tiers.length)
    return Math.min(FREE_MAX, Math.max(FREE_MIN, need))
  return tiers.find(n => n >= need) ?? tiers[tiers.length - 1]!
}

export function talkingToneLabel(tone: TalkingTone) {
  return TALKING_TONES.find(item => item.id === tone)?.label ?? TALKING_TONES[0]!.label
}

export function talkingFramingLabel(framing: TalkingFraming) {
  return TALKING_FRAMINGS.find(item => item.id === framing)?.label ?? TALKING_FRAMINGS[0]!.label
}

/** 口播提示词（中文模板）：固定机位 + 正对镜头 + 口型同步 + 台词；补充描述拼在最后 */
export function buildTalkingPrompt(opts: { script: string, tone: TalkingTone, framing: TalkingFraming, subject?: string, extra?: string }) {
  const script = String(opts.script || '').trim()
  const who = opts.subject?.trim() ? `${opts.subject.trim()}` : '人物'
  const parts = [
    `${talkingFramingLabel(opts.framing)}固定机位，${who}正对镜头口播，口型与台词同步，自然眨眼与手势，${talkingToneLabel(opts.tone)}语气清晰说出：「${script}」。画面稳定，无字幕，无背景音乐。`,
  ]
  const extra = String(opts.extra || '').trim()
  if (extra)
    parts.push(extra)
  return parts.join('')
}

/** abilities 既可能是数组（GET /generation/models），也兼容逗号分隔的字符串 */
export function modelAbilities(model?: { abilities?: string[] | string | null } | null): string[] {
  const raw = model?.abilities
  if (Array.isArray(raw))
    return raw.map(item => String(item).trim()).filter(Boolean)
  if (typeof raw === 'string')
    return raw.split(',').map(item => item.trim()).filter(Boolean)
  return []
}

export function hasNativeAudio(model?: { abilities?: string[] | string | null } | null) {
  return modelAbilities(model).includes(NATIVE_AUDIO_ABILITY)
}
