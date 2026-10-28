import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startHiddenAwarePoll } from './hidden-poll'

describe('startHiddenAwarePoll', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('页签藏起来时不调用，露出来后下一次才查', () => {
    vi.useFakeTimers()
    let hidden = true
    let calls = 0
    const stop = startHiddenAwarePoll(() => {
      calls += 1
    }, 1000, () => hidden)

    vi.advanceTimersByTime(3000)
    expect(calls).toBe(0)

    hidden = false
    vi.advanceTimersByTime(1000)
    expect(calls).toBe(1)

    stop()
    vi.advanceTimersByTime(3000)
    expect(calls).toBe(1)
  })

  it('重新可见时立刻再查一次，不必干等到下一个间隔', () => {
    vi.useFakeTimers()
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', {
      hidden: true,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    })
    let hidden = true
    let calls = 0
    const stop = startHiddenAwarePoll(() => {
      calls += 1
    }, 1000, () => hidden)

    hidden = false
    listeners.get('visibilitychange')?.()
    expect(calls).toBe(1)

    stop()
  })
})

describe('页面轮询走 hidden-poll', () => {
  it('一句话成片合成轮询藏页签时不打接口', () => {
    const src = readFileSync('app/pages/create/index.vue', 'utf8')
    expect(src).toContain("import { startHiddenAwarePoll } from '~/utils/hidden-poll'")
    expect(src).toContain('startHiddenAwarePoll(() => { void pollCompose() }, POLL_MS)')
    expect(src).not.toContain('composePoller')
  })

  it('主体库参考图轮询藏页签时不打接口', () => {
    const src = readFileSync('app/pages/subjects/index.vue', 'utf8')
    expect(src).toContain("import { startHiddenAwarePoll } from '~/utils/hidden-poll'")
    expect(src).toContain('startHiddenAwarePoll(() => { void pollGen(id) }, POLL_MS)')
    expect(src).not.toContain('setInterval(() => void pollGen')
  })

  it('支付二维码轮询藏页签时不打接口', () => {
    const src = readFileSync('app/components/pricing/PayQrModal.vue', 'utf8')
    expect(src).toContain("import { startHiddenAwarePoll } from '~/utils/hidden-poll'")
    expect(src).toContain('startHiddenAwarePoll(() => poll(), POLL_MS)')
  })

  it('充值到账轮询藏页签时不打接口', () => {
    const src = readFileSync('app/pages/console/recharge.vue', 'utf8')
    expect(src).toContain("import { startHiddenAwarePoll } from '~/utils/hidden-poll'")
    expect(src).toContain('stopRechargePoll = startHiddenAwarePoll(async () => {')
  })
})
