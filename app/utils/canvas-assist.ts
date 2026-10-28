import { expandPromptTokens } from '~/utils/canvas-mark'
import type { CanvasWorkflowGraph } from '~/utils/canvas-workflow'

/**
 * 画布助手（API.md 16）：拼节点上下文、方案里的修改怎么展示 / 排执行顺序。
 * 纯函数，不碰 vue-flow，单独测。
 * 对话式工作流生成（API.md 32）的 /agent 接口响应体与 AssistPlan 同构，只多出 apply_graph 与新字段。
 */

export type AssistNodeSummary = {
  id: string
  kind: string
  label: string
  prompt: string
  content: string
  has_media: boolean
  task_id: number
  selected: boolean
  upstream: string[]
  downstream: string[]
}

export type AssistAction = 'update_prompt' | 'regenerate' | 'add_node' | 'connect' | 'apply_graph'

export type AssistChange = {
  action: AssistAction
  node_id?: string
  node_label?: string
  kind?: string
  label?: string
  prompt?: string
  before?: string
  from?: string
  source?: string
  target?: string
  reason?: string
  type?: string
  model?: string
  params?: Record<string, unknown>
  points?: number
  /** 仅 kind === 'text' 的新节点：写进 data.content（prompt 仍写进 data.prompt） */
  content?: string
  /** action === 'apply_graph' 时模型给的整张图（服务端已编译，坐标是相对值） */
  graph?: CanvasWorkflowGraph
}

export type AssistPlan = {
  task_id: number
  status: string
  error_msg?: string
  question: string
  reply: string
  changes: AssistChange[]
  dropped: number
  estimated_points: number
  cost_points: number
}

/** 校验问题（契约 4.1/4.2）：error 阻断该条 change，warning 只提示 */
export type AgentIssue = {
  code: string
  severity: 'error' | 'warning' | string
  node_id?: string
  field?: string
  value?: string
  message: string
  hint?: string
  change_index?: number
}

/** 一轮工具调用 / 规划的留痕，方案卡里展示「第几轮在查什么」 */
export type AgentStepView = {
  round: number
  tool: string
  summary: string
  ok: boolean
  error?: string
}

export type AgentEstimateItem = {
  node_id: string
  kind: string
  type: string
  model: string
  points: number
}

export type AgentEstimate = {
  points: number
  items: AgentEstimateItem[]
}

export type AgentValidateReport = {
  ok: boolean
  errors: AgentIssue[]
  warnings: AgentIssue[]
  estimate: AgentEstimate
  normalized?: CanvasWorkflowGraph
}

/**
 * GET /user/canvas/:id/agent/:task_id 的响应（契约 2.4）。
 * 与 AssistPlan 同构，所以方案卡的勾选 / 应用 / 撤销全都能复用；多出来的是多轮过程与校验报告。
 */
export type AgentPlan = AssistPlan & {
  mode?: string
  round?: number
  max_rounds?: number
  steps?: AgentStepView[]
  validate?: AgentValidateReport
  estimate?: AgentEstimate
}

export type AssistApplyResult = { undoToken: number, applied: number, skipped: number, generated: number }

/** 画布页交给对话栏的桥：读上下文、应用 / 撤销方案 */
export type AssistBridge = {
  context: () => AssistNodeSummary[]
  apply: (changes: AssistChange[], generate: boolean) => Promise<AssistApplyResult>
  undo: (token: number) => 'ok' | 'stale' | 'missing'
}

type GraphNode = {
  id: string
  selected?: boolean
  data?: {
    kind?: string
    label?: string
    prompt?: string
    content?: string
    taskId?: number
  }
}

type GraphEdge = { source: string, target: string }

/** 一次最多带多少节点，与服务端 assistMaxNodes 一致 */
export const ASSIST_MAX_NODES = 40

function isContent(node: GraphNode) {
  const kind = node.data?.kind
  return Boolean(kind) && kind !== 'group'
}

/**
 * 助手要看的节点：有选中时 = 选中节点 + 上游两层 + 下游一层（改提示词要知道参考了什么、会影响谁）；
 * 没选中时带整张画布。文本节点带正文（HTML 由调用方转成纯文本），媒体节点只标「已有结果」。
 */
export function buildAssistNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  plainText: (node: GraphNode) => string,
  max = ASSIST_MAX_NODES,
): AssistNodeSummary[] {
  const content = nodes.filter(isContent)
  const byId = new Map(content.map(node => [node.id, node]))
  const up = new Map<string, string[]>()
  const down = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target) || edge.source === edge.target)
      continue
    if (!up.get(edge.target)?.includes(edge.source))
      up.set(edge.target, [...(up.get(edge.target) ?? []), edge.source])
    if (!down.get(edge.source)?.includes(edge.target))
      down.set(edge.source, [...(down.get(edge.source) ?? []), edge.target])
  }

  const selected = content.filter(node => node.selected)
  let picked: string[]
  if (!selected.length) {
    picked = content.map(node => node.id)
  }
  else {
    const order: string[] = []
    const seen = new Set<string>()
    const push = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id)
        order.push(id)
      }
    }
    selected.forEach(node => push(node.id))
    let frontier = selected.map(node => node.id)
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        for (const src of up.get(id) ?? []) {
          if (!seen.has(src))
            next.push(src)
          push(src)
        }
      }
      frontier = next
    }
    for (const node of selected) {
      for (const dst of down.get(node.id) ?? [])
        push(dst)
    }
    picked = order
  }

  return picked.slice(0, max).map((id) => {
    const node = byId.get(id)!
    const kind = node.data?.kind || ''
    return {
      id,
      kind,
      label: node.data?.label || id,
      // 给助手看的是人话：运镜 / 元素占位符展开后再发
      prompt: expandPromptTokens((node.data?.prompt || '').trim(), (node.data as { markElements?: import('~/utils/canvas-mark').CanvasMarkElement[] } | undefined)?.markElements),
      content: kind === 'text' ? plainText(node) : '',
      has_media: kind !== 'text' && Boolean(String(node.data?.content || '').trim()),
      task_id: Number(node.data?.taskId) || 0,
      selected: Boolean(node.selected),
      upstream: up.get(id) ?? [],
      downstream: down.get(id) ?? [],
    }
  })
}

/**
 * 对话式工作流生成的模式（API.md 32.2）：
 * - 画布是空的：只能从零搭，走 generate；
 * - 画布上有东西：默认 patch（在现有节点上小改），除非用户在对话栏显式打开「从零搭图」。
 *
 * 不能只按「画布是否为空」判定：用户画布上随便留着一个节点，
 * 提示词末尾就会变成「按用户的话改画布」、轮数也从 6 降到 4，
 * 于是「做一条 15 秒竖屏广告」这种需求永远等不到 apply_graph。
 */
export function agentModeFor(nodeCount: number, buildFromScratch = false): 'generate' | 'patch' {
  return nodeCount > 0 && !buildFromScratch ? 'patch' : 'generate'
}

/** 执行顺序：先落整图（apply_graph）→ 连线（连线会把上游文本同步成提示词）→ 加节点 → 改提示词 → 生成 */
const ACTION_ORDER: Record<AssistAction, number> = { apply_graph: 0, connect: 1, add_node: 2, update_prompt: 3, regenerate: 4 }

export function orderAssistChanges(changes: AssistChange[]) {
  return changes
    .map((change, index) => ({ change, index }))
    .sort((a, b) => ACTION_ORDER[a.change.action] - ACTION_ORDER[b.change.action] || a.index - b.index)
    .map(item => item.change)
}

/** 勾选的修改里「重新生成」的预计积分合计 */
export function pickedPoints(changes: AssistChange[], picked: boolean[]) {
  return changes.reduce((sum, change, i) => sum + (picked[i] !== false && change.action === 'regenerate' ? Number(change.points) || 0 : 0), 0)
}

export function hasPickedRegenerate(changes: AssistChange[], picked: boolean[]) {
  return changes.some((change, i) => picked[i] !== false && change.action === 'regenerate')
}

const KIND_LABELS: Record<string, string> = { text: '文本', image: '图片', video: '视频', audio: '音频' }

/**
 * 一条修改的标题，返回 i18n key 与插值。
 * 必须有 default 兜底：服务端可能发来前端还不认识的动作（如 set_params），
 * 没有兜底会在渲染方案卡时抛错，整段对话都打不开。
 */
export function assistChangeTitle(change: AssistChange): { key: string, params: Record<string, string | number> } {
  switch (change.action) {
    case 'update_prompt':
      return { key: '改写「{name}」的提示词', params: { name: change.node_label || change.node_id || '' } }
    case 'regenerate':
      return { key: '重新生成「{name}」', params: { name: change.node_label || change.node_id || '' } }
    case 'add_node':
      return { key: '新建{kind}节点「{name}」', params: { kind: KIND_LABELS[change.kind || ''] || '', name: change.label || '' } }
    case 'connect':
      return { key: '连线 {name}', params: { name: change.node_label || `${change.source} → ${change.target}` } }
    case 'apply_graph':
      return { key: '搭一张工作流（{n} 个节点）', params: { n: change.graph?.nodes?.length || 0 } }
    default:
      return { key: '不支持的动作 {name}', params: { name: change.action || '' } }
  }
}

/**
 * update_prompt 写进节点 data 的补丁。
 * 文本节点显示 / 下游取用的是 data.content，写 data.prompt 用户看不到变化（现存 bug，本方案顺手修）；
 * 生成类节点仍是 data.prompt。
 */
export function updatePromptPatch(change: AssistChange, kind: string): Record<string, unknown> {
  const text = change.prompt || ''
  return kind === 'text' ? { content: text } : { prompt: text }
}

/**
 * add_node 写进新节点 data 的补丁（契约 3.2）：prompt 一律写；
 * text 节点的正文写 content（缺省沿用 prompt，与旧行为一致）；model / params 有值才写（AI 选的模型要能落到生成上）。
 */
export function addNodeDataPatch(change: AssistChange): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (change.kind === 'text') {
    patch.content = change.content ?? change.prompt ?? ''
    if (change.prompt)
      patch.prompt = change.prompt
  }
  else {
    patch.prompt = change.prompt || ''
  }
  if (change.label)
    patch.label = change.label
  if (change.model)
    patch.model = change.model
  if (change.params && typeof change.params === 'object')
    patch.params = { ...change.params }
  return patch
}

/**
 * 对话额度（GET /user/ai-chat/quota）里展示用得上的字段；
 * 完整响应类型见 app/api/ai-chat.ts 的 ChatQuota。这里只做展示，纯函数不碰网络。
 */
export type ChatQuotaView = {
  /** 平台是否开启对话（AgentEnabled）：false 时对话入口直接提示，不发请求 */
  enabled?: boolean
  /** 是否走免费次数；false 时退回积分口径，不展示次数 */
  free?: boolean
  /** 会员：unlimited 且 is_member 才是「会员 · 不限次」 */
  is_member?: boolean
  /** 不限次：会员，或后台把每日次数配成 <=0 */
  unlimited?: boolean
  daily_limit?: number
  remaining?: number
}

/** i18n 翻译函数由调用方注入，纯函数才能单独测 */
export type ChatQuotaTranslate = (key: string, params?: Record<string, string | number>) => string

/**
 * 后端「今日次数用完」：优先认 data.reason=chat_quota_exceeded（API.md 32.5），
 * 没有码再认中文 message 前缀（旧接口 / 任务 error_msg）。
 */
export const CHAT_QUOTA_EXCEEDED_REASON = 'chat_quota_exceeded'
export const CHAT_QUOTA_EXCEEDED_MESSAGE = '今日 AI 对话次数已用完'

export type ChatQuotaErrorData = {
  reason?: string
  daily_limit?: number
}

export function isChatQuotaExceeded(message?: string | null, data?: ChatQuotaErrorData | null): boolean {
  if (String(data?.reason || '') === CHAT_QUOTA_EXCEEDED_REASON)
    return true
  return String(message ?? '').includes(CHAT_QUOTA_EXCEEDED_MESSAGE)
}

/**
 * 次数文案：会员 → 「会员 · 不限次」，后台把每日次数配成不限 → 「不限」，
 * 普通用户 → 「今日剩余 n/上限 次」；free=false（按积分口径）返回 null，调用方不展示次数。
 * 次数走一条带插值的词条，各语言才能按自己的语序组织数字（词条已进 7 个语言文件）。
 */
export function chatQuotaLabel(quota: ChatQuotaView | null | undefined, t: ChatQuotaTranslate): string | null {
  if (!quota || !quota.free)
    return null
  // 平台关掉对话（AgentEnabled=false）：没有次数可言，别渲染「今日剩余 N/M 次」
  if (quota.enabled === false)
    return null
  // unlimited 有两个来源（服务端 IsMember || DailyLimit<=0）：只有 is_member 才配说「会员」，
  // 非会员只是平台把次数配成了不限，别给他挂会员字样（is_member 缺失时同样不自称会员）
  if (quota.unlimited)
    return quota.is_member === true ? t('会员 · 不限次') : t('不限')
  const remaining = Math.max(0, Math.floor(Number(quota.remaining) || 0))
  const limit = Math.max(0, Math.floor(Number(quota.daily_limit) || 0))
  return t('今日剩余 {n}/{total} 次', { n: remaining, total: limit })
}

/** 平台关闭了对话（AgentEnabled=false）：agent 入口会以「暂未开启」拒绝，前端先拦下来 */
export function chatQuotaDisabled(quota: ChatQuotaView | null | undefined): boolean {
  return Boolean(quota && quota.enabled === false)
}

/** 次数用完：免费口径、非不限次、剩余 <= 0。用尽时发送按钮禁用并给会员入口 */
export function chatQuotaExhausted(quota: ChatQuotaView | null | undefined): boolean {
  if (!quota || !quota.free || quota.unlimited)
    return false
  const remaining = Number(quota.remaining)
  return Number.isFinite(remaining) && remaining <= 0
}
