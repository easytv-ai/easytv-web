/** 智能续写大弹窗（视频节点）：类型 / 输出规格的共享定义与提交负载 */

/** 续写类型：延长沿用源任务续写接口；片段重拍走 retake_segment 媒体作业；其余两类按视频生成（POST /user/task）提交 */
export type ExtendStudioType = 'extend' | 'reference' | 'fl2v' | 'edit' | 'retake'

export const EXTEND_STUDIO_TYPES: Array<{ id: ExtendStudioType, label: string, hint: string }> = [
  { id: 'extend', label: '视频延长', hint: '以这段视频接着往下生成' },
  { id: 'reference', label: '全能参考', hint: '以这段视频为参考生成新视频' },
  { id: 'fl2v', label: '首尾帧', hint: '用选区尾帧作首帧，再选一张图作尾帧' },
  { id: 'edit', label: '视频编辑', hint: '参考这段视频，按提示词改出新的' },
  { id: 'retake', label: '片段重拍', hint: '重选一段时间线片段，按提示词重新生成' },
]

/** 输出规格（API.md 1.4 的 params 约定） */
export const EXTEND_STUDIO_RATIOS = ['智能', '16:9', '9:16', '1:1'] as const
export const EXTEND_STUDIO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const EXTEND_STUDIO_FORMATS = ['mp4', 'mov'] as const
export const EXTEND_STUDIO_COUNTS = [1, 2, 4] as const
export const EXTEND_STUDIO_SECONDS_MAX = 30

export type ExtendStudioRef = {
  /** 素材库 id，提交时作为 inputs 的 asset_id */
  assetId: number
  kind: 'image' | 'video' | 'audio'
  url: string
  name?: string
}

export type ExtendStudioPayload = {
  type: ExtendStudioType
  model: string
  prompt: string
  /** 风格库选中的提示词片段，空串表示没选 */
  style: string
  /** 选中的运镜预设 id 列表（canvas-node-kinds 的 CAMERA_MOVE_ITEMS） */
  cameras: string[]
  /** 生成的新片段时长（秒）；延长时即续写秒数 */
  seconds: number
  ratio: string
  resolution: string
  videoFormat: 'mp4' | 'mov'
  audio: boolean
  count: number
  /** 源视频上的选区（比例 0-1），首尾帧用选区尾帧作首帧 */
  range: { start: number, end: number, duration: number }
  refs: ExtendStudioRef[]
  /** 首尾帧模式：弹窗里抽好并上传的选区尾帧（first_frame） */
  firstFrameAssetId?: number
  /** 片段重拍：时间线分成的段数（RETAKE_SEGMENT_COUNT） */
  total?: number
}
