import type { GenerationModel } from '~/types/creative'
import { modelAbilities } from '~/utils/canvas-talking'

/** 参考视频能力位（API.md 23.1 model_price.abilities）：视频模型能接收 reference_video 素材 */
export const VIDEO_REFERENCE_ABILITY = 'video_reference'

/** 爆款复刻把原片当 reference_video 提交，不吃参考视频的模型到了网关才会被拒，所以只列这类模型 */
export function hasVideoReference(model?: { abilities?: string[] | string | null } | null) {
  return modelAbilities(model).includes(VIDEO_REFERENCE_ABILITY)
}

/** 爆款复刻可选的模型：视频、已定价、能吃参考视频 */
export function viralModels(list: GenerationModel[] | null | undefined): GenerationModel[] {
  return (list || []).filter(item => item.type === 'video' && item.priced && hasVideoReference(item))
}

/**
 * 默认模型：上次复刻用过的 → 运营配的成片默认视频模型（GET /app/config growth.compose_video_model）→ 清单第一个。
 * 每一级都要在可选清单里才算数；都不在时返回 null，由调用方提示「暂无支持参考视频的模型」。
 */
export function pickViralModel(
  list: GenerationModel[] | null | undefined,
  prefs: { remembered?: string | null, configModel?: string | null } = {},
): GenerationModel | null {
  const usable = viralModels(list)
  if (!usable.length)
    return null
  for (const want of [prefs.remembered, prefs.configModel]) {
    const name = String(want || '').trim()
    if (!name)
      continue
    const hit = usable.find(item => item.model === name)
    if (hit)
      return hit
  }
  return usable[0] ?? null
}

const FREE_MIN = 3
const FREE_MAX = 15

/**
 * 复刻时长：原片多长就出多长。模型声明了档位就落到最接近原片时长的档（相等距离取更长的），
 * 没声明档位时四舍五入并夹在 3~15 秒；原片时长读不到时取最短档 / 5 秒。
 */
export function viralDuration(sourceSeconds: number, allowedDurations?: number[] | null): number {
  const tiers = (allowedDurations || []).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const src = Number.isFinite(sourceSeconds) && sourceSeconds > 0 ? sourceSeconds : 0
  if (!tiers.length) {
    if (!src)
      return 5
    return Math.min(FREE_MAX, Math.max(FREE_MIN, Math.round(src)))
  }
  if (!src)
    return tiers[0]!
  let best = tiers[0]!
  for (const tier of tiers) {
    const gap = Math.abs(tier - src)
    const bestGap = Math.abs(best - src)
    if (gap < bestGap || (gap === bestGap && tier > best))
      best = tier
  }
  return best
}

const RATIO_CANDIDATES = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'] as const

/** 详情接口没给比例枚举时的兜底选项 */
export const VIRAL_RATIO_CANDIDATES: readonly string[] = RATIO_CANDIDATES

/**
 * 悬浮条参数选项：从模型详情（GET /generation/models/detail，API.md 28）的
 * params.video.properties 取 aspect_ratio / resolution 枚举与 duration 区间，
 * 详情没给的结构字段（durations / resolutions）回落到 GET /generation/models 列表行。
 * 空数组 = 该项没有可选档，悬浮条只留「自动」。
 */
export function viralParamOptions(
  detail: { params?: Record<string, { properties?: Record<string, unknown> }> } | null,
  model?: { durations?: number[] | null, resolutions?: string[] | null } | null,
): { ratios: string[], resolutions: string[], durations: number[] } {
  const props = detail?.params?.video?.properties ?? detail?.params?.text_to_video?.properties ?? {}
  const enumOf = (key: string): string[] => {
    const list = (props[key] as { enum?: unknown } | undefined)?.enum
    return Array.isArray(list) ? list.map(item => String(item || '').trim()).filter(Boolean) : []
  }
  const ratios = enumOf('aspect_ratio')
  const resolutions = enumOf('resolution')
  let durations = (model?.durations || []).map(n => Number(n) || 0).filter(n => n > 0)
  if (!durations.length) {
    const spec = props.duration as { enum?: unknown, min?: unknown, max?: unknown } | undefined
    const enumList = Array.isArray(spec?.enum)
      ? (spec?.enum as unknown[]).map(n => Number(n) || 0).filter(n => n > 0)
      : []
    if (enumList.length) {
      durations = enumList
    }
    else {
      const min = Number(spec?.min) || 0
      const max = Number(spec?.max) || 0
      // 连续区间只在跨度合理时展开成逐秒档位，否则视为不限（只有自动）
      if (min > 0 && max >= min && max - min <= 20)
        durations = Array.from({ length: max - min + 1 }, (_, i) => min + i)
    }
  }
  return {
    ratios: ratios.length ? ratios : [...VIRAL_RATIO_CANDIDATES],
    resolutions: resolutions.length ? resolutions : (model?.resolutions || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean),
    durations,
  }
}

/** 复刻比例：按原片像素尺寸落到最接近的常用比例；尺寸读不到时横屏 16:9 */
export function viralRatio(width: number, height: number): string {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w <= 0 || h <= 0)
    return '16:9'
  const target = w / h
  let best: string = RATIO_CANDIDATES[0]
  let bestGap = Number.POSITIVE_INFINITY
  for (const item of RATIO_CANDIDATES) {
    const [a, b] = item.split(':').map(Number) as [number, number]
    const gap = Math.abs(a / b - target)
    if (gap < bestGap) {
      bestGap = gap
      best = item
    }
  }
  return best
}

/**
 * 复刻用的分辨率：模型声明了档位就优先 720P → 1080P → 清单第一个；没声明返回空串（不传，由网关取默认）。
 */
export function viralResolution(allowed?: string[] | null): string {
  const list = (allowed || []).map(item => String(item || '').trim().toUpperCase()).filter(Boolean)
  if (!list.length)
    return ''
  for (const want of ['720P', '1080P']) {
    if (list.includes(want))
      return want
  }
  return list[0]!
}

/**
 * 原片结构文本（反推出来的 Timestamped prompts）裁到提示词能装下的长度：
 * 去掉标题行，按整行截断，避免把某一段切成半句。
 */
export function trimViralStructure(text: string, maxChars = 1600): string {
  const lines = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^_?timestamped prompts_?$/i.test(line))
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + (out.length ? 1 : 0)
    if (used + cost > maxChars)
      break
    out.push(line)
    used += cost
  }
  return out.join('\n')
}

/**
 * 复刻提示词：有原片结构时逐段照搬景别、运镜与节奏，主体与场景换成参考素材；
 * 没有结构（反推不可用或失败）时退回到一句话的整体描述。中文界面出中文，其它语言出英文。
 */
export function buildViralPrompt(opts: {
  locale?: string
  structure?: string
  refCount: number
  durationSec: number
}): string {
  const zh = (opts.locale || 'zh').toLowerCase().startsWith('zh')
  const structure = trimViralStructure(opts.structure || '')
  const refs = Math.max(0, Math.floor(opts.refCount) || 0)
  const seconds = Math.max(1, Math.round(opts.durationSec) || 0)
  if (zh) {
    const refLine = refs > 0
      ? `主体、场景与道具按提供的 ${refs} 个参考素材替换`
      : '主体、场景与道具可以重新设计，但要保持同样的节奏与镜头语言'
    const tail = `${refLine}；保持画面连贯、风格统一，总时长约 ${seconds} 秒；不要出现原片里的文字、水印和品牌标识。`
    if (!structure)
      return `参考这条爆款视频的分镜结构、节奏与运镜，复刻一支同结构的新视频：逐镜对应原片的景别与镜头运动，${tail}`
    return `按下面的分镜结构复刻一支同结构的新视频：逐段对应原片的景别、运镜与节奏，${tail}\n\n原片分镜结构：\n${structure}`
  }
  const refLine = refs > 0
    ? `replace the subjects, setting and props with the ${refs} provided reference asset(s)`
    : 'the subjects, setting and props may be redesigned while keeping the same pacing and camera language'
  const tail = `${refLine}; keep the footage coherent and the style consistent, about ${seconds} seconds in total; do not reproduce any text, watermark or brand mark from the original.`
  if (!structure)
    return `Recreate a new video that follows the shot structure, pacing and camera moves of this viral video: match each shot's framing and camera motion, ${tail}`
  return `Recreate a new video that follows the shot structure below: match each segment's framing, camera motion and pacing, ${tail}\n\nOriginal shot structure:\n${structure}`
}

const ZH_FREE_LINE = '主体、场景与道具可以重新设计，但要保持同样的节奏与镜头语言'
const EN_FREE_LINE = 'the subjects, setting and props may be redesigned while keeping the same pacing and camera language'

/** 参考素材角色。原片也是 reference_video，计数时要单独排除 */
const VIRAL_REF_ROLES = new Set(['reference', 'reference_video', 'reference_audio'])

function rewriteViralLine(text: string, pattern: RegExp, freeLine: string, line: string) {
  if (!pattern.test(text) && !text.includes(freeLine))
    return text
  pattern.lastIndex = 0
  return text.replace(pattern, line).replaceAll(freeLine, line)
}

/**
 * 提示词里「N 个参考素材」应对的数量：reference / reference_video / reference_audio，去掉原片。
 * 旧复刻节点没记下原片资产时，有 reference_video 就减一条。
 */
export function viralExtraRefCount(
  inputs: Array<{ asset_id?: number, role?: string }>,
  sourceAssetId?: number,
): number {
  const refs = inputs.filter(item => VIRAL_REF_ROLES.has(String(item.role || '')))
  const source = Number(sourceAssetId) || 0
  if (source > 0)
    return refs.filter(item => item.asset_id !== source).length
  return refs.some(item => item.role === 'reference_video') ? Math.max(0, refs.length - 1) : refs.length
}

/**
 * 复刻提示词里那句参考素材数量，按当次 inputs 重写。
 * 不是复刻提示词（两句模板都不在）就原样返回，避免改到用户自己写的提示词。
 */
export function syncViralPromptRefs(prompt: string, refCount: number): string {
  const text = String(prompt || '')
  const refs = Math.max(0, Math.floor(Number(refCount)) || 0)
  const zhLine = refs > 0
    ? `主体、场景与道具按提供的 ${refs} 个参考素材替换`
    : ZH_FREE_LINE
  const enLine = refs > 0
    ? `replace the subjects, setting and props with the ${refs} provided reference asset(s)`
    : EN_FREE_LINE
  return rewriteViralLine(
    rewriteViralLine(text, /主体、场景与道具按提供的 \d+ 个参考素材替换/g, ZH_FREE_LINE, zhLine),
    /replace the subjects, setting and props with the \d+ provided reference asset\(s\)/g,
    EN_FREE_LINE,
    enLine,
  )
}

export type ViralCarryRef = { assetId?: number, url: string, name?: string }

/**
 * 第一次提交用到的参考素材，挂到复刻节点上：连线的再连一条边，上传的放进 refItems。
 * 原片不重复挂；同一个资产连线和上传都有时只留连线。
 */
export function viralCarryRefs(input: {
  sourceAssetId: number
  connected: Array<{ id: string, assetId?: number }>
  uploaded: ViralCarryRef[]
  usedAssetIds: Iterable<number>
}): { refItems: ViralCarryRef[], linkIds: string[] } {
  const used = new Set(input.usedAssetIds)
  const source = Number(input.sourceAssetId) || 0
  const linkIds: string[] = []
  const linkedAssets = new Set<number>()
  const seenNodes = new Set<string>()
  for (const item of input.connected) {
    const id = String(item.id || '')
    const assetId = Number(item.assetId) || 0
    if (!id || seenNodes.has(id) || !(assetId > 0) || assetId === source || !used.has(assetId))
      continue
    seenNodes.add(id)
    linkedAssets.add(assetId)
    linkIds.push(id)
  }
  const refItems: ViralCarryRef[] = []
  const seenAssets = new Set<number>()
  for (const item of input.uploaded) {
    const assetId = Number(item.assetId) || 0
    const url = String(item.url || '').trim()
    if (!(assetId > 0) || !url || assetId === source || !used.has(assetId) || linkedAssets.has(assetId) || seenAssets.has(assetId))
      continue
    seenAssets.add(assetId)
    refItems.push({
      assetId,
      url,
      name: item.name ? String(item.name).trim() : undefined,
    })
  }
  return { refItems, linkIds }
}

/** 一次拉片最多拆这么多镜，再多的截掉，避免一次提交太多视频任务 */
export const VIRAL_SHOT_MAX = 8

export type ViralEntityKind = 'role' | 'scene' | 'element'

export type ViralShot = {
  start: number
  end: number
  text: string
}

export type ViralEntity = {
  id: string
  kind: ViralEntityKind
  name: string
  note: string
  assetId?: number
  url?: string
  assetName?: string
}

/** 挂在原片节点上的拉片结果。替换素材和额外要求也写在这里，随画布保存 */
export type ViralPlan = {
  sourceAssetId: number
  duration: number
  width: number
  height: number
  shots: ViralShot[]
  entities: ViralEntity[]
  extra: string
}

export type ViralFrameHint = {
  index: number
  timeSec: number
  startSec: number
  endSec: number
}

/**
 * 拉片指令：看图模型按关键帧拆镜头，并标出可替换的角色、场景、元素。
 * 只要 JSON，解析失败时再退回时间轴列表。
 */
export function viralAnalysisInstruction(locale: string | undefined, frames: ViralFrameHint[], durationSec: number) {
  const lines = frames.map(frame => `图${frame.index}：约 ${frame.timeSec.toFixed(1)}s（建议覆盖 ${frame.startSec}-${frame.endSec}s）`)
  const seconds = Math.max(0, Math.round(durationSec * 10) / 10)
  const zh = (locale || 'zh').toLowerCase().startsWith('zh')
  const body = [
    '你在做爆款视频拉片。下面按时间顺序给出同一段视频的关键帧。',
    `视频总时长约 ${seconds} 秒。`,
    '关键帧：',
    ...lines,
    `把整段拆成不超过 ${VIRAL_SHOT_MAX} 个连续镜头，并标出可以换成用户自己素材的角色、场景和元素。`,
    '只输出一个 JSON 对象，不要 Markdown、不要前言。格式：',
    '{"shots":[{"start":0,"end":3,"text":"这一镜的主体、动作、运镜、景别、场景和光线"}],"roles":[{"name":"角色名","note":"外观"}],"scenes":[{"name":"场景名","note":"环境"}],"elements":[{"name":"道具名","note":"外观"}]}',
    'shots 的 start/end 是秒，首尾相接并覆盖整段。text 要具体，能直接拿去生成这一镜。',
    'roles / scenes / elements 只写画面里真正出现、适合替换的对象，没有就给空数组。名字短，不要重复。',
  ]
  if (!zh)
    body.push('Write name and text values in English. Keep the JSON keys unchanged.')
  else if ((locale || '').toLowerCase() === 'zh-tw')
    body.push('name 和 text 用繁体中文。')
  else
    body.push('name 和 text 用简体中文。')
  return body.join('\n')
}

function readRecordList(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== 'object')
    return []
  const record = raw as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(record[key]))
      return record[key] as unknown[]
  }
  return []
}

function readEntity(item: unknown): { name: string, note: string } | null {
  if (typeof item === 'string') {
    const name = item.trim()
    return name ? { name: name.slice(0, 40), note: '' } : null
  }
  if (!item || typeof item !== 'object')
    return null
  const row = item as Record<string, unknown>
  const name = String(row.name ?? row.title ?? row['名称'] ?? '').trim()
  const note = String(row.note ?? row.description ?? row.desc ?? row['说明'] ?? '').trim()
  if (!name)
    return null
  return { name: name.slice(0, 40), note: note.slice(0, 80) }
}

function readShot(item: unknown, fallbackDuration: number): ViralShot | null {
  if (!item || typeof item !== 'object')
    return null
  const row = item as Record<string, unknown>
  const start = Number(row.start ?? row['开始'])
  let end = Number(row.end ?? row['结束'])
  const text = String(row.text ?? row.prompt ?? row.description ?? row['内容'] ?? '').trim()
  if (!Number.isFinite(start) || start < 0 || !text)
    return null
  if (!Number.isFinite(end) || end <= start)
    end = start + (fallbackDuration > 0 ? Math.min(4, Math.max(1, fallbackDuration - start)) : 3)
  return {
    start: Math.round(start * 10) / 10,
    end: Math.round(end * 10) / 10,
    text: text.slice(0, 400),
  }
}

function parseTimestampedShots(text: string): ViralShot[] {
  const shots: ViralShot[] = []
  for (const line of text.split('\n')) {
    const matched = line.trim().match(/^[-*]?\s*(\d+(?:\.\d+)?)\s*[-~～到至]\s*(\d+(?:\.\d+)?)\s*s?\s*[：:]\s*(.+)$/i)
    if (!matched)
      continue
    const start = Number(matched[1])
    const end = Number(matched[2])
    const body = matched[3]?.trim() || ''
    if (!body || !(end > start))
      continue
    shots.push({ start, end, text: body.slice(0, 400) })
  }
  return shots
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced?.[1] || text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start)
    return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  }
  catch {
    return null
  }
}

function clampShots(shots: ViralShot[], durationSec: number) {
  const duration = Number(durationSec) > 0 ? durationSec : 0
  const next = shots
    .map((shot) => {
      let start = shot.start
      let end = shot.end
      if (duration > 0) {
        start = Math.min(start, duration)
        end = Math.min(Math.max(end, start), duration)
      }
      if (!(end > start) || !shot.text.trim())
        return null
      return { start, end, text: shot.text.trim() }
    })
    .filter((shot): shot is ViralShot => Boolean(shot))
    .sort((a, b) => a.start - b.start)
  return next.slice(0, VIRAL_SHOT_MAX)
}

function readEntities(raw: unknown, kind: ViralEntityKind, keys: string[], taken: Set<string>) {
  const entities: ViralEntity[] = []
  readRecordList(raw, keys).forEach((item) => {
    const parsed = readEntity(item)
    if (!parsed)
      return
    const key = `${kind}:${parsed.name}`
    if (taken.has(key))
      return
    taken.add(key)
    entities.push({
      id: `${kind}-${entities.length + 1}`,
      kind,
      name: parsed.name,
      note: parsed.note,
    })
  })
  return entities
}

/**
 * 从拉片文本里取出分镜和可替换对象。
 * 优先 JSON；模型若仍按时间轴列表输出，就只得到分镜。都没有时返回 null。
 */
export function parseViralBreakdown(text: string, durationSec = 0): { shots: ViralShot[], entities: ViralEntity[] } | null {
  const raw = String(text || '').trim()
  if (!raw)
    return null
  const json = extractJsonObject(raw)
  const fromJson = json ? readRecordList(json, ['shots', 'shot', '镜头']).map(item => readShot(item, durationSec)).filter((shot): shot is ViralShot => Boolean(shot)) : []
  const shots = clampShots(fromJson.length ? fromJson : parseTimestampedShots(raw), durationSec)
  if (!shots.length)
    return null
  const taken = new Set<string>()
  const entities = json
    ? [
        ...readEntities(json, 'role', ['roles', 'role', '角色'], taken),
        ...readEntities(json, 'scene', ['scenes', 'scene', '场景'], taken),
        ...readEntities(json, 'element', ['elements', 'element', 'props', '元素', '道具'], taken),
      ]
    : []
  return { shots, entities }
}

const KIND_LABEL_ZH: Record<ViralEntityKind, string> = { role: '角色', scene: '场景', element: '元素' }
const KIND_LABEL_EN: Record<ViralEntityKind, string> = { role: 'character', scene: 'setting', element: 'prop' }

/** 已经指定了替换素材的对象，顺序要和视频任务里的参考图一致 */
export function viralMappedEntities(entities: ViralEntity[]) {
  return entities.filter(item => Number(item.assetId) > 0)
}

/**
 * 单镜提示词。替换素材按「参考图1、参考图2」写明，调用方按同一顺序放进 inputs。
 */
export function buildViralShotPrompt(opts: {
  locale?: string
  shot: ViralShot
  entities: ViralEntity[]
  extra?: string
}): string {
  const zh = (opts.locale || 'zh').toLowerCase().startsWith('zh')
  const shot = opts.shot
  const mapped = viralMappedEntities(opts.entities)
  const extra = String(opts.extra || '').trim()
  if (zh) {
    const refs = mapped.length
      ? mapped.map((item, index) => `参考图${index + 1}替换${KIND_LABEL_ZH[item.kind]}「${item.name}」`).join('，') + '。'
      : '主体、场景与道具可以重新设计，但要保持同样的节奏与镜头语言。'
    const lines = [
      `复刻原片 ${shot.start}-${shot.end}s 这一镜，景别、运镜和节奏与原片一致。`,
      refs,
    ]
    if (extra)
      lines.push(`额外要求：${extra}`)
    lines.push(`镜头内容：${shot.text}`, '不要出现原片里的文字、水印和品牌标识。')
    return lines.join('\n')
  }
  const refs = mapped.length
    ? mapped.map((item, index) => `reference image ${index + 1} replaces the ${KIND_LABEL_EN[item.kind]} "${item.name}"`).join('; ') + '.'
    : 'The subjects, setting and props may be redesigned while keeping the same pacing and camera language.'
  const lines = [
    `Recreate the ${shot.start}-${shot.end}s shot from the original. Match its framing, camera move and pacing.`,
    refs,
  ]
  if (extra)
    lines.push(`Extra direction: ${extra}`)
  lines.push(`Shot: ${shot.text}`, 'Do not reproduce any text, watermark or brand mark from the original.')
  return lines.join('\n')
}
