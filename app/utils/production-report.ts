import type { ComposePackageFiles, ProductionReport, ProductionReviewStatus, ShotReviewReason } from '~/types/creative'

/**
 * 制片报表（API.md 26.3）与交付包（API.md 26.2）的格式化 / 状态映射，纯函数，组件里只做渲染。
 * 文案通过 tr 接收组件的 t（key 即中文原文）。
 */
type Tr = (key: string) => string

/** 积分只显示整数（后端净结算已是整数，这里兜住小数） */
export function formatReportPoints(value: number | null | undefined) {
  return String(Math.round(Number(value) || 0))
}

/** 秒保留 1 位小数 */
export function formatReportSeconds(value: number | null | undefined) {
  return (Number(value) || 0).toFixed(1)
}

/** 每有效秒成本：积分 ÷ 秒，保留 1 位小数；没有有效时长时显示 — */
export function formatCostPerSecond(value: number | null | undefined, effectiveSeconds: number | null | undefined) {
  if (!(Number(effectiveSeconds) > 0))
    return '—'
  return (Number(value) || 0).toFixed(1)
}

/** 状态色：通过 = 绿、退回 = 红、待审 = 灰、没有素材 = 空 */
export type ReviewTone = 'ok' | 'bad' | 'wait' | 'none'

const TONES: Record<ProductionReviewStatus, ReviewTone> = { approved: 'ok', rejected: 'bad', pending: 'wait', none: 'none' }

export function reviewTone(status: string | null | undefined): ReviewTone {
  return TONES[(status || 'none') as ProductionReviewStatus] ?? 'none'
}

/** 选用状态文案；none = 该镜没有视频 */
export function selectedStatusLabel(status: string | null | undefined, tr: Tr) {
  switch (status) {
    case 'approved': return tr('通过')
    case 'rejected': return tr('退回')
    case 'pending': return tr('待审')
    default: return tr('无视频')
  }
}

/** 分镜图审片状态文案；none = 该镜没有分镜图 */
export function imageStatusLabel(status: string | null | undefined, tr: Tr) {
  switch (status) {
    case 'approved': return tr('通过')
    case 'rejected': return tr('退回')
    case 'pending': return tr('待审')
    default: return tr('无分镜图')
  }
}

/** 审批门禁（API.md 26.1）：'' 关闭 / rejected 有退回即拦 / approved 分镜图须通过 */
export function reviewGateLabel(gate: string | null | undefined, tr: Tr) {
  switch (gate) {
    case 'rejected': return tr('有退回即拦')
    case 'approved': return tr('分镜图须通过')
    default: return tr('未开启')
  }
}

const REASON_KEYS: Record<ShotReviewReason, string> = {
  identity: '人物不对',
  performance: '表演',
  lipsync: '口型',
  composition: '构图',
  continuity: '连戏',
  duration: '时长',
  technical: '技术故障',
}

/** 退回原因码 → 文案；未知的原样返回 */
export function rejectReasonLabel(reason: string, tr: Tr) {
  const key = REASON_KEYS[reason as ShotReviewReason]
  return key ? tr(key) : reason
}

/** 多个退回原因去重后用「 / 」连起来；没有就空串 */
export function rejectReasonsText(reasons: string[] | null | undefined, tr: Tr) {
  return Array.from(new Set((reasons ?? []).filter(Boolean))).map(reason => rejectReasonLabel(reason, tr)).join(' / ')
}

export type PackageEntry = { key: 'master' | 'srt' | 'voice' | 'manifest', label: string, url: string }

/** 交付包四项固定顺序：母版 / SRT / 对白轨 / 素材清单；缺的 url 为空串，由组件显示「未生成」 */
export function packageEntries(files: ComposePackageFiles | null | undefined, tr: Tr): PackageEntry[] {
  const f = files ?? {}
  return [
    { key: 'master', label: tr('无字幕母版'), url: f.master_url || '' },
    { key: 'srt', label: tr('字幕 SRT'), url: f.srt_url || '' },
    { key: 'voice', label: tr('对白轨'), url: f.voice_url || '' },
    { key: 'manifest', label: tr('素材清单'), url: f.manifest_url || '' },
  ]
}

/** 交付包是否有任一文件 */
export function hasPackageFiles(files: ComposePackageFiles | null | undefined) {
  return packageEntries(files, key => key).some(entry => !!entry.url)
}

/** 报表里的镜头按镜号升序；后端 null 兜成空数组 */
export function sortedReportShots(report: ProductionReport | null | undefined) {
  return [...(report?.shots ?? [])].sort((a, b) => a.no - b.no)
}
