/**
 * 新手跟练（回放式）的纯逻辑部分：剧本、每步「完成没有」的判定、自动备好计划、
 * 回放数据与卡片文案。UI 与画布写入分别在 CanvasPracticeTour / CanvasPracticeList 与宿主里。
 *
 * 三条设计要点（与「进去了出不来」的做法刻意不同）：
 * - **零消耗**：跟练不提交任何模型任务；点「生成」一律被 replaySubmit 接住，
 *   回放的是仓库自带的示例素材（public/images/tutorial），也不写库、不扣点数；
 * - **只读 + 走人还原**：画布对用户只读，跟练自己的写入只有 prepare（退出随快照还原）；
 *   结束卡只有一个动作：完成、退出并还原画布；
 * - **完成态只有一个入口** `practiceStepSatisfied`（判据视图 / 或该步进过会话 done——
 *   引导自己演示完的 demo 步与用户点「跳过这一步」的 result 步都走 done 通道），
 *   判据 `gateSatisfied` 保持 view-only，自动备好计划仍只看它。
 *
 * 九条剧本按等级分档（入门 / 进阶 / 高阶），一条教一个方向，**图形态各不相同**：
 * 角色一致性靠主体引用（subjectIds）、场景延续靠一张首帧扇出、分镜靠多节点各链、
 * 口播靠节点上的 talking 数据 + 独立音频节点、合成靠两段视频节点——不是把同一条骨架换套文案。
 * 单次视频任务仍然只收一条提示词。多镜写在分镜节点上，再拆成一镜一条视频。
 */

import { outputSignature } from '~/utils/canvas-upstream'
import { canvasTaskPatch } from '~/utils/canvas-task-apply'
import { cameraMoveLabel, fxPresetLabel } from '~/utils/canvas-node-kinds'
import { talkingDuration } from '~/utils/canvas-talking'
import { catalogModelsEqual } from '~/utils/canvas-catalog-model'
import type { TalkingData } from '~/utils/canvas-talking'
import type { SubjectKind } from '~/types/creative'

/** 回放的一次「生成」：一个节点生成完之后长什么样，以及要演多久 */
export type PracticeReplayTrack = {
  /** 模拟耗时（毫秒）。真实那次图片 42s、视频 111s，跟练压缩到十几秒，免得干等 */
  simulatedMs: number
  /** 回放的产物地址（public/images/tutorial 下，来自真实产物；节点只认 /images 这类前缀或绝对地址） */
  url: string
  /**
   * 失败演练：这一步的回放第一次按失败演（节点上是失败态），用户再点一次生成就成功。
   * 只演一次（会话里记住这一步已经失败过），全程不消耗点数；见 useCanvasPractice.replaySubmit。
   */
  failOnce?: boolean
}

/** 回放数据：单产物剧本直接用顶层那一份，多产物剧本（扇出 / 多镜）用 byKey 给每个节点各一份 */
export type PracticeReplay = PracticeReplayTrack & {
  /**
   * 一个 key 一份回放：多镜 / 多规格剧本里一个步骤要对多个节点各演一次，必须按 key 区分；
   * key 是 prepare 声明过的 practiceKey。带 byKey 的步骤只认表里那几份（解析见 practiceReplayFor）：
   * 表里没有的 key 不回落到顶层，否则多镜剧本里选错节点会领到别条链的产物。
   */
  byKey?: Record<string, PracticeReplayTrack>
}

/**
 * 回放只对这些类型的节点有意义（文本节点不会「生成」出一份产物）。
 * 校验节点类型是防止 byKey 配错、或判据把回放挂到画布上的用户节点上。
 */
export const PRACTICE_REPLAY_KINDS = ['image', 'video', 'audio'] as const

/** 失败演练写在节点上的错误文案（中文原文即 key，调用方过 t() 再写进 taskError） */
export const PRACTICE_REPLAY_FAIL_LABEL = '回放失败（失败演练）：再点一次生成就会成功'
/** 失败演练的提示条文案（中文原文即 key，调用方过 t()） */
export const PRACTICE_REPLAY_FAIL_NOTICE = '这一步是跟练安排的失败演练：节点上是失败态，再点一次生成就会成功'

/** 判据的节点定位：带 key 时认 data.practiceKey === key 的那个节点，不带 key 时认该 kind 的第一个 */
export type PracticeGate =
  | { kind: 'node', nodeKind: string, atLeast: number, key?: string }
  | { kind: 'edge', fromKind: string, toKind: string, fromKey?: string, toKey?: string }
  /** 该节点 prompt 或 content 非空（文本节点用 content） */
  | { kind: 'prompt', nodeKind: string, key?: string }
  | { kind: 'model', nodeKind: string, model: string, key?: string }
  /** 该节点 subjectIds 数量 ≥ atLeast（默认 1）：主体引用的存在性判据 */
  | { kind: 'subject', nodeKind: string, key?: string, atLeast?: number }
  /** 该节点 data.talking.script 非空 */
  | { kind: 'talking', nodeKind: string, key?: string }
  /** 该节点（或该 kind 的节点数）已有回放产物 */
  | { kind: 'result', nodeKind: string, key?: string, atLeast?: number }
  /**
   * 引导自己演示之后算完成：宿主在「备好 + 定位 + 停一拍」之后把 step.id 写进 session.done，
   * 由 practiceStepSatisfied 的 done 通道读它。视图满足不了它（gateSatisfied 恒 false）。
   */
  | { kind: 'demo' }

/** 主体引用写的是主体库的哪一种（与 subjectApi.list 的 kind 同口径） */
export type PracticeSubjectKind = SubjectKind
/** 视频节点的生成模式（与 CanvasNodeData.videoMode 同一套取值） */
export type PracticeVideoMode = 'reference' | 'fl2v' | 'i2v' | 'talking'

/** 运镜 / 特效写进节点的那一份（宿主落 cameraMoves + params.fx + camera:{on:true,...}） */
export type PracticeCameraSetup = {
  /** 运镜 id：取自 canvas-node-kinds 的 CAMERA_MOVE_ITEMS（如 dolly-in / pan-right / handheld） */
  moves: string[]
  /** 特效预设 id：取自 FX_PRESET_ITEMS（如 film） */
  fx?: string
}

/**
 * 自动备好：由宿主写进画布（跟练数据，退出随快照还原）。
 *
 * 六种分支共享同一套必备语义，缺一条整条链就建不出来：
 * 1. 先按 key 在跟练作用域内定位（无 key 时找该 kind 的第一个节点）；
 * 2. 找不到就按 nodeKind 新建，并**在同一拍**写 practiceKey——同一 tick 内必须已落，
 *    否则下一次 scope 定位又找不到它，会出现重复建点；
 * 3. 带 fromKey / fromKind→toKind 的补边；
 * 4. 字段一律写（画布只读，不存在「用户已经写过的字」需要让位，「只补空」那套旗标随之取消）。
 */
export type PracticePrepare =
  /** 放一个该类型的空节点（除 practiceKey 外不写其余字段） */
  | { kind: 'add-node', nodeKind: string, key?: string, label?: string }
  /** 放好 toKind 的节点（缺就建，落 from 右侧 80px）并把它连到 fromKind 上 */
  | { kind: 'add-connect', fromKind: string, toKind: string, fromKey?: string, toKey?: string, key?: string }
  /** 文本教具（角色设定 / 分镜脚本）：缺则建文本节点并写 content */
  | { kind: 'add-text', content: string, key?: string }
  | {
    kind: 'image-setup'
    nodeKind: 'image' | 'panorama'
    key?: string
    fromKey?: string
    model: string
    params: Record<string, unknown>
    prompt?: string
    subjectKind?: PracticeSubjectKind
  }
  | {
    kind: 'video-setup'
    nodeKind: 'video'
    key?: string
    fromKey?: string
    /** 缺文本上游就建一个文本节点（key/content）并连到视频节点上：运镜台本走这条 */
    textUpstream?: { key: string, content: string }
    /** 'auto' 是宿主注入的 resolveTalkingModel() 现场解析（只口播用），不是真模型 id */
    model: string
    videoMode: PracticeVideoMode
    params: Record<string, unknown>
    prompt?: string
    subjectKind?: PracticeSubjectKind
    talking?: Partial<TalkingData>
    camera?: PracticeCameraSetup
  }
  | {
    kind: 'audio-setup'
    nodeKind: 'audio'
    key?: string
    label?: string
    prompt?: string
    params: { duration: number, audioKind?: string }
  }

/** 最后一步的「成片卡」：把回放的那条产物留在画布上给用户看（一条剧本只有一张） */
export type PracticeShowcase = {
  nodeKind: 'video' | 'audio' | 'image'
  url: string
  /**
   * 音轨没有模型概念（audio-setup 刻意不写 model），音频成片卡这一项给空串；
   * 其余成片卡与对应 prepare 写进节点的字段同源，线性走完时落在同一张卡上，不会多出第二张。
   */
  model: string
  prompt: string
  params?: Record<string, unknown>
}

export type PracticeStep = {
  id: string
  /** 中文原文即 key，渲染时过 t() */
  title: string
  body: string
  /** 清单里标题下面那句小字（中文原文，渲染时过 t()） */
  summary: string
  /** 高亮锚点：data-guide 值（tools / inspector-run / inspector-subject / inspector-talking / inspector-cam / inspector-audio），或 node:<kind> */
  anchor?: string
  gate?: PracticeGate
  prepare?: PracticePrepare
  /**
   * 「等你动手」那行的提示语。`result` 判据未满足时主按钮禁用并显示它，
   * 所以每个 `result` 步都必须写（跟练的主动作是「点生成看回放」，说不清就卡人）。
   * 引导自己演示的 demo 步用它给「这一步的做法：{what}」。
   */
  gateHint?: string
  /** 这一步的「生成」由回放顶上（点生成后按这里的时长与产物演一遍） */
  replay?: PracticeReplay
  /** 收尾步的成片卡（只有收尾步配）：把回放产物留在画布中央 */
  showcase?: PracticeShowcase
}

export type PracticeScriptLevel = 'starter' | 'advanced' | 'expert'

export type PracticeScript = {
  id: string
  name: string
  hint: string
  level: PracticeScriptLevel
  /** 场景选择卡上的图标（lucide 名，原样给 UIcon） */
  icon: string
  steps: PracticeStep[]
}

/** 等级与其中文名（中文原文即 key）：场景选择卡按它分组（入门 / 进阶 / 高阶） */
export const PRACTICE_LEVELS: ReadonlyArray<{ id: PracticeScriptLevel, label: string }> = [
  { id: 'starter', label: '入门' },
  { id: 'advanced', label: '进阶' },
  { id: 'expert', label: '高阶' },
]

/** 画布状态的扁平视图：判据只看这几个字段，不碰 Vue / DOM */
export type PracticeGraphView = {
  nodes: Array<{
    id: string
    kind: string
    model: string
    prompt: string
    /** data.practiceKey：跟练自己给节点起的定位名（多镜 / 多规格剧本靠它认人） */
    key: string
    /** 主体引用数（subjectIds.length） */
    subjects: number
    /** 有没有台词（data.talking.script 非空） */
    talking: boolean
    hasResult: boolean
  }>
  edges: Array<{ source: string, target: string }>
}

type RawNode = { id?: string, data?: Record<string, any> | null }
type RawEdge = { source?: string, target?: string }

export function practiceGraphView(
  graph?: { nodes?: RawNode[], edges?: RawEdge[] } | null,
): PracticeGraphView {
  const nodes = (graph?.nodes ?? [])
    .filter(node => typeof node?.id === 'string' && node.id)
    .map(node => ({
      id: String(node.id),
      kind: String(node.data?.kind ?? ''),
      model: String(node.data?.model ?? ''),
      // 不能用 ??：addNode 建节点时写死 prompt:''，空串不是 nullish，
      // 文本节点的视图 prompt 会恒为空串，`prompt` 类判据永不满足。prompt 为空时回落到 content。
      prompt: String(node.data?.prompt || node.data?.content || ''),
      key: String(node.data?.practiceKey ?? ''),
      subjects: Array.isArray(node.data?.subjectIds) ? node.data.subjectIds.length : 0,
      talking: Boolean(String(node.data?.talking?.script ?? '').trim()),
      hasResult: outputSignature(node.data) !== '',
    }))
  const ids = new Set(nodes.map(node => node.id))
  const edges = (graph?.edges ?? [])
    .filter(edge => typeof edge?.source === 'string' && typeof edge?.target === 'string' && ids.has(edge.source!) && ids.has(edge.target!))
    .map(edge => ({ source: edge.source!, target: edge.target! }))
  return { nodes, edges }
}

/** 这一类节点里第一个带产物的（回放/高亮都按它来） */
export function practiceNodeOfKind(view: PracticeGraphView, kind: string) {
  return view.nodes.find(node => node.kind === kind) ?? null
}

/**
 * 判据的节点定位：带 key 时认 practiceKey 相同的那个，不带 key 时认该 kind 的第一个。
 * 一条剧本里同一个 kind 可以有多张卡（一景两镜的两条视频、扇出的三条支线），key 就是它们的名字。
 */
export function practiceScopedNodeOf(view: PracticeGraphView, kind: string, key?: string | null) {
  const rows = view.nodes.filter(node => node.kind === kind)
  if (!key)
    return rows[0] ?? null
  return rows.find(node => node.key === key) ?? null
}

/**
 * 这一步关心哪一类节点：判据或自动备好动作里写的 nodeKind。
 * inspector-* 锚点靠它决定「该替用户选中谁」——面板只在有选中节点时挂出来。
 */
export function stepKindOf(step: PracticeStep | null | undefined): string | null {
  const gate = step?.gate
  if (gate && 'nodeKind' in gate)
    return gate.nodeKind
  const prepare = step?.prepare
  if (prepare && 'nodeKind' in prepare)
    return prepare.nodeKind
  return null
}

/**
 * 这一步的节点名（practiceKey）：prepare 优先，判据兜底。
 * 宿主拿它把 inspector-* 锚点定位到正确的那张卡上（无 key 时按该 kind 的第一个）。
 */
export function stepKeyOf(step: PracticeStep | null | undefined): string | null {
  const prep = step?.prepare
  if (prep && 'key' in prep && prep.key)
    return prep.key
  const gate = step?.gate
  if (gate && 'key' in gate && gate.key)
    return gate.key
  return null
}

/**
 * 跟练兜底新建节点的落点：画布上已有内容时放到「最右节点右边 80px + 最上节点的顶」，
 * 别落在视口中心——跟练里同尺寸的节点多，中心落点会跟已有节点完全叠住，
 * 看起来就是「点了没反应」。画布空着时返回 null，交给调用方用视口中心（口径与 graphOriginPoint 一致）。
 */
export function practiceSpotForNewNode(
  existing: Array<{ x: number, y: number, w: number, h: number }>,
): { x: number, y: number } | null {
  if (!existing.length)
    return null
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  for (const box of existing) {
    right = Math.max(right, box.x + box.w)
    top = Math.min(top, box.y)
  }
  return { x: right + 80, y: top }
}

/** 常驻清单面板的宽度（px）：与 canvas.css 的 .canvas-practice-list 保持一致 */
export const PRACTICE_LIST_WIDTH = 248

/**
 * 跟练作用域视图：把「进跟练那一刻画布上已有的节点」（基线）整批滤掉。
 *
 * 跟练是在用户自己的画布上跑的（不隔离、退出才还原），如果判据/兜底/高亮还是"第一个同类节点"，
 * 非空画布上就会指到用户原有的节点上：第 1 步一进去就自动满足、prepare 把真实节点改掉、
 * 回放挂到旧节点上。滤掉基线之后，四件事都只认「跟练期间新增的节点」，
 * 预置节点永不计入判据、永不被写；用户自己在跟练里新建的（不在基线里）照常放行。
 */
export function practiceScopedGraphView(
  graph?: { nodes?: RawNode[], edges?: RawEdge[] } | null,
  baselineIds?: ReadonlySet<string> | Iterable<string> | null,
): PracticeGraphView {
  if (!baselineIds)
    return practiceGraphView(graph)
  const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds)
  const nodes = (graph?.nodes ?? []).filter(node => !(typeof node?.id === 'string' && baseline.has(node.id)))
  return practiceGraphView({ nodes, edges: graph?.edges })
}

export function gateSatisfied(gate: PracticeGate | undefined, view: PracticeGraphView): boolean {
  if (!gate)
    return true
  switch (gate.kind) {
    case 'node': {
      const rows = view.nodes.filter(node => node.kind === gate.nodeKind && (!gate.key || node.key === gate.key))
      return rows.length >= gate.atLeast
    }
    case 'prompt': {
      const node = practiceScopedNodeOf(view, gate.nodeKind, gate.key)
      return Boolean(node && node.prompt.trim())
    }
    case 'model': {
      const node = practiceScopedNodeOf(view, gate.nodeKind, gate.key)
      return Boolean(node && catalogModelsEqual(node.model, gate.model))
    }
    case 'edge': {
      const from = practiceScopedNodeOf(view, gate.fromKind, gate.fromKey)
      const to = practiceScopedNodeOf(view, gate.toKind, gate.toKey)
      return Boolean(from && to && view.edges.some(edge => edge.source === from.id && edge.target === to.id))
    }
    case 'subject': {
      const node = practiceScopedNodeOf(view, gate.nodeKind, gate.key)
      return Boolean(node && node.subjects >= (gate.atLeast ?? 1))
    }
    case 'talking': {
      const node = practiceScopedNodeOf(view, gate.nodeKind, gate.key)
      return Boolean(node && node.talking)
    }
    case 'result': {
      const rows = view.nodes.filter(node => node.kind === gate.nodeKind && (!gate.key || node.key === gate.key))
      return rows.filter(node => node.hasResult).length >= (gate.atLeast ?? 1)
    }
    // demo 是「引导自己演示完」这一步的完成态，视图里没有对应物：只能由 done 通道满足
    case 'demo':
      return false
  }
}

/** 完成态的唯一入口：Tour 的 satisfied、清单打勾、主按钮禁用都用它 */
export function practiceStepSatisfied(
  step: PracticeStep | null | undefined,
  view: PracticeGraphView,
  doneIds?: ReadonlySet<string> | Iterable<string> | null,
): boolean {
  if (!step)
    return false
  const done = doneIds instanceof Set ? doneIds : new Set(doneIds ?? [])
  return gateSatisfied(step.gate, view) || done.has(step.id)
}

/**
 * 锚点 → 选择器。节点类锚点按"当前这一类的第一个节点"算，找不到就回落到工具轨，
 * 保证每一步都有东西可高亮（没有高亮的步骤会退化成居中卡片）。
 */
export function anchorSelector(anchor: string | undefined, view: PracticeGraphView): string | null {
  if (!anchor)
    return null
  if (anchor.startsWith('node:')) {
    const node = practiceNodeOfKind(view, anchor.slice(5))
    return node ? `[data-id="${node.id}"]` : '[data-guide="tools"]'
  }
  return `[data-guide="${anchor}"]`
}

/**
 * 锚点身份：换步 / 换节点时聚光要直落（跟着平滑过去会在两个锚点之间拉一条扫过的线）。
 * 卡片位置切换的判据就是它变了没有。
 */
export function practiceAnchorKey(step: PracticeStep | null | undefined, view: PracticeGraphView): string {
  if (!step)
    return ''
  return `${step.id}#${anchorSelector(step.anchor, view) ?? ''}`
}

/** 常驻清单里的一行 */
export type PracticeProgressItem = {
  id: string
  index: number
  /** 走到了 / 已打勾 / 还没走：只描述这一行怎么显示 */
  state: 'current' | 'done' | 'todo'
  /** 打勾：走过的（index < stepIndex），或"这一步已完成"（判据已满足 / 被引导演示过 / 被跳过） */
  checked: boolean
}

export type PracticeProgress = {
  /** 打勾的行数 = 顶部那句「已完成 N/50 步」 */
  done: number
  total: number
  items: PracticeProgressItem[]
}

/**
 * 清单进度（纯函数，顶部数字与每行打勾的唯一来源）。
 *
 * 打勾规则一句话：走过的（index < stepIndex）算完成；这一步配了判据且已完成也算完成。
 * 判据是"东西在不在画布上"，与走到哪一步无关——所以从清单跳回前面的步骤时，
 * 后面那些已经备好的行不会集体退回未完成（进度只增不减），跟练替用户备好的当前行也立刻打勾。
 * 没有判据的过场步（开场 / 收尾）只按"走过"算，不会原地自动打勾。
 */
export function practiceProgress(
  steps: PracticeStep[],
  view: PracticeGraphView,
  stepIndex: number,
  doneIds?: ReadonlySet<string> | Iterable<string> | null,
): PracticeProgress {
  const items = steps.map((step, index) => {
    const checked = index < stepIndex || (Boolean(step.gate) && practiceStepSatisfied(step, view, doneIds))
    return {
      id: step.id,
      index,
      state: (index === stepIndex ? 'current' : checked ? 'done' : 'todo') as PracticeProgressItem['state'],
      checked,
    }
  })
  return { done: items.filter(item => item.checked).length, total: items.length, items }
}

/** 节点类型 / 主体类型的中文名（中文原文即 key，调用方再过一次 t()）：清单、卡片与兜底提示共用一份 */
export function practiceKindLabel(kind: string): string {
  switch (kind) {
    case 'image':
      return '图片'
    case 'video':
      return '视频'
    case 'audio':
      return '音频'
    case 'text':
      return '文本'
    case 'panorama':
      return '全景图'
    case 'director':
      return '3D 导演台'
    case 'storyboard':
      return '分镜'
    case 'character':
      return '角色'
    case 'scene':
      return '场景'
    case 'prop':
      return '道具'
    default:
      return '节点'
  }
}

/**
 * 「进入一步就替用户备好」的写入计划（纯函数）。
 *
 * 从第 0 步一路走到 targetIndex：只有「配了 prepare 且判据还不满足」的动作入列。
 * 顺序就是依赖顺序（先建文本 / 图片节点 → 再建视频并连线 → 再写台词与运镜），
 * 所以从清单直接点最后一步也能把整条链补齐。
 *
 * 注意：view 是计划生成那一刻的快照，动作按"一拍一个"执行时视图会逐步刷新；
 * 执行侧每个分支都先按 key 定位、判据满足就跳过，重复入列不会造成重复写入。
 */
export function practiceAutoPreparePlan(
  steps: PracticeStep[],
  targetIndex: number,
  view: PracticeGraphView,
): PracticePrepare[] {
  const plan: PracticePrepare[] = []
  if (!steps.length)
    return plan
  const end = Math.min(Math.max(0, targetIndex), steps.length - 1)
  for (let index = 0; index <= end; index++) {
    const step = steps[index]
    if (!step)
      continue
    // demo 判据恒 false：演示步没有 prepare，不会因此混进计划
    if (step.prepare && !gateSatisfied(step.gate, view))
      plan.push(step.prepare)
  }
  return plan
}

/**
 * 卡片上「跟练已替你布好这一步」那一行的内容（纯数据，文案由组件过 t()）。
 *
 * 它由宿主**实际执行过的** prepare 反推（session.applied → 这里），不再由剧本静态推导：
 * 跟练没写进去的东西（例如主体库为空、模型没解析到）卡片就不上行，没写成功走 session.notice。
 * 所以没有 applied 时给空数组——卡片宁可少一行，也不能写一句跟画布不符的话。
 */
export type PracticeReadyItem =
  | { kind: 'node', nodeKind: string }
  | { kind: 'connect', fromKind: string, toKind: string }
  | { kind: 'model', value: string }
  | { kind: 'subject', name: string }
  | { kind: 'talking', script: string, seconds: number }
  /** asScript=true 是分镜 / 运镜台本（「已写好脚本：」），否则是普通正文（「已写好正文：」） */
  | { kind: 'text', text: string, asScript: boolean }
  | { kind: 'audio', seconds: number }
  | { kind: 'camera', moves: string }

/** 宿主执行过的 prepare（结构上等价于 useCanvasPractice 里导出的 PracticeApplied，避免反向依赖 composable） */
export type PracticeAppliedPrepare = { stepId: string, prep: PracticePrepare }

/** 模型那行的写法：'qwen-image-2.0 · 16:9 · 2K · std'（模型 + 参数值，按声明顺序） */
function practiceModelLine(model: string, params?: Record<string, unknown>): string {
  const values = Object.values(params ?? {}).map(value => String(value))
  return [model, ...values].filter(Boolean).join(' · ')
}

/** 运镜那行：按 CAMERA_MOVE_ITEMS 翻成中文名；只有特效没有运镜时退回特效名（否则这行会是空的） */
function practiceCameraLine(camera: PracticeCameraSetup): string {
  const moves = (camera.moves || []).map(id => cameraMoveLabel(id)).filter(Boolean)
  if (moves.length)
    return moves.join(' · ')
  return fxPresetLabel(camera.fx) || ''
}

function practiceReadyOf(prep: PracticePrepare): PracticeReadyItem[] {
  switch (prep.kind) {
    case 'add-node':
      return [{ kind: 'node', nodeKind: prep.nodeKind }]
    case 'add-connect':
      return [{ kind: 'connect', fromKind: prep.fromKind, toKind: prep.toKind }]
    case 'add-text':
      return [{ kind: 'text', text: prep.content, asScript: prep.key === 'script' }]
    case 'image-setup': {
      const rows: PracticeReadyItem[] = [{ kind: 'model', value: practiceModelLine(prep.model, prep.params) }]
      if (prep.subjectKind)
        rows.push({ kind: 'subject', name: practiceKindLabel(prep.subjectKind) })
      return rows
    }
    case 'video-setup': {
      const rows: PracticeReadyItem[] = []
      if (prep.textUpstream)
        rows.push({ kind: 'text', text: prep.textUpstream.content, asScript: prep.textUpstream.key === 'script' })
      // 'auto' 是宿主现场解析的占位，不是模型名：卡片上说「auto 已选好」会是假话，这一行干脆不上
      if (prep.model !== 'auto')
        rows.push({ kind: 'model', value: practiceModelLine(prep.model, prep.params) })
      if (prep.subjectKind)
        rows.push({ kind: 'subject', name: practiceKindLabel(prep.subjectKind) })
      const script = String(prep.talking?.script ?? '')
      if (script.trim())
        rows.push({ kind: 'talking', script, seconds: talkingDuration(script, null) })
      if (prep.camera) {
        const moves = practiceCameraLine(prep.camera)
        if (moves)
          rows.push({ kind: 'camera', moves })
      }
      return rows
    }
    case 'audio-setup':
      return [{ kind: 'audio', seconds: Math.max(0, Math.floor(Number(prep.params?.duration) || 0)) }]
  }
}

export function practiceReadyItems(
  step: PracticeStep | null | undefined,
  applied?: ReadonlyArray<PracticeAppliedPrepare> | null,
): PracticeReadyItem[] {
  if (!step || !applied?.length)
    return []
  const items: PracticeReadyItem[] = []
  for (const entry of applied) {
    if (!entry || entry.stepId !== step.id || !entry.prep)
      continue
    items.push(...practiceReadyOf(entry.prep))
  }
  return items
}

/**
 * 回放素材地址认出来的产物类型：跟练自带的示例素材只有 jpg / mp4 / mp3 三类
 * （public/images/tutorial）。认不出扩展名（data: / blob: 之类）时返回 null——
 * 那种地址没有可靠的类型信息，只能交给调用方按节点类型用。
 */
function practiceReplayProductKind(url: string): 'image' | 'video' | 'audio' | null {
  const path = String(url || '').split(/[?#]/)[0]?.toLowerCase() ?? ''
  if (/\.(?:mp4|webm|mov|m4v)$/.test(path))
    return 'video'
  if (/\.(?:mp3|wav|m4a|aac|ogg|flac)$/.test(path))
    return 'audio'
  if (/\.(?:jpg|jpeg|png|webp|gif|avif|bmp)$/.test(path))
    return 'image'
  return null
}

/**
 * 这一步该演哪一份回放（纯函数）。两道校验，任一不过就返回 null——调用方据此跳过回放并提示，
 * 而不是把产物写到不该写的节点上：
 * 1. 节点类型必须在 PRACTICE_REPLAY_KINDS 里（文本节点不会「生成」出产物）；
 * 2. 产物类型要与节点类型相配：分镜 / 扇出这类 byKey 步骤里被选中生成的是图片节点，
 *    产物却是别条链的 mp4，这道校验拦住「视频素材写进图片节点」。
 * 带 byKey 的步骤只认表里那几份：key 不在表里（含没有 practiceKey 的节点）不回落顶层；
 * 只有单产物步（没有 byKey）才回落到顶层那份。
 */
export function practiceReplayFor(
  replay: PracticeReplay | null | undefined,
  nodeKind: string,
  nodeKey?: string | null,
): PracticeReplayTrack | null {
  if (!replay)
    return null
  if (!(PRACTICE_REPLAY_KINDS as readonly string[]).includes(nodeKind))
    return null
  const hit = nodeKey ? replay.byKey?.[nodeKey] : undefined
  if (replay.byKey && !hit)
    return null
  const track = hit ?? { simulatedMs: replay.simulatedMs, url: replay.url, failOnce: replay.failOnce }
  const product = practiceReplayProductKind(track.url)
  if (product && product !== nodeKind)
    return null
  return track
}

/** 回放时用的"假任务"：id 固定 0，既不会被轮询接管，也不会让节点上出现取消按钮 */
const PRACTICE_REPLAY_TASK = { id: 0, result_text: '', result_asset_id: 0, error_msg: '' }

/**
 * 回放产物写回节点的补丁（成功态）。跟练的 replaySubmit 与收尾步的成片卡共用一份，
 * taskId / assetId 一并清空——这样「重跑」「过期」不会把回放产物当成真结果。
 */
export function practiceReplayPatch(url: string, type: string, failedLabel: string) {
  return {
    ...canvasTaskPatch(
      { ...PRACTICE_REPLAY_TASK, status: 'succeeded' as const, progress: 100, type: type as never, result_url: url },
      failedLabel,
    ),
    taskId: undefined,
    assetId: undefined,
  }
}

/**
 * 回放失败演练的补丁（失败态）：与成功态同源（canvasTaskPatch），只是 status=failed。
 * 不挂真实任务 id / 素材 id：失败态由「再点一次生成」的重试覆盖，别让节点上出现取消按钮或真任务。
 */
export function practiceReplayFailPatch(type: string, message: string) {
  return {
    ...canvasTaskPatch(
      // result_url 必填（成功态才用它写内容）：失败态给空串，canvasTaskPatch 不会写 content
      { ...PRACTICE_REPLAY_TASK, status: 'failed' as const, progress: 100, type: type as never, result_url: '', error_msg: message },
      message,
    ),
    taskId: undefined,
    assetId: undefined,
  }
}

// ---------------------------------------------------------------------------
// 剧本文案常量：回放那一条产物对应的输入（模型只用定价表里的 qwen-image-2.0 / Kling-2.5）
// ---------------------------------------------------------------------------

/** 入门课：出图那句 prompts（回放 frame.jpg 那张的输入） */
export const PRACTICE_IMAGE_PROMPT = '电影感剧照：主角站在天台边缘俯瞰城市夜景，风吹动衣角，霓虹与车流做背景虚化。'
/** 入门课：出片那句 prompts（回放 clip.mp4 那条的输入） */
export const PRACTICE_VIDEO_PROMPT = '风把衣角吹起，镜头从背后缓缓推近，城市灯光轻微呼吸。'

/** 角色一致性：角色设定（文本节点教具）——外貌 / 发型 / 服装 / 气质写具体，两次出片才锁得住 */
export const PRACTICE_ROLE_SCRIPT = '角色设定：林见，28 岁女摄影师，短发、圆脸、左眉尾有一颗小痣，常穿米色冲锋衣；说话干脆，眼神平静。'
/** 角色一致性：定妆图（引用角色主体的第一张图） */
export const PRACTICE_CAST_IMAGE_PROMPT = '角色定妆照：按角色设定出半身正面像，干净浅灰背景，柔光棚拍，短发、圆脸、左眉尾小痣、米色冲锋衣都要对得上，竖版 9:16。'
/** 角色一致性：出镜片（同一个角色主体进视频） */
export const PRACTICE_CAST_VIDEO_PROMPT = '人物轻微转头看镜头再低头整理衣领，手持轻晃，光线不变，保持五官、发型与服装一致。'

/** 场景延续：场景首帧（引用场景主体） */
export const PRACTICE_SCENE_IMAGE_PROMPT = '场景首帧：老城面馆门头，招牌文字清晰、店内暖光，玻璃门上有水珠，雨后街道的霓虹倒影，宽画幅 16:9。'
/** 场景延续：近景镜（首帧 + 前推） */
export const PRACTICE_NEAR_PROMPT = '镜头缓慢前推，从门头推到桌上的招牌牛肉面，热气升起，场景不变。'
/** 场景延续：全景镜（首帧 + 右摇） */
export const PRACTICE_FAR_PROMPT = '镜头缓慢右摇，从门头摇到整条街道，霓虹倒影与行人剪影入画，场景不变。'

/** 多镜头分镜 / 运镜台本共用的一份两镜脚本（与配方库 multi-shot 的教学口径一致） */
export const PRACTICE_SHOT_SCRIPT = '两镜脚本：镜头一，主角在便利店收银台前接过咖啡，冷白日光灯，玻璃门上有水珠；镜头二，雨后的街道，主角站在店门口抬头看天，霓虹倒影在水洼里。'
/** 分镜：镜头一首帧 */
export const PRACTICE_S1_IMAGE_PROMPT = '镜头一首帧：便利店内部，主角在收银台前接过咖啡，冷白日光灯，玻璃门上有水珠，中景 16:9。'
/** 分镜：镜头二首帧 */
export const PRACTICE_S2_IMAGE_PROMPT = '镜头二首帧：雨后的街道，主角站在店门口抬头看天，霓虹倒影在水洼里，全景 16:9。'
/** 分镜：镜头一出片 */
export const PRACTICE_S1_VIDEO_PROMPT = '镜头轻微手持晃动，蒸汽从咖啡杯上升起，场景与光线不要变。'
/** 分镜：镜头二出片 */
export const PRACTICE_S2_VIDEO_PROMPT = '镜头缓慢上摇，雨滴从屋檐滴落，主角露出放松的表情，场景与光线不要变。'

/** 口播与音频：讲师首帧 */
export const PRACTICE_HOST_IMAGE_PROMPT = '讲师首帧：半身正面看镜头，干净浅色背景，服装质感清晰，竖版 9:16，右侧留字幕位。'
/** 口播与音频：台词（字数就是时长：中文 3.5 字/秒 + 1 秒收尾，3–15 秒） */
export const PRACTICE_TALK_SCRIPT = '别再用错查找函数：从左往右查不到的值，换一行写法就能取到。'
/** 口播与音频：口播节点的画面补充（台词由 talking.script 拼进提示词） */
export const PRACTICE_TALK_EXTRA = '画面补充：讲师半身固定机位，浅色背景，右侧留字幕位。'

/** 一图多规格：商品首帧（方图起手） */
export const PRACTICE_COVER_PROMPT = '电商主图：白色陶瓷咖啡杯摆在浅灰背景上，正面 45°、占画面 70%，柔光影棚光，杯身质感清晰，画面下方留一行卖点大字「今早的咖啡，7 分钟出杯」，方图 1:1。'
/** 一图多规格：9:16 信息流 */
export const PRACTICE_FEED_PROMPT = '镜头缓慢环绕，杯子匀速微转，蒸汽升起，柔光棚拍，不改变商品外形与包装文字。'
/** 一图多规格：1:1 详情页 */
export const PRACTICE_SQUARE_PROMPT = '镜头缓慢前推，杯口与把手细节依次入画，柔光棚拍，不改变商品外形与包装文字。'
/** 一图多规格：16:9 主图 */
export const PRACTICE_WIDE_PROMPT = '镜头缓慢后移，商品与场景道具同框，柔光棚拍，不改变商品外形与包装文字。'

/** 镜头语言：prompt 只写动作——运镜 / 特效交给节点上的数据字段（结构），别在提示词里重复描述 */
export const PRACTICE_CAM_PROMPT = '主角在便利店收银台前接过咖啡，蒸汽升起，人物动作自然连贯。'
/** 3D 预演：prompt 只写画面，运镜由导出认路径后写进节点 */
export const PRACTICE_PREVIEW_PROMPT = '主角走过天台边缘，城市灯光在身后。'

/** 正文固定开场句（三条，全剧本共用）：开场步 / 首次点生成那步 / 其余步各一句 */
const PRACTICE_BODY_ENTER = '跟练不会真的调模型、不花点数；退出会把画布还原成进来那一刻。'
const PRACTICE_BODY_FIRST_RUN = '回放放的是跟练自带的示例素材，不是按你这句提示词真生成的。'
const PRACTICE_BODY_READY = '跟练已经替你把这一步布好了，你只要点生成看回放。'

/** 正文 = 固定开场句 + 本步要点（要点 ≤60 字；整段中文原文即 i18n 键） */
function practiceBody(opening: string, point: string) {
  return `${opening}${point}`
}

/** 点生成那步在面板上点哪里（单产物步骤共用的"等你动手"） */
const PRACTICE_RUN_HINT = '在面板点生成，看回放'

// ---- 3.1 入门：图片 + 视频节点（最小骨架） ----
const IMAGE_VIDEO_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：图片怎么变成视频',
    summary: '不调模型、不花点数，退出即还原',
    body: practiceBody(PRACTICE_BODY_ENTER, '这条链只有两个节点：图片定住画面，视频节点吃它当首帧。'),
  },
  {
    id: 'add-image',
    title: '先放一个图片节点',
    summary: '放一个图片节点（出图的起点）',
    body: practiceBody(PRACTICE_BODY_READY, '左边工具条的加号、空画布中间的入口都能加节点；这一步先放图片。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1 },
    prepare: { kind: 'add-node', nodeKind: 'image' },
  },
  {
    id: 'add-video',
    title: '再加一个视频节点，连上图片',
    summary: '视频节点连上图片，当首帧',
    body: practiceBody(PRACTICE_BODY_READY, '从图片节点右侧的圆点拖到视频节点上，那张图就成了视频的首帧。'),
    anchor: 'tools',
    gate: { kind: 'edge', fromKind: 'image', toKind: 'video' },
    prepare: { kind: 'add-connect', fromKind: 'image', toKind: 'video' },
  },
  {
    id: 'run-image',
    title: '点生成，看图片回放',
    summary: '点生成，看图片回放',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '提示词与出图模型都替你写好了：qwen-image-2.0，16:9、2K、std。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image' },
    gateHint: PRACTICE_RUN_HINT,
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      model: 'qwen-image-2.0',
      params: { ratio: '16:9', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_IMAGE_PROMPT,
    },
    replay: { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
  },
  {
    id: 'run-video',
    title: '点生成，看图动起来',
    summary: '选 Kling-2.5，出 5 秒片',
    body: practiceBody(PRACTICE_BODY_READY, '视频节点配好 Kling-2.5、5 秒、1080P；第一次点生成会先演一遍失败态。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video' },
    gateHint: PRACTICE_RUN_HINT,
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_VIDEO_PROMPT,
    },
    replay: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
  },
  {
    id: 'done',
    title: '这条链就是「图生视频」',
    summary: '成片卡留在画布中央（退出即还原）',
    body: practiceBody(PRACTICE_BODY_READY, '图定住画面，视频节点吃上游那张图当首帧；退出跟练画布就还原。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_VIDEO_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
    },
  },
]

// ---- 3.2 进阶：角色一致性（主体引用） ----
const CHARACTER_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：让同一个人出现在每条片里',
    summary: '让同一位角色出现在每条片里',
    body: practiceBody(PRACTICE_BODY_ENTER, '角色一致靠两件事：同一份角色设定，和同一个角色主体版本。'),
  },
  {
    id: 'write-role',
    title: '写一句角色设定',
    summary: '写一句角色设定（文本节点）',
    body: practiceBody(PRACTICE_BODY_READY, '角色设定写成文本节点：外貌、发型、服装、气质，越具体越稳。'),
    anchor: 'tools',
    gate: { kind: 'prompt', nodeKind: 'text' },
    prepare: { kind: 'add-text', content: PRACTICE_ROLE_SCRIPT },
  },
  {
    id: 'cast-image',
    title: '定妆图：引用角色主体',
    summary: '定妆图：引用角色主体',
    body: practiceBody(PRACTICE_BODY_READY, '主体引用会自动把角色参考图并进任务，再补一段角色描述。'),
    anchor: 'inspector-subject',
    gate: { kind: 'subject', nodeKind: 'image', key: 'cast-image' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 'cast-image',
      model: 'qwen-image-2.0',
      params: { ratio: '9:16', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_CAST_IMAGE_PROMPT,
      subjectKind: 'character',
    },
  },
  {
    id: 'run-image',
    title: '点生成，看定妆图回放',
    summary: '点生成，看定妆图回放',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '定妆图是 9:16、2K，五官按角色设定锁死。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image', key: 'cast-image' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
  },
  {
    id: 'cast-video',
    title: '出镜片：同一位角色进视频',
    summary: '出镜片：同一位角色进视频',
    body: practiceBody(PRACTICE_BODY_READY, '视频节点也引同一个角色主体：两次出片才是同一个人。'),
    anchor: 'inspector-subject',
    gate: { kind: 'subject', nodeKind: 'video', key: 'cast-video' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'cast-video',
      fromKey: 'cast-image',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '9:16' },
      prompt: PRACTICE_CAST_VIDEO_PROMPT,
      subjectKind: 'character',
    },
  },
  {
    id: 'run-video',
    title: '点生成，看角色出片',
    summary: '点生成，看角色出片',
    body: practiceBody(PRACTICE_BODY_READY, '出片拿定妆图当首帧；第一次点生成会先演一遍失败态。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', key: 'cast-video' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
  },
  {
    id: 'done',
    title: '角色一致性的三个要点',
    summary: '角色一致性的三个要点',
    body: practiceBody(PRACTICE_BODY_READY, '要点：角色设定落成文本、两次都引同一主体、主体版本别换。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_CAST_VIDEO_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '9:16' },
    },
  },
]

// ---- 3.3 进阶：场景延续（一景两镜） ----
const SCENE_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：同一场景，两个景别',
    summary: '同一场景，两个景别',
    body: practiceBody(PRACTICE_BODY_ENTER, '一张场景首帧扇出两条片：近景前推、全景右摇。'),
  },
  {
    id: 'scene-image',
    title: '场景首帧：引用场景主体',
    summary: '场景首帧：引用场景主体',
    body: practiceBody(PRACTICE_BODY_READY, '场景主体写进节点后，两条视频都带同一份场景参考。'),
    anchor: 'inspector-subject',
    gate: { kind: 'subject', nodeKind: 'image', key: 'scene-image' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 'scene-image',
      model: 'qwen-image-2.0',
      params: { ratio: '16:9', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_SCENE_IMAGE_PROMPT,
      subjectKind: 'scene',
    },
  },
  {
    id: 'run-image',
    title: '点生成，看场景首帧回放',
    summary: '点生成，看场景首帧回放',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '首帧 16:9、2K；比例与时长落在各自的视频节点上。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image', key: 'scene-image' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
  },
  {
    id: 'near-shot',
    title: '近景镜：首帧 + 前推',
    summary: '近景镜：首帧 + 前推',
    body: practiceBody(PRACTICE_BODY_READY, '运镜是结构、prompt 只写动作：前推已经在节点上选好了。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'near' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'near',
      fromKey: 'scene-image',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '9:16' },
      prompt: PRACTICE_NEAR_PROMPT,
      camera: { moves: ['dolly-in'] },
      subjectKind: 'scene',
    },
  },
  {
    id: 'far-shot',
    title: '全景镜：首帧 + 右摇',
    summary: '全景镜：首帧 + 右摇',
    body: practiceBody(PRACTICE_BODY_READY, '同一张首帧再连一条视频节点，只改运镜与规格。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'far' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'far',
      fromKey: 'scene-image',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_FAR_PROMPT,
      camera: { moves: ['pan-right'] },
      subjectKind: 'scene',
    },
  },
  {
    id: 'run-videos',
    title: '两个镜头各点一次生成',
    summary: '两个镜头各点一次生成',
    body: practiceBody(PRACTICE_BODY_READY, '两条片各点一次生成：先演一次失败态，再点一次就成功。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', atLeast: 2 },
    gateHint: '两个镜头各点一次生成',
    replay: {
      simulatedMs: 13000,
      url: '/images/tutorial/clip.mp4',
      byKey: {
        near: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
        far: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4' },
      },
    },
  },
  {
    id: 'done',
    title: '一景两镜的三个要点',
    summary: '一景两镜的三个要点',
    body: practiceBody(PRACTICE_BODY_READY, '要点：一张首帧扇出多条片、规格各自落参数、场景主体共享。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_NEAR_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '9:16' },
    },
  },
]

// ---- 3.4 进阶：多镜头分镜（一脚本两镜） ----
const STORYBOARD_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：一个脚本拆两个镜头',
    summary: '一个脚本拆两个镜头',
    body: practiceBody(PRACTICE_BODY_ENTER, '每条镜头各自一条「图片 → 视频」链，互不串提示词。'),
  },
  {
    id: 'script',
    title: '写成两个镜头的脚本',
    summary: '写成两个镜头的脚本',
    body: practiceBody(PRACTICE_BODY_READY, '分镜脚本写成文本节点，两个镜头各占一句。'),
    anchor: 'tools',
    gate: { kind: 'prompt', nodeKind: 'text', key: 'script' },
    prepare: { kind: 'add-text', key: 'script', content: PRACTICE_SHOT_SCRIPT },
  },
  {
    id: 'shot-1',
    title: '镜头一：首帧图',
    summary: '镜头一：便利店里的首帧',
    body: practiceBody(PRACTICE_BODY_READY, '镜头一首帧：景别、主体位置与光线都写在提示词里。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1, key: 's1-image' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 's1-image',
      fromKey: 'script',
      model: 'qwen-image-2.0',
      params: { ratio: '16:9', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_S1_IMAGE_PROMPT,
    },
  },
  {
    id: 'shot-2',
    title: '镜头二：首帧图',
    summary: '镜头二：雨后街道的首帧',
    body: practiceBody(PRACTICE_BODY_READY, '镜头二首帧另起一句，不跟镜头一串提示词。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1, key: 's2-image' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 's2-image',
      fromKey: 'script',
      model: 'qwen-image-2.0',
      params: { ratio: '16:9', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_S2_IMAGE_PROMPT,
    },
  },
  {
    id: 'chain-1',
    title: '镜头一：接上出片节点',
    summary: '镜头一：接上出片节点',
    body: practiceBody(PRACTICE_BODY_READY, '每条镜头的连线各自独立，两条链的提示词互不影响。'),
    anchor: 'tools',
    gate: { kind: 'edge', fromKind: 'image', toKind: 'video', fromKey: 's1-image', toKey: 's1-video' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 's1-video',
      fromKey: 's1-image',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_S1_VIDEO_PROMPT,
    },
  },
  {
    id: 'chain-2',
    title: '镜头二：接上出片节点',
    summary: '镜头二：接上出片节点',
    body: practiceBody(PRACTICE_BODY_READY, '镜头二同样接一条视频节点：一镜一条链的结构。'),
    anchor: 'tools',
    gate: { kind: 'edge', fromKind: 'image', toKind: 'video', fromKey: 's2-image', toKey: 's2-video' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 's2-video',
      fromKey: 's2-image',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_S2_VIDEO_PROMPT,
    },
  },
  {
    id: 'run-images',
    title: '两张首帧各点一次生成',
    summary: '两张首帧各点一次生成',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '先看两张首帧：提示词不一样，画面就该不一样。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image', atLeast: 2 },
    gateHint: '两张首帧各点一次生成',
    replay: {
      simulatedMs: 7000,
      url: '/images/tutorial/frame.jpg',
      byKey: {
        's1-image': { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
        's2-image': { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
      },
    },
  },
  {
    id: 'run-videos',
    title: '两条链各点一次生成',
    summary: '两条链各点一次生成',
    body: practiceBody(PRACTICE_BODY_READY, '两条链各点一次生成：多镜头就是多节点。分镜节点可以一次写下多条提示词，再拆成各段视频。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', atLeast: 2 },
    gateHint: '两条链各点一次生成',
    replay: {
      simulatedMs: 13000,
      url: '/images/tutorial/clip.mp4',
      byKey: {
        's1-video': { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
        's2-video': { simulatedMs: 13000, url: '/images/tutorial/clip.mp4' },
      },
    },
  },
  {
    id: 'done',
    title: '分镜的三个要点',
    summary: '分镜的三个要点',
    body: practiceBody(PRACTICE_BODY_READY, '要点：一镜一条链、提示词互不串。分镜节点负责写多镜，生成仍是一镜一条视频。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_S1_VIDEO_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
    },
  },
]

// ---- 3.5 高阶：口播与音频（台词 + 音频轨） ----
const TALKING_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：让画面自己说话',
    summary: '让画面自己说话',
    body: practiceBody(PRACTICE_BODY_ENTER, '口播是台词、语气、景别三件套；音频节点承载旁白或配乐。'),
  },
  {
    id: 'host-image',
    title: '讲师首帧',
    summary: '讲师首帧：半身正面看镜头',
    body: practiceBody(PRACTICE_BODY_READY, '口播片的首帧就是讲师定妆图：竖版、右侧留字幕位。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1, key: 'host-image' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 'host-image',
      model: 'qwen-image-2.0',
      params: { ratio: '9:16', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_HOST_IMAGE_PROMPT,
    },
  },
  {
    id: 'run-image',
    title: '点生成，看讲师首帧回放',
    summary: '点生成，看讲师首帧回放',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '首帧 9:16、2K；口播片也吃这张图当首帧。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image', key: 'host-image' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
  },
  {
    id: 'talking-video',
    title: '换成口播：台词、语气、景别',
    summary: '换成口播：台词、语气、景别',
    body: practiceBody(PRACTICE_BODY_READY, '台词字数就是时长（中文 3.5 字/秒 + 1 秒收尾），自动落档。'),
    anchor: 'inspector-talking',
    gate: { kind: 'talking', nodeKind: 'video', key: 'talk' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'talk',
      fromKey: 'host-image',
      // 口播要模型带原生出声能力位，清单里有没有取决于运营：由宿主现场解析，解析不到就退回首帧驱动
      model: 'auto',
      videoMode: 'talking',
      params: { ratio: '9:16', resolution: '1080P' },
      prompt: PRACTICE_TALK_EXTRA,
      talking: { script: PRACTICE_TALK_SCRIPT, tone: 'natural', framing: 'medium' },
    },
  },
  {
    id: 'run-video',
    title: '点生成，看口播回放（生成按钮点不动时可跳过）',
    summary: '点生成，看口播回放',
    body: practiceBody(PRACTICE_BODY_READY, '口播要模型带原生出声；仓库这条示例视频本身没有音轨。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', key: 'talk' },
    gateHint: '听回放：这条是示例素材，视频没有音轨',
    replay: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
  },
  {
    id: 'audio-track',
    title: '再放一条音频轨',
    summary: '再放一条音频轨',
    body: practiceBody(PRACTICE_BODY_READY, '音频节点可以生成配乐或音效：选配乐、写提示词后点生成。'),
    anchor: 'inspector-audio',
    gate: { kind: 'node', nodeKind: 'audio', atLeast: 1, key: 'voice' },
    prepare: {
      kind: 'audio-setup',
      nodeKind: 'audio',
      key: 'voice',
      label: '旁白/配乐轨',
      params: { duration: 5, audioKind: 'bgm' },
      prompt: '这段旁白/配乐的用途与情绪，例如：开场 5 秒轻快旁白',
    },
  },
  {
    id: 'run-audio',
    title: '点生成，听音频回放',
    summary: '点生成，听音频回放',
    body: practiceBody(PRACTICE_BODY_READY, '这条回放真能听到声音：示例音轨落在音频节点上。'),
    anchor: 'node:audio',
    gate: { kind: 'result', nodeKind: 'audio', key: 'voice' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 4000, url: '/images/tutorial/voice.mp3' },
  },
  {
    id: 'done',
    title: '口播与音频的三个要点',
    summary: '口播与音频的三个要点',
    body: practiceBody(PRACTICE_BODY_READY, '要点：台词定时长、口播要能力位、音频节点承载旁白 / 配乐。'),
    anchor: 'node:audio',
    showcase: {
      nodeKind: 'audio',
      url: '/images/tutorial/voice.mp3',
      // 音轨没有模型：audio-setup 写 model 会「模型未定价」，成片卡同样不假装有模型
      model: '',
      prompt: '这段旁白/配乐的用途与情绪，例如：开场 5 秒轻快旁白',
      params: { duration: 5, audioKind: 'bgm' },
    },
  },
]

// ---- 3.6 高阶：一图多规格扇出（交付规格） ----
const SPEC_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：一张图出三种交付规格',
    summary: '一张图出三种交付规格',
    body: practiceBody(PRACTICE_BODY_ENTER, '规格是纯数据：同一张首帧按 9:16 / 1:1 / 16:9 各出一条片。'),
  },
  {
    id: 'cover',
    title: '商品首帧（方图起手）',
    summary: '商品首帧：方图起手',
    body: practiceBody(PRACTICE_BODY_READY, '首帧用 1:1 方图起手，三种规格都从它扇出。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1, key: 'cover' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 'cover',
      model: 'qwen-image-2.0',
      params: { ratio: '1:1', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_COVER_PROMPT,
    },
  },
  {
    id: 'run-image',
    title: '点生成，看商品首帧回放',
    summary: '点生成，看商品首帧回放',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '首帧 1:1、2K；卖点大字烧进图里，合成画幅没有 3:4。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image', key: 'cover' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
  },
  {
    id: 'spec-feed',
    title: '支线一：9:16 信息流',
    summary: '支线一：9:16 信息流',
    body: practiceBody(PRACTICE_BODY_READY, '支线一的规格写在节点参数里：9:16、5 秒、1080P。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'v-feed' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'v-feed',
      fromKey: 'cover',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { ratio: '9:16', duration: 5, resolution: '1080P' },
      prompt: PRACTICE_FEED_PROMPT,
    },
  },
  {
    id: 'spec-square',
    title: '支线二：1:1 详情页',
    summary: '支线二：1:1 详情页',
    body: practiceBody(PRACTICE_BODY_READY, '支线二换规格不换首帧：1:1、5 秒、1080P。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'v-square' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'v-square',
      fromKey: 'cover',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { ratio: '1:1', duration: 5, resolution: '1080P' },
      prompt: PRACTICE_SQUARE_PROMPT,
    },
  },
  {
    id: 'spec-wide',
    title: '支线三：16:9 主图',
    summary: '支线三：16:9 主图',
    body: practiceBody(PRACTICE_BODY_READY, '支线三 16:9：三条支线都连在同一张首帧上。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'v-wide' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'v-wide',
      fromKey: 'cover',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { ratio: '16:9', duration: 5, resolution: '1080P' },
      prompt: PRACTICE_WIDE_PROMPT,
    },
  },
  {
    id: 'run-videos',
    title: '三条支线各点一次生成',
    summary: '三条支线各点一次生成',
    body: practiceBody(PRACTICE_BODY_READY, '三条各点一次生成：先演一次失败态，再点一次就成功。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', atLeast: 3 },
    gateHint: '三条支线各点一次生成',
    replay: {
      simulatedMs: 13000,
      url: '/images/tutorial/clip.mp4',
      byKey: {
        'v-feed': { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
        'v-square': { simulatedMs: 11000, url: '/images/tutorial/clip.mp4' },
        'v-wide': { simulatedMs: 9000, url: '/images/tutorial/clip.mp4' },
      },
    },
  },
  {
    id: 'done',
    title: '多规格扇出的三个要点',
    summary: '多规格扇出的三个要点',
    body: practiceBody(PRACTICE_BODY_READY, '要点：规格是纯数据、一张首帧扇出多条、出图只有三个比例桶。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_FEED_PROMPT,
      params: { ratio: '9:16', duration: 5, resolution: '1080P' },
    },
  },
]

// ---- 3.7 高阶：镜头语言（运镜 / 特效 / 摄影） ----
const CAMERA_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：运镜怎么变成画面',
    summary: '运镜怎么变成画面',
    body: practiceBody(PRACTICE_BODY_ENTER, '运镜、特效、摄影配置都只是提示词结构，prompt 只写动作。'),
  },
  {
    id: 'shot',
    title: '一条运镜台本 → 一个视频节点',
    summary: '一条运镜台本 → 一个视频节点',
    body: practiceBody(PRACTICE_BODY_READY, '没有图片节点：台本进文本节点，运镜与特效选在视频节点上。'),
    anchor: 'inspector-cam',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'shot' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'shot',
      textUpstream: { key: 'script', content: PRACTICE_SHOT_SCRIPT },
      model: 'Kling-2.5',
      videoMode: 'reference',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_CAM_PROMPT,
      camera: { moves: ['dolly-in', 'handheld'], fx: 'film' },
    },
  },
  {
    id: 'run-video',
    title: '点生成，看运镜回放',
    summary: '点生成，看运镜回放',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '看的是运镜怎么落进画面，不是按你这句台本真生成的。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', key: 'shot' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
  },
  {
    id: 'camera-notes',
    title: '运镜的三个要点（只讲解）',
    summary: '运镜的三个要点（只讲解）',
    body: practiceBody(PRACTICE_BODY_READY, '要点：运镜是结构、特效是预设、摄影配置同样进提示词。'),
    anchor: 'node:video',
    // 纯讲解步：不产节点、不产产物、步内没有用户动作，宿主演示完把这一步写进会话 done（判据是 {demo}）
    gate: { kind: 'demo' },
    gateHint: '先在节点上选好运镜与特效，提示词里只写动作',
  },
  {
    id: 'done',
    title: '这条链就是「镜头语言」',
    summary: '这条链就是「镜头语言」',
    body: practiceBody(PRACTICE_BODY_READY, '逐帧导出见「3D 预演出片」；本课只到运镜进提示词。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_CAM_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
    },
  },
]

// ---- 3.8 高阶：3D 预演出片（导演台导出 → 看回放） ----
const PREVIEW_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：预演视频怎么出片',
    summary: '备好预演视频再出片',
    body: practiceBody(PRACTICE_BODY_ENTER, '跟练会备好预演视频节点，再点生成看回放。不进导演台拖机位。'),
  },
  {
    id: 'director',
    title: '先放一个导演台节点',
    summary: '先放一个导演台节点',
    body: practiceBody(PRACTICE_BODY_READY, '3D 场景在导演台里。跟练不进台里拖机位，下一步会备好预演视频。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'director', atLeast: 1, key: 'stage' },
    prepare: { kind: 'add-node', nodeKind: 'director', key: 'stage' },
  },
  {
    id: 'export-shot',
    title: '备好预演视频节点',
    summary: '备好预演视频节点',
    body: practiceBody(PRACTICE_BODY_READY, '跟练会备好预演视频，提示词只写运镜。真导出要退出后在导演台时间轴点。'),
    anchor: 'inspector-cam',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'preview' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'preview',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_PREVIEW_PROMPT,
      camera: { moves: ['dolly-in'] },
    },
  },
  {
    id: 'run-video',
    title: '点生成，看预演成片',
    summary: '点生成，看预演成片',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '回放是示例片，不是按这条运镜真渲的。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', key: 'preview' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
  },
  {
    id: 'done',
    title: '运镜是结构，提示词只写动作',
    summary: '运镜是结构，提示词只写动作',
    body: practiceBody(PRACTICE_BODY_READY, '跟练不走真导出。退出后在导演台时间轴点导出；点视频节点生成才计积分。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_PREVIEW_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
    },
  },
]

// ---- 3.9 高阶：多段合成（两段视频合成一条成片） ----
const COMPOSE_STEPS: PracticeStep[] = [
  {
    id: 'welcome',
    title: '跟练一遍：两段视频怎么合成',
    summary: '两段视频合成一条成片',
    body: practiceBody(PRACTICE_BODY_ENTER, '先出两段成片；跟练只练到出片，合成要退出后自己做。'),
  },
  {
    id: 'clip-a',
    title: '第一段：先出首帧',
    summary: '第一段：先出首帧',
    body: practiceBody(PRACTICE_BODY_READY, '合成吃的是已经生成好的视频节点，不是图片。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1, key: 'clip-a' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 'clip-a',
      model: 'qwen-image-2.0',
      params: { ratio: '16:9', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_S1_IMAGE_PROMPT,
    },
  },
  {
    id: 'run-image',
    title: '点生成，看第一段首帧',
    summary: '点生成，看第一段首帧',
    body: practiceBody(PRACTICE_BODY_FIRST_RUN, '先有画面再出片，合成课也从首帧起。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'image', key: 'clip-a' },
    gateHint: PRACTICE_RUN_HINT,
    replay: { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' },
  },
  {
    id: 'take-a',
    title: '第一段出片',
    summary: '第一段出片',
    body: practiceBody(PRACTICE_BODY_READY, '这段之后还会再出一段，两条都生成才能合成。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'take-a' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'take-a',
      fromKey: 'clip-a',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_S1_VIDEO_PROMPT,
    },
  },
  {
    id: 'clip-b',
    title: '第二段：另起一条首帧',
    summary: '第二段：另起一条首帧',
    body: practiceBody(PRACTICE_BODY_READY, '第二段不跟第一段串提示词，各是各的镜头。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'image', atLeast: 1, key: 'clip-b' },
    prepare: {
      kind: 'image-setup',
      nodeKind: 'image',
      key: 'clip-b',
      model: 'qwen-image-2.0',
      params: { ratio: '16:9', clarity: '2K', quality: 'std' },
      prompt: PRACTICE_S2_IMAGE_PROMPT,
    },
  },
  {
    id: 'take-b',
    title: '第二段出片',
    summary: '第二段出片',
    body: practiceBody(PRACTICE_BODY_READY, '两条视频都在画布上之后，才能选中它们去合成。'),
    anchor: 'tools',
    gate: { kind: 'node', nodeKind: 'video', atLeast: 1, key: 'take-b' },
    prepare: {
      kind: 'video-setup',
      nodeKind: 'video',
      key: 'take-b',
      fromKey: 'clip-b',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
      prompt: PRACTICE_S2_VIDEO_PROMPT,
    },
  },
  {
    id: 'run-videos',
    title: '两段各点一次生成',
    summary: '两段各点一次生成',
    body: practiceBody(PRACTICE_BODY_READY, '合成前两条都要有成片；跟练里点生成看回放，不真提交合成。'),
    anchor: 'inspector-run',
    gate: { kind: 'result', nodeKind: 'video', atLeast: 2 },
    gateHint: '两段各点一次生成',
    replay: {
      simulatedMs: 13000,
      url: '/images/tutorial/clip.mp4',
      byKey: {
        'take-a': { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
        'take-b': { simulatedMs: 13000, url: '/images/tutorial/clip.mp4' },
      },
    },
  },
  {
    id: 'done',
    title: '合成不计积分',
    summary: '合成不计积分',
    body: practiceBody(PRACTICE_BODY_READY, '跟练不打开合成。退出后选中两段打开合成，顺序即成片顺序，不计积分。'),
    anchor: 'node:video',
    showcase: {
      nodeKind: 'video',
      url: '/images/tutorial/clip.mp4',
      model: 'Kling-2.5',
      prompt: PRACTICE_S2_VIDEO_PROMPT,
      params: { duration: 5, resolution: '1080P', ratio: '16:9' },
    },
  },
]

/**
 * 跟练剧本（9 条，从易到难）。
 *
 * 数据口径：模型只写平台定价表里有的（qwen-image-2.0 / Kling-2.5，与配方库同一份约定；
 * 口播那步的模型交给宿主现场解析），回放产物是仓库自带的示例素材（public/images/tutorial），
 * 文案里如实说明"不是按你这句提示词真生成的"。多镜写在分镜节点上，生成仍是一镜一条视频。
 */
export const PRACTICE_SCRIPTS: PracticeScript[] = [
  {
    id: 'image-video-basics',
    name: '图片 + 视频节点（最小骨架）',
    hint: '入门：放节点、连线、出图、出片',
    level: 'starter',
    icon: 'i-lucide-image',
    steps: IMAGE_VIDEO_STEPS,
  },
  {
    id: 'character-consistency',
    name: '角色一致性（主体引用）',
    hint: '进阶：写角色设定、引角色主体，两次出片是同一个人',
    level: 'advanced',
    icon: 'i-lucide-user-round',
    steps: CHARACTER_STEPS,
  },
  {
    id: 'scene-continuity',
    name: '场景延续（一景两镜）',
    hint: '进阶：场景主体当参考，一张首帧扇出两个景别',
    level: 'advanced',
    icon: 'i-lucide-image-plus',
    steps: SCENE_STEPS,
  },
  {
    id: 'storyboard-shots',
    name: '多镜头分镜（一脚本两镜）',
    hint: '进阶：一个脚本拆两镜，各自一条图片 → 视频链',
    level: 'advanced',
    icon: 'i-lucide-clapperboard',
    steps: STORYBOARD_STEPS,
  },
  {
    id: 'talking-and-audio',
    name: '口播与音频（台词 + 音频轨）',
    hint: '高阶：口播台词与自动时长，独立音频节点承载旁白 / 配乐',
    level: 'expert',
    icon: 'i-lucide-mic',
    steps: TALKING_STEPS,
  },
  {
    id: 'spec-fanout',
    name: '一图多规格扇出（交付规格）',
    hint: '高阶：一张图按 9:16 / 1:1 / 16:9 出三条片',
    level: 'expert',
    icon: 'i-lucide-layout-grid',
    steps: SPEC_STEPS,
  },
  {
    id: 'camera-language',
    name: '镜头语言（运镜 / 特效 / 摄影）',
    hint: '高阶：运镜与特效怎么进提示词，prompt 只写动作',
    level: 'expert',
    icon: 'i-lucide-video',
    steps: CAMERA_STEPS,
  },
  {
    id: 'preview-export',
    name: '3D 预演出片',
    hint: '高阶：备好预演视频，再点生成看出片',
    level: 'expert',
    icon: 'i-lucide-film',
    steps: PREVIEW_STEPS,
  },
  {
    id: 'multi-clip-compose',
    name: '多段合成',
    hint: '高阶：两段出片；合成要退出后自己做',
    level: 'expert',
    icon: 'i-lucide-layers',
    steps: COMPOSE_STEPS,
  },
]

/** 剧本 id → 剧本（场景选择卡与宿主都用它） */
export function findPracticeScript(id: string) {
  return PRACTICE_SCRIPTS.find(item => item.id === id) ?? null
}
