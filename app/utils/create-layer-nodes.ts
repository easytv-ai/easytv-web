/**
 * 成片向导第 3 步（CreateLayers）四层节点的分组与排序，纯逻辑。
 *
 * 后端按策划案建画布 / 同步时给节点打 `data.sp = { layer, shot, shot_id, ... }`（API.md 24.1 / 24.8）：
 * layer 取 character / shot_image / shot_video / voice / plan。
 * - 画布上只要有一个带 `sp.layer` 的节点 → **策划案模式**：四层只收对应 sp.layer 的节点，
 *   工具条派生的拉片帧 / 分离音轨 / 重拍节点、用户手加的图等没有 sp 标记的一律不进层
 *   （否则会显示「缺少提示词」，还会被「一键生成全部」带上），只汇总成 `others` 给页面提示。
 * - 一个 sp 标记都没有的老画布 → **按 kind 推断**：image 里被视频引用为首帧的算分镜图，其余算角色图；
 *   video / audio 按 kind 归层，和以前一致。
 */

export type LayerNodeKey = 'character' | 'shot' | 'video' | 'audio'

export type LayerFlowNode = {
  id: string
  type?: string
  position: { x: number, y: number }
  data: Record<string, any>
}

export type LayerFlowEdge = { source?: unknown, target?: unknown, [key: string]: unknown }

export type LayerGroups = {
  /** 是否按 sp.layer 分层（false = 老画布按 kind 推断） */
  planMode: boolean
  character: LayerFlowNode[]
  shot: LayerFlowNode[]
  video: LayerFlowNode[]
  audio: LayerFlowNode[]
  /** 策划案模式下没有 sp 标记、不进任何层的节点数；按 kind 推断时恒为 0 */
  others: number
}

const LAYER_OF_TAG: Record<string, LayerNodeKey> = {
  character: 'character',
  shot_image: 'shot',
  shot_video: 'video',
  voice: 'audio',
}

function spOf(node: LayerFlowNode): Record<string, unknown> | null {
  const sp = node.data?.sp
  return sp && typeof sp === 'object' ? sp as Record<string, unknown> : null
}

/** 节点的 sp.layer（没有返回空串） */
export function layerTagOf(node: LayerFlowNode): string {
  const sp = spOf(node)
  return sp ? String(sp.layer ?? '') : ''
}

/** 节点的镜号 sp.shot（没有或不合法返回 0） */
export function shotNoOf(node: LayerFlowNode): number {
  const sp = spOf(node)
  const n = sp ? Number(sp.shot) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 节点的稳定镜头 id sp.shot_id（API.md 24.8），没有返回空串 */
export function shotIdOf(node: LayerFlowNode): string {
  const sp = spOf(node)
  return sp ? String(sp.shot_id ?? '') : ''
}

/** 画布上是否有任何带 sp.layer 的节点 */
export function hasPlanMarks(nodes: LayerFlowNode[]): boolean {
  return nodes.some(node => layerTagOf(node) !== '')
}

export function byPosition(a: LayerFlowNode, b: LayerFlowNode) {
  return a.position.x - b.position.x || a.position.y - b.position.y
}

/** 镜号升序；没有镜号的排在后面，按位置 */
export function byShot(a: LayerFlowNode, b: LayerFlowNode) {
  const sa = shotNoOf(a)
  const sb = shotNoOf(b)
  if (sa && sb)
    return sa - sb || byPosition(a, b)
  if (sa !== sb)
    return sa ? -1 : 1
  return byPosition(a, b)
}

/** 视频节点的首帧图片节点：优先 data.refNodeId，其次画布连线里的上游图片节点 */
export function refImageIn(nodes: LayerFlowNode[], edges: LayerFlowEdge[], video: LayerFlowNode): LayerFlowNode | null {
  const byId = (id: string) => nodes.find(node => node.id === id) ?? null
  const refId = String(video.data.refNodeId || '').trim()
  if (refId) {
    const node = byId(refId)
    if (node && node.data.kind === 'image')
      return node
  }
  for (const edge of edges) {
    if (String(edge?.target) !== video.id)
      continue
    const src = byId(String(edge?.source))
    if (src && src.data.kind === 'image')
      return src
  }
  return null
}

function groupByPlan(nodes: LayerFlowNode[]): LayerGroups {
  const groups: LayerGroups = { planMode: true, character: [], shot: [], video: [], audio: [], others: 0 }
  for (const node of nodes) {
    const tag = layerTagOf(node)
    if (!tag) {
      groups.others += 1
      continue
    }
    const key = LAYER_OF_TAG[tag]
    if (key)
      groups[key].push(node)
  }
  groups.character.sort(byPosition)
  groups.shot.sort(byShot)
  groups.video.sort(byShot)
  groups.audio.sort(byShot)
  return groups
}

function groupByKind(nodes: LayerFlowNode[], edges: LayerFlowEdge[]): LayerGroups {
  const video = nodes.filter(node => node.data.kind === 'video').sort(byPosition)
  const shot: LayerFlowNode[] = []
  for (const v of video) {
    const ref = refImageIn(nodes, edges, v)
    if (ref && !shot.includes(ref))
      shot.push(ref)
  }
  const shotIds = new Set(shot.map(node => node.id))
  const character = nodes.filter(node => node.data.kind === 'image' && !shotIds.has(node.id)).sort(byPosition)
  const audio = nodes.filter(node => node.data.kind === 'audio').sort(byPosition)
  return { planMode: false, character, shot, video, audio, others: 0 }
}

/**
 * 把画布节点分到四层。有 sp 标记按 sp.layer（镜头按 sp.shot 升序），没有按 kind 推断（按位置）。
 * 传入的 nodes 应已过滤成 data 为对象的节点。
 */
export function groupLayerNodes(nodes: LayerFlowNode[], edges: LayerFlowEdge[] = []): LayerGroups {
  return hasPlanMarks(nodes) ? groupByPlan(nodes) : groupByKind(nodes, edges)
}
