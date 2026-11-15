import { describe, expect, it } from 'vitest'
import {
  chatMediaCardAwaiting,
  chatMediaReport,
  chatMediaVerdict,
  nodeTaskSettle,
  settleChatMediaMessage,
} from './canvas-chat-media-report'

const texts = { stopped: '已停止', failed: '生成失败' }
const cardTexts = { placed: '视频已生成', waiting: '还在排队', failed: '生成失败', hints: ['正在生成视频…'] }

function lockedCard() {
  return { locked: true } as { locked: boolean, waitingTaskId?: number, waitingNodeId?: string }
}

describe('S-3 单条出片：等待结果 → 报告', () => {
  it('等待到时任务仍在 running：报 pending 而不是失败，并带上任务号', () => {
    const report = chatMediaReport('video-1', { taskId: 42, status: 'running' }, texts)
    expect(report).toEqual({ ok: false, pending: true, nodeId: 'video-1', taskId: 42 })
    expect(report.error).toBeUndefined()
  })

  it('仍在 pending（排队）同样算进行中', () => {
    expect(chatMediaReport('video-1', { taskId: 7, status: 'pending' }, texts).pending).toBe(true)
  })

  it('后端终态各归各位：成功带地址，取消与失败带各自的说明', () => {
    expect(chatMediaReport('n', { taskId: 1, status: 'succeeded', url: 'https://x/a.mp4' }, texts)).toEqual({ ok: true, nodeId: 'n', url: 'https://x/a.mp4' })
    expect(chatMediaReport('n', { taskId: 1, status: 'cancelled' }, texts)).toEqual({ ok: false, nodeId: 'n', error: '已停止' })
    expect(chatMediaReport('n', { taskId: 1, status: 'failed', error: '上游超时' }, texts)).toEqual({ ok: false, nodeId: 'n', error: '上游超时' })
    expect(chatMediaReport('n', { taskId: 1, status: 'failed' }, texts).error).toBe('生成失败')
  })
})

describe('S-3 单条出片：报告 → 卡片是否解锁', () => {
  it('只有终态失败 / 取消才解锁；仍在进行与已出片都保持锁定', () => {
    expect(chatMediaVerdict({ ok: false, pending: true })).toEqual({ state: 'waiting', unlock: false })
    expect(chatMediaVerdict({ ok: true })).toEqual({ state: 'placed', unlock: false })
    expect(chatMediaVerdict({ ok: false })).toEqual({ state: 'failed', unlock: true })
  })

  it('等待超时：气泡换成「还在排队」，不标错误，卡片仍锁定并记下在等的任务', () => {
    const msg = { text: '给你做一条\n\n正在生成视频…', error: false, card: lockedCard() }
    settleChatMediaMessage(msg, { ok: false, pending: true, nodeId: 'video-1', taskId: 42 }, cardTexts)
    expect(msg.text).toBe('给你做一条\n\n还在排队')
    expect(msg.error).toBe(false)
    expect(msg.card).toEqual({ locked: true, waitingTaskId: 42, waitingNodeId: 'video-1' })
    expect(chatMediaCardAwaiting(msg.card)).toBe(true)
  })

  it('之后后端报成功：提示换成已出片并带缩略图，卡片不解锁（没有第二次扣分的入口）', () => {
    const msg: { text: string, error?: boolean, thumb?: string, card: ReturnType<typeof lockedCard> } = { text: '给你做一条\n\n还在排队', card: { locked: true, waitingTaskId: 42, waitingNodeId: 'video-1' } }
    settleChatMediaMessage(msg, { ok: true, nodeId: 'video-1', url: 'https://x/a.mp4' }, cardTexts)
    expect(msg.text).toBe('给你做一条\n\n视频已生成')
    expect(msg.thumb).toBe('https://x/a.mp4')
    expect(msg.card).toEqual({ locked: true })
    expect(chatMediaCardAwaiting(msg.card)).toBe(false)
  })

  it('之后后端报失败：这时才解锁卡片并显示失败原因', () => {
    const msg = { text: '还在排队', error: false, card: { locked: true, waitingTaskId: 42, waitingNodeId: 'video-1' } as ReturnType<typeof lockedCard> }
    settleChatMediaMessage(msg, { ok: false, nodeId: 'video-1', error: '上游超时' }, cardTexts)
    expect(msg.card).toEqual({ locked: false })
    expect(msg.error).toBe(true)
    expect(msg.text).toBe('上游超时')
  })

  it('连续两次仍在进行：提示不叠加', () => {
    const msg = { text: '正在生成视频…', card: lockedCard() }
    const report = { ok: false, pending: true, nodeId: 'v', taskId: 1 }
    settleChatMediaMessage(msg, report, cardTexts)
    settleChatMediaMessage(msg, report, cardTexts)
    expect(msg.text).toBe('还在排队')
  })
})

describe('S-3 跟踪中的节点任务', () => {
  it('还在跑就继续等，后端给了终态才算结束', () => {
    expect(nodeTaskSettle({ taskId: 42, status: 'running' }, 42, true)).toBe('waiting')
    expect(nodeTaskSettle({ taskId: 42, status: 'pending' }, 42, true)).toBe('waiting')
    expect(nodeTaskSettle({ taskId: 42, status: 'succeeded' }, 42, true)).toBe('settled')
    expect(nodeTaskSettle({ taskId: 42, status: 'failed' }, 42, true)).toBe('settled')
    expect(nodeTaskSettle({ taskId: 42, status: 'cancelled' }, 42, true)).toBe('settled')
  })

  it('节点换了任务或被删掉：算丢失，不能当成终态', () => {
    expect(nodeTaskSettle({ taskId: 43, status: 'succeeded' }, 42, true)).toBe('lost')
    expect(nodeTaskSettle(null, 42, true)).toBe('lost')
  })

  it('画布还没载入这个节点（刷新后）：先等着', () => {
    expect(nodeTaskSettle(null, 42, false)).toBe('waiting')
  })
})
