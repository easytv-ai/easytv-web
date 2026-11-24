import { describe, expect, it } from 'vitest'
import { composeRetakePrompt, extendSourceWindow, initialRetakeRange, retakeOutputRatio, retakeOutputResolution, retakeOutputSeconds, retakeSnapRange } from '~/utils/canvas-extend-studio'

describe('initialRetakeRange', () => {
  it('第一次打开落在第一段，不是整条', () => {
    expect(initialRetakeRange(null, 5)).toEqual({ start: 0, end: 0.2 })
  })

  it('已经圈过的区间原样打开', () => {
    expect(initialRetakeRange({ start: 0.4, end: 0.6 }, 5)).toEqual({ start: 0.4, end: 0.6 })
  })

  it('整段都选过时保留整段', () => {
    expect(initialRetakeRange({ start: 0, end: 1 }, 5)).toEqual({ start: 0, end: 1 })
  })

  it('区间无效时退回第一段', () => {
    expect(initialRetakeRange({ start: 0.8, end: 0.2 }, 5)).toEqual({ start: 0, end: 0.2 })
  })
})

describe('composeRetakePrompt', () => {
  const fallback = '按原画面重拍这一段，保持主体、场景和光影'

  it('改动和原镜头描述一起交给模型', () => {
    const text = composeRetakePrompt({
      change: '黑色西装换成白色',
      sourcePrompt: '地牢里的年轻剑士，头顶一只蓝色史莱姆，火把暖光',
      start: 0,
      end: 3.05,
      fallback,
    })
    expect(text).toContain('重拍当前选中的 00:00–00:03 这一段。黑色西装换成白色')
    expect(text).toContain('只改提到的地方')
    expect(text).toContain('原镜头描述：\n地牢里的年轻剑士，头顶一只蓝色史莱姆，火把暖光')
  })

  it('改动框空着时仍带上原镜头描述，不再只发兜底句', () => {
    const text = composeRetakePrompt({
      change: '',
      sourcePrompt: '地牢里的年轻剑士，头顶一只蓝色史莱姆',
      start: 0,
      end: 3,
      fallback,
    })
    expect(text).toContain('按原镜头描述重拍')
    expect(text).toContain('地牢里的年轻剑士，头顶一只蓝色史莱姆')
    expect(text).not.toBe(fallback)
  })

  it('改动里已经写了原描述就不再贴第二次', () => {
    const source = '地牢里的年轻剑士，头顶一只蓝色史莱姆'
    const text = composeRetakePrompt({
      change: `保持原画面。${source}。把剑换成法杖`,
      sourcePrompt: source,
      fallback,
    })
    expect(text.match(/地牢里的年轻剑士/g)).toHaveLength(1)
  })

  it('两边都没有时才用兜底句', () => {
    expect(composeRetakePrompt({ change: '', sourcePrompt: '', fallback })).toBe(fallback)
  })
})

describe('retakeOutputSeconds', () => {
  it('没声明档位时用选区秒数，夹在 2 到 15', () => {
    expect(retakeOutputSeconds(3.2)).toBe(3)
    expect(retakeOutputSeconds(1)).toBe(2)
  })

  it('有档位时抬到不短于选区的最小档', () => {
    expect(retakeOutputSeconds(3, [4, 5, 6, 8, 10])).toBe(4)
    expect(retakeOutputSeconds(5, [4, 5, 6])).toBe(5)
    expect(retakeOutputSeconds(12, [4, 8])).toBe(8)
  })
})

describe('retakeOutputResolution', () => {
  it('对得上就用模型枚举原文', () => {
    expect(retakeOutputResolution('720p', ['480p', '720p', '1080p'])).toBe('720p')
    expect(retakeOutputResolution('1080p', ['720P', '1080P'])).toBe('1080P')
  })

  it('当前档模型不收时优先 720p', () => {
    expect(retakeOutputResolution('480p', ['720P', '1080P'])).toBe('720P')
    expect(retakeOutputResolution('720p', ['512P', '1080P'])).toBe('512P')
  })
})

describe('retakeSnapRange', () => {
  it('5 秒片子、最短 4 秒时，窗口是 4 秒，只能再挪 1 秒', () => {
    const fitted = retakeSnapRange({
      duration: 5.04,
      start: 0,
      end: 0.2,
      minSeconds: 4,
      mode: 'fit',
    })
    expect(fitted.seconds).toBe(4)
    expect(fitted.start).toBe(0)
    expect(fitted.end).toBeCloseTo(4 / 5.04, 5)

    const slid = retakeSnapRange({
      duration: 5.04,
      start: 2.5 / 5.04,
      end: 1,
      minSeconds: 4,
      mode: 'move',
      lengthSeconds: 4,
    })
    expect(slid.seconds).toBe(4)
    expect(slid.start).toBeCloseTo(1 / 5.04, 5)
    expect(slid.end).toBe(1)
  })

  it('拖终点不能短于最短时长，拉满则收到整秒', () => {
    const shrunk = retakeSnapRange({
      duration: 5.04,
      start: 0,
      end: 2 / 5.04,
      minSeconds: 4,
      mode: 'end',
    })
    expect(shrunk.seconds).toBe(4)

    const full = retakeSnapRange({
      duration: 5.04,
      start: 0,
      end: 1,
      minSeconds: 4,
      mode: 'end',
    })
    expect(full.seconds).toBe(5)
    expect(full.end).toBe(1)
  })

  it('还不知道最短档时，不要把窗口收成 1 秒', () => {
    expect(retakeSnapRange({
      duration: 5.04,
      start: 0,
      end: 0.2,
      minSeconds: 0,
      mode: 'fit',
    })).toEqual({ start: 0, end: 0.2, seconds: 0 })
  })

  it('片子比最短时长短时，选区铺满，生成秒数仍是最短档', () => {
    expect(retakeSnapRange({
      duration: 3.2,
      start: 0.2,
      end: 0.5,
      minSeconds: 4,
      mode: 'fit',
    })).toEqual({ start: 0, end: 1, seconds: 4 })
  })
})

describe('retakeOutputRatio', () => {
  const seedance = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive']

  it('竖屏 2:3 不在 Seedance 表里时用 adaptive，不再送 2:3', () => {
    expect(retakeOutputRatio({
      current: '9:16',
      allowed: seedance,
      width: 1176,
      height: 1764,
    })).toBe('adaptive')
  })

  it('原片就是 9:16 时用 9:16', () => {
    expect(retakeOutputRatio({
      current: '16:9',
      allowed: seedance,
      width: 1080,
      height: 1920,
    })).toBe('9:16')
  })

  it('手选过且新模型仍收这一档时保持', () => {
    expect(retakeOutputRatio({
      current: '16:9',
      allowed: seedance,
      width: 1176,
      height: 1764,
      touched: true,
    })).toBe('16:9')
  })

  it('手选的档新模型没有、也没有 adaptive 时落到最接近的竖屏', () => {
    expect(retakeOutputRatio({
      current: '2:3',
      allowed: ['16:9', '9:16', '1:1'],
      touched: true,
    })).toBe('9:16')
  })
})

describe('extendSourceWindow', () => {
  it('整段选区不裁，直接用已入库的源视频', () => {
    expect(extendSourceWindow({ start: 0, end: 1, duration: 8 })).toBeNull()
  })

  it('后半段不好时，裁到坏的那段之前', () => {
    expect(extendSourceWindow({ start: 0, end: 0.5, duration: 10 })).toEqual({ start: 0, end: 5 })
  })

  it('从中间某一刻接着写时，只留这一段', () => {
    expect(extendSourceWindow({ start: 0.2, end: 0.8, duration: 10 })).toEqual({ start: 2, end: 8 })
  })

  it('读不到时长时不裁', () => {
    expect(extendSourceWindow({ start: 0.2, end: 0.4, duration: 0 })).toBeNull()
  })
})
