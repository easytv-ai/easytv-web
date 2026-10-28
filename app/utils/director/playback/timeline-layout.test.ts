import { describe, expect, it } from 'vitest'
import {
  formatPlayheadTime,
  getNodeLabel,
  getRulerTicks,
  getRulerTickStep,
  getTrackContentWidth,
  timeFromTrackOffset,
  TRACK_GUTTER_WIDTH,
} from './timeline-layout'

describe('formatPlayheadTime', () => {
  it('补零到固定宽度，秒数不会跳着变宽', () => {
    expect(formatPlayheadTime(0)).toBe('00:00.0')
    expect(formatPlayheadTime(9.54)).toBe('00:09.5')
    expect(formatPlayheadTime(75.2)).toBe('01:15.2')
  })

  it('负数按 0 显示', () => {
    expect(formatPlayheadTime(-3)).toBe('00:00.0')
  })
})

describe('getRulerTickStep', () => {
  it('放得越大刻度越密', () => {
    expect(getRulerTickStep(320)).toBe(0.25)
    expect(getRulerTickStep(80)).toBe(1)
  })

  it('缩到最小也不会没有刻度，退到最疏的那档', () => {
    expect(getRulerTickStep(1)).toBe(20)
  })

  it('任何缩放下刻度间距都不小于 70 像素 —— 再密数字就叠上了', () => {
    for (const zoom of [20, 40, 80, 160, 320])
      expect(getRulerTickStep(zoom) * zoom).toBeGreaterThanOrEqual(70)
  })
})

describe('getRulerTicks', () => {
  it('从 0 开始，覆盖到总时长之后一格', () => {
    const ticks = getRulerTicks(3, 80)
    expect(ticks[0]!.time).toBe(0)
    expect(ticks[ticks.length - 1]!.time).toBeGreaterThanOrEqual(3)
  })

  it('位置算进了左侧留白', () => {
    expect(getRulerTicks(2, 80)[0]!.left).toBe(TRACK_GUTTER_WIDTH)
    expect(getRulerTicks(2, 80)[1]!.left).toBe(TRACK_GUTTER_WIDTH + 80)
  })

  it('小数刻度留一位，整秒不带 .0', () => {
    const dense = getRulerTicks(1, 320)
    expect(dense[1]!.label).toBe('0.3s')
    expect(getRulerTicks(3, 80)[1]!.label).toBe('1s')
  })

  it('时长为 0 时也给一个起点刻度，尺子不会空着', () => {
    expect(getRulerTicks(0, 80)).toHaveLength(1)
  })
})

describe('timeFromTrackOffset', () => {
  it('减掉左侧留白再除以缩放', () => {
    expect(timeFromTrackOffset(TRACK_GUTTER_WIDTH + 160, 80, 10)).toBe(2)
  })

  it('夹在 0 和总时长之间', () => {
    expect(timeFromTrackOffset(0, 80, 10)).toBe(0)
    expect(timeFromTrackOffset(99999, 80, 10)).toBe(10)
  })

  it('缩放为 0 时给 0 而不是 Infinity', () => {
    expect(timeFromTrackOffset(200, 0, 10)).toBe(0)
  })
})

describe('getTrackContentWidth', () => {
  it('短路径也有最小宽度', () => {
    expect(getTrackContentWidth(0, 80)).toBe(480)
  })

  it('末尾多留一截，方便把最后一个节点往后拖', () => {
    expect(getTrackContentWidth(10, 80)).toBe(10 * 80 + 320)
  })
})

describe('getNodeLabel', () => {
  it('前 26 个是单字母', () => {
    expect(getNodeLabel(0)).toBe('A')
    expect(getNodeLabel(25)).toBe('Z')
  })

  it('超过 26 个进位成两位，而不是变成 [ \\ ] 这些字符', () => {
    expect(getNodeLabel(26)).toBe('AA')
    expect(getNodeLabel(27)).toBe('AB')
    expect(getNodeLabel(51)).toBe('AZ')
    expect(getNodeLabel(52)).toBe('BA')
  })

  it('标号里只会出现大写字母', () => {
    for (let index = 0; index < 200; index++)
      expect(getNodeLabel(index)).toMatch(/^[A-Z]+$/)
  })
})
