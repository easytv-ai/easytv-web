/**
 * 音频节点口径：旁白走配音语种 / 音色，配乐和音效只交提示词 + 时长。
 * 生成仍走 POST /user/task type=audio，不另开音乐接口。
 */

export const AUDIO_KINDS = ['narration', 'bgm', 'sfx'] as const
export type AudioKind = (typeof AUDIO_KINDS)[number]

export const AUDIO_KIND_DEFAULT_SECONDS: Record<AudioKind, number> = {
  narration: 10,
  bgm: 15,
  sfx: 5,
}

export const AUDIO_MOODS = [
  { id: 'heat', prompt: '热血、鼓点清晰的短视频配乐，无人声，节奏稳定，适合剪辑卡点' },
  { id: 'growth', prompt: '温暖上扬的成长向配乐，钢琴或木吉他为主，无人声，适合叙事收尾' },
  { id: 'pulse', prompt: '节奏感强的电子配乐，无人声，中等速度，适合产品展示和卡点转场' },
  { id: 'trust', prompt: '克制、可信的品牌向配乐，轻弦乐或轻电子，无人声，不抢旁白' },
  { id: 'calm', prompt: '安静舒缓的氛围配乐，无人声，低动态，适合口播垫乐' },
] as const
export type AudioMoodId = (typeof AUDIO_MOODS)[number]['id']

export function parseAudioKind(raw: unknown): AudioKind {
  return AUDIO_KINDS.includes(raw as AudioKind) ? raw as AudioKind : 'narration'
}

export function parseAudioMood(raw: unknown): AudioMoodId | '' {
  return AUDIO_MOODS.some(item => item.id === raw) ? raw as AudioMoodId : ''
}

export function audioUsesVoice(kind: AudioKind) {
  return kind === 'narration'
}

export function audioKindTag(kind: AudioKind) {
  return `canvas.audio.tag.${kind}`
}

export function audioMoodPrompt(id?: string) {
  return AUDIO_MOODS.find(item => item.id === id)?.prompt || ''
}

export function audioKindParams(kind: AudioKind, mood?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    audioKind: kind,
    duration: AUDIO_KIND_DEFAULT_SECONDS[kind],
  }
  if (kind === 'bgm')
    out.mood = parseAudioMood(mood) || 'pulse'
  return out
}

/** 提示词还是空的、或仍是上一档情绪模板时，换成新情绪；用户自己写过的不覆盖 */
export function applyAudioMoodPrompt(prompt: string, nextMood: string, prevMood?: string) {
  const next = audioMoodPrompt(nextMood)
  const prev = audioMoodPrompt(prevMood)
  const text = String(prompt || '').trim()
  if (!text || (prev && text === prev))
    return next
  return text
}

export function buildAudioPrompt(kind: AudioKind, prompt: string, mood?: string) {
  const text = String(prompt || '').trim()
  if (kind !== 'bgm')
    return text
  const extra = audioMoodPrompt(mood)
  if (!extra)
    return text
  if (!text)
    return extra
  if (text.includes(extra))
    return text
  return `${text}\n\n${extra}`
}

export function isPreferredComposeBgm(params?: Record<string, unknown> | null) {
  return parseAudioKind(params?.audioKind) === 'bgm'
}

/** 合成配乐：先用标成配乐的轨道，否则只在画布上恰好一条音频时自动带上 */
export function pickComposeBgmId(audios: Array<{ assetId: number, preferred?: boolean }>) {
  const preferred = audios.find(item => item.preferred && item.assetId > 0)
  if (preferred)
    return preferred.assetId
  if (audios.length === 1) {
    const only = audios[0]
    return only && only.assetId > 0 ? only.assetId : 0
  }
  return 0
}
