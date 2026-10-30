/**
 * 画布对话的制作流水线：发剧本先出卡，闲聊另走带上文的补全。
 * 卡片由前端画；模型只回答离题问题和写文案，不负责排版。
 */

export const CREW_RATIOS = ['16:9', '9:16', '21:9'] as const
export const CREW_LANGS = ['zh', 'en', 'ja'] as const

export type CrewRatio = typeof CREW_RATIOS[number]
export type CrewLang = typeof CREW_LANGS[number]
export type CrewRole = 'director' | 'character' | 'scene' | 'storyboard' | 'sound'
export type CrewGuest = 'character' | 'scene' | 'storyboard' | 'sound'
export type CrewStep = 'idle' | 'settings' | 'styles' | 'portraits' | 'scenes' | 'storyboard' | 'sound' | 'done'
export const CREW_SCHEMES = ['multi', 'grid'] as const
export type CrewScheme = typeof CREW_SCHEMES[number]

export type CrewStyleOption = {
  name: string
  prompt: string
  cover: string
}

export type CrewSettingsCard = {
  kind: 'settings'
  role: 'director'
  locked: boolean
  startedAt: number
  elapsed?: number
  ratio: CrewRatio
  language: CrewLang
  script?: string
}

export type CrewInviteCard = {
  kind: 'invite'
  role: CrewRole
  locked: true
  startedAt: number
  elapsed?: number
  guest: CrewGuest
}

export type CrewStylesCard = {
  kind: 'styles'
  role: 'character'
  locked: boolean
  startedAt: number
  elapsed?: number
  styles: CrewStyleOption[]
  picked?: string
  loading?: boolean
  cast?: { name: string, look: string }[]
}

export type CrewPortrait = {
  name: string
  look: string
  status: 'wait' | 'run' | 'ok' | 'fail'
  url?: string
  error?: string
  taskId?: number
  assetId?: number
}

export type CrewPortraitsCard = {
  kind: 'portraits'
  role: 'character'
  locked: boolean
  startedAt: number
  elapsed?: number
  loading?: boolean
  portraits: CrewPortrait[]
}

export type CrewScene = {
  name: string
  look: string
  status?: 'wait' | 'run' | 'ok' | 'fail'
  url?: string
  error?: string
  taskId?: number
  assetId?: number
}

export type CrewScenesCard = {
  kind: 'scenes'
  role: 'scene'
  locked: boolean
  startedAt: number
  elapsed?: number
  loading?: boolean
  scenes: CrewScene[]
}

export type CrewShot = {
  name: string
  status: 'wait' | 'run' | 'ok' | 'fail'
  url?: string
  error?: string
  taskId?: number
  assetId?: number
}

export type CrewStoryboardCard = {
  kind: 'storyboard'
  role: 'storyboard'
  locked: boolean
  startedAt: number
  elapsed?: number
  model: string
  scheme: CrewScheme
  loading?: boolean
  shots?: CrewShot[]
}

export type CrewSoundCard = {
  kind: 'sound'
  role: 'sound'
  locked: boolean
  startedAt: number
  elapsed?: number
  loading?: boolean
  status?: 'wait' | 'run' | 'ok' | 'fail'
  url?: string
  error?: string
  taskId?: number
  assetId?: number
}

export type CrewFinishCard = {
  kind: 'finish'
  role: 'director'
  locked: true
  startedAt: number
  elapsed?: number
  clips?: { name: string, url: string }[]
  audioUrl?: string
}

export type CrewCard = CrewSettingsCard | CrewInviteCard | CrewStylesCard | CrewPortraitsCard | CrewScenesCard | CrewStoryboardCard | CrewSoundCard | CrewFinishCard

export const CREW_PORTRAIT_LIMIT = 6
export const CREW_SCENE_LIMIT = 2

export type CrewState = {
  step: CrewStep
  skillId?: number
  script: string
  ratio?: CrewRatio
  language?: CrewLang
  styleName?: string
}

export type CrewTurn = {
  role: 'user' | 'assistant'
  text: string
}

const CREW_HISTORY_TURNS = 8
const CREW_TURN_CHARS = 400

export function defaultCrewState(): CrewState {
  return { step: 'idle', script: '' }
}

export function defaultCrewSettings(): Pick<CrewSettingsCard, 'ratio' | 'language'> {
  return { ratio: '16:9', language: 'zh' }
}

/** 选了制作技能、且当前没卡在半截确认上，才开新的设置卡 */
export function shouldStartCrew(input: { skillId?: number, step: CrewStep }) {
  return Boolean(input.skillId) && (input.step === 'idle' || input.step === 'done')
}

export function crewElapsed(startedAt: number, now = Date.now()) {
  return Math.max(1, Math.round((now - startedAt) / 1000))
}

export function lockSettingsCard(card: CrewSettingsCard, now = Date.now()): CrewSettingsCard {
  return { ...card, locked: true, elapsed: crewElapsed(card.startedAt, now) }
}

export function lockStylesCard(card: CrewStylesCard, picked: string, now = Date.now()): CrewStylesCard {
  return { ...card, locked: true, picked, elapsed: crewElapsed(card.startedAt, now), loading: false }
}

export function lockPortraitsCard(card: CrewPortraitsCard, now = Date.now()): CrewPortraitsCard {
  return { ...card, locked: true, loading: false, elapsed: crewElapsed(card.startedAt, now) }
}

export function lockScenesCard(card: CrewScenesCard, now = Date.now()): CrewScenesCard {
  return { ...card, locked: true, loading: false, elapsed: crewElapsed(card.startedAt, now) }
}

export function lockStoryboardCard(card: CrewStoryboardCard, now = Date.now()): CrewStoryboardCard {
  return { ...card, locked: true, elapsed: crewElapsed(card.startedAt, now) }
}

export function lockSoundCard(card: CrewSoundCard, now = Date.now()): CrewSoundCard {
  return { ...card, locked: true, elapsed: crewElapsed(card.startedAt, now) }
}

export function crewPortraitsSettled(card: CrewPortraitsCard) {
  return !card.loading && card.portraits.length > 0 && card.portraits.every(item => item.status === 'ok' || item.status === 'fail')
}

export function crewPortraitsRetryable(card: CrewPortraitsCard) {
  return !card.locked && !card.loading && card.portraits.some(item => item.status === 'fail' || item.status === 'wait')
}

export function crewScenesSettled(card: CrewScenesCard) {
  return !card.loading && card.scenes.length > 0 && card.scenes.every(item => item.status === 'ok' || item.status === 'fail')
}

export function crewScenesRetryable(card: CrewScenesCard) {
  return !card.locked && !card.loading && card.scenes.some(item => item.status === 'fail' || item.status === 'wait')
}

export function cardToHistoryText(card: CrewCard) {
  if (card.kind === 'settings')
    return `影片设置 ${card.ratio} ${card.language}${card.locked ? ' 已确认' : ' 待确认'}`
  if (card.kind === 'invite')
    return `已邀请${card.guest}`
  if (card.kind === 'scenes') {
    const named = card.scenes.map(item => item.name).filter(Boolean).join('、')
    const ok = card.scenes.filter(item => item.status === 'ok').length
    if (ok)
      return `场景图 ${ok} 张${named ? ` ${named}` : ''}`
    return `场景 ${named || (card.loading ? '整理中' : '待确认')}`
  }
  if (card.kind === 'storyboard') {
    const ok = (card.shots || []).filter(item => item.status === 'ok').length
    if (ok)
      return `分镜视频 ${ok} 条`
    return `分镜 ${card.scheme} ${card.model}${card.locked ? ' 已确认' : ''}`
  }
  if (card.kind === 'sound') {
    if (card.url)
      return '配乐已生成'
    return card.locked ? '音效已确认' : '等待确认音效'
  }
  if (card.kind === 'finish')
    return card.clips?.length ? `成片 ${card.clips.length} 段` : '制作流程已走完'
  if (card.kind === 'portraits') {
    const ok = card.portraits.filter(item => item.status === 'ok').length
    const fail = card.portraits.filter(item => item.status === 'fail').length
    return `角色主图 ${ok} 成功${fail ? ` ${fail} 失败` : ''}`
  }
  return `风格推荐${card.picked ? ` 已选 ${card.picked}` : card.loading ? ' 加载中' : ''}`
}

export function crewFromMessages(list: { card?: CrewCard }[]): CrewState {
  const state = defaultCrewState()
  for (const item of list) {
    const card = item.card
    if (!card)
      continue
    if (card.kind === 'settings') {
      state.ratio = card.ratio
      state.language = card.language
      state.script = card.script || state.script
      state.step = card.locked ? 'styles' : 'settings'
    }
    else if (card.kind === 'styles') {
      if (card.picked)
        state.styleName = card.picked
      state.step = card.locked ? 'portraits' : 'styles'
    }
    else if (card.kind === 'portraits')
      state.step = card.locked ? 'scenes' : 'portraits'
    else if (card.kind === 'scenes')
      state.step = card.locked ? 'storyboard' : 'scenes'
    else if (card.kind === 'storyboard')
      state.step = card.locked ? 'sound' : 'storyboard'
    else if (card.kind === 'sound')
      state.step = card.locked ? 'done' : 'sound'
    else if (card.kind === 'finish')
      state.step = 'done'
  }
  return state
}

export function crewStateLine(state: CrewState) {
  const bits: string[] = []
  if (state.ratio)
    bits.push(`比例 ${state.ratio}`)
  if (state.language)
    bits.push(`语言 ${state.language}`)
  if (state.styleName)
    bits.push(`风格 ${state.styleName}`)
  if (state.step === 'settings')
    bits.push('等待确认影片设置')
  if (state.step === 'styles')
    bits.push('等待选择风格')
  if (state.step === 'portraits')
    bits.push('正在整理角色主图')
  if (state.step === 'scenes')
    bits.push('等待确认场景')
  if (state.step === 'storyboard')
    bits.push('等待确认分镜')
  if (state.step === 'sound')
    bits.push('等待确认音效')
  return bits.join('，')
}

export function crewExtractPrompt(script: string, style: string, language: string) {
  return `从下面剧本里抽出最多 ${CREW_PORTRAIT_LIMIT} 个主要角色。只输出 JSON 数组，不要其它字。每项：{"name":"角色名","look":"外貌与服装，40字内"}。风格：${style || '未指定'}。对白语言：${language || 'zh'}。\n\n剧本：\n${String(script || '').slice(0, 4000)}`
}

export function parseCrewCharacters(text: string): { name: string, look: string }[] {
  const raw = String(text || '').trim()
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start)
    return []
  try {
    const list = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(list))
      return []
    const seen = new Set<string>()
    const out: { name: string, look: string }[] = []
    for (const row of list) {
      const name = String((row as any)?.name || '').trim()
      if (!name || seen.has(name))
        continue
      seen.add(name)
      out.push({ name, look: String((row as any)?.look || name).trim() })
      if (out.length >= CREW_PORTRAIT_LIMIT)
        break
    }
    return out
  }
  catch {
    return []
  }
}

export function crewPortraitPrompt(input: { name: string, look: string, style: string }) {
  return [input.look, input.name, input.style, '角色设定图，半身，干净背景']
    .filter(Boolean)
    .join('，')
}

export function crewScenePrompt(input: { name: string, look: string, style: string }) {
  return [input.look, input.name, input.style, '场景设定图，无人物，环境全景']
    .filter(Boolean)
    .join('，')
}

export function crewImageModel(models: { type?: string, model?: string, priced?: boolean }[]) {
  const images = (models || []).filter(item => item.type === 'image' && item.model)
  return images.find(item => item.priced)?.model || images[0]?.model || ''
}

export function crewVideoModel(models: { type?: string, model?: string, priced?: boolean }[]) {
  const videos = (models || []).filter(item => item.type === 'video' && item.model)
  return videos.find(item => item.priced)?.model || videos[0]?.model || ''
}

export function crewAudioModel(models: { type?: string, model?: string, priced?: boolean }[]) {
  const rows = (models || []).filter(item => item.type === 'audio' && item.model)
  return rows.find(item => item.priced)?.model || rows[0]?.model || ''
}

export function crewShotPrompt(input: { name: string, look: string, cast: string, style: string }) {
  return [input.look, input.name, input.cast, input.style, '镜头缓慢推进，电影感，无字幕']
    .filter(Boolean)
    .join('，')
}

export function crewGridPrompt(input: { scenes: string, cast: string, style: string }) {
  return [input.scenes, input.cast, input.style, '四格分镜图，从左到右，电影分镜，无文字']
    .filter(Boolean)
    .join('，')
}

export function crewShotsSettled(card: CrewStoryboardCard) {
  const shots = card.shots || []
  return !card.loading && shots.length > 0 && shots.every(item => item.status === 'ok' || item.status === 'fail')
}

export function crewExtractScenesPrompt(script: string, style: string) {
  return `从下面剧本里抽出 ${CREW_SCENE_LIMIT} 个核心场景。只输出 JSON 数组，不要其它字。每项：{"name":"场景名","look":"环境与光线，40字内"}。风格：${style || '未指定'}。\n\n剧本：\n${String(script || '').slice(0, 4000)}`
}

export function parseCrewScenes(text: string): CrewScene[] {
  return parseCrewCharacters(text).slice(0, CREW_SCENE_LIMIT)
}

export function clipCrewTurn(text: string) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= CREW_TURN_CHARS)
    return clean
  return `${clean.slice(0, CREW_TURN_CHARS)}…`
}

/** 普通文本任务没有 history 字段，把上文和制作进度折进这一轮 prompt */
export function buildCrewChatPrompt(input: {
  current: string
  state: CrewState
  turns: CrewTurn[]
}) {
  const history = input.turns
    .slice(-CREW_HISTORY_TURNS)
    .map(item => `${item.role === 'user' ? '用户' : '助手'}：${clipCrewTurn(item.text)}`)
    .filter(item => item.split('：')[1])
  const facts = crewStateLine(input.state)
  return [
    facts ? `当前制作进度：${facts}` : '',
    history.length ? `对话上文：\n${history.join('\n')}` : '',
    input.current,
  ].filter(Boolean).join('\n\n')
}
