import { describe, expect, it } from 'vitest'
import { candidateReviewState, clipDurationWithVoice, clipUsesRejected, duplicateClip, ensureClipIds, estimateTimeline, estimateTotal, moveClip, selectableCandidates, timelineSaveOutcome, trimmedDuration, unusableClips, subtitleSourceNodes } from './timeline'
import type { NodeCandidate, Shot, ShotReview, Timeline, TimelineClip } from '~/types/creative'

function clip(node_id: string, patch: Partial<TimelineClip> = {}): TimelineClip {
  return { id: `c_${node_id}`, node_id, enabled: true, asset_id: 0, in: 0, out: 0, voice_mode: 'mix', orig_volume: 1, voice_volume: 1, subtitle: null, ...patch }
}

function shot(nodeId: string, assetId: number, duration: number, candidates: Array<[number, number]> = [], voiceDuration = 0): Shot {
  const media = { node_id: nodeId, asset_id: assetId, url: '', cover_url: '', duration, task_status: 'succeeded', candidates: candidates.map(([id, d]) => ({ task_id: id, node_id: nodeId, asset_id: id, url: '', cover_url: '', duration: d, model: 'm', prompt: '', created_at: 0 })) }
  const voice = voiceDuration > 0 ? { node_id: `${nodeId}-voice`, asset_id: 900, url: '', cover_url: '', duration: voiceDuration, task_status: 'succeeded', candidates: [] } : null
  return { no: 1, line: '', seconds: 5, video: media, image: null, voice, character_node_ids: [] }
}

function base(clips: TimelineClip[]): Timeline {
  return { aspect: '16:9', resolution: '720p', subtitles: true, voice: true, lang: 'zh', bgm_asset_id: 0, bgm_volume: 0.2, clips }
}

function review(status: 1 | -1, reason: ShotReview['reason'] = ''): ShotReview {
  return { id: 1, user_id: 1, canvas_id: 1, node_id: 'v', asset_id: 1, task_id: 0, status, reason, note: '', created_at: 0, updated_at: 0 }
}

function cand(assetId: number, r?: ShotReview | null): NodeCandidate {
  return { task_id: assetId, node_id: 'v', asset_id: assetId, url: '', cover_url: '', duration: 4, model: 'm', prompt: '', created_at: assetId, review: r }
}

describe('timeline utils', () => {
  it('trimmedDuration 与后端 trimRange 一致', () => {
    expect(trimmedDuration(clip('v', { in: 1, out: 3 }), 4)).toBe(2)
    expect(trimmedDuration(clip('v', { in: 5 }), 4)).toBe(4)
    expect(trimmedDuration(clip('v', { in: 1, out: 1.2 }), 4)).toBe(3)
  })

  it('estimateTotal 只算启用的镜头，换候选用候选时长', () => {
    const shots = [shot('video-1', 11, 4, [[13, 8]]), shot('video-2', 12, 3)]
    const tl: Timeline = { aspect: '16:9', resolution: '720p', subtitles: true, voice: true, lang: 'zh', bgm_asset_id: 0, bgm_volume: 0.2,
      clips: [clip('video-1', { asset_id: 13, in: 1 }), clip('video-2', { enabled: false })] }
    expect(estimateTotal(tl, shots)).toBe(7)
  })

  it('moveClip 越界不动', () => {
    const list = [clip('a'), clip('b'), clip('c')]
    expect(moveClip(list, 0, 2).map(c => c.node_id)).toEqual(['b', 'c', 'a'])
    expect(moveClip(list, 0, 5).map(c => c.node_id)).toEqual(['a', 'b', 'c'])
  })

  it('unusableClips 找出没有视频的启用镜头', () => {
    const shots = [shot('video-1', 11, 4), shot('video-2', 0, 0)]
    const tl: Timeline = { aspect: '16:9', resolution: '720p', subtitles: true, voice: true, lang: 'zh', bgm_asset_id: 0, bgm_volume: 0.2,
      clips: [clip('video-1'), clip('video-2'), clip('video-3', { enabled: false })] }
    expect(unusableClips(tl, shots).map(c => c.node_id)).toEqual(['video-2'])
  })

  // 复审 D04：同一素材可以作为两个剪辑片段出现
  it('duplicateClip 同一 node 再插一条，id 独立、入出点可各自改', () => {
    const list = [clip('video-1', { in: 0, out: 1 }), clip('video-2')]
    const next = duplicateClip(list, 0)
    expect(next.map(c => c.node_id)).toEqual(['video-1', 'video-1', 'video-2'])
    expect(next[1]!.id).not.toBe(next[0]!.id)
    expect(next[1]!.id).toMatch(/^c_[a-z0-9]{8}$/)
    expect(next[1]!.in).toBe(0)
    next[1] = { ...next[1]!, in: 2, out: 3 }
    expect(next[0]!.in).toBe(0)
    expect(duplicateClip(list, 5)).toHaveLength(2)
    // A / B / A 三条各自算时长
    const shots = [shot('video-1', 11, 4), shot('video-2', 12, 3)]
    const tl: Timeline = { aspect: '16:9', resolution: '720p', subtitles: true, voice: true, lang: 'zh', bgm_asset_id: 0, bgm_volume: 0.2, clips: next }
    expect(estimateTotal(tl, shots)).toBe(1 + 1 + 3)
  })

  it('ensureClipIds 补齐缺失与重复的 id', () => {
    const list = [clip('a', { id: '' }), clip('b', { id: 'c_same' }), clip('c', { id: 'c_same' })]
    const next = ensureClipIds(list)
    expect(next[0]!.id).toMatch(/^c_/)
    expect(next[1]!.id).toBe('c_same')
    expect(next[2]!.id).not.toBe('c_same')
    expect(next[1]).toBe(list[1])
  })

  // 复审 D05 / 24.4：冲突与普通失败分开处理；25.6 定版锁单独一类
  it('timelineSaveOutcome 区分成功 / 冲突 / 定版 / 其它失败', () => {
    expect(timelineSaveOutcome({ success: true })).toBe('ok')
    expect(timelineSaveOutcome({ success: false, message: '时间线已在其他地方修改，请刷新后再保存' })).toBe('conflict')
    expect(timelineSaveOutcome({ success: false, message: '时间线已定版，先解锁再修改' })).toBe('locked')
    expect(timelineSaveOutcome({ success: false, message: '保存失败' })).toBe('error')
    expect(timelineSaveOutcome(null)).toBe('error')
  })

  // API.md 25.4：与后端 clipDurationWithVoice 一致
  it('clipDurationWithVoice 配音更长才延长，最多 10 秒', () => {
    expect(clipDurationWithVoice(5, 0)).toBe(5)
    expect(clipDurationWithVoice(5, 4.55)).toBe(5)
    expect(clipDurationWithVoice(5, 4.56)).toBeCloseTo(5.01)
    expect(clipDurationWithVoice(5, 7)).toBeCloseTo(7.45)
    expect(clipDurationWithVoice(5, 30)).toBe(15)
  })

  it('estimateTimeline 按入出点 + 配音延长，voice_mode=off 不延长，没视频回落策划秒数', () => {
    const shots = [
      shot('video-1', 11, 4, [[13, 8]], 6), // 配音 6 秒：需要 6.45
      shot('video-2', 12, 3, [], 20), // 配音 20 秒：最多延长到 13
      shot('video-3', 0, 0), // 没有视频：按策划秒数 5 估（与后端 seconds 回落一致）
      { ...shot('video-4', 0, 0), seconds: 0 }, // 连策划秒数都没有：按 0
    ]
    const tl = base([
      clip('video-1', { asset_id: 13, in: 1, out: 5 }), // 段长 4 → 6.45（+2.45）
      clip('video-2'), // 3 → 13（+10）
      clip('video-2', { id: 'c_off', voice_mode: 'off' }), // 不延长
      clip('video-3'),
      clip('video-4'),
      clip('video-1', { id: 'c_disabled', enabled: false }),
    ])
    const est = estimateTimeline(tl, shots)
    expect(est.clips.map(c => c.id)).toEqual(['c_video-1', 'c_video-2', 'c_off', 'c_video-3', 'c_video-4'])
    expect(est.clips[0]).toEqual({ id: 'c_video-1', node_id: 'video-1', duration: 6.45, voice_extended: 2.45 })
    expect(est.clips[1]).toEqual({ id: 'c_video-2', node_id: 'video-2', duration: 13, voice_extended: 10 })
    expect(est.clips[2]).toEqual({ id: 'c_off', node_id: 'video-2', duration: 3, voice_extended: 0 })
    expect(est.clips[3]).toEqual({ id: 'c_video-3', node_id: 'video-3', duration: 5, voice_extended: 0 })
    expect(est.clips[4]).toEqual({ id: 'c_video-4', node_id: 'video-4', duration: 0, voice_extended: 0 })
    expect(est.total).toBe(27.45)
  })

  // API.md 25.5：退回的不可选用，已通过的排前面
  it('selectableCandidates / candidateReviewState / clipUsesRejected', () => {
    const list = [cand(3), cand(2, review(1)), cand(1, review(-1, 'lipsync')), cand(0, null)]
    expect(list.map(candidateReviewState)).toEqual(['pending', 'approved', 'rejected', 'pending'])
    expect(selectableCandidates(list).map(c => c.asset_id)).toEqual([2, 3, 0])

    const s = shot('video-1', 11, 4, [[11, 4], [12, 4]])
    s.video.candidates[0]!.review = review(-1, 'identity')
    expect(clipUsesRejected(clip('video-1'), s)).toBe(true) // asset_id=0 → 节点当前视频 11 已退回
    expect(clipUsesRejected(clip('video-1', { asset_id: 12 }), s)).toBe(false)
    expect(clipUsesRejected(clip('video-1', { asset_id: 12 }), undefined)).toBe(false)
  })
})

describe('subtitleSourceNodes', () => {
  it('只认正文是 SRT 的文本节点', () => {
    const nodes = [
      { id: 'text-3', data: { kind: 'text', label: '视频1_字幕', content: '1\n00:00:00,000 --> 00:00:02,000\n你好', transcriptCues: [{ start: 0, end: 2, text: '你好' }] } },
      { id: 'text-4', data: { kind: 'text', label: '脚本', content: '普通脚本文本' } },
      { id: 'text-5', data: { kind: 'text', label: '手贴的 SRT', content: '1\n00:00:00,000 --> 00:00:01,000\nhi' } },
      { id: 'image-1', data: { kind: 'image', label: '图', content: '1 --> 2' } },
    ]
    expect(subtitleSourceNodes(nodes)).toEqual([{ id: 'text-3', label: '视频1_字幕' }, { id: 'text-5', label: '手贴的 SRT' }])
  })
})
