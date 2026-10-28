/**
 * 语音转字幕的弹窗选项（API.md 35.2）：语种与后端 transcribeLanguages 一一对应，
 * 区分说话人只有模型名含 diarize 的转写模型才生效。
 */
export const TRANSCRIBE_LANGUAGES = [
  { id: 'auto', label: '自动识别' },
  { id: 'zh', label: '中文' },
  { id: 'en', label: '英语' },
  { id: 'ja', label: '日语' },
  { id: 'ko', label: '韩语' },
  { id: 'es', label: '西班牙语' },
  { id: 'fr', label: '法语' },
] as const

export type TranscribeLanguage = (typeof TRANSCRIBE_LANGUAGES)[number]['id']

export const TRANSCRIBE_LANG_STORAGE_KEY = 'easytv-transcribe-lang'

export function normalizeTranscribeLanguage(raw: unknown): TranscribeLanguage {
  const value = String(raw ?? '').trim().toLowerCase()
  return TRANSCRIBE_LANGUAGES.some(item => item.id === value) ? value as TranscribeLanguage : 'auto'
}

export function isDiarizeModel(model: string) {
  return model.toLowerCase().includes('diarize')
}

/**
 * 要不要区分说话人决定用哪个模型：勾了就挑第一个 diarize 模型，没勾优先挑非 diarize 的
 * （diarize 模型通常更贵）；清单为空返回空串，交给后端按设置 / 能力位兜底。
 */
export function pickTranscribeModel(models: string[], diarize: boolean) {
  const list = models.map(item => String(item || '').trim()).filter(Boolean)
  if (diarize)
    return list.find(isDiarizeModel) || ''
  return list.find(item => !isDiarizeModel(item)) || list[0] || ''
}
