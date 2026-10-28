/**
 * 把已经排好的预演帧排成画布图：一镜一组，组里横排帧和视频。
 * 一镜只有一帧（或首尾是同一时刻）用 i2v；首尾时刻不同用 fl2v，只连第一帧和最后一帧。
 * 中间帧仍然落成图像，不连到视频上。
 *
 * 不渲染、不上传、不提交。上传结果由调用方填进 uploads，这里只抄 url 和 assetId。
 */
import type { BatchItemRequest } from '~/types/creative'
import { buildCanvasTaskInputs } from '~/utils/canvas-task-inputs'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import type { DirectorCameraShot } from '../schema'
import { planPreviewFrames, type PreviewFramePlan, type PreviewSampling } from './preview-frames'

/** 服务端批量 layer：跟一稿多版的 matrix 分开，队列里能看出来是预演出片 */
export const PREVIEW_BATCH_LAYER = 'preview'

/** 配方库约定的默认视频模型；清单里还定价就继续用，下架了再换下一条 */
export const PREVIEW_VIDEO_MODEL_FALLBACK = 'Kling-2.5'
const IMAGE_SIZE = { width: 320, height: 240 }
const VIDEO_SIZE = { width: 360, height: 260 }
const GROUP_PAD = 28
const CHILD_GAP = 16
const GROUP_GAP = 24
const GROUP_COLOR = '#ececee'

export interface PreviewClipUpload {
  shotIndex: number
  time: number
  url: string
  assetId: number
}

export interface PreviewClipNode {
  id: string
  kind: 'image' | 'video' | 'group'
  parentId?: string
  x: number
  y: number
  width: number
  height: number
  data: Record<string, unknown>
}

export interface PreviewClipGraph {
  version: 1
  nodes: PreviewClipNode[]
  edges: { source: string, target: string, sourceHandle: string, targetHandle: string }[]
}

/**
 * 预演报价和批量提交共用这一条：优先用还在定价的约定模型，否则清单里第一条已定价视频模型。
 * 清单为空或没有视频模型时返回空串，调用方不要再发明一个模型名去提交。
 */
export function pickPreviewVideoModel(
  list: Array<{ type?: string, model?: string, priced?: boolean }> | null | undefined,
  preferred = PREVIEW_VIDEO_MODEL_FALLBACK,
) {
  const items = list || []
  const want = String(preferred || '').trim()
  const current = items.find(item => item.type === 'video' && item.model === want)
  if (current?.priced && current.model)
    return current.model
  return items.find(item => item.type === 'video' && item.priced)?.model
    || items.find(item => item.type === 'video')?.model
    || ''
}

function clampDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0)
    return 5
  return Math.min(15, Math.max(3, Math.round(seconds)))
}

function packRow(items: Array<{ width: number, height: number }>) {
  let x = GROUP_PAD
  let maxH = 0
  const positions = items.map((item) => {
    const pos = { x, y: GROUP_PAD }
    x += item.width + CHILD_GAP
    maxH = Math.max(maxH, item.height)
    return pos
  })
  return {
    positions,
    width: items.length ? x - CHILD_GAP + GROUP_PAD : GROUP_PAD * 2,
    height: maxH + GROUP_PAD * 2,
  }
}

function framesByShot(frames: PreviewFramePlan[]) {
  const grouped = new Map<number, PreviewFramePlan[]>()
  for (const frame of frames) {
    const list = grouped.get(frame.shotIndex) ?? []
    list.push(frame)
    grouped.set(frame.shotIndex, list)
  }
  return [...grouped.keys()].sort((a, b) => a - b).map(shotIndex => grouped.get(shotIndex)!)
}

export function planPreviewClipGraph(
  frames: PreviewFramePlan[],
  prompts: string[] = [],
  uploads: PreviewClipUpload[] = [],
  options?: { imagesOnly?: boolean, videoModel?: string },
): PreviewClipGraph {
  const nodes: PreviewClipNode[] = []
  const edges: PreviewClipGraph['edges'] = []
  let groupTop = 0

  framesByShot(frames).forEach((shotFrames) => {
    const shotIndex = shotFrames[0]!.shotIndex
    const groupId = `preview-s${shotIndex + 1}-group`
    const kids: PreviewClipNode[] = []
    const imageIds: string[] = []
    shotFrames.forEach((frame, index) => {
      const id = `preview-s${shotIndex + 1}-f${index + 1}`
      imageIds.push(id)
      const upload = uploads.find(item => item.shotIndex === frame.shotIndex && item.time === frame.time)
      const data: Record<string, unknown> = {
        label: frame.label.replace(/\.png$/, ''),
        prompt: '',
        previewFrame: { shotIndex: frame.shotIndex, index, time: frame.time },
        ...(options?.imagesOnly ? { previewControl: true } : {}),
      }
      if (upload) {
        data.content = upload.url
        data.assetId = upload.assetId
      }
      kids.push({
        id,
        kind: 'image',
        parentId: groupId,
        x: 0,
        y: 0,
        ...IMAGE_SIZE,
        data,
      })
    })

    if (!options?.imagesOnly) {
      const first = shotFrames[0]!
      const last = shotFrames[shotFrames.length - 1]!
      const videoId = `preview-s${shotIndex + 1}-video`
      const fl2v = shotFrames.length > 1 && first.time !== last.time
      kids.push({
        id: videoId,
        kind: 'video',
        parentId: groupId,
        x: 0,
        y: 0,
        ...VIDEO_SIZE,
        data: {
          label: `镜子${shotIndex + 1}`,
          prompt: prompts[shotIndex] ?? '',
          model: options?.videoModel ?? PREVIEW_VIDEO_MODEL_FALLBACK,
          videoMode: fl2v ? 'fl2v' : 'i2v',
          previewSubmit: 'first-last-prompt',
          params: {
            duration: clampDuration(last.time - first.time),
            resolution: '1080P',
            ratio: '16:9',
          },
        },
      })
      const linked = fl2v ? [imageIds[0]!, imageIds[imageIds.length - 1]!] : [imageIds[0]!]
      for (const source of linked) {
        edges.push({ source, target: videoId, sourceHandle: 'out', targetHandle: 'in' })
      }
    }

    const pack = packRow(kids)
    kids.forEach((kid, index) => {
      kid.x = pack.positions[index]!.x
      kid.y = pack.positions[index]!.y
    })
    nodes.push({
      id: groupId,
      kind: 'group',
      x: 0,
      y: groupTop,
      width: pack.width,
      height: pack.height,
      data: {
        kind: 'group',
        label: `镜子${shotIndex + 1}`,
        color: GROUP_COLOR,
        layout: 'row',
      },
    }, ...kids)
    groupTop += pack.height + GROUP_GAP
  })

  return { version: 1, nodes, edges }
}

/**
 * 彩色预演里每条视频的花费加总。quote 用检查器同一套单价（按秒的模型乘时长）。
 * 深度和白模没有视频节点，结果是 0。某个模型没定价时 quote 回 0，这一条不计入。
 */
export function previewClipPoints(
  graph: PreviewClipGraph,
  quote: (model: string, durationSeconds: number) => number,
): number {
  let total = 0
  for (const node of graph.nodes) {
    if (node.kind !== 'video')
      continue
    const params = node.data.params as { duration?: number } | undefined
    const duration = Number(params?.duration) || 0
    const points = quote(String(node.data.model ?? ''), duration)
    if (Number.isFinite(points) && points > 0)
      total += points
  }
  return total
}

/**
 * 彩色预演落到画布后的批量条目：输入直接带帧的 asset_id（上传已经完成），
 * 不依赖同批节点有没有落库。count 固定 1（服务端批量一次只收 1 个结果）。
 * idOf 把规划图里的局部 id 换成画布上的真实 id。
 */
export function previewShotIndexOf(data: unknown): number | null {
  if (!data || typeof data !== 'object')
    return null
  const n = Number((data as { previewFrame?: { shotIndex?: number } }).previewFrame?.shotIndex)
  return Number.isFinite(n) ? n : null
}

export function isPreviewControlData(data: unknown): boolean {
  return Boolean(data && typeof data === 'object' && (data as { previewControl?: boolean }).previewControl)
}

/** 画布上已经落下的同一镜控制图（深度 / 白模），按资产 id 去重 */
export function previewControlNodesForShot<T extends { id: string, data?: unknown }>(
  nodes: T[],
  shotIndex: number,
): T[] {
  const seen = new Set<number>()
  const out: T[] = []
  for (const node of nodes) {
    if (!isPreviewControlData(node.data) || previewShotIndexOf(node.data) !== shotIndex)
      continue
    const assetId = Number((node.data as { assetId?: number }).assetId) || 0
    if (assetId <= 0 || seen.has(assetId))
      continue
    seen.add(assetId)
    out.push(node)
  }
  return out
}

export function previewShotIndexForVideo(clip: PreviewClipGraph, videoId: string): number | null {
  const sourceId = clip.edges.find(edge => edge.target === videoId)?.source
  const source = sourceId ? clip.nodes.find(node => node.id === sourceId) : undefined
  return previewShotIndexOf(source?.data)
}

function isPreviewSubmitVideo(data: unknown): boolean {
  if (!data || typeof data !== 'object')
    return false
  const node = data as { kind?: string, previewSubmit?: string }
  return node.kind === 'video' && node.previewSubmit === 'first-last-prompt'
}

export type PreviewControlLink = { source: string, target: string, shotIndex: number, assetId: number }

/**
 * 同一镜的控制图接到预演视频上：先导出深度 / 白模再导出彩色，或反过来，都能挂上。
 * 已经有的连线不重复加。
 */
export function previewControlLinks<T extends { id: string, data?: unknown }>(
  nodes: T[],
  edges: Array<{ id?: string, source: string, target: string }>,
): PreviewControlLink[] {
  const links: PreviewControlLink[] = []
  const seen = new Set<string>()
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    if (!isPreviewSubmitVideo(node.data))
      continue
    const sourceId = edges.find(edge => edge.target === node.id)?.source
    const source = sourceId ? byId.get(sourceId) : undefined
    const shotIndex = previewShotIndexOf(source?.data)
    if (shotIndex == null)
      continue
    for (const control of previewControlNodesForShot(nodes, shotIndex)) {
      const assetId = Number((control.data as { assetId?: number }).assetId) || 0
      if (assetId <= 0)
        continue
      const key = `${control.id}->${node.id}`
      if (seen.has(key) || edges.some(edge => edge.source === control.id && edge.target === node.id))
        continue
      seen.add(key)
      links.push({ source: control.id, target: node.id, shotIndex, assetId })
    }
  }
  return links
}

export function previewBatchItems(
  clip: PreviewClipGraph,
  idOf: (id: string) => string,
  extraControls: Array<{ shotIndex: number, assetId: number }> = [],
): BatchItemRequest[] {
  const byId = new Map(clip.nodes.map(node => [node.id, node]))
  const out: BatchItemRequest[] = []
  for (const video of clip.nodes) {
    if (video.kind !== 'video')
      continue
    const model = String(video.data.model || '').trim()
    const prompt = String(video.data.prompt || '').trim()
    const mode = String(video.data.videoMode || 'i2v')
    const params = (video.data.params || {}) as { duration?: number, resolution?: string, ratio?: string }
    const linked = clip.edges
      .filter(edge => edge.target === video.id)
      .map(edge => byId.get(edge.source))
      .filter((node): node is PreviewClipNode => Boolean(node))
    const firstId = Number(linked[0]?.data.assetId) || 0
    const lastId = Number(linked[1]?.data.assetId) || Number(linked[linked.length - 1]?.data.assetId) || 0
    if (!model || !prompt || !firstId)
      continue
    const images = [{ assetId: firstId, url: '' }]
    if (mode === 'fl2v' && lastId && lastId !== firstId)
      images.push({ assetId: lastId, url: '' })
    const shotIndex = previewShotIndexForVideo(clip, video.id)
    if (shotIndex != null) {
      for (const item of extraControls) {
        if (item.shotIndex === shotIndex && item.assetId > 0)
          images.push({ assetId: item.assetId, url: '' })
      }
    }
    out.push({
      node_id: idOf(video.id),
      layer: PREVIEW_BATCH_LAYER,
      type: 'video',
      model,
      prompt,
      params: {
        count: 1,
        mode,
        ratio: String(params.ratio || '16:9'),
        resolution: String(params.resolution || '1080P'),
        duration: Number(params.duration) || 5,
        audio: true,
      },
      inputs: buildCanvasTaskInputs(
        { data: { kind: 'video', previewSubmit: 'first-last-prompt' } as CanvasNodeData },
        mode,
        images,
        [],
      ),
      depends: [],
    })
  }
  return out
}

/** 导出前报价：彩色按即将落下的视频节点加总，深度和白模是 0。不渲染、不上传。 */
export function previewExportPoints(
  camera: Pick<DirectorCameraShot, 'nodes' | 'segments'>,
  sampling: PreviewSampling,
  output: 'color' | 'depth' | 'matte',
  quote: (model: string, durationSeconds: number) => number,
  videoModel?: string,
) {
  if (output !== 'color')
    return 0
  return previewClipPoints(planPreviewClipGraph(planPreviewFrames(camera, sampling), [], [], { videoModel }), quote)
}

/** 下一批预演组的左缘：已有组在起点右侧时，接到它们右边，避免叠在同一位置。 */
export function nextPreviewLeft(
  startX: number,
  boxes: Array<{ x: number, width: number }>,
  gap = 60,
) {
  let left = startX
  for (const box of boxes) {
    if (!Number.isFinite(box.x) || !Number.isFinite(box.width) || box.width <= 0)
      continue
    if (box.x + box.width > startX)
      left = Math.max(left, box.x + box.width + gap)
  }
  return left
}
