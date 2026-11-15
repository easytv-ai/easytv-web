import { describe, expect, it, vi } from 'vitest'
import { consumePracticeRequest, guardPracticeWrites } from './canvas-practice-gate'

function fakeApis() {
  const calls: string[] = []
  const ok = (name: string) => (..._args: unknown[]) => {
    calls.push(name)
    return Promise.resolve({ success: true, message: '', data: { id: 1 } })
  }
  const task = { create: ok('task.create'), get: ok('task.get'), cancel: ok('task.cancel') }
  const canvas = {
    agent: ok('canvas.agent'),
    agentPlan: ok('canvas.agentPlan'),
    chat: { list: ok('chat.list'), create: ok('chat.create'), update: ok('chat.update'), delete: ok('chat.delete') },
  }
  return { calls, task, canvas }
}

describe('N-3 跟练期间对话栏不建任务、不存会话', () => {
  it('跟练中：建任务 / 结合画布 / 存会话都不发请求，回失败并带提示', async () => {
    const { calls, task, canvas } = fakeApis()
    const on = () => true
    const guardedTask = guardPracticeWrites(task, ['create'], on, () => '跟练中不能发送')
    const guardedCanvas = guardPracticeWrites(canvas, ['agent', 'chat.create', 'chat.update', 'chat.delete'], on, () => '跟练中不能发送')

    expect(await guardedTask.create({ type: 'text' })).toEqual({ success: false, message: '跟练中不能发送', data: null })
    expect((await guardedCanvas.agent(1, {})).success).toBe(false)
    expect((await guardedCanvas.chat.create(1, {})).success).toBe(false)
    expect((await guardedCanvas.chat.update(1, 2, {})).success).toBe(false)
    expect((await guardedCanvas.chat.delete(1, 2)).success).toBe(false)
    expect(calls).toEqual([])
  })

  it('跟练中：查询与取消照常放行（停掉跟练前就在跑的任务不能被挡）', async () => {
    const { calls, task, canvas } = fakeApis()
    const guardedTask = guardPracticeWrites(task, ['create'], () => true, () => 'x')
    const guardedCanvas = guardPracticeWrites(canvas, ['agent', 'chat.create'], () => true, () => 'x')
    await guardedTask.get(1)
    await guardedTask.cancel(1)
    await guardedCanvas.agentPlan(1, 2)
    await guardedCanvas.chat.list(1)
    expect(calls).toEqual(['task.get', 'task.cancel', 'canvas.agentPlan', 'chat.list'])
  })

  it('开关是活的：退出跟练后同一个包装对象恢复真提交', async () => {
    const { calls, task } = fakeApis()
    let practice = true
    const guarded = guardPracticeWrites(task, ['create'], () => practice, () => 'x')
    expect((await guarded.create({})).success).toBe(false)
    practice = false
    expect((await guarded.create({})).success).toBe(true)
    expect(calls).toEqual(['task.create'])
  })
})

describe('N-4 跟练入口请求只消费一次', () => {
  it('只读 / 锁定画布把 start 拒了：置位照样复位，下一张画布不会自己开跟练', () => {
    const wanted = { value: true }
    const rejected = vi.fn() // start 里 canEditCanvas 返回 false，会话没起来
    expect(consumePracticeRequest(wanted, () => 'first-video', rejected)).toBe(true)
    expect(rejected).toHaveBeenCalledWith('first-video')
    expect(wanted.value).toBe(false)

    // 换到下一张画布：immediate 监听再跑一次，不应再启动，也不去动预选剧本
    const next = vi.fn()
    const take = vi.fn(() => '')
    expect(consumePracticeRequest(wanted, take, next)).toBe(false)
    expect(next).not.toHaveBeenCalled()
    expect(take).not.toHaveBeenCalled()
  })

  it('被拒之后再点一次入口：请求能再次送达（不再卡死）', () => {
    const wanted = { value: true }
    const start = vi.fn()
    consumePracticeRequest(wanted, () => '', start)
    wanted.value = true
    consumePracticeRequest(wanted, () => '', start)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('start 抛错也不留置位', () => {
    const wanted = { value: true }
    expect(() => consumePracticeRequest(wanted, () => '', () => { throw new Error('boom') })).toThrow('boom')
    expect(wanted.value).toBe(false)
  })
})
