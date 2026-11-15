import { describe, expect, it } from 'vitest'
import { recordGenerateView } from './bible-record'

describe('N-8 「用 AI 生成本集记录」点击前看得到扣分说明', () => {
  const base = { target: 3, recording: false, saving: false, episodeCount: 0 }

  it('已经有每集记录时扣分说明仍在（原先只剩空状态那句，有记录后就什么都不显示）', () => {
    const view = recordGenerateView({ ...base, episodeCount: 5 })
    expect(view.showCost).toBe(true)
    expect(view.showEmpty).toBe(false)
    expect(view.disabled).toBe(false)
  })

  it('没有记录时空状态说明与扣分说明同时出现，前者不顶替后者', () => {
    const view = recordGenerateView(base)
    expect(view.showCost).toBe(true)
    expect(view.showEmpty).toBe(true)
  })

  it('生成中 / 保存中 / 没选集：按钮禁用，说明不收起', () => {
    for (const state of [{ ...base, recording: true }, { ...base, saving: true }, { ...base, target: 0 }]) {
      const view = recordGenerateView(state)
      expect(view.disabled).toBe(true)
      expect(view.showCost).toBe(true)
    }
  })
})
