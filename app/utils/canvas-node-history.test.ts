import { describe, expect, it } from 'vitest'
import type { NodeCandidate } from '~/types/creative'
import {
  canPickNodeCandidate,
  isCurrentNodeCandidate,
  isRejectedNodeCandidate,
  nodeCandidateDuration,
  nodeCandidatePatch,
  nodeCandidateTime,
  visibleNodeCandidates,
} from './canvas-node-history'

function cand(extra: Partial<NodeCandidate> = {}): NodeCandidate {
  return {
    task_id: 1,
    node_id: 'image-1',
    asset_id: 11,
    url: 'https://cdn.example/a.png',
    cover_url: '',
    duration: 0,
    model: 'img-1',
    prompt: '',
    created_at: 0,
    ...extra,
  }
}

describe('节点历史结果', () => {
  it('不足两条不显示入口，没有地址的坏行不算', () => {
    expect(visibleNodeCandidates(null)).toEqual([])
    expect(visibleNodeCandidates([cand()])).toEqual([])
    expect(visibleNodeCandidates([cand(), cand({ task_id: 2, url: '' })])).toEqual([])
    expect(visibleNodeCandidates([cand(), cand({ task_id: 2, asset_id: 12, url: 'https://cdn.example/b.png' })])).toHaveLength(2)
  })

  it('当前结果先比资产 id，没有资产 id 再比地址', () => {
    expect(isCurrentNodeCandidate({ assetId: 11, content: 'https://other/x.png' }, cand())).toBe(true)
    expect(isCurrentNodeCandidate({ assetId: 12, content: 'https://cdn.example/a.png' }, cand())).toBe(false)
    expect(isCurrentNodeCandidate({ content: 'https://cdn.example/a.png' }, cand())).toBe(true)
    expect(isCurrentNodeCandidate({ content: '' }, cand({ url: '' }))).toBe(false)
    expect(isCurrentNodeCandidate(null, cand())).toBe(false)
  })

  it('切回某条：改 content / assetId，任务状态指回那条成功任务', () => {
    expect(nodeCandidatePatch(cand({ task_id: 7, asset_id: 21, url: ' https://cdn.example/v.mp4 ' }))).toEqual({
      content: 'https://cdn.example/v.mp4',
      assetId: 21,
      taskId: 7,
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
    })
    expect(nodeCandidatePatch({ task_id: 0, asset_id: 0, url: 'u' })).toEqual({
      content: 'u',
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
    })
  })

  it('只读 / 锁定 / 正在生成时不能切', () => {
    expect(canPickNodeCandidate({ taskStatus: 'succeeded' })).toBe(true)
    expect(canPickNodeCandidate({ taskStatus: 'failed' })).toBe(true)
    expect(canPickNodeCandidate({ taskStatus: 'running' })).toBe(false)
    expect(canPickNodeCandidate({ taskStatus: 'pending' })).toBe(false)
    expect(canPickNodeCandidate({ taskStatus: 'succeeded' }, { readonly: true })).toBe(false)
    expect(canPickNodeCandidate({ taskStatus: 'succeeded' }, { locked: true })).toBe(false)
    expect(canPickNodeCandidate(null)).toBe(false)
  })

  it('退回标记只认 status = -1', () => {
    expect(isRejectedNodeCandidate(cand())).toBe(false)
    expect(isRejectedNodeCandidate(cand({ review: null }))).toBe(false)
    expect(isRejectedNodeCandidate(cand({ review: { status: 1 } as NodeCandidate['review'] }))).toBe(false)
    expect(isRejectedNodeCandidate(cand({ review: { status: -1 } as NodeCandidate['review'] }))).toBe(true)
  })

  it('时间与时长的显示', () => {
    const now = new Date(2026, 10, 10, 20, 0, 0)
    const today = Math.floor(new Date(2026, 10, 10, 9, 5, 0).getTime() / 1000)
    const earlier = Math.floor(new Date(2026, 9, 3, 18, 30, 0).getTime() / 1000)
    expect(nodeCandidateTime(today, now)).toBe('09:05')
    expect(nodeCandidateTime(earlier, now)).toBe('10-03 18:30')
    expect(nodeCandidateTime(0, now)).toBe('')
    expect(nodeCandidateDuration(0)).toBe('')
    expect(nodeCandidateDuration(5)).toBe('0:05')
    expect(nodeCandidateDuration(75.4)).toBe('1:15')
  })
})
