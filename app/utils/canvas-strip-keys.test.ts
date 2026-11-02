import { describe, expect, it } from 'vitest'
import { canInsertSplitCut, clipStripAspect, clipStripMetrics, moveSplitCut, nearestSplitCut, splitLabelRows, stripKeyResult, stripKeyStep } from './canvas-strip-keys'

const base = { variant: 'clip' as const, start: 0.4, end: 0.6, duration: 10, snap: false, minRange: 0.08 }

describe('stripKeyStep', () => {
  it('默认 0.1 秒，Shift 或吸附时 1 秒；时长读不到按 5 秒估', () => {
    expect(stripKeyStep(base, false)).toBeCloseTo(0.01)
    expect(stripKeyStep(base, true)).toBeCloseTo(0.1)
    expect(stripKeyStep({ ...base, snap: true }, false)).toBeCloseTo(0.1)
    expect(stripKeyStep({ duration: 0, snap: false }, false)).toBeCloseTo(0.02)
  })
})

describe('stripKeyResult', () => {
  it('← → 整体移动选区，宽度不变，贴边停住', () => {
    const right = stripKeyResult({ key: 'ArrowRight' }, base)
    expect(right).toMatchObject({ type: 'range' })
    if (right?.type === 'range') {
      expect(right.start).toBeCloseTo(0.41)
      expect(right.end).toBeCloseTo(0.61)
    }
    const edge = stripKeyResult({ key: 'ArrowRight', shift: true }, { ...base, start: 0.78, end: 0.98 })
    if (edge?.type === 'range') {
      expect(edge.start).toBeCloseTo(0.8)
      expect(edge.end).toBeCloseTo(1)
    }
    const left = stripKeyResult({ key: 'ArrowLeft', shift: true }, { ...base, start: 0.05, end: 0.25 })
    if (left?.type === 'range') {
      expect(left.start).toBe(0)
      expect(left.end).toBeCloseTo(0.2)
    }
  })

  it('Alt + ← → 只动终点，不会小于最小宽度', () => {
    const r = stripKeyResult({ key: 'ArrowLeft', alt: true, shift: true }, { ...base, start: 0.4, end: 0.5 })
    if (r?.type === 'range') {
      expect(r.start).toBe(0.4)
      expect(r.end).toBeCloseTo(0.48)
    }
  })

  it('↑ ↓ 两端同时放大 / 缩小，缩到最小宽度为止', () => {
    const up = stripKeyResult({ key: 'ArrowUp', shift: true }, base)
    if (up?.type === 'range') {
      expect(up.start).toBeCloseTo(0.3)
      expect(up.end).toBeCloseTo(0.7)
    }
    const down = stripKeyResult({ key: 'ArrowDown', shift: true }, { ...base, start: 0.45, end: 0.55 })
    if (down?.type === 'range')
      expect(down.end - down.start).toBeCloseTo(0.08)
  })

  it('分割模式只有一个游标：← → 移动，↑ ↓ 不认', () => {
    const split = { ...base, variant: 'split' as const, start: 0.5, end: 0.5 }
    const r = stripKeyResult({ key: 'ArrowLeft', shift: true }, split)
    if (r?.type === 'range') {
      expect(r.start).toBeCloseTo(0.4)
      expect(r.end).toBeCloseTo(0.4)
    }
    expect(stripKeyResult({ key: 'ArrowUp' }, split)).toBeNull()
  })

  it('Enter / Esc 通用；S / L 只在片段截取里生效；其它键交还画布', () => {
    expect(stripKeyResult({ key: 'Enter' }, base)).toEqual({ type: 'command', command: 'submit' })
    expect(stripKeyResult({ key: 'Escape' }, base)).toEqual({ type: 'command', command: 'close' })
    expect(stripKeyResult({ key: 's' }, base)).toEqual({ type: 'command', command: 'toggle-snap' })
    expect(stripKeyResult({ key: 'L' }, base)).toEqual({ type: 'command', command: 'toggle-loop' })
    expect(stripKeyResult({ key: 's' }, { ...base, variant: 'extend' })).toBeNull()
    expect(stripKeyResult({ key: 'Delete' }, base)).toBeNull()
  })
})

describe('分割点', () => {
  it('点在线上就拖已有分割点，离得远才能再加一条', () => {
    expect(nearestSplitCut([0.2, 0.8], 0.21, 0.03)).toBe(0)
    expect(nearestSplitCut([0.2, 0.8], 0.5, 0.03)).toBe(-1)
    expect(canInsertSplitCut([0.5], 0.2, 0.08, 11)).toBe(true)
    expect(canInsertSplitCut([0.5], 0.53, 0.08, 11)).toBe(false)
    expect(canInsertSplitCut([0.5], 0.02, 0.08, 11)).toBe(false)
    expect(canInsertSplitCut([0.2, 0.5], 0.8, 0.08, 2)).toBe(false)
  })

  it('时间靠得近就换到下一行，离得开的仍在第一行', () => {
    expect(splitLabelRows([0.1, 0.5, 0.9], 0.2)).toEqual([0, 0, 0])
    expect(splitLabelRows([0.4, 0.45, 0.8], 0.12)).toEqual([0, 1, 0])
    expect(splitLabelRows([0.5, 0.52, 0.54], 0.1)).toEqual([0, 1, 2])
    expect(splitLabelRows([], 0.1)).toEqual([])
  })

  it('拖动时夹在相邻分割线之间，两边留出最短一段', () => {
    expect(moveSplitCut([0.2, 0.5, 0.8], 1, 0.9, 0.08)[1]).toBeCloseTo(0.72)
    expect(moveSplitCut([0.2, 0.5, 0.8], 1, 0.1, 0.08)[1]).toBeCloseTo(0.28)
    expect(moveSplitCut([0.5], 0, 0.02, 0.08)[0]).toBeCloseTo(0.08)
  })
})

describe('clipStripMetrics', () => {
  it('条比节点更宽，格子按当前视频比例铺，竖屏比横屏更密', () => {
    const wide = clipStripMetrics(800, 16 / 9)
    expect(wide.width).toBe(960)
    expect(wide.filmHeight).toBe(44)
    expect(wide.aspect).toBeCloseTo(16 / 9)
    expect(clipStripMetrics(400).width).toBe(720)
    expect(clipStripMetrics(200).filmHeight).toBe(44)
    const landscape = clipStripMetrics(800, 16 / 9).frameCount
    const square = clipStripMetrics(800, 1).frameCount
    const portrait = clipStripMetrics(800, 9 / 16).frameCount
    expect(portrait).toBeGreaterThan(square)
    expect(square).toBeGreaterThan(landscape)
  })

  it('读不到尺寸时按 16:9，极端比例夹在合理区间', () => {
    expect(clipStripAspect(0, 0)).toBeCloseTo(16 / 9)
    expect(clipStripAspect(1920, 1080)).toBeCloseTo(16 / 9)
    expect(clipStripAspect(1080, 1920)).toBeCloseTo(9 / 16)
    expect(clipStripAspect(100, 1)).toBeLessThanOrEqual(21 / 9)
    expect(clipStripAspect(1, 100)).toBeGreaterThanOrEqual(9 / 21)
  })
})
