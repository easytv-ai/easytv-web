/**
 * 画布多段合成一条（选中的视频节点按阅读顺序交给 POST /user/canvas/:id/compose）。
 * 纯函数，不碰 vue-flow；顺序复用 montageOrder，时间线字段与成片工作室同一套 Timeline。
 *
 * 合成不计积分（成片向导第 4 步同口径）。单次最多 24 镜，超了要分段再拼。
 * 只把 timeline 放进这次合成请求，不调用 timelineApi.save，避免盖掉成片工作室已存的时间线。
 */

import type { Timeline, TimelineClip } from '~/types/creative'
import { montageOrder } from '~/utils/canvas-montage'
import { canvasFitMediaSize } from '~/utils/canvas-node-kinds'
import { newClipId, trimmedDuration } from '~/utils/timeline'

export const COMPOSE_MIN = 2
export const COMPOSE_MAX = 24

export const COMPOSE_ASPECTS = ['16:9', '9:16', '1:1'] as const
export type ComposeAspect = (typeof COMPOSE_ASPECTS)[number]

export const COMPOSE_RESOLUTIONS = ['720p', '1080p'] as const
export type ComposeResolution = (typeof COMPOSE_RESOLUTIONS)[number]

export type ComposeSource = {
  id: string
  assetId: number
  url: string
  label: string
  x: number
  y: number
  w: number
  h: number
  /** 节点声明的时长（秒）；没有就按 5 秒估，与 timeline.trimmedDuration 缺素材回落同口径 */
  duration: number
  /** 入点（秒）；0 或越界按片头 */
  trimIn?: number
  /** 出点（秒）；0 或非法按片尾，与成片时间线 clips.out 同口径 */
  trimOut?: number
  /** 节点 params.ratio，用来猜成片画幅 */
  ratio?: string
}

export type ComposeOptions = {
  aspect: ComposeAspect
  resolution: ComposeResolution
  subtitles: boolean
  voice: boolean
  lang: string
  bgmAssetId: number
  bgmVolume: number
  subtitleNodeId?: string
  preview: boolean
  package: boolean
}

export type ComposePick = { kind?: string, assetId?: number }

/** 阅读顺序：与合成分镜组同一套（先按行，行内从左到右） */
export function composeOrder<T extends { x: number, y: number, w: number, h: number }>(items: T[]): T[] {
  return montageOrder(items)
}

/** 能不能合成：都是带资产的视频节点，条数在 2~24 */
export function composeReady(items: ComposePick[]) {
  if (items.length < COMPOSE_MIN || items.length > COMPOSE_MAX)
    return false
  return items.every(item => item.kind === 'video' && Number(item.assetId) > 0)
}

/** 节点时长：params.duration 有正数就用，否则 0（估价时再按 5 秒回落） */
export function composeClipDuration(params?: Record<string, unknown> | null) {
  const n = Number(params?.duration)
  return n > 0 ? n : 0
}

/** 成片画幅：竖版 / 主图竖版走 9:16，方形走 1:1，其余（含 3:4 以外的横版）走 16:9 */
export function composeGuessAspect(ratio?: string): ComposeAspect {
  const value = String(ratio || '').trim()
  if (value === '9:16' || value === '3:4')
    return '9:16'
  if (value === '1:1')
    return '1:1'
  return '16:9'
}

/** 一段裁切后的秒数：与成片时间线 trimmedDuration 同一套入出点规则 */
export function composeClipSeconds(item: { duration: number, trimIn?: number, trimOut?: number }) {
  return trimmedDuration(
    { in: Number(item.trimIn) || 0, out: Number(item.trimOut) || 0 } as TimelineClip,
    item.duration,
  )
}

/** 启用片段的预计总秒数：没写时长的按 5 秒，有入出点按裁切后的长度 */
export function composeEstimateSeconds(ordered: Array<{ duration: number, trimIn?: number, trimOut?: number }>) {
  let total = 0
  for (const item of ordered)
    total += composeClipSeconds(item)
  return Math.round(total * 10) / 10
}

/** 结果节点卡片尺寸：按成片画幅估，跟上传/生成后 fit 同一套上限 */
export function composeNodeSize(aspect: ComposeAspect) {
  if (aspect === '9:16')
    return canvasFitMediaSize(1080, 1920)
  if (aspect === '1:1')
    return canvasFitMediaSize(1080, 1080)
  return canvasFitMediaSize(1920, 1080)
}

/**
 * 这次合成用的时间线快照：片段按传入顺序，入出点跟成片时间线同一套。
 * 不写 review_gate——画布点选合成不走审片门禁。
 */
export function composeTimeline(ordered: ComposeSource[], opts: ComposeOptions): Timeline {
  const bgmId = Number(opts.bgmAssetId) || 0
  return {
    aspect: opts.aspect,
    resolution: opts.resolution,
    subtitles: Boolean(opts.subtitles),
    voice: Boolean(opts.voice),
    lang: String(opts.lang || 'zh'),
    bgm_asset_id: bgmId,
    bgm_volume: bgmId ? (Number(opts.bgmVolume) || 0.2) : 0,
    clips: ordered.map((item) => {
      const start = Number(item.trimIn) || 0
      const end = Number(item.trimOut) || 0
      return {
        id: newClipId(),
        node_id: item.id,
        enabled: true,
        asset_id: item.assetId,
        in: start > 0 ? start : 0,
        out: end > 0 ? end : 0,
        voice_mode: opts.voice ? 'mix' : 'off',
        orig_volume: 1,
        voice_volume: 1,
        subtitle: null,
      }
    }),
    ...(opts.subtitleNodeId ? { subtitle_node_id: opts.subtitleNodeId } : {}),
  }
}

export type ComposeAudioSource = { id: string, assetId: number, label: string, preferred?: boolean }
export type ComposeSubtitleSource = { id: string, label: string }
