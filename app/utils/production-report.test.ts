import { describe, expect, it } from 'vitest'
import { formatCostPerSecond, formatReportPoints, formatReportSeconds, hasPackageFiles, imageStatusLabel, packageEntries, rejectReasonsText, reviewGateLabel, reviewTone, selectedStatusLabel, sortedReportShots } from './production-report'
import type { ProductionReport, ProductionShot } from '~/types/creative'

const tr = (key: string) => `[${key}]`

describe('制片报表格式化', () => {
  it('积分取整、秒保留 1 位小数', () => {
    expect(formatReportPoints(36)).toBe('36')
    expect(formatReportPoints(35.6)).toBe('36')
    expect(formatReportPoints(undefined)).toBe('0')
    expect(formatReportSeconds(3)).toBe('3.0')
    expect(formatReportSeconds(2.345)).toBe('2.3')
    expect(formatReportSeconds(null)).toBe('0.0')
  })

  it('每有效秒成本：没有有效时长显示 —', () => {
    expect(formatCostPerSecond(10, 8)).toBe('10.0')
    expect(formatCostPerSecond(12.36, 8)).toBe('12.4')
    expect(formatCostPerSecond(0, 0)).toBe('—')
    expect(formatCostPerSecond(5, undefined)).toBe('—')
  })
})

describe('状态映射', () => {
  it('通过绿、退回红、待审灰、无视频空', () => {
    expect(reviewTone('approved')).toBe('ok')
    expect(reviewTone('rejected')).toBe('bad')
    expect(reviewTone('pending')).toBe('wait')
    expect(reviewTone('none')).toBe('none')
    expect(reviewTone('')).toBe('none')
    expect(reviewTone(undefined)).toBe('none')
    expect(reviewTone('weird')).toBe('none')
  })

  it('选用状态与分镜图状态文案', () => {
    expect(selectedStatusLabel('approved', tr)).toBe('[通过]')
    expect(selectedStatusLabel('rejected', tr)).toBe('[退回]')
    expect(selectedStatusLabel('pending', tr)).toBe('[待审]')
    expect(selectedStatusLabel('none', tr)).toBe('[无视频]')
    expect(imageStatusLabel('none', tr)).toBe('[无分镜图]')
    expect(imageStatusLabel('approved', tr)).toBe('[通过]')
  })

  it('门禁文案', () => {
    expect(reviewGateLabel('', tr)).toBe('[未开启]')
    expect(reviewGateLabel(undefined, tr)).toBe('[未开启]')
    expect(reviewGateLabel('rejected', tr)).toBe('[有退回即拦]')
    expect(reviewGateLabel('approved', tr)).toBe('[分镜图须通过]')
  })

  it('退回原因去重、未知原因原样', () => {
    expect(rejectReasonsText(['continuity', 'continuity', 'lipsync'], tr)).toBe('[连戏] / [口型]')
    expect(rejectReasonsText(['mystery'], tr)).toBe('mystery')
    expect(rejectReasonsText(null, tr)).toBe('')
    expect(rejectReasonsText(['', 'duration'], tr)).toBe('[时长]')
  })
})

describe('交付包', () => {
  it('四项固定顺序，缺的 url 为空', () => {
    const entries = packageEntries({ master_url: '/m.mp4', manifest_url: '/m.json' }, tr)
    expect(entries.map(e => e.key)).toEqual(['master', 'srt', 'voice', 'manifest'])
    expect(entries.map(e => e.url)).toEqual(['/m.mp4', '', '', '/m.json'])
    expect(entries[0]!.label).toBe('[无字幕母版]')
  })

  it('没有任何文件时 hasPackageFiles 为假', () => {
    expect(hasPackageFiles(null)).toBe(false)
    expect(hasPackageFiles({})).toBe(false)
    expect(hasPackageFiles({ srt_url: '/a.srt' })).toBe(true)
  })
})

describe('镜头排序', () => {
  function shot(no: number): ProductionShot {
    return { no, node_id: `video-${no}`, line: '', candidates: 0, approved: 0, rejected: 0, pending: 0, reworks: 0, selected_asset_id: 0, selected_status: 'none', enabled: true, image_status: 'none', cost_points: 0, tasks: 0, effective_seconds: 0, reject_reasons: null }
  }

  it('按镜号升序，shots 为 null 时空数组', () => {
    const report = { shots: [shot(3), shot(1), shot(2)] } as ProductionReport
    expect(sortedReportShots(report).map(s => s.no)).toEqual([1, 2, 3])
    expect(sortedReportShots({ shots: null } as ProductionReport)).toEqual([])
    expect(sortedReportShots(null)).toEqual([])
  })
})
