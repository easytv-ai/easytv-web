/**
 * 生成时把模型与参数记回节点（L21：批量生成落到画布的是带参生成器组，不是空节点）。
 * 只留 Inspector 初始化会读的那几个键（API.md 32.7 的 data.params 消费链），
 * count / camera / seed 这类一次性的不记——记了反而让下一次点「生成」带上旧值。
 */

export const NODE_PARAM_KEYS = ['ratio', 'clarity', 'quality', 'size', 'resolution', 'duration', 'mode', 'lang', 'voice', 'audioKind', 'mood'] as const

export function pickNodeParams(params: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!params)
    return undefined
  const out: Record<string, unknown> = {}
  for (const key of NODE_PARAM_KEYS) {
    const value = params[key]
    if (value === undefined || value === null || value === '')
      continue
    out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

/** 写回节点的补丁：模型 + 白名单参数；没有可记的参数时保留节点上原有的 */
export function nodeGeneratePatch(model: string, params: Record<string, unknown> | null | undefined) {
  const picked = pickNodeParams(params)
  const patch: { model?: string, params?: Record<string, unknown> } = {}
  if (model)
    patch.model = model
  if (picked)
    patch.params = picked
  return patch
}
