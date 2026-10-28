/**
 * 把剧本 / 配方 / 节点上写的模型 id 对到 GET /generation/models 的真 id。
 *
 * 运营定价表里的 id 大小写、分隔符经常和剧本约定（qwen-image-2.0 / Kling-2.5）对不上。
 * 检查器以前只做精确匹配，对不上就回落到上次选的模型——跟练卡片写 Kling，面板却显示 Seedance。
 */

export type CatalogModelRef = {
  model: string
  type?: string
  priced?: boolean
  label?: string
}

export type ResolveCatalogModelOptions = {
  /** 只在这一类里找（image / video / audio / text）；空则不限 */
  type?: string
  /** 默认 true：同分时已定价的优先，避免写上未定价的同名变体 */
  preferPriced?: boolean
}

/** 去掉路径、大小写、分隔符后的比对键：Kling-2.5 / kling/2.5 / Kling 2.5 都是 kling25 */
export function catalogModelKey(id: string) {
  const raw = String(id || '').trim().toLowerCase()
  if (!raw)
    return ''
  const parts = raw.split(/[/:]/)
  const last = parts[parts.length - 1] || raw
  // vendor/kling-2.5 只留最后一段；kling/2.5 的末段没有字母，整串一起收
  const slug = parts.length > 1 && /[a-z]/.test(last) ? last : raw
  return slug.replace(/[^a-z0-9]+/g, '')
}

export function catalogModelsEqual(a: string, b: string) {
  const left = String(a || '').trim()
  const right = String(b || '').trim()
  if (!left || !right)
    return false
  if (left === right || left.toLowerCase() === right.toLowerCase())
    return true
  const leftKey = catalogModelKey(left)
  const rightKey = catalogModelKey(right)
  return Boolean(leftKey && rightKey && leftKey === rightKey)
}

function prefixRelated(a: string, b: string) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  // kling25 / kling25pro 算同一家；光写 kling 去撞 kling26 太宽
  return short.length >= 6 && /\d/.test(short) && long.startsWith(short)
}

function scoreCatalogMatch(wanted: string, item: CatalogModelRef) {
  const id = String(item.model || '').trim()
  if (!id)
    return 0
  if (id === wanted)
    return 100
  if (id.toLowerCase() === wanted.toLowerCase())
    return 90
  const wantKey = catalogModelKey(wanted)
  const idKey = catalogModelKey(id)
  if (!wantKey || !idKey)
    return 0
  if (idKey === wantKey)
    return 80
  if (prefixRelated(wantKey, idKey))
    return Math.max(50, 70 - Math.abs(idKey.length - wantKey.length))
  const labelKey = catalogModelKey(item.label || '')
  if (labelKey && (labelKey === wantKey || prefixRelated(wantKey, labelKey)))
    return 40
  return 0
}

/**
 * 在定价清单里找 wanted 对应的真模型 id。
 * 对不上或清单为空时返回 null——调用方应保留原 id，不要改用「上次选的」。
 */
export function resolveCatalogModel(
  wanted: string,
  catalog: readonly CatalogModelRef[] | null | undefined,
  opts?: ResolveCatalogModelOptions,
): string | null {
  const raw = String(wanted || '').trim()
  if (!raw || raw === 'auto')
    return null
  const type = String(opts?.type || '').trim()
  const items = (catalog || []).filter(item => item.model && (!type || !item.type || item.type === type))
  if (!items.length)
    return null
  const preferPriced = opts?.preferPriced !== false
  let best: CatalogModelRef | null = null
  let bestScore = 0
  for (const item of items) {
    let score = scoreCatalogMatch(raw, item)
    if (!score)
      continue
    if (preferPriced && item.priced)
      score += 5
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return best?.model || null
}

/** 对得上就用清单 id，对不上就原样返回（空 / auto 也原样） */
export function resolveCatalogModelId(
  wanted: string,
  catalog: readonly CatalogModelRef[] | null | undefined,
  opts?: ResolveCatalogModelOptions,
) {
  const raw = String(wanted || '').trim()
  return resolveCatalogModel(raw, catalog, opts) || raw
}
