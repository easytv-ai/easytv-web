import { describe, expect, it } from 'vitest'
import {
  assetReviewState,
  batchFailureSplit,
  blockedBatchItems,
  imageReviewsOf,
  isReviewGateBlocked,
  normalizeReviewGate,
  reviewGateVerdict,
  reviewReasonLabel,
} from './create-review-gate'
import type { GenerationBatch, GenerationBatchItem, NodeCandidate, Shot, ShotReview } from '~/types/creative'

function review(assetId: number, status: 1 | -1, reason: ShotReview['reason'] = ''): ShotReview {
  return { id: assetId, user_id: 1, canvas_id: 1, node_id: 'image-1', asset_id: assetId, task_id: 0, status, reason, note: '', created_at: 0, updated_at: 0 }
}

function cand(assetId: number, r: ShotReview | null | undefined): NodeCandidate {
  return { task_id: assetId, node_id: 'image-1', asset_id: assetId, url: '', cover_url: '', duration: 0, model: 'm', prompt: '', created_at: 0, review: r }
}

function shot(candidates: NodeCandidate[], image = true): Shot {
  const media = { node_id: 'image-1', asset_id: candidates[0]?.asset_id ?? 0, url: '', cover_url: '', duration: 0, task_status: 'succeeded', candidates }
  return { no: 1, line: '', seconds: 3, video: { ...media, node_id: 'video-1', candidates: [] }, image: image ? media : null, voice: null, character_node_ids: [] }
}

function item(node_id: string, patch: Partial<GenerationBatchItem> = {}): GenerationBatchItem {
  return { id: 1, batch_id: 1, node_id, layer: '', type: 'video', model: 'm', status: 'waiting', estimate: 2, task_id: 0, asset_id: 0, attempts: 0, error: '', seq: 0, ...patch }
}

describe('create-review-gate', () => {
  it('normalizeReviewGate 只认 rejected / approved，其余当关闭', () => {
    expect(normalizeReviewGate('rejected')).toBe('rejected')
    expect(normalizeReviewGate(' Approved ')).toBe('approved')
    expect(normalizeReviewGate('')).toBe('')
    expect(normalizeReviewGate(undefined)).toBe('')
    expect(normalizeReviewGate('whatever')).toBe('')
  })

  it('reviewReasonLabel 给中文标签并走翻译，不认识的原样返回', () => {
    expect(reviewReasonLabel('lipsync')).toBe('口型')
    expect(reviewReasonLabel('identity', s => `[${s}]`)).toBe('[人物不对]')
    expect(reviewReasonLabel('unknown')).toBe('unknown')
  })

  it('imageReviewsOf 只收分镜图候选里有结论的，image 为空的镜头跳过', () => {
    const shots = [
      shot([cand(11, review(11, 1)), cand(12, null), cand(13, review(13, -1, 'composition'))]),
      shot([cand(21, review(21, 1))], false),
    ]
    const map = imageReviewsOf(shots)
    expect([...map.keys()]).toEqual([11, 13])
    expect(assetReviewState(11, map)).toBe('approved')
    expect(assetReviewState(12, map)).toBe('pending')
    expect(assetReviewState(13, map)).toBe('rejected')
    expect(assetReviewState(0, map)).toBe('pending')
    expect(imageReviewsOf(null).size).toBe(0)
  })

  it('门禁关闭或没有输入时不拦', () => {
    const reviews = imageReviewsOf([shot([cand(13, review(13, -1))])])
    expect(reviewGateVerdict('', [{ asset_id: 13, role: 'first_frame' }], reviews)).toEqual({ blocked: false })
    expect(reviewGateVerdict('approved', [], reviews)).toEqual({ blocked: false })
  })

  it('rejected：任一输入被退回就拦，待审 / 通过都放行', () => {
    const reviews = imageReviewsOf([shot([cand(11, review(11, 1)), cand(12, null), cand(13, review(13, -1))])])
    expect(reviewGateVerdict('rejected', [{ asset_id: 12, role: 'first_frame' }], reviews)).toEqual({ blocked: false })
    expect(reviewGateVerdict('rejected', [{ asset_id: 11, role: 'first_frame' }, { asset_id: 13, role: 'style' }], reviews))
      .toEqual({ blocked: true, asset_id: 13, why: 'rejected' })
  })

  it('approved：首帧图必须已通过，其它角色的素材只要没被退回就行', () => {
    const reviews = imageReviewsOf([shot([cand(11, review(11, 1)), cand(12, null), cand(13, review(13, -1))])])
    expect(reviewGateVerdict('approved', [{ asset_id: 11, role: 'first_frame' }, { asset_id: 12, role: 'style' }], reviews)).toEqual({ blocked: false })
    expect(reviewGateVerdict('approved', [{ asset_id: 12, role: 'first_frame' }], reviews)).toEqual({ blocked: true, asset_id: 12, why: 'unapproved' })
    expect(reviewGateVerdict('approved', [{ asset_id: 13, role: 'first_frame' }], reviews)).toEqual({ blocked: true, asset_id: 13, why: 'rejected' })
    // 顺序：先遇到谁先报谁，与后端一致
    expect(reviewGateVerdict('approved', [{ asset_id: 12, role: 'first_frame' }, { asset_id: 13, role: 'style' }], reviews)).toEqual({ blocked: true, asset_id: 12, why: 'unapproved' })
  })

  it('isReviewGateBlocked 只认 success=false 且 data.reason=review_gate', () => {
    expect(isReviewGateBlocked({ success: false, data: { reason: 'review_gate' } })).toBe(true)
    expect(isReviewGateBlocked({ success: false, data: { reason: 'concurrency' } })).toBe(false)
    expect(isReviewGateBlocked({ success: true, data: { reason: 'review_gate' } })).toBe(false)
    expect(isReviewGateBlocked({ success: false })).toBe(false)
    expect(isReviewGateBlocked(null)).toBe(false)
  })

  it('blockedBatchItems / batchFailureSplit 把被拦的从 failed 计数里拆出来', () => {
    const batch = {
      status: 'done',
      failed: 3,
      items: [
        item('video-1', { status: 'blocked', error: '审批门禁：分镜图（素材 12）还没通过审片' }),
        item('video-2', { status: 'failed', error: '模型报错' }),
        item('video-3', { status: 'skipped' }),
        item('video-4', { status: 'blocked' }),
      ],
    } as GenerationBatch
    expect(blockedBatchItems(batch).map(i => i.node_id)).toEqual(['video-1', 'video-4'])
    expect(batchFailureSplit(batch)).toEqual({ blocked: 2, failed: 1 })
    expect(batchFailureSplit(null)).toEqual({ blocked: 0, failed: 0 })
    // 老后端 failed 没计入 blocked 时不出现负数
    expect(batchFailureSplit({ ...batch, failed: 1 })).toEqual({ blocked: 2, failed: 0 })
  })
})
