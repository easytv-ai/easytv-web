import { describe, expect, it } from 'vitest'
import {
  AXIS_DRAG_PIXELS_PER_STEP,
  clampFieldValue,
  formatFieldValue,
  degreesToRadians,
  precisionOfStep,
  radiansToDegrees,
  valueAfterDrag,
} from './number-field'

describe('precisionOfStep', () => {
  it('整数步长不留小数', () => {
    expect(precisionOfStep(1)).toBe(0)
    expect(precisionOfStep(5)).toBe(0)
  })

  it('小数步长按位数留', () => {
    expect(precisionOfStep(0.1)).toBe(1)
    expect(precisionOfStep(0.01)).toBe(2)
  })
})

describe('formatFieldValue', () => {
  it('去掉没意义的尾零', () => {
    expect(formatFieldValue(1.2, 2)).toBe('1.2')
    expect(formatFieldValue(3, 2)).toBe('3')
  })

  it('按精度截断而不是直接显示浮点误差', () => {
    expect(formatFieldValue(0.1 + 0.2, 2)).toBe('0.3')
  })

  it('精度封顶六位，再多显示的也是噪声', () => {
    expect(formatFieldValue(1 / 3, 20)).toBe('0.333333')
  })

  it('非有限值给空串，输入框里不显示 NaN', () => {
    expect(formatFieldValue(Number.NaN, 2)).toBe('')
    expect(formatFieldValue(Number.POSITIVE_INFINITY, 2)).toBe('')
  })
})

describe('clampFieldValue', () => {
  it('只给一边时另一边不限', () => {
    expect(clampFieldValue(-5, 0)).toBe(0)
    expect(clampFieldValue(999, undefined, 10)).toBe(10)
    expect(clampFieldValue(-999)).toBe(-999)
  })
})

describe('valueAfterDrag', () => {
  it('满一格才动一步', () => {
    const base = { startValue: 0, step: 1 }
    expect(valueAfterDrag({ ...base, deltaPixels: AXIS_DRAG_PIXELS_PER_STEP - 1 })).toBe(1)
    expect(valueAfterDrag({ ...base, deltaPixels: AXIS_DRAG_PIXELS_PER_STEP * 3 })).toBe(3)
  })

  it('往回拖回到原值 —— 按起点算总位移，不是逐帧累加', () => {
    const base = { startValue: 2, step: 0.1 }
    const out = valueAfterDrag({ ...base, deltaPixels: AXIS_DRAG_PIXELS_PER_STEP * 7 })
    expect(out).toBeCloseTo(2.7, 10)
    expect(valueAfterDrag({ ...base, deltaPixels: 0 })).toBe(2)
  })

  it('小数步长不漏浮点误差', () => {
    expect(valueAfterDrag({ startValue: 0.1, deltaPixels: AXIS_DRAG_PIXELS_PER_STEP * 2, step: 0.1 })).toBe(0.3)
  })

  it('超出范围时夹住', () => {
    expect(valueAfterDrag({ startValue: 0, deltaPixels: 1000, step: 1, max: 5 })).toBe(5)
    expect(valueAfterDrag({ startValue: 0, deltaPixels: -1000, step: 1, min: -2 })).toBe(-2)
  })

  it('步长为 0 时退回一步一格，否则拖动会完全失灵', () => {
    expect(valueAfterDrag({ startValue: 0, deltaPixels: AXIS_DRAG_PIXELS_PER_STEP * 2, step: 0 })).toBe(2)
  })
})

describe('角度换算', () => {
  it('来回转一趟回到原值', () => {
    for (const degrees of [0, 45, 90, -180, 37.5])
      expect(radiansToDegrees(degreesToRadians(degrees))).toBeCloseTo(degrees, 10)
  })

  it('90 度就是四分之一个圆周', () => {
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2, 12)
  })
})
