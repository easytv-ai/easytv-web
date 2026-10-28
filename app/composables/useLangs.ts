import langApi from '~/api/lang'
import type { LangOption } from '~/types/creative'

/** 接口不可用时的兜底语种，与 API.md 10.4 的 setting.ComposeLangs 默认值一致 */
const FALLBACK_LANGS: LangOption[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
]

/** 字幕 / 配音语种（GET /langs，API.md 10.4）：跨组件共享，只拉一次 */
export function useLangs() {
  const langs = useState<LangOption[]>('compose-langs', () => [...FALLBACK_LANGS])
  const loaded = useState('compose-langs-loaded', () => false)

  async function load() {
    if (loaded.value)
      return
    try {
      const res = await langApi.list()
      if (!res?.success || !Array.isArray(res.data))
        return
      if (res.data.length)
        langs.value = res.data.filter(item => item?.code).map(item => ({ code: String(item.code), label: String(item.label || item.code) }))
      loaded.value = true
    }
    catch {
      // 保留兜底语种，下次再试
    }
  }

  function langLabel(code: string) {
    return langs.value.find(item => item.code === code)?.label || code
  }

  return { langs, load, langLabel }
}
