import type { GenerationBatch, GenerationBatchItem, ReviewGate, Shot, ShotReview, ShotReviewReason, ShotMedia } from '~/types/creative'
import { candidateReviewState, type CandidateReviewState } from './timeline'

/**
 * 审批门禁（API.md 26.1，复审 G05）与图片节点审片的纯逻辑，向导第 3 步 CreateLayers 用。
 *
 * - 门禁存在时间线 `timeline.review_gate`：'' 关闭 / rejected 退回即拦 / approved 分镜图通过才放行；
 * - 图片候选的审片结论从 `GET /user/canvas/:id/shots` 的 `shots[].image.candidates[].review` 读（角色图候选不在镜头视图里，只审分镜图）；
 * - `reviewGateVerdict` 与后端 service.ReviewGateCheck 同一套规则，只用来在提交前提示（拦不拦以后端为准）。
 */

export const REVIEW_GATES: ReviewGate[] = ['', 'rejected', 'approved']

/** 非法值当关闭，与后端 NormalizeReviewGate 一致 */
export function normalizeReviewGate(value: unknown): ReviewGate {
  const v = String(value ?? '').trim().toLowerCase()
  return v === 'rejected' || v === 'approved' ? v : ''
}

export const REVIEW_REASONS: ShotReviewReason[] = ['identity', 'performance', 'lipsync', 'composition', 'continuity', 'duration', 'technical']

const REASON_LABELS: Record<ShotReviewReason, string> = {
  identity: '人物不对',
  performance: '表演',
  lipsync: '口型',
  composition: '构图',
  continuity: '连戏',
  duration: '时长',
  technical: '技术故障',
}

/** 退回原因的中文标签（与时间线一致）；tr 传 t 做翻译，不认识的原因原样返回 */
export function reviewReasonLabel(reason: string, tr: (s: string) => string = s => s): string {
  const label = REASON_LABELS[reason as ShotReviewReason]
  return label ? tr(label) : reason
}

/** 镜头视图里分镜图 / 角色图候选的审片结论：asset_id → review（待审的不收） */
export function imageReviewsOf(shots: Shot[] | null | undefined, characters?: ShotMedia[] | null): Map<number, ShotReview> {
  const out = new Map<number, ShotReview>()
  for (const shot of shots ?? []) {
    for (const cand of shot.image?.candidates ?? []) {
      if (cand.review && cand.asset_id > 0)
        out.set(cand.asset_id, cand.review)
    }
  }
  for (const media of characters ?? []) {
    for (const cand of media.candidates ?? []) {
      if (cand.review && cand.asset_id > 0)
        out.set(cand.asset_id, cand.review)
    }
  }
  return out
}

/** 某个资产的审片状态：没有结论 / 没有资产都算待审 */
export function assetReviewState(assetId: number, reviews: Map<number, ShotReview>): CandidateReviewState {
  return candidateReviewState({ review: assetId > 0 ? reviews.get(assetId) ?? null : null })
}

export type GateInput = { asset_id: number, role?: string }

export type GateVerdict
  = { blocked: false }
    | { blocked: true, asset_id: number, why: 'rejected' | 'unapproved' }

/**
 * 按门禁校验一次视频生成的输入（对应后端 service.ReviewGateCheck）：
 * - rejected / approved：任一输入素材被退回就拦；
 * - approved：首帧图（role=first_frame）还没通过也拦。
 * 门禁关闭或没有输入时不拦。
 */
export function reviewGateVerdict(gate: ReviewGate | string, inputs: GateInput[], reviews: Map<number, ShotReview>): GateVerdict {
  const g = normalizeReviewGate(gate)
  if (!g)
    return { blocked: false }
  for (const input of inputs) {
    const state = assetReviewState(input.asset_id, reviews)
    if (state === 'rejected')
      return { blocked: true, asset_id: input.asset_id, why: 'rejected' }
    if (g === 'approved' && input.role === 'first_frame' && state !== 'approved')
      return { blocked: true, asset_id: input.asset_id, why: 'unapproved' }
  }
  return { blocked: false }
}

/** 单个生成接口被门禁拦下：success=false 且 data.reason=review_gate（API.md 26.1） */
export function isReviewGateBlocked(res: { success?: boolean, data?: unknown } | null | undefined): boolean {
  if (!res || res.success)
    return false
  const data = res.data
  return !!data && typeof data === 'object' && (data as { reason?: unknown }).reason === 'review_gate'
}

/** 批次里被门禁拦下的条目（API.md 26.1）；error 是原因 */
export function blockedBatchItems(batch: GenerationBatch | null | undefined): GenerationBatchItem[] {
  return (batch?.items ?? []).filter(item => item.status === 'blocked')
}

/** 批次 failed 计数包含 blocked（后端 refreshBatchCounters），这里拆成「真失败 / 被拦」 */
export function batchFailureSplit(batch: GenerationBatch | null | undefined) {
  const blocked = blockedBatchItems(batch).length
  return { blocked, failed: Math.max(0, (batch?.failed ?? 0) - blocked) }
}
