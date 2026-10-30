import type { NodeCandidate, Shot, Timeline, TimelineClip, TimelineEstimate } from '~/types/creative'

/** 时间线纯逻辑（成片向导第 4 步用），与后端 model.Timeline.Normalize 的规则保持一致。 */

export const TIMELINE_MIN_SEGMENT = 0.3

/** 片段 id（与后端 model.NewTimelineClipId 同形）：c_ + 8 位随机串 */
export function newClipId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'c_'
  for (let i = 0; i < 8; i++)
    id += alphabet[Math.floor(Math.random() * alphabet.length)]
  return id
}

/** 服务端返回的片段都带 id；本地新建 / 旧数据没有的补上 */
export function ensureClipIds(clips: TimelineClip[]) {
  const seen = new Set<string>()
  return clips.map((clip) => {
    let id = clip.id
    if (!id || seen.has(id))
      id = newClipId()
    seen.add(id)
    return id === clip.id ? clip : { ...clip, id }
  })
}

/**
 * 复制片段（API.md 24.3）：同一素材再插一条到原片段后面，入出点 / 音量 / 字幕都复制一份、可独立改。
 * 越界返回原数组副本。
 */
export function duplicateClip(clips: TimelineClip[], index: number) {
  const next = clips.slice()
  const src = next[index]
  if (!src)
    return next
  next.splice(index + 1, 0, { ...src, id: newClipId() })
  return next
}

/** 这个镜头当前选用的视频时长：换了候选用候选的时长，否则用节点当前视频 */
export function clipSourceDuration(clip: TimelineClip, shot?: Shot) {
  if (!shot)
    return 0
  if (clip.asset_id) {
    const cand = shot.video.candidates.find(item => item.asset_id === clip.asset_id)
    if (cand)
      return Number(cand.duration) || shot.seconds || 0
  }
  return Number(shot.video.duration) || shot.seconds || 0
}

/** 裁切后的段长（与后端 trimRange 一致：入点越界回落 0，出点不合法到结尾，至少 0.3 秒） */
export function trimmedDuration(clip: TimelineClip, sourceDuration: number) {
  const dur = sourceDuration > 0 ? sourceDuration : 5
  let start = clip.in
  if (start < 0 || start >= dur - TIMELINE_MIN_SEGMENT)
    start = 0
  let end = dur
  if (clip.out > start + TIMELINE_MIN_SEGMENT && clip.out < dur)
    end = clip.out
  return Math.round((end - start) * 10) / 10
}

/** 启用镜头的预计总时长（不含配音延长） */
export function estimateTotal(timeline: Timeline, shots: Shot[]) {
  const byNode = new Map(shots.map(shot => [shot.video.node_id, shot]))
  let total = 0
  for (const clip of timeline.clips) {
    if (!clip.enabled)
      continue
    total += trimmedDuration(clip, clipSourceDuration(clip, byNode.get(clip.node_id)))
  }
  return Math.round(total * 10) / 10
}

/** 把 from 位置的镜头移到 to（越界返回原数组副本） */
export function moveClip(clips: TimelineClip[], from: number, to: number) {
  const next = clips.slice()
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to)
    return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

/** 配音比画面长时这一段延长到配音结束（含 0.15 秒延后与 0.3 秒收尾），最多延长 10 秒；与后端 clipDurationWithVoice 一致 */
export const TIMELINE_VOICE_TAIL = 0.45
export const TIMELINE_VOICE_MAX_EXTEND = 10

export function clipDurationWithVoice(videoDur: number, voiceDur: number) {
  const need = voiceDur + TIMELINE_VOICE_TAIL
  if (voiceDur <= 0 || need <= videoDur)
    return videoDur
  return Math.min(need, videoDur + TIMELINE_VOICE_MAX_EXTEND)
}

/**
 * 预计时长（API.md 25.4）：与后端 service.EstimateTimeline 同一套规则，本地改动后先用它算，保存后以服务端 estimate 为准。
 * 只算启用的片段；素材缺失按 0 计；voice_mode 不是 off 且该镜有配音时按配音延长。保留两位小数。
 */
export function estimateTimeline(timeline: Timeline, shots: Shot[]): TimelineEstimate {
  const byNode = new Map(shots.map(shot => [shot.video.node_id, shot]))
  const est: TimelineEstimate = { total: 0, clips: [] }
  for (const clip of timeline.clips) {
    if (!clip.enabled)
      continue
    const shot = byNode.get(clip.node_id)
    const source = clipSourceDuration(clip, shot)
    let duration = 0
    let extended = 0
    if (shot && source > 0) {
      duration = trimmedDuration(clip, source)
      // 与后端 EstimateTimeline 同规则：时间线总开关关了、或本片段 off，都不算配音延长
      const voiceDur = timeline.voice && clip.voice_mode !== 'off' && shot.voice?.asset_id ? Number(shot.voice.duration) || 0 : 0
      if (voiceDur > 0) {
        const ext = clipDurationWithVoice(duration, voiceDur)
        extended = Math.round((ext - duration) * 100) / 100
        duration = ext
      }
    }
    duration = Math.round(duration * 100) / 100
    est.total += duration
    est.clips.push({ id: clip.id, node_id: clip.node_id, duration, voice_extended: extended })
  }
  est.total = Math.round(est.total * 100) / 100
  return est
}

export type CandidateReviewState = 'approved' | 'rejected' | 'pending'

/** 候选的审片状态（API.md 25.5）：review 缺失 / null 为待审 */
export function candidateReviewState(cand: Pick<NodeCandidate, 'review'>): CandidateReviewState {
  const status = cand.review?.status
  if (status === 1)
    return 'approved'
  if (status === -1)
    return 'rejected'
  return 'pending'
}

/** 可选用的候选：退回的不能选；已通过的排前面（各自保持原来的新旧顺序） */
export function selectableCandidates<T extends Pick<NodeCandidate, 'review'>>(candidates: T[]) {
  const approved = candidates.filter(cand => candidateReviewState(cand) === 'approved')
  const pending = candidates.filter(cand => candidateReviewState(cand) === 'pending')
  return [...approved, ...pending]
}

/** 片段实际用到的视频资产：换了候选用候选，否则是节点当前视频 */
export function clipEffectiveAssetId(clip: TimelineClip, shot?: Shot) {
  return clip.asset_id || shot?.video.asset_id || 0
}

/** 片段当前选用的候选已被退回（API.md 25.5）：要提示并高亮 */
export function clipUsesRejected(clip: TimelineClip, shot?: Shot) {
  if (!shot)
    return false
  const assetId = clipEffectiveAssetId(clip, shot)
  if (!assetId)
    return false
  const cand = shot.video.candidates.find(item => item.asset_id === assetId)
  return !!cand && candidateReviewState(cand) === 'rejected'
}

export type TimelineSaveOutcome = 'ok' | 'error' | 'conflict' | 'locked'

/**
 * 保存结果分类（API.md 24.4 / 25.6）：后端乐观锁冲突与定版锁都没有错误码，只有这句话
 * （版本冲突 / 已定版锁定）。
 * 冲突要停掉自动保存等用户选，锁住要切到定版态，其它失败保留草稿等重试。
 */
export function timelineSaveOutcome(res: { success?: boolean, message?: string } | null | undefined): TimelineSaveOutcome {
  if (res?.success)
    return 'ok'
  const msg = typeof res?.message === 'string' ? res.message : ''
  if (/已在其他地方修改/.test(msg))
    return 'conflict'
  if (/已定版/.test(msg))
    return 'locked'
  return 'error'
}

/** 启用了但没有可用视频的镜头（合成会报错，提前提示） */
export function unusableClips(timeline: Timeline, shots: Shot[]) {
  const byNode = new Map(shots.map(shot => [shot.video.node_id, shot]))
  return timeline.clips.filter((clip) => {
    if (!clip.enabled)
      return false
    const shot = byNode.get(clip.node_id)
    if (!shot)
      return true
    return clip.asset_id ? !shot.video.candidates.some(c => c.asset_id === clip.asset_id) && clip.asset_id !== shot.video.asset_id : !shot.video.asset_id
  })
}

/** 画布上能当整份字幕用的文本节点（API.md 35.4）：语音转字幕的产物（有 transcriptCues），或正文本身就是 SRT */
export function subtitleSourceNodes(nodes: Array<{ id: string, data?: { kind?: string, label?: string, content?: string, transcriptCues?: unknown[] } }>) {
  const out: Array<{ id: string, label: string }> = []
  for (const node of nodes) {
    const data = node.data
    if (!data || data.kind !== 'text')
      continue
    // 后端只认正文里有 "-->" 时间轴的；transcriptCues 只是转写产物的标记，正文被改掉就不算
    const content = String(data.content || '').trim()
    if (!/-->/.test(content))
      continue
    out.push({ id: node.id, label: String(data.label || node.id) })
  }
  return out
}
