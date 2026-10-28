import { describe, expect, it } from 'vitest'
import { stripKeyResult, stripKeyStep } from './canvas-strip-keys'

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
