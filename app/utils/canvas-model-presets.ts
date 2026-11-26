/**
 * 画布创作预设：按模型记住比例、时长、分辨率等参数。
 * 不记提示词、种子和生成模式提交值；视频模式单独记，套用时再对到这个模型支持的模式。
 */

export interface CanvasModelPreset {
  id: string
  name: string
  model: string
  params: Record<string, string | number | boolean>
  videoMode?: string
  updatedAt: number
}

export const MODEL_PRESET_LIMIT = 8
export const MODEL_PRESET_TOTAL = 48
const NAME_LIMIT = 20

const SKIP_KEYS = new Set([
  'seed',
  'mode',
  'preset',
  'style_preset',
  'prompt',
  'subject_ids',
  'subject_versions',
])

export function capturePresetParams(input: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SKIP_KEYS.has(key))
      continue
    if (typeof value === 'string') {
      const text = value.trim()
      if (text)
        out[key] = text
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value))
      out[key] = value
    else if (typeof value === 'boolean')
      out[key] = value
  }
  return out
}

export function normalizePresetName(name: string) {
  return name.replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT)
}

export function presetsForModel(list: CanvasModelPreset[], model: string) {
  return list
    .filter(item => item.model === model)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 同模型同名覆盖。每个模型最多 8 条，总共最多 48 条，多的丢掉最旧的。 */
export function upsertModelPreset(
  list: CanvasModelPreset[],
  draft: { name: string, model: string, params: Record<string, string | number | boolean>, videoMode?: string },
  now = Date.now(),
): { list: CanvasModelPreset[], replaced: boolean } {
  const name = normalizePresetName(draft.name)
  const model = draft.model.trim()
  if (!name || !model)
    return { list, replaced: false }
  const existing = list.find(item => item.model === model && item.name === name)
  const row: CanvasModelPreset = {
    id: existing?.id || `mp-${now}`,
    name,
    model,
    params: { ...draft.params },
    ...(draft.videoMode ? { videoMode: draft.videoMode } : {}),
    updatedAt: now,
  }
  const rest = list.filter(item => item.id !== row.id && !(item.model === model && item.name === name))
  const same = [row, ...rest.filter(item => item.model === model)].slice(0, MODEL_PRESET_LIMIT)
  const others = rest.filter(item => item.model !== model)
  return {
    list: [...same, ...others].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MODEL_PRESET_TOTAL),
    replaced: Boolean(existing),
  }
}

export function deleteModelPreset(list: CanvasModelPreset[], id: string) {
  return list.filter(item => item.id !== id)
}

export function parseModelPresets(raw: unknown): CanvasModelPreset[] | null {
  const text = typeof raw === 'string' ? raw : ''
  if (!text)
    return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed))
      return null
    const out: CanvasModelPreset[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object')
        continue
      const row = item as Partial<CanvasModelPreset>
      const name = normalizePresetName(String(row.name || ''))
      const model = String(row.model || '').trim()
      const id = String(row.id || '').trim()
      if (!name || !model || !id || !row.params || typeof row.params !== 'object')
        continue
      const params = capturePresetParams(row.params as Record<string, unknown>)
      out.push({
        id,
        name,
        model,
        params,
        ...(typeof row.videoMode === 'string' && row.videoMode.trim() ? { videoMode: row.videoMode.trim() } : {}),
        updatedAt: Number.isFinite(row.updatedAt) ? Number(row.updatedAt) : 0,
      })
    }
    return out.slice(0, MODEL_PRESET_TOTAL)
  }
  catch {
    return null
  }
}
