/**
 * 剧本对话：先确认要交付什么，再写创作稿、锚点和分镜。
 * 创作稿落到文本节点。锚点里的角色、场景、道具和分镜落到图片节点；有对白的角色可再建音色；成片路径再落逐镜视频并合成。
 * 模型只出 JSON，卡片和画布节点由前端画。
 */

export type BriefQuestion = {
  ask: string
  options: string[]
  /** 选中的选项下标；等于 options.length 时是「自己填写」 */
  chosen?: number
  note?: string
}

export type BriefPath = 'full' | 'teaser' | 'stills' | 'script'

export type BriefAskCard = {
  kind: 'ask'
  locked: boolean
  title: string
  script: string
  questions: BriefQuestion[]
  /** 开场第一问的分岔：成片 / 预告 / 设定图 / 只写剧本 */
  path?: BriefPath
  /** 多问时当前页，从 0 起 */
  step?: number
}

export type BriefCharacter = {
  name: string
  look: string
}

export type BriefShot = {
  no: string
  seconds: number
  picture: string
  line: string
}

export type BriefVoice = {
  name: string
  shots: string[]
}

export type BriefDocCard = {
  kind: 'draft' | 'anchors' | 'board'
  locked: boolean
  title: string
  thinking: string
  label: string
  body: string
  characters?: BriefCharacter[]
  scenes?: BriefCharacter[]
  props?: BriefCharacter[]
  shots?: BriefShot[]
  /** 分镜静帧用的画幅，来自已确认的制作方向 */
  frameRatio?: string
  placed: boolean
}

export type BriefVoiceCard = {
  kind: 'voice'
  locked: boolean
  title: string
  questions: BriefQuestion[]
  voices: BriefVoice[]
  step?: number
  placed: boolean
}

export type BriefGenerateCounts = {
  characters: number
  scenes: number
  props: number
  shots: number
  voices: number
  points?: number
}

/** 批量出图 / 配音 / 出视频时用户选的模型，避免清单第一条贵模型直接跑 */
export type BriefMediaKind = 'image' | 'audio' | 'video'
export type BriefMediaModels = Partial<Record<BriefMediaKind, string>>

export type BriefGenerateCard = {
  kind: 'generate'
  locked: boolean
  title: string
  questions: BriefQuestion[]
  counts: BriefGenerateCounts
  step?: number
  auto?: boolean
  models?: BriefMediaModels
  /** 用户选了「暂不配音」。空字符串会被当成还没选，不能靠它挡住默认模型。 */
  skipAudio?: boolean
}

export type BriefVideoCard = {
  kind: 'video' | 'compose'
  locked: boolean
  title: string
  questions: BriefQuestion[]
  shots: number
  step?: number
  models?: BriefMediaModels
}

/** 对话模型构思之后、真正出片之前的确认卡 */
export type ChatMediaConfirmCard = {
  kind: 'media-confirm'
  locked: boolean
  mediaType: ChatFreeMediaKind
  prompt: string
  model: string
  ratio?: string
  seconds?: number
  resolution?: string
  points?: number
  skipped?: boolean
  refs?: Array<{ assetId?: number, url: string, name?: string }>
}

export type BriefCard = BriefAskCard | BriefDocCard | BriefVoiceCard | BriefGenerateCard | BriefVideoCard | ChatMediaConfirmCard

export type BriefMediaGroup = 'character' | 'scene' | 'prop' | 'shot' | 'voice' | 'video'

export type BriefGenerateProgress = {
  index: number
  total: number
  label: string
  status: 'start' | 'ok' | 'fail'
}

export type BriefGenerateReport = {
  ok: number
  failed: number
  total: number
  /** 等到界面超时仍在排队或生成，没有标失败，也不能当失败去重试 */
  waiting?: number
}

export type BriefGenerateOpts = {
  onProgress?: (row: BriefGenerateProgress) => void
  models?: BriefMediaModels
}

export type BriefComposeReport = {
  ok: boolean
  nodeId?: string
  error?: string
  count?: number
}

export type BriefComposeOpts = {
  preview?: boolean
  aspect?: string
  onStart?: (nodeId: string) => void
  onDone?: (report: BriefComposeReport) => void
}

/** 模型把「成片已导出」写成了正文，并没有真文件，要走画布合成落到视频节点 */
export function looksLikeComposeReport(text: string) {
  const raw = String(text || '')
  if (!raw.trim())
    return false
  const hits = [
    /成片交付/.test(raw),
    /导出文件/.test(raw),
    /音画绑定/.test(raw),
    /合成结果/.test(raw),
    /final_cut|\.mp4/i.test(raw),
    /可直接导出|交付可用/.test(raw),
  ].filter(Boolean).length
  return hits >= 2
}

const BRIEF_ROLE: Record<BriefMediaGroup, string> = {
  character: '角色锚点',
  scene: '场景锚点',
  prop: '道具锚点',
  shot: '分镜',
  voice: '音色锚点',
  video: '分镜视频',
}

const BRIEF_ROLE_TAIL = /(?:\s*[-/·]\s*)?(角色锚点|场景锚点|道具锚点|分镜视频|分镜|音色锚点)\s*$/

/** 卡片标题：王建国 - 角色锚点，不要图片1、图片2 */
export function briefNodeTitle(name: string, group: BriefMediaGroup, role = '') {
  const suffix = String(role || BRIEF_ROLE[group] || '').trim()
  const head = briefTitleHead(name) || String(name || '').trim()
  if (!head)
    return suffix
  if (!suffix || head === suffix || head.endsWith(` - ${suffix}`) || head.endsWith(`/${suffix}`))
    return head
  return `${head} - ${suffix}`
}

/** 去掉已有的类型后缀，方便从静帧标题推出视频标题 */
export function briefTitleHead(label: string) {
  return String(label || '').replace(BRIEF_ROLE_TAIL, '').trim()
}

export function briefPathOf(chosen?: number): BriefPath {
  return (['full', 'teaser', 'stills', 'script'] as const)[chosen ?? 0] || 'full'
}

export function briefWantsBoard(path?: BriefPath) {
  return path === 'full' || path === 'teaser'
}

export function briefWantsFilm(path?: BriefPath) {
  return path === 'full' || path === 'teaser'
}

export function briefGenerateGroups(chosen: number): BriefMediaGroup[] | null {
  if (chosen === 0)
    return ['character', 'scene', 'prop', 'shot', 'voice']
  if (chosen === 2)
    return ['character', 'scene', 'prop']
  return null
}

/** 没选配音模型时从批量生成里拿掉音色，避免空模型把整批拦住 */
export function briefRunGroups(groups: BriefMediaGroup[], models?: BriefMediaModels): BriefMediaGroup[] {
  if (String(models?.audio || '').trim())
    return groups
  return groups.filter(group => group !== 'voice')
}

export function briefNeedsImage(counts: Pick<BriefGenerateCounts, 'characters' | 'scenes' | 'props' | 'shots'>) {
  return Boolean(counts.characters || counts.scenes || counts.props || counts.shots)
}

/** 画布节点上次选的模型（与检查器 localStorage 同一把钥匙） */
export const CANVAS_LAST_MODEL_KEY = 'easytv-canvas-last-model'

export function readCanvasLastModels(): Record<string, string> {
  if (typeof localStorage === 'undefined')
    return {}
  try {
    const raw = JSON.parse(localStorage.getItem(CANVAS_LAST_MODEL_KEY) || '{}') as Record<string, string>
    return raw && typeof raw === 'object' ? raw : {}
  }
  catch {
    return {}
  }
}

export function writeCanvasLastModel(type: string, id: string) {
  const model = String(id || '').trim()
  if (!type || !model || typeof localStorage === 'undefined')
    return
  try {
    const next = { ...readCanvasLastModels(), [type]: model }
    localStorage.setItem(CANVAS_LAST_MODEL_KEY, JSON.stringify(next))
  }
  catch {
    // 忽略配额 / 隐私模式
  }
}

type BriefPricedModel = {
  model: string
  type: string
  priced?: boolean
  unit?: string
  points_per_unit?: number
  member_points_per_unit?: number
  effective_points_per_unit?: number
  effective_member_points_per_unit?: number
}

function briefUnitPrice(item: BriefPricedModel, isMember: boolean) {
  const n = (value: unknown) => {
    const x = Number(value)
    return Number.isFinite(x) && x > 0 ? x : 0
  }
  const eff = isMember ? n(item.effective_member_points_per_unit) : n(item.effective_points_per_unit)
  if (eff)
    return eff
  const member = n(item.member_points_per_unit)
  return isMember && member ? member : n(item.points_per_unit)
}

export function briefModelsOf(list: BriefPricedModel[], type: BriefMediaKind) {
  const priced = list.filter(item => item.type === type && item.priced)
  return priced.length ? priced : list.filter(item => item.type === type)
}

/** 批量生成默认模型：有上次选择就用上次的，否则用最便宜的已定价模型 */
export function defaultBriefModel(list: BriefPricedModel[], type: BriefMediaKind, lastId = '', isMember = false) {
  const items = briefModelsOf(list, type)
  if (!items.length)
    return ''
  const last = String(lastId || '').trim()
  if (last && items.some(item => item.model === last))
    return last
  return items.slice().sort((a, b) => briefUnitPrice(a, isMember) - briefUnitPrice(b, isMember))[0]!.model
}

export function briefTitle(script: string) {
  const hit = String(script || '').match(/《([^》]{1,40})》/)
  return hit?.[1]?.trim() || '未命名'
}

/** 带故事结构的材料，或特别长的正文，才走开场确认；短句仍走普通对话 */
export function shouldOpenBrief(text: string) {
  const raw = String(text || '').trim()
  if (/剧本|故事|人物|主角|第一集|体量|金手指|场次/.test(raw) && raw.length >= 12)
    return true
  return raw.length >= 180
}

export type ChatFreeMediaKind = 'image' | 'video' | 'audio'

/** 对话里点名要出一条媒体，而不是写剧本 / 改提示词 */
export function chatWantsStillImage(text: string) {
  const raw = String(text || '').trim()
  if (!raw)
    return false
  if (/视频|成片|分镜|剧本|配音|音色|配乐|BGM|提示词/.test(raw))
    return false
  return /(生成|画|出|做).{0,12}(图|头像|海报|封面|立绘|设定图|女头|男头)|一[张幅].{0,8}(图|头像|海报|封面|立绘)|帮我画/.test(raw)
}

export function chatWantsVideo(text: string) {
  const raw = String(text || '').trim()
  if (!raw || /剧本|分镜|合成/.test(raw))
    return false
  return /(生成|做|出).{0,12}视频|一段.{0,8}视频/.test(raw)
}

export function chatWantsAudio(text: string) {
  const raw = String(text || '').trim()
  if (!raw)
    return false
  return /(生成|做|出).{0,8}(配音|音色|配乐|BGM|音频)/.test(raw)
}

/**
 * 自由创作选了图/视频/音频模型时，发送即出片。
 * Agent / 文本模型只在用户明显要单张图、一条视频或一段音频时才出片。
 */
export function chatFreeMediaKind(text: string, selected?: string | null): ChatFreeMediaKind | null {
  const type = String(selected || '').trim()
  if (type === 'image' || type === 'video' || type === 'audio')
    return type
  if (chatWantsVideo(text))
    return 'video'
  if (chatWantsAudio(text))
    return 'audio'
  if (chatWantsStillImage(text))
    return 'image'
  return null
}

export type ChatGenerateAction = {
  type: ChatFreeMediaKind
  prompt: string
  ratio?: string
  seconds?: number
  model?: string
}

const GENERATE_MARK = /(?:<<<\s*)?GENERATE\s*\{/i
const CHAT_MEDIA_MAX_SECONDS = 15

function generateMarkIndex(raw: string) {
  const hit = String(raw || '').search(GENERATE_MARK)
  return hit < 0 ? -1 : hit
}

function extractBalancedObject(raw: string, from: number) {
  const start = raw.indexOf('{', from)
  if (start < 0)
    return ''
  let depth = 0
  let quote = ''
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote)
        quote = ''
      continue
    }
    if (ch === '"' || ch === '\'') {
      quote = ch
      continue
    }
    if (ch === '{')
      depth++
    else if (ch === '}')
      depth--
    if (depth === 0)
      return raw.slice(start, i + 1)
  }
  return ''
}

/** 对话模型决定出片时写在回复末尾的动作；没有这一行就只展示文本 */
export function parseChatGenerateAction(text: string): ChatGenerateAction | null {
  const raw = String(text || '')
  const mark = generateMarkIndex(raw)
  if (mark < 0)
    return null
  const json = extractBalancedObject(raw, mark)
  if (!json)
    return null
  try {
    const obj = JSON.parse(json) as Record<string, unknown>
    const type = String(obj.type || '').trim()
    if (type !== 'image' && type !== 'video' && type !== 'audio')
      return null
    const prompt = String(obj.prompt || '').trim()
    if (!prompt)
      return null
    const seconds = Math.round(Number(obj.seconds))
    return {
      type,
      prompt,
      ratio: String(obj.ratio || '').trim() || undefined,
      seconds: type === 'video' && Number.isFinite(seconds) && seconds > 0
        ? Math.min(CHAT_MEDIA_MAX_SECONDS, Math.max(1, seconds))
        : undefined,
      model: String(obj.model || '').trim() || undefined,
    }
  }
  catch {
    return null
  }
}

export function stripChatGenerateAction(text: string) {
  const raw = String(text || '')
  const mark = generateMarkIndex(raw)
  if (mark < 0)
    return raw.trim()
  const json = extractBalancedObject(raw, mark)
  let end = json ? raw.indexOf(json, mark) + json.length : -1
  if (end >= 0 && raw.slice(end, end + 3) === '>>>')
    end += 3
  if (end < 0) {
    const close = raw.indexOf('>>>', mark)
    end = close < 0 ? raw.length : close + 3
  }
  return `${raw.slice(0, mark)}${raw.slice(end)}`.replace(/\n{3,}/g, '\n\n').trim()
}

/** 发给对话模型的出片约定（不进用户气泡） */
export function chatGenerateInstruction(opts?: {
  imageModel?: string
  videoModel?: string
  audioModel?: string
  ratio?: string
  seconds?: number
  resolution?: string
}) {
  const lines = [
    '你在 EasyTV 画布的对话助手里。用户要出图、出视频或出音频时，由你构思提示词；平台会按你给的提示词真正生成。不要说当前对话不能生成图片或视频，也不要让用户去复制提示词自己出图。',
    '普通问答、改文案、看剧本只写回复，不要输出 GENERATE。只有用户明确要求现在生成时，先用中文写几句想法（构图、风格、画幅），再在回复末尾单独一行输出：',
    '<<<GENERATE{"type":"image","prompt":"完整出图提示词","ratio":"16:9"}>>>',
    'type 只能是 image、video 或 audio。用户没说视频时不要用 video，没说配音/配乐时不要用 audio。prompt 必须是可直接交给生成模型的完整提示词。不要填写 model，平台会让用户确认模型和积分后再出片。不要把 GENERATE 写进正文，也不要声称已经生成完成。',
  ]
  if (opts?.imageModel)
    lines.push(`出图使用模型 ${opts.imageModel}。`)
  if (opts?.videoModel)
    lines.push(`出视频使用模型 ${opts.videoModel}。`)
  if (opts?.audioModel)
    lines.push(`出音频使用模型 ${opts.audioModel}。`)
  if (opts?.ratio)
    lines.push(`默认比例 ${opts.ratio}。`)
  if (opts?.seconds)
    lines.push(`默认时长 ${opts.seconds} 秒。`)
  if (opts?.resolution)
    lines.push(`默认分辨率 ${opts.resolution}。`)
  return `\n[${lines.join('')}]`
}

export function briefAskPrompt(script: string) {
  return `你是短剧制片助手。用户发来一份材料。先问他接下来要你做什么，给出 4 条可选回答。
只输出 JSON，不要其它字：
{"title":"作品名","intro":"","ask":"这份《作品》脚本，你希望我接下来做什么？","options":["选项1","选项2","选项3","选项4"]}
options 固定 4 条，按材料写具体一点，不要空泛。顺序是：完整成片（走锚点+分镜）、只要开场概念段或预告、生成角色和场景设定图（点出材料里的角色名）、先扩写成细剧本暂不生成媒体。
材料只是设定大纲、没有可拍剧情时，再加第 2 问：
{"questions":[{"ask":"第一问","options":["四条"]},{"ask":"这份文本是设定大纲，成片剧情从哪里来？","options":["四条"]}]}
第 2 问的 options 写：代写第一集并先确认、由他再贴一段正文、先出角色设定图、先只写分场大纲。最多 2 问。不要写「其他」。材料里已经写明的画幅、时长、风格，写进对应选项。
材料：
${String(script || '').slice(0, 8000)}`
}

export function briefDraftPrompt(input: { title: string, script: string, picks: string, extra: string }) {
  return `你是短剧编剧。用户已确认：${input.picks}${input.extra ? `。补充：${input.extra}` : ''}。
作品：${input.title}
如果材料只是设定和人物，没有可直接拍摄的分镜，就代笔写出 60 秒以内的第一集剧情演绎稿。无旁白、无画外音，心理活动写成神态和动作。
只输出 JSON，不要其它字：
{"thinking":"一两句你为什么这样写","label":"《作品》第一集 · 创作稿","body":"完整剧本体"}
body 用场次体，例如「场次一 · 地点 · 日·外」，对白格式「角色：台词」。不要写分镜号，不要写拍摄指南。
材料：
${String(input.script || '').slice(0, 8000)}`
}

export function briefAnchorPrompt(input: { title: string, script: string, picks: string, draft: string }) {
  return `你是短剧场记。根据已确认的制作方向和第一集创作稿，做内容锚点全量登记。
已确认：${input.picks}
作品：${input.title}
只输出 JSON，不要其它字：
{"thinking":"一两句登记范围","label":"《作品》锚点集","characters":[{"name":"角色名","look":"一句话外貌"}],"scenes":[{"name":"场景名","look":"一句话环境"}],"props":[{"name":"道具名","look":"一句话外观"}],"body":""}
characters 列出创作稿里每一个要出镜的角色，包含主角和有名字的配角，最多 12 个。look 只写年龄感、五官、发型、服装，不要写剧情。
scenes 列出每一个要出镜的场景，最多 8 个。look 写时间、天气、空间、光线，不要写人物。
props 列出关键道具，最多 8 个。look 只写外形。不要把角色、场景、道具再写进 body，不要写分镜。
创作稿：
${String(input.draft || '').slice(0, 8000)}
材料：
${String(input.script || '').slice(0, 4000)}`
}

export function briefBoardPrompt(input: { title: string, picks: string, draft: string, anchors: string }) {
  return `你是短剧分镜师。把第一集创作稿拆成可拍摄的分镜，总时长落在已确认的时长里。
已确认：${input.picks}
作品：${input.title}
只输出 JSON，不要其它字：
{"thinking":"一两句拆分方式","label":"《作品》第一集 · 分镜","shots":[{"no":"1","seconds":4,"picture":"这一镜的画面","line":"对白或动作"}]}
shots 按时间顺序，每镜一条，最多 16 镜。seconds 是大约秒数，加总不超过已确认时长。picture 只写这一镜能看见的画面：景别、人物、动作、环境。line 写这一镜的对白或关键动作，没有就留空。不要写分镜表正文，不要把多镜画进同一格。
创作稿：
${String(input.draft || '').slice(0, 8000)}
锚点：
${String(input.anchors || '').slice(0, 4000)}`
}

export function plainChatPrompt(input: { current: string, turns: { role: string, text: string }[] }) {
  const recent = (input.turns || []).slice(-8).map((turn) => {
    const who = turn.role === 'user' ? '用户' : '助手'
    return `${who}：${String(turn.text || '').replace(/\s+/g, ' ').trim().slice(0, 400)}`
  }).filter(line => line.length > 3)
  const current = String(input.current || '').trim()
  if (!recent.length)
    return current
  return `${recent.join('\n')}\n用户：${current}`
}

function parseObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start)
    return null
  try {
    const value = JSON.parse(raw.slice(start, end + 1))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null
    return value as Record<string, unknown>
  }
  catch {
    return null
  }
}

function readAskOptions(row: any): string[] {
  const list = Array.isArray(row?.options) ? row.options : []
  const out: string[] = []
  for (const item of list) {
    const text = String(item || '').trim()
    if (!text)
      continue
    out.push(text)
    if (out.length >= 4)
      break
  }
  const pick = String(row?.pick || '').trim()
  if (!out.length && pick)
    out.push(pick)
  return out
}

function readAskQuestion(row: any): BriefQuestion | null {
  const ask = String(row?.ask || '').trim()
  const options = readAskOptions(row)
  if (!ask || !options.length)
    return null
  return { ask, options }
}

export function parseBriefAsk(text: string): { title: string, intro: string, questions: BriefQuestion[] } | null {
  const obj = parseObject(text)
  if (!obj)
    return null
  const questions: BriefQuestion[] = []
  const top = readAskQuestion(obj)
  const list = Array.isArray(obj.questions) ? obj.questions : []
  for (const row of list) {
    const item = readAskQuestion(row)
    if (!item)
      continue
    questions.push(item)
    if (questions.length >= 2)
      break
  }
  if (!questions.length && top)
    questions.push(top)
  if (!questions.length)
    return null
  return {
    title: String(obj.title || '').trim(),
    intro: String(obj.intro || '').trim(),
    questions,
  }
}

/** 确认卡上已选中的回答，自己填写时用 note */
export function briefAskPicks(card: BriefAskCard, otherLabel = '') {
  return card.questions.map((row) => {
    const index = row.chosen ?? 0
    if (index >= row.options.length)
      return String(row.note || '').trim() || otherLabel
    return row.options[index] || ''
  }).filter(Boolean).join('；')
}

export function parseBriefDoc(text: string) {
  const raw = String(text || '').trim()
  const obj = parseObject(raw)
  if (!obj)
    return { thinking: '', label: '', body: raw }
  const body = String(obj.body || '').trim()
  return {
    thinking: String(obj.thinking || '').trim(),
    label: String(obj.label || '').trim(),
    body: body || raw,
  }
}

const CHARACTER_LIMIT = 12
const SCENE_LIMIT = 8
const PROP_LIMIT = 8
const SECTION_LINE = /^(?:#{1,3}\s*)?(?:【)?(?:[一二三四五六七八九十\d]+[.、]\s*)?(角色|人物|场景|道具)(?:】)?\s*[:：]?\s*$/

function cleanAnchorLine(raw: string) {
  return raw.trim().replace(/^[-*•]\s*/, '').replace(/^\d+[.、)\]]\s*/, '')
}

function readCharacterRows(list: unknown): BriefCharacter[] {
  if (!Array.isArray(list))
    return []
  const seen = new Set<string>()
  const out: BriefCharacter[] = []
  for (const row of list) {
    const name = String((row as any)?.name || '').trim()
    const look = String((row as any)?.look || '').trim()
    if (!name || !look || seen.has(name))
      continue
    seen.add(name)
    out.push({ name, look })
    if (out.length >= CHARACTER_LIMIT)
      break
  }
  return out
}

function readNamedSection(body: string, heads: string[], limit: number): BriefCharacter[] {
  const seen = new Set<string>()
  const out: BriefCharacter[] = []
  let inSection = false
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = cleanAnchorLine(raw)
    if (!line)
      continue
    const head = line.match(SECTION_LINE)
    if (head) {
      inSection = heads.includes(head[1] || '')
      continue
    }
    if (!inSection)
      continue
    const hit = line.match(/^([^，,：:]{1,24})[，,：:]\s*(.+)$/)
    if (!hit)
      continue
    const name = (hit[1] ?? '').trim()
    const look = (hit[2] ?? '').trim()
    if (!name || !look || seen.has(name))
      continue
    seen.add(name)
    out.push({ name, look })
    if (out.length >= limit)
      break
  }
  return out
}

/** 锚点 JSON 里的 characters；没有时从正文的「角色」一节拆 */
export function briefCharacters(text: string): BriefCharacter[] {
  const obj = parseObject(text)
  const fromJson = readCharacterRows(obj?.characters)
  if (fromJson.length)
    return fromJson
  return readNamedSection(String(obj?.body || text || ''), ['角色', '人物'], CHARACTER_LIMIT)
}

/** 锚点 JSON 里的 scenes；没有时从正文的「场景」一节拆 */
export function briefScenes(text: string): BriefCharacter[] {
  const obj = parseObject(text)
  const fromJson = readCharacterRows(obj?.scenes).slice(0, SCENE_LIMIT)
  if (fromJson.length)
    return fromJson
  return readNamedSection(String(obj?.body || text || ''), ['场景'], SCENE_LIMIT)
}

/** 锚点 JSON 里的 props；没有时从正文的「道具」一节拆 */
export function briefProps(text: string): BriefCharacter[] {
  const obj = parseObject(text)
  const fromJson = readCharacterRows(obj?.props).slice(0, PROP_LIMIT)
  if (fromJson.length)
    return fromJson
  return readNamedSection(String(obj?.body || text || ''), ['道具'], PROP_LIMIT)
}

/** 角色、场景、道具已经单独成图时，正文不再重复这三节 */
export function briefSceneBody(text: string, characters: BriefCharacter[], scenes: BriefCharacter[] = [], props: BriefCharacter[] = []) {
  const obj = parseObject(text)
  const body = String(obj?.body || (!obj ? text : '') || '').trim()
  const drop = new Set<string>([
    ...(characters.length ? ['角色', '人物'] : []),
    ...(scenes.length ? ['场景'] : []),
    ...(props.length ? ['道具'] : []),
  ])
  if (!drop.size)
    return body
  const kept: string[] = []
  let skipping = false
  for (const raw of body.split(/\r?\n/)) {
    const head = cleanAnchorLine(raw).match(SECTION_LINE)
    if (head) {
      skipping = drop.has(head[1] || '')
      if (skipping)
        continue
    }
    if (!skipping)
      kept.push(raw)
  }
  return kept.join('\n').trim()
}

/** 角色图片节点上的提示词：全身正面设定图，外貌用创作稿里的那句 */
export function characterImagePrompt(character: BriefCharacter, style = '') {
  const look = [character.name, character.look].filter(Boolean).join('，')
  const styleLine = style.trim() ? `生成图片的风格为：${style.trim()}。` : ''
  return `生成一张角色站立、展示全身、正面角度、纯白背景、带有简单阴影的图片。生成图片中角色的外貌为：${look}。${styleLine}`.trim()
}

/** 场景图片节点上的提示词：环境全景，不要人物 */
export function sceneImagePrompt(scene: BriefCharacter, style = '') {
  const look = [scene.name, scene.look].filter(Boolean).join('，')
  const styleLine = style.trim() ? `生成图片的风格为：${style.trim()}。` : ''
  return `生成一张场景设定图，无人物，环境全景。场景为：${look}。${styleLine}`.trim()
}

/** 道具图片节点：白底产品设定图 */
export function propImagePrompt(item: BriefCharacter, style = '') {
  const look = [item.name, item.look].filter(Boolean).join('，')
  const styleLine = style.trim() ? `生成图片的风格为：${style.trim()}。` : ''
  return `生成一张道具设定图，纯白背景，物体居中。道具为：${look}。${styleLine}`.trim()
}

/** 分镜里有对白的角色，按名字收齐镜号 */
export function briefVoices(shots: BriefShot[]): BriefVoice[] {
  const map = new Map<string, string[]>()
  for (const shot of shots) {
    const hit = String(shot.line || '').trim().match(/^([^：:]{1,16})[：:]\s*\S/)
    if (!hit)
      continue
    const name = (hit[1] ?? '').trim()
    if (!name)
      continue
    const list = map.get(name) || []
    if (!list.includes(shot.no))
      list.push(shot.no)
    map.set(name, list)
  }
  return [...map.entries()].map(([name, nos]) => ({ name, shots: nos }))
}

export function voiceAudioPrompt(voice: BriefVoice) {
  const shots = voice.shots.length ? `镜${voice.shots.join('、')}` : '各镜'
  return `${voice.name}的对白配音，音色稳定，${shots}使用同一条声线。`
}

const SHOT_LIMIT = 16
const SHOT_LINE = /^(?:镜\s*)?(\d+)\s*[.、:：|/｜]\s*(?:约\s*)?(\d+)\s*秒\s*[.、:：|/｜]\s*(.+)$/

function readShotRows(list: unknown): BriefShot[] {
  if (!Array.isArray(list))
    return []
  const seen = new Set<string>()
  const out: BriefShot[] = []
  for (const row of list) {
    const raw = row as any
    const no = String(raw?.no ?? raw?.index ?? '').trim()
    const picture = String(raw?.picture || '').trim()
    if (!no || !picture || seen.has(no))
      continue
    const seconds = Math.round(Number(raw?.seconds) || 4)
    seen.add(no)
    out.push({
      no,
      seconds: Math.min(20, Math.max(1, seconds)),
      picture,
      line: String(raw?.line || '').trim(),
    })
    if (out.length >= SHOT_LIMIT)
      break
  }
  return out
}

function splitShotRest(rest: string) {
  const parts = rest.split(/\s*[|｜]\s*|\s+\/\s+/).map(item => item.trim()).filter(Boolean)
  return {
    picture: parts[0] || '',
    line: parts.slice(1).join('，'),
  }
}

function readShotLines(body: string): BriefShot[] {
  const seen = new Set<string>()
  const out: BriefShot[] = []
  for (const raw of String(body || '').split(/\r?\n/)) {
    const hit = raw.trim().match(SHOT_LINE)
    if (!hit)
      continue
    const no = hit[1]
    const parts = splitShotRest(hit[3] ?? '')
    if (!no || !parts.picture || seen.has(no))
      continue
    seen.add(no)
    out.push({
      no,
      seconds: Math.min(20, Math.max(1, Number(hit[2]) || 4)),
      picture: parts.picture,
      line: parts.line,
    })
    if (out.length >= SHOT_LIMIT)
      break
  }
  return out
}

/** 分镜 JSON 里的 shots；没有时从「镜号｜秒数｜画面」行拆 */
export function briefShots(text: string): BriefShot[] {
  const obj = parseObject(text)
  const fromJson = readShotRows(obj?.shots)
  if (fromJson.length)
    return fromJson
  return readShotLines(String(obj?.body || text || ''))
}

/** 已确认方向里的画幅，分镜静帧用它。没写明时用竖屏 */
export function briefFrameRatio(picks: string) {
  const hit = String(picks || '').match(/21:9|16:9|9:16|4:3|3:4|1:1/)
  return hit?.[0] || '9:16'
}

type BriefText = (key: string, params?: Record<string, string | number>) => string

/** 已确认方向里能直接展示的规格：画幅、时长 */
export function briefSpecChips(picks: string, t?: BriefText) {
  const text = String(picks || '')
  const chips: string[] = []
  const ratio = text.match(/21:9|16:9|9:16|4:3|3:4|1:1/)
  if (ratio)
    chips.push(ratio[0])
  const seconds = text.match(/(\d+)\s*秒/) || text.match(/(\d+)\s*s\b/i)
  if (seconds)
    chips.push(t ? t('canvas.chat.brief.shotSeconds', { n: seconds[1]! }) : `${seconds[1]}秒`)
  return chips
}

/** 分镜正文里点到的锚点名，长名字优先，避免「剑」吃掉「生锈铁剑」 */
export function briefNamesInText(text: string, names: string[]) {
  const hay = String(text || '')
  const hit: string[] = []
  for (const name of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (hay.includes(name) && !hit.includes(name) && !hit.some(item => item.includes(name)))
      hit.push(name)
  }
  return hit
}

export function briefPickShotRefs(text: string, groups: { characters: string[], scenes: string[], props: string[] }) {
  const characters = briefNamesInText(text, groups.characters)
  const scenes = briefNamesInText(text, groups.scenes)
  const props = briefNamesInText(text, groups.props)
  return {
    characters: characters.length ? characters : groups.characters,
    scenes: scenes.length ? scenes : (groups.scenes.length <= 2 ? groups.scenes : []),
    props,
  }
}

export const SHOT_REF_HINT = '必须与参考图中的角色、场景、道具保持同一外形，不要换脸、换服装、换道具形制。'

/** 分镜图片节点上的提示词：这一镜的静帧，不是角色设定图 */
export function shotImagePrompt(shot: BriefShot, style = '') {
  const spoken = shot.line.trim() ? `对白或动作：${shot.line.trim()}。` : ''
  const styleLine = style.trim() ? `生成图片的风格为：${style.trim()}。` : ''
  return `分镜静帧，单镜头画面。${SHOT_REF_HINT}镜${shot.no}，约${shot.seconds}秒。画面：${shot.picture}。${spoken}${styleLine}`.trim()
}

/** 分镜视频节点：按这一镜的秒数做图生视频 */
export function shotVideoPrompt(shot: BriefShot, style = '') {
  const spoken = shot.line.trim() ? `对白或动作：${shot.line.trim()}。` : ''
  const styleLine = style.trim() ? `生成视频的风格为：${style.trim()}。` : ''
  return `把这一镜做成视频，单镜头，动作连贯。镜${shot.no}，约${shot.seconds}秒。画面：${shot.picture}。${spoken}${styleLine}`.trim()
}

const BRIEF_HISTORY: Record<string, string> = {
  'canvas.chat.brief.history.askWait': '等待确认交付方式',
  'canvas.chat.brief.history.askDone': '已确认交付方式',
  'canvas.chat.brief.history.draft': '第一集创作稿',
  'canvas.chat.brief.history.anchors': '锚点集',
  'canvas.chat.brief.history.voice': '音色锚点',
  'canvas.chat.brief.history.generateWait': '等待确认是否生成',
  'canvas.chat.brief.history.generateDone': '已确认是否生成',
  'canvas.chat.brief.history.videoWait': '等待确认是否出视频',
  'canvas.chat.brief.history.videoDone': '已确认是否出视频',
  'canvas.chat.brief.history.composeWait': '等待确认是否合成',
  'canvas.chat.brief.history.composeDone': '已确认是否合成',
  'canvas.chat.brief.history.board': '分镜',
  'canvas.chat.media.historyWait': '等待确认是否出片',
  'canvas.chat.media.historyDone': '已确认是否出片',
}

export function briefHistoryKey(card: BriefCard) {
  if (card.kind === 'ask')
    return card.locked ? 'canvas.chat.brief.history.askDone' : 'canvas.chat.brief.history.askWait'
  if (card.kind === 'draft')
    return 'canvas.chat.brief.history.draft'
  if (card.kind === 'anchors')
    return 'canvas.chat.brief.history.anchors'
  if (card.kind === 'voice')
    return 'canvas.chat.brief.history.voice'
  if (card.kind === 'generate')
    return card.locked ? 'canvas.chat.brief.history.generateDone' : 'canvas.chat.brief.history.generateWait'
  if (card.kind === 'video')
    return card.locked ? 'canvas.chat.brief.history.videoDone' : 'canvas.chat.brief.history.videoWait'
  if (card.kind === 'compose')
    return card.locked ? 'canvas.chat.brief.history.composeDone' : 'canvas.chat.brief.history.composeWait'
  if (card.kind === 'media-confirm')
    return card.locked ? 'canvas.chat.media.historyDone' : 'canvas.chat.media.historyWait'
  return 'canvas.chat.brief.history.board'
}

export function briefHistoryText(card: BriefCard, t?: BriefText) {
  const key = briefHistoryKey(card)
  return t ? t(key) : (BRIEF_HISTORY[key] || key)
}
