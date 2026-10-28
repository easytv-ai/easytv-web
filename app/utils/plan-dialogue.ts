import type { ScreenplayLine, ScreenplayPlan, ScreenplayShot } from '~/types/creative'

/**
 * 策划案对白 / 本镜人物状态（API.md 25.1 / 25.2）的纯函数：
 * - 老镜头只有整句 `line`、没有 `dialogue`：展示成一条旁白，编辑时才转成 dialogue；
 * - 编辑对白后本地同步拼 `line`（后端保存时也会按条重拼），清空后 dialogue=[]、line=''；
 * - states 只留非空且 key 非空的条目，空则整体去掉。
 */

/** 旁白的说话人：后端接受空串 / narrator，归一化后统一为空串 */
export const NARRATOR = ''
/** 每镜对白条数上限（model.PlanMaxDialogue） */
export const MAX_DIALOGUE = 12
/** 每条对白正文上限（model.PlanLineMaxLen） */
export const MAX_LINE_TEXT = 200
/** 情绪短文本上限（后端截到 30 字） */
export const MAX_EMOTION = 30
/** 本镜人物状态上限（model.PlanStateMaxLen） */
export const MAX_STATE = 100
/** 角色说话风格上限 */
export const MAX_VOICE_STYLE = 40
/** OpenAI TTS 音色；空 = 模型默认 */
export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const

/** `{ [lang]: 译文 }`：去掉空 code；没有有效条目返回 undefined */
export function normalizeLangLines(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return undefined
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([code]) => Boolean(code))
    .map(([code, text]) => [code, String(text ?? '')] as const)
  return entries.length ? Object.fromEntries(entries) : undefined
}

/** 归一化一条对白：speaker 去空白（narrator → 空串）、text 转字符串，emotion / lines 只在非空时保留 */
export function normalizeLine(raw: unknown): ScreenplayLine {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScreenplayLine>
  let speaker = String(r.speaker ?? '').trim()
  if (speaker === 'narrator')
    speaker = NARRATOR
  const line: ScreenplayLine = { speaker, text: String(r.text ?? '') }
  const emotion = String(r.emotion ?? '').trim()
  if (emotion)
    line.emotion = emotion
  const lines = normalizeLangLines(r.lines)
  if (lines)
    line.lines = lines
  return line
}

/** 归一化 shots[].dialogue：非数组当空处理 */
export function normalizeDialogue(raw: unknown): ScreenplayLine[] {
  return Array.isArray(raw) ? raw.map(normalizeLine) : []
}

/** 归一化 shots[].states：只留 key / 值都非空的；空对象返回 undefined */
export function normalizeStates(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim()
    const v = String(value ?? '').trim()
    if (k && v)
      out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** 展示用对白列表：有 dialogue 用 dialogue；否则老数据的整句 line 显示为一条旁白 */
export function shotDialogue(shot: Pick<ScreenplayShot, 'line' | 'lines' | 'dialogue'>): ScreenplayLine[] {
  if (shot.dialogue?.length)
    return shot.dialogue
  const line = String(shot.line ?? '')
  if (!line.trim())
    return []
  const entry: ScreenplayLine = { speaker: NARRATOR, text: line }
  if (shot.lines && Object.keys(shot.lines).length)
    entry.lines = { ...shot.lines }
  return [entry]
}

/** 编辑前保证 shot.dialogue 是数组（老数据的 line 先转成一条旁白），返回可直接改的数组 */
export function ensureDialogue(shot: ScreenplayShot): ScreenplayLine[] {
  if (!shot.dialogue?.length)
    shot.dialogue = shotDialogue(shot).map(item => ({ ...item }))
  return shot.dialogue
}

/** 各条正文用空格拼成整句（与后端 Normalize 一致），供摘要 / 老流程用 */
export function joinDialogue(dialogue: ScreenplayLine[]): string {
  return dialogue.map(item => item.text.trim()).filter(Boolean).join(' ')
}

/** 对白改动后同步 line；全部清空时 dialogue=[]、line='' */
export function syncLineFromDialogue(shot: ScreenplayShot) {
  const dialogue = (shot.dialogue ?? []).filter(item => item.text.trim())
  if (!dialogue.length) {
    shot.dialogue = []
    shot.line = ''
    return
  }
  shot.line = joinDialogue(dialogue)
}

/** 摘要行：「阿杰：手机呢 / 小雨：在我这」，旁白用 narratorLabel */
export function dialogueSummary(
  shot: Pick<ScreenplayShot, 'line' | 'lines' | 'dialogue'>,
  nameOf: (key: string) => string,
  narratorLabel: string,
): string {
  return shotDialogue(shot)
    .filter(item => item.text.trim())
    .map(item => `${item.speaker ? nameOf(item.speaker) : narratorLabel}：${item.text.trim()}`)
    .join(' / ')
}

/** 写本镜人物状态：空值删键，没有条目时去掉 states */
export function setShotState(shot: ScreenplayShot, key: string, value: string) {
  const v = value.trim()
  if (!v) {
    if (shot.states) {
      delete shot.states[key]
      if (!Object.keys(shot.states).length)
        shot.states = undefined
    }
    return
  }
  if (!shot.states)
    shot.states = {}
  shot.states[key] = v
}

/**
 * 本镜取消勾选人物：移出 characters 并清掉它的本镜状态。
 * 对白说话人不动（后端只要求是策划案里的人物，画外音也合理）；人物从策划案整体删除时再用 resetSpeaker 改成旁白，避免 ErrPlanRef。
 */
export function dropShotCharacter(shot: ScreenplayShot, key: string, resetSpeaker = false) {
  shot.characters = shot.characters.filter(k => k !== key)
  setShotState(shot, key, '')
  if (!resetSpeaker)
    return
  for (const item of shot.dialogue ?? []) {
    if (item.speaker === key)
      item.speaker = NARRATOR
  }
}

/**
 * 保存前整理（深拷贝，不动编辑器里的对象）：去掉正文为空的对白条目；有对白时 line 由各条正文拼出，
 * 没有对白时 line 原样保留（老数据只有整句 line 且没编辑过），用户删光对白后 line 已被 syncLineFromDialogue 清空。
 */
export function planForSave(plan: ScreenplayPlan): ScreenplayPlan {
  const copy = JSON.parse(JSON.stringify(plan)) as ScreenplayPlan
  for (const shot of copy.shots) {
    const dialogue = (shot.dialogue ?? []).filter(item => item.text.trim())
    shot.dialogue = dialogue
    if (dialogue.length)
      shot.line = joinDialogue(dialogue)
    shot.states = normalizeStates(shot.states)
    if (!shot.states)
      delete shot.states
  }
  return copy
}

/** 配音节点 data.segments → 音频任务 params.segments（API.md 25.1）：只带 provider 读的 speaker / voice / text，空文本跳过 */
export function voiceSegmentParams(raw: unknown): { speaker: string, voice: string, text: string }[] {
  if (!Array.isArray(raw))
    return []
  return raw
    .map((item) => {
      const s = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return { speaker: String(s.speaker ?? ''), voice: String(s.voice ?? '').trim(), text: String(s.text ?? '').trim() }
    })
    .filter(item => item.text)
}
