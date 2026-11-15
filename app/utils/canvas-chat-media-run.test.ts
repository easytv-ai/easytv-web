import { describe, expect, it } from 'vitest'
import {
  adoptOrphanChatMediaRuns,
  beginChatMediaRun,
  chatMediaCardAwaiting,
  chatMediaCardRunning,
  chatMediaReport,
  endChatMediaRun,
  findRunningChatMedia,
  noteChatMediaTask,
  settleChatMediaMessage,
  type ChatMediaRunCard,
} from './canvas-chat-media-report'

type Row = { id: number, text: string, error?: boolean, thumb?: string, card?: ChatMediaRunCard | null }

const TEXTS = { placed: '已放到画布', waiting: '还在生成', failed: '生成失败', hints: ['正在生成图片…'] }

function card(patch: ChatMediaRunCard = {}): ChatMediaRunCard {
  return { kind: 'media-confirm', locked: false, ...patch }
}

/** 一张已经出片成功的卡：成功后保持 locked，但不带 running */
function succeededRow(id: number): Row {
  return { id, text: '已放到画布', thumb: 'https://cdn/x.png', card: card({ locked: true }) }
}

function runningRow(id: number, taskId = 0, nodeId = ''): Row {
  const c = card()
  beginChatMediaRun(c)
  noteChatMediaTask(c, taskId, nodeId)
  return { id, text: '正在生成图片…', card: c }
}

describe('「停止」兜底只认出片中的卡', () => {
  it('没有出片中的卡时不返回更早那张已成功的卡', () => {
    const rows = [succeededRow(1), { id: 2, text: '普通回复' }]
    expect(findRunningChatMedia(rows)).toBeNull()
    expect(rows[0]!.card!.locked).toBe(true)
  })

  it('有出片中的卡时返回它，而不是它前后已成功 / 已跳过 / 在等后端的卡', () => {
    const running = runningRow(2)
    const awaiting: Row = { id: 3, text: '', card: card({ locked: true, running: true, waitingTaskId: 9 }) }
    const skipped: Row = { id: 4, text: '', card: card({ locked: true, skipped: true, running: true }) }
    expect(findRunningChatMedia([succeededRow(1), running, awaiting, skipped])).toBe(running)
  })

  it('一轮结束后（回报到了 / 取消成功）不再算出片中', () => {
    const row = runningRow(1, 77, 'image-1')
    expect(chatMediaCardRunning(row.card)).toBe(true)
    endChatMediaRun(row.card!)
    expect(chatMediaCardRunning(row.card)).toBe(false)
    expect(row.card).toEqual({ kind: 'media-confirm', locked: true })
  })

  it('别的卡种即使 locked 也不算', () => {
    expect(chatMediaCardRunning({ kind: 'generate', locked: true, running: true })).toBe(false)
  })
})

describe('出片途中切走会话，回来按任务 id 找后端对账', () => {
  it('被丢弃的出片中卡转成「等后端终态」，卡仍锁着', () => {
    const row = runningRow(1, 77, 'image-1')
    expect(adoptOrphanChatMediaRuns([succeededRow(0), row])).toBe(1)
    expect(row.card).toEqual({ kind: 'media-confirm', locked: true, waitingTaskId: 77, waitingNodeId: 'image-1' })
    expect(chatMediaCardAwaiting(row.card)).toBe(true)
    // 再进一次不重复转
    expect(adoptOrphanChatMediaRuns([row])).toBe(0)
  })

  it('后端说已成功：标成已放到画布，卡保持锁定（不能再点一次再扣一次）', () => {
    const row = runningRow(1, 77, 'image-1')
    adoptOrphanChatMediaRuns([row])
    const report = chatMediaReport('image-1', { taskId: 77, status: 'succeeded', url: 'https://cdn/a.png' }, { stopped: '已停止', failed: '生成失败' })
    const verdict = settleChatMediaMessage(row, report, TEXTS)
    expect(verdict).toEqual({ state: 'placed', unlock: false })
    expect(row.card!.locked).toBe(true)
    expect(row.card!.waitingTaskId).toBeUndefined()
    expect(row.thumb).toBe('https://cdn/a.png')
    expect(row.text).toBe('已放到画布')
  })

  it('后端说已取消 / 失败：解锁', () => {
    for (const status of ['cancelled', 'failed']) {
      const row = runningRow(1, 77, 'image-1')
      adoptOrphanChatMediaRuns([row])
      const report = chatMediaReport('image-1', { taskId: 77, status, error: status === 'failed' ? '模型报错' : '' }, { stopped: '已停止', failed: '生成失败' })
      expect(settleChatMediaMessage(row, report, TEXTS).unlock).toBe(true)
      expect(row.card!.locked).toBe(false)
      expect(row.text).toBe(status === 'failed' ? '模型报错' : '已停止')
    }
  })

  it('后端说还在跑：继续锁着等，记着任务与节点', () => {
    const row = runningRow(1, 77, 'image-1')
    adoptOrphanChatMediaRuns([row])
    const report = chatMediaReport('image-1', { taskId: 77, status: 'running' }, { stopped: '已停止', failed: '生成失败' })
    expect(settleChatMediaMessage(row, report, TEXTS)).toEqual({ state: 'waiting', unlock: false })
    expect(row.card).toMatchObject({ locked: true, waitingTaskId: 77, waitingNodeId: 'image-1' })
  })

  it('当前仍在跑的那一轮不算被丢弃；任务还没建出来的也不转（没有可问的 id，不解锁）', () => {
    const live = runningRow(1, 77, 'image-1')
    const noTask = runningRow(2)
    expect(adoptOrphanChatMediaRuns([live, noTask], 77)).toBe(0)
    expect(live.card!.running).toBe(true)
    expect(noTask.card).toEqual({ kind: 'media-confirm', locked: true, running: true })
  })

  it('重新确认一次会清掉上一轮记的任务', () => {
    const row = runningRow(1, 77, 'image-1')
    beginChatMediaRun(row.card!)
    expect(row.card).toEqual({ kind: 'media-confirm', locked: true, running: true })
  })
})
