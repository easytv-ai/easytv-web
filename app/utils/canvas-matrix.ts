/**
 * 一稿多版矩阵（平台规格 × 多语言派生）的纯逻辑：选一个已出片的节点 → 勾平台规格（9:16 / 16:9 …）
 * 与可选语种 → 得到 N 条派生版本、落图用的 workflow graph、服务端批量条目与点数估算。
 *
 * 口径（都能在仓库里对上，改之前先确认线上一致）：
 * - 平台规格的 ratio / resolution 取自 Inspector 的 RATIO_ITEMS / VIDEO_RES_ITEMS（非法值会被回落），
 *   与 `canvas-workflow-presets.ts` 的 `platform` 同形。
 * - 3:4 是**降级**规格：出图侧 `imageSizeFor`（easytv-api service/providers/easyapi.go）按方向分桶，
 *   3:4 与 9:16 同落 portrait（2K 时都是 1440x2560）；合成侧 `composeOutputSize` 只认 9:16 / 1:1，
 *   其余回落 16:9。所以这条规格在 UI 上必须注明「出图与合成都不严格 3:4，要严格 3:4 得后期裁切」。
 * - 派生节点沿用源节点的模型与提示词（多语言时用译文）；产物清空，等生成。
 * - 落图交给 `placeWorkflowGraph` + `workflowNodesToFlow`（与工作流模板 / apply_graph 同一条路径），
 *   自己不拼边：graph 里锚点（源节点 / 首帧图）用既有 id，派生节点用新 id（见 matrixPlaceGraph）。
 * - 生成走服务端批量（复用 batchApi + utils/create-batch），条目参数与 canvas 生成口径一致：
 *   图片 { count:1, ratio, quality, clarity }、视频 { count:1, mode, ratio, resolution, duration, audio }，
 *   输入经 `buildCanvasTaskInputs` 推导（与 Inspector / 工作流同一条）。
 */

import type { BatchItemRequest, TaskInput } from '~/types/creative'
import { canvasStageSize } from '~/utils/canvas-node-kinds'
import { buildCanvasTaskInputs, type CanvasRefImage } from '~/utils/canvas-task-inputs'
import { buildTalkingPrompt, normalizeTalkingData, talkingDuration, TALKING_PRESET, type TalkingData } from '~/utils/canvas-talking'
import {
  placeWorkflowGraph,
  workflowNodesToFlow,
  WORKFLOW_GRAPH_VERSION,
  type CanvasWorkflowGraph,
  type WorkflowFlowEdge,
  type WorkflowFlowNode,
  type WorkflowNode,
} from '~/utils/canvas-workflow'

/** 平台规格：一稿多版里的「一版」 */
export type MatrixPlatform = {
  id: string
  /** 中文原文即 key，渲染时过 t() */
  label: string
  /** 平台说明（中文原文即 key，渲染时过 t()） */
  hint: string
  /** 出图 / 出片比例，取自 Inspector 的 RATIO_ITEMS */
  ratio: string
  /** 视频分辨率，取自 Inspector 的 VIDEO_RES_ITEMS；图片节点不写 */
  resolution: string
  /** 视频时长（秒）；图片节点不写 */
  durationSeconds: number
  /**
   * 有值 = 这条规格在现有接口下是降级产物（界面必须原样注明，渲染时过 t()）。
   * 目前只有 3:4：出图落 portrait 桶、合成画幅回落 16:9，都不严格 3:4。
   */
  degraded?: string
}

/** 4 条规格：竖版 / 横版 / 方形 / 主图竖版（3:4，降级） */
export const MATRIX_PLATFORMS: MatrixPlatform[] = [
  {
    id: 'vertical-9x16',
    label: '竖版 9:16',
    hint: '抖音 / 视频号 / 小红书 / Reels',
    ratio: '9:16',
    resolution: '1080P',
    durationSeconds: 5,
  },
  {
    id: 'horizontal-16x9',
    label: '横版 16:9',
    hint: 'B 站 / YouTube / 店铺大屏',
    ratio: '16:9',
    resolution: '1080P',
    durationSeconds: 5,
  },
  {
    id: 'square-1x1',
    label: '方形 1:1',
    hint: '详情页 / 朋友圈 / 头像位',
    ratio: '1:1',
    resolution: '1080P',
    durationSeconds: 5,
  },
  {
    id: 'portrait-3x4',
    label: '竖版 3:4',
    hint: '淘宝 / 天猫主图',
    ratio: '3:4',
    resolution: '1080P',
    durationSeconds: 5,
    degraded: '现有接口不严格支持 3:4：出图会落成竖版同款尺寸（与 9:16 同桶），合成画幅也会回落 16:9，要严格 3:4 得后期裁切',
  },
]

/** 一次派生最多这么多版本：再多既不好认也不好一次付（超了就少勾几条规格或语种） */
export const MATRIX_VERSION_MAX = 12
/**
 * 服务端批次条目里我们自己的层标记：恢复 / 显示时只认这一批
 * （成片向导用的是 character / shot / video / voice，服务端只把它截到 20 字符，不校验）。
 */
export const MATRIX_BATCH_LAYER = 'matrix'

export function findMatrixPlatform(id: string) {
  return MATRIX_PLATFORMS.find(item => item.id === id) ?? null
}

/** 源节点视图：只取纯逻辑要用的字段（工作区传画布节点进来） */
export type MatrixSource = {
  id: string
  kind: string
  label: string
  prompt: string
  model: string
  /** 源的参数（沿用 quality / clarity / videoMode 这类，不被规格覆盖的字段） */
  params?: Record<string, unknown>
  /** 源节点 data（派生节点当副本拷，只清产物字段） */
  data?: Record<string, unknown>
  /** 产物资产（>0 才算已出片） */
  assetId?: number
  /** 产物地址（判「已出片」用） */
  content?: string
  /** 连线上游的图片节点（派生节点沿用同一批连线，与 spawnBatchSibling 同口径） */
  images?: Array<{ id: string, assetId: number }>
  /** 口播配置（data.talking）：有台词时派生版本走口播，提示词由台词拼出来 */
  talking?: Partial<TalkingData> | null
}

/**
 * 口播源：data.talking 里有台词才算（与 CanvasInspector.isTalkingMode 同判据）。
 * 台词既可能挂在外层的 talking 字段上，也可能就在节点 data 里（工作区传的是整份 data），两处都认。
 */
export function matrixTalkingOf(source: Pick<MatrixSource, 'talking' | 'data'>) {
  const raw = source.talking ?? (source.data as { talking?: Partial<TalkingData> } | undefined)?.talking
  const talking = normalizeTalkingData(raw)
  return talking.script.trim() ? talking : null
}

/** 源节点的口播台词（没有就是空串）：面板用它决定翻译的是台词还是提示词 */
export function matrixTalkingScript(source: Pick<MatrixSource, 'talking' | 'data'>) {
  return matrixTalkingOf(source)?.script || ''
}

export type MatrixEligibility = { ok: true, kind: 'image' | 'video' } | { ok: false, reason: string }

/**
 * 源节点能不能派生。reason 是中文原文（渲染时过 t()），每条都给出具体该怎么办，别只说不支持。
 * 口播节点允许只有台词、没有提示词（提示词由台词拼出来，见 matrixPlan）。
 */
export function matrixEligibility(source: Pick<MatrixSource, 'kind' | 'assetId' | 'content' | 'prompt' | 'model' | 'talking' | 'data'>): MatrixEligibility {
  if (source.kind !== 'image' && source.kind !== 'video')
    return { ok: false, reason: '一稿多版只支持图片与视频节点' }
  if (!(Number(source.assetId) > 0) || !String(source.content || '').trim())
    return { ok: false, reason: '这个节点还没出片：先生成一次，拿到产物再派生' }
  if (!String(source.prompt || '').trim() && !matrixTalkingScript(source).trim())
    return { ok: false, reason: '这个节点还没有提示词：先补上提示词再派生' }
  if (!String(source.model || '').trim())
    return { ok: false, reason: '这个节点还没选模型：在节点面板里选好模型再派生' }
  return { ok: true, kind: source.kind }
}

export type MatrixLang = { code: string, label: string }

/** 一条降级 / 回落说明：text 是中文原文 key（带槽位），显示时 t(text, params)，有值就必须显示 */
export type MatrixNote = { text: string, params?: Record<string, string | number> }

/** 一条派生版本 */
export type MatrixVersion = {
  /** graph 里的局部 id（v1、v2…），落图时换成画布上的新 id */
  localId: string
  platform: MatrixPlatform
  /** 目标语种；没选多语言时为 null */
  lang: MatrixLang | null
  /** 节点标题（已过 t()，由调用方给） */
  label: string
  /** 写进节点的提示词（多语言时是译文；口播版本由台词拼出来） */
  prompt: string
  /** 提交参数（与 canvas 生成口径一致，count 固定 1） */
  params: Record<string, unknown>
  /** 落图节点 data：已清产物、带 matrix 来源标记 */
  data: Record<string, any>
  /** 相对规格的降级 / 回落说明（3:4、时长档、分辨率），有一条就要显示 */
  notes: MatrixNote[]
}

export type MatrixPlan = {
  sourceId: string
  sourceKind: 'image' | 'video'
  batchId: string
  /** 源节点视图：提交批量时要按它取连线上游的资产（面板选的那份） */
  source: MatrixSource
  /** 落图用的 graph：锚点在前（源节点 / 首帧图，复用既有 id），派生节点在后 */
  graph: CanvasWorkflowGraph
  /** graph 里作为锚点的既有节点 id */
  anchors: { source: string, images: string[] }
  versions: MatrixVersion[]
}

/** 生成产物字段：派生节点是「配方不是成品」，一律清掉（与 utils/canvas-workflow 的 RESULT_FIELDS 一致） */
const RESULT_FIELDS = ['content', 'assetId', 'previewUrl', 'taskId', 'taskStatus', 'taskProgress', 'taskError', 'mediaJobId', 'mediaAction', 'mediaLinkedId', 'composeJobId', 'gridSplit', 'transcriptCues', 'matrix'] as const

function clearedSourceData(data: Record<string, unknown> | undefined) {
  const next: Record<string, any> = { ...(data || {}) }
  for (const key of RESULT_FIELDS)
    delete next[key]
  return next
}

/**
 * 时长档：规格里的秒数落在目标模型声明的档位上（与成片向导 CreateLayers.pickDuration 同规则：
 * 取第一个 ≥ 需求的档，都没有就用最后一档）。模型没声明档位时原样用规格值。
 * 回落时给出的 degraded 是中文原文 key（带 {wanted} / {hit} 槽位），由界面过 t() + degradedParams 渲染。
 */
export function matrixDuration(seconds: number, durations?: number[]) {
  const wanted = Math.max(1, Math.round(Number(seconds) || 0))
  const list = (durations || []).map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  if (!list.length)
    return { seconds: wanted, degraded: '', degradedParams: {} as Record<string, number> }
  const hit = list.find(n => n >= wanted) ?? list[list.length - 1]!
  if (hit === wanted)
    return { seconds: hit, degraded: '', degradedParams: {} as Record<string, number> }
  return hit > wanted
    ? { seconds: hit, degraded: '这个视频模型没有 {wanted} 秒档，已按最近的一档 {hit} 秒提交', degradedParams: { wanted, hit } }
    : { seconds: hit, degraded: '这个视频模型最长 {hit} 秒，已按最长档提交', degradedParams: { hit } }
}

/**
 * 分辨率：落在目标模型声明的档位上（与 Inspector.videoResItems 同规则：声明了就用第一档，
 * 与成片向导 CreateLayers.videoResolution 同口径）。模型没声明档位时按规格值提交。
 * 回落时给出中文原文 key + 参数，由界面过 t()——别把模型不认的分辨率原样发给网关。
 */
export function matrixResolution(wanted: string, resolutions?: string[]) {
  const want = String(wanted || '').trim()
  const list = (resolutions || []).map(item => String(item || '').trim()).filter(Boolean)
  if (!list.length || !want || list.includes(want))
    return { resolution: want, note: null as MatrixNote | null }
  const got = list[0]!
  return {
    resolution: got,
    note: { text: '这个视频模型不支持 {want}，已按它声明的 {got} 提交', params: { want, got } } as MatrixNote,
  }
}

/** 图片参数：规格给 ratio，其余沿用源节点的档位（没写就用 Inspector 的默认档） */
function imageParams(source: MatrixSource, platform: MatrixPlatform) {
  const base = source.params || {}
  return {
    count: 1,
    ratio: platform.ratio,
    quality: typeof base.quality === 'string' ? base.quality : 'std',
    clarity: typeof base.clarity === 'string' ? base.clarity : '2K',
  }
}

/**
 * 视频参数：与 Inspector.generatePayload 同形（口播分支对齐 CanvasInspector.vue:645-663）。
 * - 口播节点（data.talking 有台词）：mode 映射成 i2v / reference（正常提交从不让 mode='talking'），
 *   audio 强制 true，带 preset='talking'，提示词由台词拼出来（见 matrixPlan）；
 * - 其余沿用源节点的 videoMode（没写按 i2v）。
 */
function videoParams(
  source: MatrixSource,
  platform: MatrixPlatform,
  opts: { seconds: number, resolution: string, hasFrame: boolean, talking: boolean },
) {
  const base = source.params || {}
  const mode = opts.talking
    ? (opts.hasFrame ? 'i2v' : 'reference')
    : (typeof source.data?.videoMode === 'string' ? String(source.data.videoMode) : (typeof base.mode === 'string' ? base.mode : 'i2v'))
  return {
    count: 1,
    mode,
    ratio: platform.ratio,
    resolution: opts.resolution,
    duration: opts.seconds,
    audio: opts.talking ? true : (typeof base.audio === 'boolean' ? base.audio : true),
    ...(opts.talking ? { preset: TALKING_PRESET } : {}),
  }
}

/** 派生节点的展示标题：源节点名 · 规格（· 语种） */
export function matrixLabel(sourceLabel: string, platform: MatrixPlatform, lang: MatrixLang | null) {
  const base = String(sourceLabel || '').trim() || '版本'
  return [base, platform.label, lang?.label].filter(Boolean).join(' · ')
}

export type MatrixPlanInput = {
  source: MatrixSource
  platforms: MatrixPlatform[]
  langs: MatrixLang[]
  /** 语种 code → 已翻译好的提示词（'' 是原语种）；缺的回落源提示词 */
  prompts?: Record<string, string>
  /** 语种 code → 已翻译好的口播台词（口播源用；缺的回落源台词） */
  talkingScripts?: Record<string, string>
  /** 视频源：目标模型声明的时长档（空 = 不限） */
  durations?: number[]
  /** 视频源：目标模型声明的分辨率档（空 = 不限） */
  resolutions?: string[]
  /** 一次派生的批次号：同一批落图的节点共享，回滚 / 分组按它认 */
  batchId: string
  /** 节点标题：默认 matrixLabel，调用方要给本地化文案时传自己的实现（纯逻辑里不调 t()） */
  labelOf?: (platform: MatrixPlatform, lang: MatrixLang | null) => string
}

/**
 * 组合出 N 条版本 + 落图 graph。规格为行、语种为列（没选语种就是一列）。
 * 单语派生（langs 为空）= 只按平台规格派生，提示词原样沿用。
 * 口播源：提示词由台词经 buildTalkingPrompt 拼出来（多语言时用台词译文），带 preset='talking'、
 * 时长按台词自动算——直接把 videoMode='talking' 当 mode 提交会落到参考图分支，白跑一次（见 canvas-practice 的注释）。
 */
export function matrixPlan(input: MatrixPlanInput): MatrixPlan {
  const { source, batchId } = input
  const sourceKind = (source.kind === 'video' ? 'video' : 'image') as 'image' | 'video'
  const images = (source.images || []).filter(item => Number(item.assetId) > 0)
  const hasFrame = images.length > 0
  const langs: Array<MatrixLang | null> = input.langs.length ? input.langs : [null]
  const stage = canvasStageSize(sourceKind) || { w: 320, h: 220 }
  const gapX = 40
  const gapY = 32
  const originX = (canvasStageSize(sourceKind)?.w || 320) + 96
  const cols = langs.length
  const prompts = input.prompts || {}
  const talkingScripts = input.talkingScripts || {}
  const talking = sourceKind === 'video' ? matrixTalkingOf(source) : null

  const versions: MatrixVersion[] = []
  let index = 0
  for (const platform of input.platforms) {
    for (const lang of langs) {
      index += 1
      // 口播：时长按台词自动算（手动档在模型档位里才生效，与 Inspector 同规则）；其余按规格的时长档
      const wantedSeconds = talking
        ? (talking.duration && (!input.durations?.length || input.durations.includes(talking.duration))
            ? talking.duration
            : talkingDuration(talking.script, input.durations ?? null))
        : platform.durationSeconds
      const duration = sourceKind === 'video'
        ? matrixDuration(wantedSeconds, input.durations)
        : { seconds: 0, degraded: '', degradedParams: {} as Record<string, number> }
      const resolution = sourceKind === 'video'
        ? matrixResolution(platform.resolution, input.resolutions)
        : { resolution: '', note: null as MatrixNote | null }
      const extra = String(source.prompt || '').trim()
      const prompt = talking
        ? buildTalkingPrompt({
            script: String(talkingScripts[lang?.code ?? ''] ?? '').trim() || talking.script,
            tone: talking.tone,
            framing: talking.framing,
            extra,
          })
        : (String(prompts[lang?.code ?? ''] ?? source.prompt ?? '').trim() || source.prompt)
      const params = sourceKind === 'video'
        ? videoParams(source, platform, { seconds: duration.seconds, resolution: resolution.resolution, hasFrame, talking: Boolean(talking) })
        : imageParams(source, platform)
      const notes: MatrixNote[] = []
      if (platform.degraded)
        notes.push({ text: platform.degraded })
      if (duration.degraded)
        notes.push({ text: duration.degraded, params: duration.degradedParams })
      if (resolution.note)
        notes.push(resolution.note)
      const label = (input.labelOf ?? ((item: MatrixPlatform, target: MatrixLang | null) => matrixLabel(source.label, item, target)))(platform, lang)
      const data: Record<string, any> = {
        ...clearedSourceData(source.data),
        kind: sourceKind,
        label,
        prompt,
        model: source.model,
        params,
        mode: 'idle',
        // content 交给 workflowNodesToFlow 兜底成 ''：派生节点是配方不是成品，别带产物字段
        matrix: {
          batchId,
          sourceId: source.id,
          sourceLabel: source.label,
          platformId: platform.id,
          ratio: platform.ratio,
          resolution: resolution.resolution,
          durationSeconds: duration.seconds,
          ...(lang ? { lang: lang.code } : {}),
        },
      }
      versions.push({
        localId: `v${index}`,
        platform,
        lang,
        label,
        prompt,
        params,
        data,
        notes,
      })
    }
  }

  return {
    sourceId: source.id,
    sourceKind,
    batchId,
    source,
    anchors: { source: source.id, images: images.map(item => item.id) },
    versions,
    graph: matrixGraph(source, versions, stage, originX, gapX, gapY, cols),
  }
}

/** 落图 graph：源节点与连线上游的图片当锚点（复用既有 id），派生节点排成「规格 × 语种」的网格 */
function matrixGraph(
  source: MatrixSource,
  versions: MatrixVersion[],
  stage: { w: number, h: number },
  originX: number,
  gapX: number,
  gapY: number,
  cols: number,
): CanvasWorkflowGraph {
  const srcNode: WorkflowNode = {
    id: 'src',
    kind: source.kind,
    x: 0,
    y: 0,
    width: stage.w,
    height: stage.h,
    data: { label: source.label },
  }
  const anchorNodes: WorkflowNode[] = (source.images || []).map((item, i) => ({
    id: `img${i + 1}`,
    kind: 'image',
    x: 0,
    y: stage.h + gapY * (i + 1),
    width: stage.w,
    height: stage.h,
    data: { label: item.id },
  }))
  const nodes: WorkflowNode[] = [
    srcNode,
    ...anchorNodes,
    ...versions.map((version, i) => ({
      id: version.localId,
      kind: version.data.kind as string,
      x: originX + (i % cols) * (stage.w + gapX),
      y: Math.floor(i / cols) * (stage.h + gapY),
      width: stage.w,
      height: stage.h,
      data: version.data,
    })),
  ]
  const edges: Array<{ source: string, target: string, sourceHandle: string, targetHandle: string }> = []
  // 图片源：源图当参考图（role=image，与 preset ecom-three-specs 的扇出同口径）
  // 视频源：沿用源节点的图片上游当首帧 / 参考（与 useCanvasGenerate.spawnBatchSibling 同口径）
  const from = source.kind === 'image'
    ? ['src']
    : (source.images || []).map((_, i) => `img${i + 1}`)
  for (const version of versions) {
    for (const anchor of from)
      edges.push({ source: anchor, target: version.localId, sourceHandle: 'out', targetHandle: 'in' })
  }
  return { version: WORKFLOW_GRAPH_VERSION, nodes, edges }
}

/** 落图结果：派生节点的 bool 视图（锚点不落图，只在 idMap 里） */
export type MatrixPlaced = {
  /** 要 addNodes 的新节点（只含派生节点） */
  nodes: WorkflowFlowNode[]
  /** 要 addEdges 的连线 */
  edges: WorkflowFlowEdge[]
  /** 局部 id → 画布 id（锚点是既有 id，派生是新 id） */
  ids: Map<string, string>
  /** 派生节点的画布 id（与 plan.versions 同序） */
  derived: string[]
}

/**
 * 把 plan.graph 落到画布坐标系：锚点复用既有 id（落图时跳过，别把源节点复制一份），
 * 派生节点用 newId 取新 id。走 placeWorkflowGraph + workflowNodesToFlow（与工作流模板同一条路径），
 * 自己不拼边——id 重排与连线两端都由它们处理。
 */
export function matrixPlaceGraph(
  plan: MatrixPlan,
  origin: { x: number, y: number },
  newId: (kind: string) => string,
): MatrixPlaced {
  const local: string[] = plan.graph.nodes.map(node => node.id)
  let cursor = 0
  const placed = placeWorkflowGraph(plan.graph, origin, kind => {
    const id = local[cursor]
    cursor += 1
    if (id === 'src')
      return plan.anchors.source
    if (id && id.startsWith('img'))
      return plan.anchors.images[Number(id.slice(3)) - 1] || newId(kind)
    return newId(kind)
  })
  const ids = placed.idMap
  const derived = plan.versions.map(version => ids.get(version.localId) || '')
  const keep = new Set(derived)
  const flow = workflowNodesToFlow(
    placed.nodes.filter(node => keep.has(node.id)),
    placed.edges.filter(edge => keep.has(edge.target) && (keep.has(edge.source) || plan.anchors.images.includes(edge.source) || edge.source === plan.anchors.source)),
  )
  return { nodes: flow.nodes, edges: flow.edges, ids, derived }
}

/** 节点的输入素材：连线上的图片 + 节点自带的参考素材（与 Inspector / 工作流同一条 buildCanvasTaskInputs） */
function matrixInputs(version: MatrixVersion, images: Array<{ assetId: number }>): TaskInput[] {
  const data = version.data as { kind: string, refItems?: Array<{ assetId?: number, url?: string }> }
  const refs: CanvasRefImage[] = images.filter(item => item.assetId > 0).map(item => ({ assetId: item.assetId, url: '' }))
  const extra: Array<{ assetId?: number, url: string, kind: 'image' | 'video' | 'audio' }> = []
  for (const item of data.refItems || []) {
    const url = String(item.url || '')
    if (!url)
      continue
    const kind = /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : /\.(mp3|wav|m4a|aac)(\?|$)/i.test(url) ? 'audio' : 'image'
    if (kind === 'image')
      refs.push({ assetId: item.assetId, url })
    else
      extra.push({ assetId: item.assetId, url, kind })
  }
  return buildCanvasTaskInputs({ data: data as never }, String(version.params.mode || ''), refs, extra)
}

export type MatrixPoints = {
  total: number
  byVersion: number[]
}

/**
 * 点数估算：逐条按调用方的 estimate（画布用 estimateSpend，与 Inspector 同口径：图片按张、视频按秒）。
 * 定价清单没加载时 estimate 返回 0——那不是「免费」，调用方要用 `matrixUnpriced` 判一下再显示。
 */
export function matrixPoints(plan: MatrixPlan, estimate: (model: string, params: Record<string, unknown>) => number): MatrixPoints {
  const byVersion = plan.versions.map(version => Math.max(0, Math.round(estimate(String(version.data.model || ''), version.params)) || 0))
  return { total: byVersion.reduce((sum, n) => sum + n, 0), byVersion }
}

/**
 * 服务端批量条目（API.md 13）：与 create 向导的 BatchItemRequest 同形。
 * - 生成的 node_id 用落图后的新 id（matrixPlaceGraph 的 derived）；
 * - 输入直接带 asset_id（源图 / 首帧图 + 节点的静态参考），不依赖画布上有没有落库同批节点；
 * - count 固定 1（服务端批量一次只收 1 个结果，多了直接 400）。
 */
export function matrixBatchItems(plan: MatrixPlan, derived: string[]): BatchItemRequest[] {
  // 图片源拿源图当参考（role=image）；视频源沿用原节点的图片上游（首帧 / 全能参考），与 Inspector 同一条口径
  const images = plan.sourceKind === 'image'
    ? (Number(plan.source.assetId) > 0 ? [{ assetId: Number(plan.source.assetId), url: '' }] : [])
    : (plan.source.images || []).filter(item => Number(item.assetId) > 0)
  return plan.versions.map((version, i) => ({
    node_id: derived[i] || version.localId,
    layer: MATRIX_BATCH_LAYER,
    type: plan.sourceKind,
    model: String(version.data.model || ''),
    prompt: version.prompt,
    params: version.params,
    inputs: matrixInputs(version, images),
    depends: [],
  }))
}

/** 画布上带这个批次标记的节点 id（回滚 / 分组用） */
export function matrixNodeIds(nodes: Array<{ id: string, data?: Record<string, any> }>, batchId: string) {
  return nodes.filter(node => node.data?.matrix?.batchId === batchId).map(node => node.id)
}

/** 同一源再派生一轮时，整组往右错开，避免叠在上一轮上面 */
export const MATRIX_PLACE_SHIFT = 420

export function matrixNextOrigin(
  origin: { x: number, y: number },
  nodes: Array<{ data?: { matrix?: { batchId?: string } } }>,
) {
  const batches = new Set(
    nodes.map(node => String(node.data?.matrix?.batchId || '')).filter(Boolean),
  )
  return { x: origin.x + batches.size * MATRIX_PLACE_SHIFT, y: origin.y }
}

/** 版本预览行（面板显示用）：实际提交的比例 · 分辨率 · 时长 · 语种（回落后的值，与条目一致） */
export function matrixVersionSpec(version: MatrixVersion, sourceKind: 'image' | 'video') {
  const parts = [String(version.params.ratio || version.platform.ratio)]
  if (sourceKind === 'video')
    parts.push(String(version.params.resolution || ''), `${Number(version.params.duration) || 0}s`)
  if (version.lang)
    parts.push(version.lang.label)
  return parts.filter(Boolean).join(' · ')
}

/** 平台勾选行：图片源只写比例，视频源才带分辨率和秒数 */
export function matrixPlatformSpec(platform: MatrixPlatform, sourceKind: 'image' | 'video' | string) {
  if (sourceKind === 'video')
    return `${platform.ratio} · ${platform.resolution} · ${platform.durationSeconds}s`
  return platform.ratio
}

/** 语种 code 收成可比较的键：zh / zh-CN / zh-Hans 都当中文，zh-TW 另算 */
export function matrixLangKey(code: string) {
  const raw = String(code || '').trim().toLowerCase().replace('_', '-')
  if (!raw)
    return ''
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-hans')
    return 'zh'
  if (raw === 'zh-tw' || raw === 'zh-hant')
    return 'zh-tw'
  return raw.split('-')[0] || raw
}

export function matrixSameLang(a: string, b: string) {
  const left = matrixLangKey(a)
  const right = matrixLangKey(b)
  return Boolean(left && right && left === right)
}

export type MatrixNodeLike = { id: string, data?: Record<string, any>, parentNode?: string }

function matrixMarkerOf(node: MatrixNodeLike) {
  const marker = node.data?.matrix
  if (!marker || typeof marker !== 'object')
    return null
  const batchId = String((marker as { batchId?: unknown }).batchId || '').trim()
  if (!batchId)
    return null
  return marker as { batchId: string, sourceId?: string, sourceLabel?: string, platformId?: string, lang?: string }
}

function nodeHasTask(node: MatrixNodeLike) {
  return Number(node.data?.taskId) > 0
}

/**
 * 画布上「只落了节点、还没提交批次」的最近一次派生：这一批所有节点都还没挂 taskId。
 * 刷新后没有服务端批次可接时，用它把 plan 还原出来好重试提交。
 */
export function matrixLatestUnsubmitted(nodes: MatrixNodeLike[]) {
  const groups = new Map<string, MatrixNodeLike[]>()
  for (const node of nodes) {
    const marker = matrixMarkerOf(node)
    if (!marker)
      continue
    const list = groups.get(marker.batchId) || []
    list.push(node)
    groups.set(marker.batchId, list)
  }
  const pending = [...groups.entries()]
    .filter(([, list]) => list.length && list.every(node => !nodeHasTask(node)))
    .sort((a, b) => a[0].localeCompare(b[0]))
  const last = pending[pending.length - 1]
  if (!last)
    return null
  const marker = matrixMarkerOf(last[1][0]!)
  return {
    batchId: last[0],
    sourceId: String(marker?.sourceId || ''),
    sourceLabel: String(marker?.sourceLabel || ''),
    nodes: sortDerivedNodes(last[1]),
  }
}

function sortDerivedNodes(nodes: MatrixNodeLike[]) {
  const order = new Map(MATRIX_PLATFORMS.map((item, index) => [item.id, index]))
  return [...nodes].sort((a, b) => {
    const left = matrixMarkerOf(a)
    const right = matrixMarkerOf(b)
    const pa = order.get(String(left?.platformId || '')) ?? 99
    const pb = order.get(String(right?.platformId || '')) ?? 99
    if (pa !== pb)
      return pa - pb
    return String(left?.lang || '').localeCompare(String(right?.lang || ''))
  })
}

/**
 * 从已落图的派生节点还原 plan（只够重试提交：matrixBatchItems 要用 source + versions）。
 * 规格 / 语种 / 提示词都从节点自己的 data 读，不依赖内存里的 last plan。
 */
export function matrixPlanFromDerived(
  source: MatrixSource,
  derived: MatrixNodeLike[],
  batchId: string,
  langLabelOf?: (code: string) => string,
): MatrixPlan | null {
  const sourceKind = (source.kind === 'video' ? 'video' : 'image') as 'image' | 'video'
  const versions: MatrixVersion[] = []
  let index = 0
  for (const node of sortDerivedNodes(derived)) {
    const marker = matrixMarkerOf(node)
    if (!marker || marker.batchId !== batchId)
      continue
    const platform = findMatrixPlatform(String(marker.platformId || '')) || MATRIX_PLATFORMS[0]
    if (!platform)
      continue
    index += 1
    const code = String(marker.lang || '').trim()
    const lang = code ? { code, label: langLabelOf?.(code) || code } : null
    const params = (node.data?.params && typeof node.data.params === 'object')
      ? { ...node.data.params as Record<string, unknown> }
      : {}
    const data = { ...(node.data || {}) }
    versions.push({
      localId: `v${index}`,
      platform,
      lang,
      label: String(node.data?.label || node.id),
      prompt: String(node.data?.prompt || source.prompt || ''),
      params,
      data,
      notes: [],
    })
  }
  if (!versions.length)
    return null
  const images = (source.images || []).filter(item => Number(item.assetId) > 0)
  return {
    sourceId: source.id,
    sourceKind,
    batchId,
    source,
    anchors: { source: source.id, images: images.map(item => item.id) },
    versions,
    graph: matrixGraph(source, versions, canvasStageSize(sourceKind) || { w: 320, h: 220 }, 416, 40, 32, Math.max(1, versions.filter(item => item.lang).length || 1)),
  }
}
