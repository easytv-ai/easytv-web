import type { GenerationModel, Shot, ShotMedia, ShotReview } from '~/types/creative'

/**
 * 少抽卡（API.md 39）：节点已有结果时再点生成 = 重抽。
 * 这里只放纯逻辑——能选哪些不满意原因、每个原因对应什么对症建议、这次要不要先问。
 * 面板在 CanvasRerollPanel.vue，接线在 CanvasWorkspace.vue。
 */

/** 与后端白名单同码（model.RerollReasons）；前七个与审片退回原因一致 */
export const REROLL_REASONS = [
  'identity',
  'performance',
  'lipsync',
  'composition',
  'continuity',
  'duration',
  'style',
  'technical',
  'off_prompt',
] as const
export type RerollReason = (typeof REROLL_REASONS)[number]

export type RerollNodeType = 'image' | 'video' | 'audio'

const IMAGE_REASONS: RerollReason[] = ['identity', 'composition', 'style', 'technical', 'off_prompt']
const VIDEO_REASONS: RerollReason[] = ['identity', 'performance', 'lipsync', 'composition', 'continuity', 'duration', 'style', 'technical', 'off_prompt']
const AUDIO_REASONS: RerollReason[] = ['performance', 'duration', 'technical', 'off_prompt']

/** 节点种类 → 重抽询问用的类型；文本和派生类节点不问，返回 null */
export function rerollNodeType(kind: string | undefined | null): RerollNodeType | null {
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
}

/** 这类节点能选的不满意原因，顺序即面板上的顺序 */
export function rerollReasonsFor(type: RerollNodeType | null | undefined): RerollReason[] {
  if (type === 'image')
    return [...IMAGE_REASONS]
  if (type === 'video')
    return [...VIDEO_REASONS]
  if (type === 'audio')
    return [...AUDIO_REASONS]
  return []
}

/** 只留这类节点认的原因，去重，按面板顺序排 */
export function normalizeRerollReasons(reasons: readonly string[] | null | undefined, type: RerollNodeType | null | undefined): RerollReason[] {
  const picked = new Set((reasons ?? []).map(item => String(item).trim()))
  return rerollReasonsFor(type).filter(item => picked.has(item))
}

/**
 * 建议上的动作码：每个都对应画布里一个现成入口（CanvasWorkspace.runRerollAction）。
 * ref 参考素材选择器 / subject 主体选择器 / style_ref 风格参考图 / stylelib 风格库 / smart_edit 智能编辑 /
 * retake 片段重拍 / extend 智能续写 / optimize 提示词优化 / camera 运镜库 / model 模型下拉 /
 * talking 切到口播模式 / first_last 切到首尾帧模式 / spec 规格（时长）下拉 / voice 音色选择器
 */
export const REROLL_ACTIONS = [
  'ref',
  'subject',
  'style_ref',
  'stylelib',
  'smart_edit',
  'retake',
  'extend',
  'optimize',
  'camera',
  'model',
  'talking',
  'first_last',
  'spec',
  'voice',
] as const
export type RerollAction = (typeof REROLL_ACTIONS)[number]

export type RerollAdvice = {
  /** 建议 id，同一条建议被多个原因命中时只出一次 */
  id: string
  /** 文案 key：canvas.reroll.advice.<id> */
  textKey: string
  /** 可点的动作；没有现成入口（或当前不可用）时不给，只显示文案 */
  action?: RerollAction
}

export type RerollContext = {
  type: RerollNodeType
  /** 已挂参考图 / 角色素材（连线或上传的都算） */
  hasRef?: boolean
  /** 已引用主体 */
  hasSubject?: boolean
  /** 视频：已有首帧图 */
  hasFirstFrame?: boolean
  /** 视频当前模式（reference / fl2v / i2v / talking） */
  videoMode?: string
  /** 当前真的能走的入口；不在里面的动作退成纯文案。不传表示都可用 */
  available?: readonly RerollAction[]
}

/**
 * 选中的原因 → 有序、去重的对症建议。
 * 同一招（智能编辑 / 片段重拍 / 换模型）被多个原因命中只出一条。
 */
export function rerollAdvice(reasons: readonly string[], ctx: RerollContext): RerollAdvice[] {
  const out: RerollAdvice[] = []
  const seen = new Set<string>()
  const usable = ctx.available ? new Set<string>(ctx.available) : null
  function push(id: string, action?: RerollAction) {
    if (seen.has(id))
      return
    seen.add(id)
    const item: RerollAdvice = { id, textKey: `canvas.reroll.advice.${id}` }
    if (action && (!usable || usable.has(action)))
      item.action = action
    out.push(item)
  }
  const { type } = ctx
  const anchored = Boolean(ctx.hasRef || ctx.hasSubject)
  for (const reason of normalizeRerollReasons(reasons, type)) {
    if (reason === 'identity') {
      if (!anchored) {
        push('attachSubject', 'subject')
        push('attachRef', 'ref')
      }
      else if (type === 'image') {
        push('smartEdit', 'smart_edit')
      }
      else {
        push('model', 'model')
      }
    }
    else if (reason === 'composition') {
      if (type === 'image') {
        push('smartEdit', 'smart_edit')
      }
      else {
        push('retake', 'retake')
        push('camera', 'camera')
      }
    }
    else if (reason === 'style') {
      push('styleLib', 'stylelib')
      if (type === 'image')
        push('styleRef', 'style_ref')
      else
        push('styleRefVideo', 'ref')
    }
    else if (reason === 'technical') {
      if (type === 'image')
        push('smartEdit', 'smart_edit')
      else if (type === 'video')
        push('retake', 'retake')
      push('model', 'model')
    }
    else if (reason === 'off_prompt') {
      if (type === 'audio')
        push('promptAudio')
      else
        push('optimize', 'optimize')
    }
    else if (reason === 'performance' || reason === 'lipsync') {
      if (type === 'audio') {
        push('voice', 'voice')
      }
      else {
        push('retake', 'retake')
        if (ctx.videoMode !== 'talking')
          push('talking', 'talking')
      }
    }
    else if (reason === 'continuity') {
      if (ctx.videoMode === 'fl2v' && ctx.hasFirstFrame)
        push('extend', 'extend')
      else {
        push('firstLast', 'first_last')
        push('extend', 'extend')
      }
    }
    else if (reason === 'duration') {
      push('duration', 'spec')
    }
  }
  return out
}

/** 节点上有没有「生成成功过的结果」：有产物、且是任务跑出来的（上传的素材没有 taskId） */
export function nodeHasResult(data: { content?: unknown, taskId?: unknown, taskStatus?: unknown } | null | undefined): boolean {
  if (!data)
    return false
  if (!String(data.content || '').trim())
    return false
  return Number(data.taskId) > 0
}

export type RerollTrigger = 'inspector' | 'shortcut' | 'selbar' | 'stale' | 'batch' | 'chat' | 'assist'

/**
 * 这次生成要不要先问「哪里不满意」。
 * 只问用户亲手对已有结果点的那一下：过期重跑（输入变了）、批量 / 对话 / 助手方案都不问；
 * 片段重拍这类派生节点、正在跑的节点、文本节点不问；用户勾过「不再询问」也不问。
 */
export function shouldAskReroll(input: {
  kind?: string | null
  data?: { content?: unknown, taskId?: unknown, taskStatus?: unknown } | null
  trigger: RerollTrigger
  /** 片段重拍 / 高清 / 逐帧拉片等派生节点 */
  derived?: boolean
  /** 跟练回放中 */
  practice?: boolean
  /** 用户偏好：false = 不再询问 */
  ask?: boolean
}): boolean {
  if (input.ask === false || input.derived || input.practice)
    return false
  if (input.trigger !== 'inspector' && input.trigger !== 'shortcut' && input.trigger !== 'selbar')
    return false
  if (!rerollNodeType(input.kind))
    return false
  const status = String(input.data?.taskStatus || '')
  if (status === 'pending' || status === 'running')
    return false
  return nodeHasResult(input.data)
}

export const REROLL_ASK_KEY = 'easytv-reroll-ask'

type AskStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function askStorage(storage?: AskStorage | null): AskStorage | null {
  if (storage !== undefined)
    return storage
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  }
  catch {
    return null
  }
}

/** 读「重抽前是否询问」偏好；读不到（隐私模式 / 坏数据）一律当要问 */
export function readRerollAsk(storage?: AskStorage | null): boolean {
  try {
    return askStorage(storage)?.getItem(REROLL_ASK_KEY) !== '0'
  }
  catch {
    return true
  }
}

export function writeRerollAsk(ask: boolean, storage?: AskStorage | null) {
  try {
    const store = askStorage(storage)
    if (!store)
      return
    if (ask)
      store.removeItem(REROLL_ASK_KEY)
    else
      store.setItem(REROLL_ASK_KEY, '0')
  }
  catch {
    // 写不进去就算了，下次照常询问
  }
}

/** 审片退回结论 → 重抽原因（向导第 3 步重新生成时自动带上）；没退回或没填原因返回空 */
export function reviewRerollReasons(review: Pick<ShotReview, 'status' | 'reason'> | null | undefined): RerollReason[] {
  if (!review || review.status !== -1)
    return []
  const reason = String(review.reason || '')
  return (REROLL_REASONS as readonly string[]).includes(reason) ? [reason as RerollReason] : []
}

/**
 * 镜头视图里所有候选的审片结论：asset_id → review（分镜图 / 视频 / 配音 / 角色图都收，待审的不收）。
 * 向导第 3 步用它查「当前这条产物有没有被退回」。
 */
export function shotReviewsByAsset(shots: Shot[] | null | undefined, characters?: ShotMedia[] | null): Map<number, ShotReview> {
  const out = new Map<number, ShotReview>()
  const collect = (media: ShotMedia | null | undefined) => {
    for (const cand of media?.candidates ?? []) {
      if (cand.review && cand.asset_id > 0)
        out.set(cand.asset_id, cand.review)
    }
  }
  for (const shot of shots ?? []) {
    collect(shot.image)
    collect(shot.video)
    collect(shot.voice)
  }
  for (const media of characters ?? [])
    collect(media)
  return out
}

/**
 * 模型下拉上的留用率（API.md 39.4）。样本不足时后端三个字段都给 0，这里返回 null 不展示。
 * rate 取整百分比；pulls 保留一位小数（1.0 显示成 1）。
 */
export function modelKeepInfo(item: Pick<GenerationModel, 'recent_keep_total' | 'recent_keep_rate' | 'recent_pulls_per_keep'> | null | undefined): { rate: number, pulls: number } | null {
  if (!item || !(Number(item.recent_keep_total) > 0))
    return null
  const rate = Math.round(Number(item.recent_keep_rate) || 0)
  const pulls = Math.round((Number(item.recent_pulls_per_keep) || 0) * 10) / 10
  if (rate <= 0 || pulls <= 0)
    return null
  return { rate: Math.min(100, rate), pulls }
}
