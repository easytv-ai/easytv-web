import { describe, expect, it } from 'vitest'
import type { GenerationTask, TaskStatus } from '~/types/creative'
import {
  isRunQueueActive,
  mergeRunQueueTasks,
  RUN_QUEUE_DONE_LIMIT,
  runQueueAction,
  runQueueActiveCount,
  runQueueBadge,
  runQueueClock,
  runQueueError,
  runQueueLocate,
  runQueuePoints,
  runQueueProgress,
  runQueueSections,
  runQueueStatusKey,
  runQueueTypeKey,
  sortRunQueueTasks,
} from './canvas-run-queue'

function task(patch: Partial<GenerationTask> = {}): GenerationTask {
  return {
    id: 1,
    task_no: 'T1',
    user_id: 1,
    project_id: 0,
    canvas_id: 9,
    node_id: 'image-1',
    type: 'image',
    provider: 'easyapi',
    model: 'qwen-image-2.0',
    prompt: '一只猫',
    params: {},
    inputs: [],
    status: 'running',
    progress: 40,
    result_asset_id: 0,
    result_url: '',
    result_text: '',
    error_msg: '',
    points_frozen: 12,
    cost_points: 0,
    created_at: 1_700_000_000,
    started_at: 1_700_000_001,
    finished_at: 0,
    ...patch,
  }
}

describe('isRunQueueActive / 状态词', () => {
  it('排队与生成中算进行中', () => {
    expect(isRunQueueActive('pending')).toBe(true)
    expect(isRunQueueActive('running')).toBe(true)
    expect(isRunQueueActive('succeeded')).toBe(false)
    expect(isRunQueueActive('failed')).toBe(false)
    expect(isRunQueueActive('cancelled')).toBe(false)
  })

  it('状态文案与任务中心同一套措辞', () => {
    const all: TaskStatus[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled']
    expect(all.map(runQueueStatusKey)).toEqual(['排队中', '生成中', '已完成', '失败', '已取消'])
  })

  it('类型文案四种都对', () => {
    expect(runQueueTypeKey('text')).toBe('文本')
    expect(runQueueTypeKey('image')).toBe('图片')
    expect(runQueueTypeKey('video')).toBe('视频')
    expect(runQueueTypeKey('audio')).toBe('音频')
  })
})

describe('sortRunQueueTasks', () => {
  it('进行中的在前，且先提交的靠上（排队最久的在队首）', () => {
    const later = task({ id: 3, status: 'running', created_at: 300 })
    const earlier = task({ id: 2, status: 'pending', created_at: 100 })
    const done = task({ id: 1, status: 'succeeded', created_at: 50, finished_at: 900 })
    expect(sortRunQueueTasks([later, done, earlier]).map(item => item.id)).toEqual([2, 3, 1])
  })

  it('结束的按结束时间倒序，同刻按 id 倒序', () => {
    const a = task({ id: 1, status: 'failed', finished_at: 100 })
    const b = task({ id: 2, status: 'succeeded', finished_at: 300 })
    const c = task({ id: 3, status: 'cancelled', finished_at: 300 })
    expect(sortRunQueueTasks([a, b, c]).map(item => item.id)).toEqual([3, 2, 1])
  })

  it('不改原数组', () => {
    const list = [task({ id: 2, status: 'succeeded', finished_at: 1 }), task({ id: 1, status: 'running' })]
    const copy = [...list]
    sortRunQueueTasks(list)
    expect(list).toEqual(copy)
  })
})

describe('runQueueSections', () => {
  const now = 1_700_000_000_000

  it('进行中全部列出，刚结束只留时间窗内的', () => {
    const active = task({ id: 1, status: 'running' })
    const fresh = task({ id: 2, status: 'succeeded', finished_at: now / 1000 - 60 })
    const old = task({ id: 3, status: 'failed', finished_at: now / 1000 - 3600 })
    const { active: on, done } = runQueueSections([old, fresh, active], now)
    expect(on.map(item => item.id)).toEqual([1])
    expect(done.map(item => item.id)).toEqual([2])
  })

  it('刚结束最多留 limit 条', () => {
    const list = Array.from({ length: RUN_QUEUE_DONE_LIMIT + 4 }, (_, index) => task({
      id: index + 1,
      status: 'succeeded',
      finished_at: now / 1000 - index,
    }))
    const { done } = runQueueSections(list, now)
    expect(done).toHaveLength(RUN_QUEUE_DONE_LIMIT)
    expect(done[0]!.id).toBe(1)
  })

  it('空列表两段都是空', () => {
    expect(runQueueSections([], now)).toEqual({ active: [], done: [] })
  })
})

describe('mergeRunQueueTasks（两路查询合并）', () => {
  it('按 id 去重，同一条以后面的那路为准', () => {
    const recent = [
      task({ id: 3, status: 'running', progress: 10 }),
      task({ id: 1, status: 'succeeded', cost_points: 5 }),
    ]
    const active = [task({ id: 3, status: 'running', progress: 88 })]
    const merged = mergeRunQueueTasks([recent, active])
    expect(merged.map(item => item.id).sort()).toEqual([1, 3])
    expect(merged.find(item => item.id === 3)!.progress).toBe(88)
  })

  it('进行中的任务被最近那一页挤掉时也还在（active=1 单查的意义）', () => {
    // 场景：先起一条长任务（id 小），之后又提交了 50 条 → id 小的那条不在「最近一页」里
    const longRunning = task({ id: 7, status: 'running' })
    const recentPage = Array.from({ length: 3 }, (_, index) => task({ id: 100 + index, status: 'succeeded', finished_at: 1 }))
    const merged = mergeRunQueueTasks([recentPage, [longRunning]])
    expect(merged.some(item => item.id === 7)).toBe(true)
  })

  it('空输入给空数组', () => {
    expect(mergeRunQueueTasks([])).toEqual([])
    expect(mergeRunQueueTasks([[], []])).toEqual([])
  })
})

describe('runQueueProgress', () => {
  it('生成中给 0-100 的整数', () => {
    expect(runQueueProgress(task({ status: 'running', progress: 42.6 }))).toBe(43)
    expect(runQueueProgress(task({ status: 'running', progress: -5 }))).toBe(0)
    expect(runQueueProgress(task({ status: 'running', progress: 300 }))).toBe(100)
    expect(runQueueProgress(task({ status: 'running', progress: 0 }))).toBe(0)
  })

  it('排队中 / 已结束没有进度', () => {
    expect(runQueueProgress(task({ status: 'pending', progress: 60 }))).toBe(0)
    expect(runQueueProgress(task({ status: 'succeeded', progress: 100 }))).toBe(0)
  })
})

describe('runQueuePoints', () => {
  it('进行中显示预扣', () => {
    expect(runQueuePoints(task({ status: 'pending', points_frozen: 8 }))).toEqual({ kind: 'frozen', points: 8 })
  })

  it('成功显示实耗', () => {
    expect(runQueuePoints(task({ status: 'succeeded', cost_points: 8, points_frozen: 10 }))).toEqual({ kind: 'cost', points: 8 })
  })

  it('失败 / 取消说明已退回', () => {
    expect(runQueuePoints(task({ status: 'failed', points_frozen: 8 }))).toEqual({ kind: 'refunded', points: 0 })
    expect(runQueuePoints(task({ status: 'cancelled' }))).toEqual({ kind: 'refunded', points: 0 })
  })

  it('没有点数可说时返回 none（显示成空白，不写 0 点）', () => {
    expect(runQueuePoints(task({ status: 'running', points_frozen: 0 }))).toEqual({ kind: 'none', points: 0 })
    expect(runQueuePoints(task({ status: 'succeeded', cost_points: 0 }))).toEqual({ kind: 'none', points: 0 })
  })
})

describe('runQueueError', () => {
  it('只有失败才给原因', () => {
    expect(runQueueError(task({ status: 'failed', error_msg: '内容审核未通过' }))).toBe('内容审核未通过')
    expect(runQueueError(task({ status: 'failed', error_msg: '  ' }))).toBe('')
    expect(runQueueError(task({ status: 'succeeded', error_msg: '旧错误' }))).toBe('')
    expect(runQueueError(task({ status: 'running', error_msg: '旧错误' }))).toBe('')
  })
})

describe('runQueueAction', () => {
  it('进行中可取消，失败 / 取消可重试，成功没有动作', () => {
    expect(runQueueAction('pending')).toBe('cancel')
    expect(runQueueAction('running')).toBe('cancel')
    expect(runQueueAction('failed')).toBe('retry')
    expect(runQueueAction('cancelled')).toBe('retry')
    expect(runQueueAction('succeeded')).toBeNull()
  })
})

describe('runQueueLocate', () => {
  const nodes = new Set(['image-1', 'video-2'])
  const hasNode = (id: string) => nodes.has(id)

  it('节点还在就能定位', () => {
    expect(runQueueLocate(task({ node_id: 'image-1' }), hasNode)).toEqual({ ok: true })
  })

  it('节点被删给出原因', () => {
    expect(runQueueLocate(task({ node_id: 'image-9' }), hasNode)).toEqual({ ok: false, reason: '节点已删除' })
  })

  it('没有节点（对话栏的文本任务）给出原因', () => {
    expect(runQueueLocate(task({ node_id: '', type: 'text' }), hasNode)).toEqual({ ok: false, reason: '这条任务没有对应节点' })
  })
})

describe('runQueueActiveCount / runQueueBadge / runQueueClock', () => {
  it('只数进行中的', () => {
    const list = [task({ id: 1, status: 'pending' }), task({ id: 2, status: 'running' }), task({ id: 3, status: 'failed' })]
    expect(runQueueActiveCount(list)).toBe(2)
    expect(runQueueActiveCount([])).toBe(0)
  })

  it('角标超过上限显示 99+', () => {
    expect(runQueueBadge(0)).toBe('0')
    expect(runQueueBadge(7)).toBe('7')
    expect(runQueueBadge(120)).toBe('99+')
  })

  it('今天只给时分，更早带月日，没时间戳给空串', () => {
    const now = new Date(2026, 9, 9, 20, 0, 0).getTime()
    const today = new Date(2026, 9, 9, 8, 5, 0).getTime() / 1000
    const older = new Date(2026, 9, 8, 23, 59, 0).getTime() / 1000
    expect(runQueueClock(today, now)).toBe('08:05')
    expect(runQueueClock(older, now)).toBe('10-08 23:59')
    expect(runQueueClock(0, now)).toBe('')
  })
})
