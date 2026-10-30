import { describe, expect, it } from 'vitest'
import {
  AUTOSAVE_DELAY_MS,
  AUTOSAVE_MAX_WAIT_MS,
  autosaveDelayMs,
  beginSave,
  canAutoSave,
  createSaveMachine,
  createSerialRunner,
  finishSave,
  gateCanvasSave,
  hasUnsavedChanges,
  isCanvasVersionConflictMessage,
  markChanged,
  needsFollowUp,
  releaseSave,
  resolveConflict,
  saveStatus,
  isSuspiciousWipe,
} from './canvas-save-machine'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('canvas save machine', () => {
  it('新草稿没改动是 idle，读到的画布是 saved', () => {
    expect(saveStatus(createSaveMachine())).toBe('idle')
    expect(saveStatus(createSaveMachine({ persisted: true }))).toBe('saved')
    expect(hasUnsavedChanges(createSaveMachine({ persisted: true }))).toBe(false)
  })

  it('改动后 dirty，保存中 saving，成功后 saved', () => {
    let m = markChanged(createSaveMachine({ persisted: true }))
    expect(saveStatus(m)).toBe('dirty')
    expect(canAutoSave(m)).toBe(true)
    m = beginSave(m)
    expect(saveStatus(m)).toBe('saving')
    m = releaseSave(m)
    expect(saveStatus(m)).toBe('dirty')
    expect(m.failed).toBe(false)
    m = beginSave(m)
    expect(canAutoSave(m)).toBe(false)
    m = finishSave(m, 'ok')
    expect(saveStatus(m)).toBe('saved')
    expect(hasUnsavedChanges(m)).toBe(false)
  })

  it('保存中再改：markChanged 不会打断进行中标志，互斥仍然有效', () => {
    let m = beginSave(markChanged(createSaveMachine({ persisted: true })))
    m = markChanged(m)
    expect(m.inFlight).toBe(true)
    expect(saveStatus(m)).toBe('saving')
    expect(canAutoSave(m)).toBe(false)
  })

  it('旧响应返回：保存途中有新改动，不能标成已保存，并且要再存一次', () => {
    let m = beginSave(markChanged(createSaveMachine({ persisted: true })))
    m = markChanged(m)
    m = finishSave(m, 'ok')
    expect(m.savedRevision).toBe(1)
    expect(m.dirtyRevision).toBe(2)
    expect(saveStatus(m)).toBe('dirty')
    expect(hasUnsavedChanges(m)).toBe(true)
    expect(needsFollowUp(m)).toBe(true)
    m = finishSave(beginSave(m), 'ok')
    expect(saveStatus(m)).toBe('saved')
    expect(needsFollowUp(m)).toBe(false)
  })

  it('失败后离开：error 视为未保存，要拦截；也不会自动再排一次', () => {
    let m = finishSave(beginSave(markChanged(createSaveMachine({ persisted: true }))), 'error')
    expect(saveStatus(m)).toBe('error')
    expect(hasUnsavedChanges(m)).toBe(true)
    expect(needsFollowUp(m)).toBe(false)
    // 失败后用户继续改：仍可自动保存，成功后恢复
    m = markChanged(m)
    expect(canAutoSave(m)).toBe(true)
    m = finishSave(beginSave(m), 'ok')
    expect(saveStatus(m)).toBe('saved')
    expect(hasUnsavedChanges(m)).toBe(false)
  })

  it('没改动的保存失败也算未保存（error 一律拦截离开）', () => {
    const m = finishSave(beginSave(createSaveMachine({ persisted: true })), 'error')
    expect(hasUnsavedChanges(m)).toBe(true)
  })

  it('冲突：停掉自动保存，继续改也不恢复，直到用户选择', () => {
    let m = finishSave(beginSave(markChanged(createSaveMachine({ persisted: true }))), 'conflict')
    expect(saveStatus(m)).toBe('conflict')
    expect(canAutoSave(m)).toBe(false)
    expect(needsFollowUp(m)).toBe(false)
    expect(hasUnsavedChanges(m)).toBe(true)
    m = markChanged(m)
    expect(canAutoSave(m)).toBe(false)
    expect(saveStatus(m)).toBe('conflict')
  })

  it('冲突后选「重新加载」：本地改动作废，回到已保存', () => {
    let m = finishSave(beginSave(markChanged(createSaveMachine({ persisted: true }))), 'conflict')
    m = resolveConflict(markChanged(m), 'reload')
    expect(saveStatus(m)).toBe('saved')
    expect(hasUnsavedChanges(m)).toBe(false)
  })

  it('冲突后选「覆盖」：解除冲突，改动仍待保存，保存成功后 saved', () => {
    let m = finishSave(beginSave(markChanged(createSaveMachine({ persisted: true }))), 'conflict')
    m = resolveConflict(m, 'overwrite')
    expect(canAutoSave(m)).toBe(true)
    expect(saveStatus(m)).toBe('dirty')
    m = finishSave(beginSave(m), 'ok')
    expect(saveStatus(m)).toBe('saved')
  })

  it('识别后端版本冲突文案', () => {
    expect(isCanvasVersionConflictMessage('画布已在其他地方修改，请刷新后再保存')).toBe(true)
    expect(isCanvasVersionConflictMessage('保存失败')).toBe(false)
    expect(isCanvasVersionConflictMessage(undefined)).toBe(false)
  })
})

describe('createSerialRunner', () => {
  it('保存中再请求：不并发，结束后合并成一次补存', async () => {
    let active = 0
    let maxActive = 0
    const calls: boolean[] = []
    const gates: Array<ReturnType<typeof deferred>> = []
    const runner = createSerialRunner(async (manual) => {
      calls.push(manual)
      active += 1
      maxActive = Math.max(maxActive, active)
      const gate = deferred()
      gates.push(gate)
      await gate.promise
      active -= 1
    })

    const first = runner.request()
    expect(runner.busy).toBe(true)
    const second = runner.request()
    const third = runner.request(true)
    expect(calls).toEqual([false])

    gates[0]!.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([false, true])
    gates[1]!.resolve()
    await Promise.all([first, second, third])
    expect(maxActive).toBe(1)
    expect(calls).toEqual([false, true])
    expect(runner.busy).toBe(false)
  })

  it('新建画布：重叠保存只会创建一次', async () => {
    let canvasId = 0
    let created = 0
    let updated = 0
    const runner = createSerialRunner(async () => {
      if (!canvasId) {
        await new Promise(r => setTimeout(r, 5))
        created += 1
        canvasId = 42
      }
      else {
        await new Promise(r => setTimeout(r, 1))
        updated += 1
      }
    })
    await Promise.all([runner.request(), runner.request(), runner.request(true)])
    expect(created).toBe(1)
    expect(updated).toBe(1)
  })

  it('任务抛错后执行器可继续使用', async () => {
    let n = 0
    const runner = createSerialRunner(async () => {
      n += 1
      if (n === 1)
        throw new Error('boom')
    })
    await expect(runner.request()).rejects.toThrow('boom')
    expect(runner.busy).toBe(false)
    await runner.request()
    expect(n).toBe(2)
  })
})

describe('gateCanvasSave', () => {
  it('加载中或只读不保存，跟练和版本冲突也不落库', () => {
    expect(gateCanvasSave({ loading: true, readonly: false, practice: false, conflict: false })).toEqual({ action: 'skip' })
    expect(gateCanvasSave({ loading: false, readonly: true, practice: true, conflict: true })).toEqual({ action: 'skip' })
    expect(gateCanvasSave({ loading: false, readonly: false, practice: true, conflict: true })).toEqual({ action: 'practice' })
    expect(gateCanvasSave({ loading: false, readonly: false, practice: false, conflict: true })).toEqual({ action: 'conflict' })
    expect(gateCanvasSave({ loading: false, readonly: false, practice: false, conflict: false })).toEqual({ action: 'save' })
  })
})

describe('autosaveDelayMs', () => {
  it('第一次改动等满间隔，连续改动从第一次算起不超过最长等待', () => {
    const firstAt = 1_000
    expect(autosaveDelayMs(firstAt, firstAt)).toBe(AUTOSAVE_DELAY_MS)
    expect(autosaveDelayMs(firstAt + 8_000, firstAt)).toBe(AUTOSAVE_MAX_WAIT_MS - 8_000)
    expect(autosaveDelayMs(firstAt + AUTOSAVE_MAX_WAIT_MS + 500, firstAt)).toBe(0)
  })
})

describe('isSuspiciousWipe', () => {
  it('曾有 3 个以上节点、现在只剩 0 或 1 个才算意外清空', () => {
    expect(isSuspiciousWipe(40, 0)).toBe(true)
    expect(isSuspiciousWipe(40, 1)).toBe(true)
    expect(isSuspiciousWipe(3, 0)).toBe(true)
    expect(isSuspiciousWipe(2, 0)).toBe(false)
    expect(isSuspiciousWipe(0, 0)).toBe(false)
    expect(isSuspiciousWipe(40, 2)).toBe(false)
  })
})
