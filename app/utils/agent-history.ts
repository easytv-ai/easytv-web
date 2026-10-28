/** Agent 灵感历史：提示词 + 当时挂的技能 / 素材，存在 localStorage。 */

export type AgentHistoryItem = {
  prompt: string
  skillId?: number
  skillTitle?: string
  assetId?: number
  assetName?: string
}

const LIMIT = 20

function asId(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function historyKey(item: AgentHistoryItem) {
  return `${item.prompt}\0${item.skillId ?? 0}\0${item.assetId ?? 0}`
}

export function parseAgentHistory(raw: unknown): AgentHistoryItem[] {
  if (!Array.isArray(raw))
    return []
  const seen = new Set<string>()
  const items: AgentHistoryItem[] = []
  for (const entry of raw) {
    const item = normalizeHistoryEntry(entry)
    if (!item)
      continue
    const key = historyKey(item)
    if (seen.has(key))
      continue
    seen.add(key)
    items.push(item)
    if (items.length >= LIMIT)
      break
  }
  return items
}

function normalizeHistoryEntry(entry: unknown): AgentHistoryItem | null {
  if (typeof entry === 'string') {
    const prompt = entry.trim()
    return prompt ? { prompt } : null
  }
  if (!entry || typeof entry !== 'object')
    return null
  const row = entry as Record<string, unknown>
  const prompt = asText(row.prompt)
  const skillId = asId(row.skillId)
  const assetId = asId(row.assetId)
  if (!prompt && !skillId && !assetId)
    return null
  return {
    prompt,
    skillId,
    skillTitle: asText(row.skillTitle) || undefined,
    assetId,
    assetName: asText(row.assetName) || undefined,
  }
}

export function pushAgentHistory(items: AgentHistoryItem[], next: AgentHistoryItem, limit = LIMIT): AgentHistoryItem[] {
  const item = normalizeHistoryEntry(next)
  if (!item)
    return items.slice(0, limit)
  const key = historyKey(item)
  return [item, ...items.filter(row => historyKey(row) !== key)].slice(0, limit)
}

export function historyLabel(item: AgentHistoryItem) {
  return item.prompt || item.skillTitle || item.assetName || ''
}
