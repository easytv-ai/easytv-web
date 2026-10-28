/**
 * 导演台场景的存取。
 *
 * 场景直接存进画布节点的 data.scene 里：画布的 graph 是后端原样透传的 JSON，
 * 存在这儿等于白捡了版本历史、只读分享、做同款几件事，不用加任何后端接口。
 *
 * 代价是 graph 有 2 MB 上限（API.md 1.2），而且这个上限是**整张画布**共用的 ——
 * 一个导演台节点撑爆它，整张画布都保存不了。所以存之前必须把大块头摘掉。
 */
import type { DirectorProject } from './schema'

/** 画布 graph 的上限（API.md 1.2），留给单个导演台场景的预算要远小于它 */
export const CANVAS_GRAPH_LIMIT_BYTES = 2 * 1024 * 1024

/** 接近硬上限时先软提醒，还不拦保存 */
export const CANVAS_GRAPH_WARN_BYTES = Math.floor(CANVAS_GRAPH_LIMIT_BYTES * 0.8)

/**
 * 单个场景的软上限。
 *
 * 定在总额的八分之一：一张画布上放三五个导演台节点还得留出别的节点的位置。
 * 超了不阻止保存，只是提示 —— 真正的硬失败在后端，前端拦早一点更友好。
 */
export const SCENE_SOFT_LIMIT_BYTES = CANVAS_GRAPH_LIMIT_BYTES / 8

/**
 * 摘掉不该进存档的东西。
 *
 * - 机位截图是 base64 的 PNG，一张就几百 KB，几张下去整张画布都存不了。
 *   它们本来就是「拍完送去画布」的中转品，送出去之后画布上已经有图片节点了。
 * - assetSource 为 local 的素材是浏览器里的 blob: 地址，刷新页面就失效，
 *   存下来下次打开只会是一堆加载失败。
 */
export function sanitizeProjectForSave(project: DirectorProject): DirectorProject {
  const assets = project.assets.filter(item => item.assetSource !== 'local')
  const keptAssetIds = new Set(assets.map(item => item.id))

  return {
    ...project,
    assets,
    // 引用的素材被摘掉了，引用也要跟着断，否则下次打开会指着一个不存在的 id
    panoramaAssetId: project.panoramaAssetId && keptAssetIds.has(project.panoramaAssetId)
      ? project.panoramaAssetId
      : null,
    objects: project.objects.map((item) => {
      let next = item
      if (item.assetRefId && !keptAssetIds.has(item.assetRefId))
        next = { ...next, assetRefId: undefined }
      if (item.lookAssetId && !keptAssetIds.has(item.lookAssetId))
        next = { ...next, lookAssetId: undefined }
      return next
    }),
    cameras: project.cameras.map(camera => ({
      ...camera,
      captures: [],
      lastCaptureUrl: null,
    })),
  }
}

/** JSON 的 UTF-8 字节数（中文名字一个字三字节），跟后端 graph 上限同一口径 */
export function estimateJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/** 存档的字节数（按 UTF-8 算，中文名字一个字三字节） */
export function estimateProjectBytes(project: DirectorProject): number {
  return estimateJsonBytes(project)
}

/** 整张画布 graph 是否已经超过 API.md 1.2 的 2MB 硬上限 */
export function isGraphOverLimit(graph: unknown): boolean {
  return estimateJsonBytes(graph) > CANVAS_GRAPH_LIMIT_BYTES
}

/** 超过 80% 软预警：还能存，但该点名瘦身了 */
export function isGraphNearLimit(graph: unknown): boolean {
  const bytes = estimateJsonBytes(graph)
  return bytes > CANVAS_GRAPH_WARN_BYTES && bytes <= CANVAS_GRAPH_LIMIT_BYTES
}

export type GraphHeavyNode = { id: string, label: string, bytes: number }

/** 体积最大的几个节点，给超限提示点名 */
export function graphHeavyNodes(graph: unknown, limit = 3): GraphHeavyNode[] {
  if (!graph || typeof graph !== 'object')
    return []
  const nodes = (graph as { nodes?: unknown[] }).nodes
  if (!Array.isArray(nodes))
    return []
  return nodes
    .map((raw) => {
      const node = raw as { id?: string, data?: { label?: string } }
      return {
        id: String(node.id || ''),
        label: String(node.data?.label || node.id || ''),
        bytes: estimateJsonBytes(raw),
      }
    })
    .filter(item => item.id && item.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, Math.max(1, limit))
}

export function graphHeavyNames(graph: unknown, limit = 3): string {
  return graphHeavyNodes(graph, limit).map(item => item.label).filter(Boolean).join('、')
}

export function isProjectWithinSoftLimit(project: DirectorProject): boolean {
  return estimateProjectBytes(project) <= SCENE_SOFT_LIMIT_BYTES
}

/**
 * 存进节点前的最后一道：摘干净、量一下。
 * 超了也照样返回场景，由调用方决定是提示还是拦住。
 */
export function prepareProjectForSave(project: DirectorProject): {
  project: DirectorProject
  bytes: number
  withinLimit: boolean
} {
  const sanitized = sanitizeProjectForSave(project)
  const bytes = estimateProjectBytes(sanitized)
  return { project: sanitized, bytes, withinLimit: bytes <= SCENE_SOFT_LIMIT_BYTES }
}

/** 从节点里读回来的东西不一定是个像样的场景，挡一道 */
export function isDirectorProject(value: unknown): value is DirectorProject {
  if (!value || typeof value !== 'object')
    return false
  const candidate = value as Partial<DirectorProject>
  return Array.isArray(candidate.objects)
    && Array.isArray(candidate.cameras)
    && Array.isArray(candidate.assets)
    && typeof candidate.scene === 'object'
}
