import { describe, expect, it } from 'vitest'
import { isHiddenGrowthTask, withoutHiddenGrowthTasks } from './growth-tasks'
import type { GrowthTask, GrowthTasks } from '~/types/creative'

function task(partial: Partial<GrowthTask> & Pick<GrowthTask, 'key'>): GrowthTask {
  return {
    title: partial.key,
    points: 10,
    status: 0,
    done_at: 0,
    ...partial,
  }
}

function payload(tasks: GrowthTask[]): GrowthTasks {
  return {
    tasks,
    total_points: 999,
    earned_points: 888,
    done: 7,
    valid_days: 14,
  }
}

describe('withoutHiddenGrowthTasks', () => {
  it('去掉绑定微信，并按剩余任务重算进度', () => {
    const next = withoutHiddenGrowthTasks(payload([
      task({ key: 'first_canvas', status: 1, points: 20 }),
      task({ key: 'bind_wechat', status: 0, points: 20 }),
      task({ key: 'first_work', status: 0, points: 30 }),
    ]))
    expect(next.tasks.map(item => item.key)).toEqual(['first_canvas', 'first_work'])
    expect(next.done).toBe(1)
    expect(next.total_points).toBe(50)
    expect(next.earned_points).toBe(20)
    expect(next.valid_days).toBe(14)
  })

  it('只剩绑定微信时列表为空', () => {
    const next = withoutHiddenGrowthTasks(payload([
      task({ key: 'bind_wechat', status: 0, points: 20 }),
    ]))
    expect(next.tasks).toEqual([])
    expect(next.done).toBe(0)
    expect(next.total_points).toBe(0)
    expect(next.earned_points).toBe(0)
  })

  it('识别隐藏任务键', () => {
    expect(isHiddenGrowthTask('bind_wechat')).toBe(true)
    expect(isHiddenGrowthTask('first_canvas')).toBe(false)
  })
})
