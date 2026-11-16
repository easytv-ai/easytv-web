import { describe, expect, it } from 'vitest'
import { buildSpine, laneRuns } from './spine'
import type { ScreenplayPlan } from '~/types/creative'

function plan(title: string, names: string[], shots: string[][]): ScreenplayPlan {
  return {
    title,
    style: '',
    aspect: '16:9',
    characters: names.map((name, index) => ({ key: `c${index + 1}`, name, look: '' })),
    scenes: [],
    shots: shots.map((characters, index) => ({
      no: index + 1,
      scene: 's1',
      characters,
      prompt: '',
      motion: '',
      line: index === 0 ? '一句旁白' : '',
    })),
  }
}

describe('buildSpine', () => {
  it('用镜头出场数画线，人不再出现就在最后一集断开', () => {
    const spine = buildSpine([
      { id: 1, episode_no: 1, canvas_id: 0, status: 1, plan: plan('夜航', ['林夏', '沈叔'], [['c1', 'c2'], ['c1']]) },
      { id: 2, episode_no: 2, canvas_id: 9, status: 2, plan: plan('靠岸', ['林夏'], [['c1']]) },
    ], [{ key: 't1', title: '钥匙', status: 'open', opened_in: 1, resolved_in: 0 }])

    expect(spine.episodes.map(episode => episode.title)).toEqual(['夜航', '靠岸'])
    const shen = spine.lanes.find(lane => lane.name === '沈叔')
    expect(shen?.weights).toEqual([1, 0])
    expect(shen?.exitAt).toBe(0)
    const lin = spine.lanes.find(lane => lane.name === '林夏')
    expect(lin?.weights).toEqual([2, 1])
    expect(lin?.exitAt).toBeNull()
    expect(spine.clues[0]).toMatchObject({ title: '钥匙', from: 0, to: 1, open: true })
    expect(spine.episodes[1]?.canvasId).toBe(9)
  })

  it('同一人物跨集改了 key，仍按名字接成一条线', () => {
    const second = plan('靠岸', ['林夏'], [['other']])
    second.characters[0]!.key = 'other'
    const spine = buildSpine([
      { id: 1, episode_no: 1, canvas_id: 0, status: 1, plan: plan('夜航', ['林夏'], [['c1']]) },
      { id: 2, episode_no: 2, canvas_id: 0, status: 1, plan: second },
    ])
    expect(spine.lanes).toHaveLength(1)
    expect(spine.lanes[0]?.weights).toEqual([1, 1])
  })
})

describe('laneRuns', () => {
  it('中间缺席分成两段', () => {
    expect(laneRuns([1, 0, 2])).toEqual([[0, 0], [2, 2]])
  })
})
