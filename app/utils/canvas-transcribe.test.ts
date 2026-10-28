import { describe, expect, it } from 'vitest'
import { isDiarizeModel, normalizeTranscribeLanguage, pickTranscribeModel } from './canvas-transcribe'

describe('normalizeTranscribeLanguage', () => {
  it('只认后端支持的语种，其余回落 auto', () => {
    expect(normalizeTranscribeLanguage('zh')).toBe('zh')
    expect(normalizeTranscribeLanguage(' EN ')).toBe('en')
    expect(normalizeTranscribeLanguage('de')).toBe('auto')
    expect(normalizeTranscribeLanguage(null)).toBe('auto')
  })
})

describe('pickTranscribeModel', () => {
  const models = ['gpt-4o-transcribe-diarize', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe']
  it('不区分说话人时优先非 diarize 模型', () => {
    expect(pickTranscribeModel(models, false)).toBe('gpt-4o-mini-transcribe')
    expect(pickTranscribeModel(['gpt-4o-transcribe-diarize'], false)).toBe('gpt-4o-transcribe-diarize')
  })
  it('区分说话人时挑 diarize 模型，没有就空串', () => {
    expect(pickTranscribeModel(models, true)).toBe('gpt-4o-transcribe-diarize')
    expect(pickTranscribeModel(['gpt-4o-mini-transcribe'], true)).toBe('')
  })
  it('清单为空交给后端兜底', () => {
    expect(pickTranscribeModel([], false)).toBe('')
    expect(isDiarizeModel('GPT-4o-Transcribe-Diarize')).toBe(true)
  })
})
