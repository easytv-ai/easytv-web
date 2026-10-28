import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 运行队列的接线断言（vitest 是 node 环境、没有挂载能力，照 canvas-workflow-panel.test.ts
 * / canvas-inspector-template.test.ts 的做法读源码）。锁的是三件最容易做歪的事：
 * 面板只有既有端点能给的按钮、定位复用画布的选中 / 居中、刷新不另起一套定时器。
 */
const PANEL = 'app/components/canvas/CanvasRunQueuePanel.vue'
const COMPOSABLE = 'app/composables/useCanvasRunQueue.ts'
const RAIL = 'app/components/canvas/CanvasToolsRail.vue'
const WORKSPACE = 'app/components/canvas/CanvasWorkspace.vue'
const CHAT = 'app/components/canvas/CanvasChat.vue'
const PAGE = 'app/pages/canvas/index.vue'

const read = (path: string) => readFileSync(resolve(path), 'utf8')

describe('CanvasRunQueuePanel', () => {
  const src = read(PANEL)

  it('两段：进行中（排队 / 生成中带进度）与刚结束', () => {
    expect(src).toContain('runQueueSections')
    expect(src).toContain("t('进行中')")
    expect(src).toContain("t('刚结束')")
    expect(src).toContain('row.progress')
  })

  it('每条显示模型、类型、提交时间、消耗点数', () => {
    expect(src).toContain('prettyModelSlug')
    expect(src).toContain('t(row.typeKey)')
    expect(src).toContain('row.clock')
    expect(src).toContain("t('预扣 {n} 积分'")
    expect(src).toContain("t('消耗 {n} 积分'")
    expect(src).toContain("t('积分已退回')")
  })

  it('失败条目带原因', () => {
    expect(src).toContain('runQueueError')
    expect(src).toContain('canvas-queue__error')
  })

  it('空态 / 加载 / 错误三态都在（有列表时错误只占一行，不盖住队列）', () => {
    expect(src).toContain("t('加载中…')")
    expect(src).toContain("t('这张画布还没有跑过任务：选中节点点「生成」，任务会出现在这里。')")
    expect(src).toContain("t('最近半小时没有进行中或刚结束的任务，更早的在任务中心。')")
    expect(src).toContain('!rows.length && tasks.length')
    expect(src).toContain('v-else-if="error && !rows.length"')
    expect(src).toContain('canvas-queue__error-line')
    expect(src).toContain("t('画布还没保存：保存后这里会列出这张画布的任务')")
  })

  it('节点不在的条目禁用并写明原因', () => {
    expect(src).toContain('runQueueLocate')
    expect(src).toMatch(/:disabled="!row\.canLocate"/)
    expect(src).toContain('row.reason')
  })

  it('只给能接既有端点的动作按钮：进行中取消、失败 / 取消重试', () => {
    expect(src).toMatch(/v-if="row\.action === 'cancel'"/)
    expect(src).toMatch(/@click\.stop="emit\('cancel', row\.task\)"/)
    expect(src).toMatch(/@click\.stop="emit\('retry', row\.task\)"/)
    // 成功任务没有「重新生成」这类编出来的按钮（画布节点上另有入口）
    expect(src).not.toContain("t('重新生成')")
    expect(src).not.toContain('retake')
    expect(src).not.toContain('upscale')
  })

  it('面板只管渲染：不直连接口、不起定时器', () => {
    expect(src).not.toContain('taskApi')
    expect(src).not.toContain('fetch(')
    expect(src).not.toContain('startHiddenAwarePoll')
    expect(src).not.toContain('setInterval')
    expect(src).not.toContain('setTimeout')
  })

  it('emit 与点一条定位的接线', () => {
    expect(src).toContain('locate: [task: GenerationTask]')
    expect(src).toContain('cancel: [task: GenerationTask]')
    expect(src).toContain('retry: [task: GenerationTask]')
    expect(src).toMatch(/@click="emit\('locate', row\.task\)"/)
    expect(src).toContain("t('定位到节点')")
  })
})

describe('useCanvasRunQueue（刷新与端点）', () => {
  const src = read(COMPOSABLE)

  it('刷新沿用画布既有轮询写法与间隔，不另开一套定时器', () => {
    expect(src).toContain("import { startHiddenAwarePoll } from '~/utils/hidden-poll'")
    expect(src).toContain("import { CANVAS_TASK_POLL_MS } from '~/composables/useCanvasJobPolling'")
    expect(src).toContain('startHiddenAwarePoll(() => { void load() }, CANVAS_TASK_POLL_MS)')
    expect(src).not.toContain('setInterval')
    expect(src).not.toContain('setTimeout')
  })

  it('有进行中的任务 / 面板开着才轮询，其余时刻停表', () => {
    expect(src).toMatch(/function needPolling\(\)/)
    expect(src).toContain('opts.open() || activeCount.value > 0')
  })

  it('进行中与最近各查一路再合并：提交高峰时进行中不会被最近一页挤掉', () => {
    expect(src).toContain('taskApi.list({ canvas_id: canvasId, active: 1, page: 1, page_size: RUN_QUEUE_ACTIVE_PAGE_SIZE })')
    expect(src).toContain('taskApi.list({ canvas_id: canvasId, page: 1, page_size: RUN_QUEUE_PAGE_SIZE })')
    expect(src).toContain('mergeRunQueueTasks([')
    // 进行中那一路没查到不能当成「没有进行中」：那会漏行、误停轮询、少算角标
    expect(src).toMatch(/if \(!activeOk\) \{[\s\S]{0,160}error\.value =/)
  })

  it('画布内提交任务会立刻查一次（否则面板关着时新任务与角标要等手动打开才出现）', () => {
    expect(src).toMatch(/function noteSubmitted\(\)/)
    expect(src).toContain('return load(true)')
    // 提交密集时靠合并兜住：进行中的那一拍查过再补一次
    expect(src).toMatch(/if \(inflight\) \{\s*if \(force\)\s*queued = true/)
  })

  it('只用既有端点：列表 + 取消 + 重试', () => {
    expect(src).toContain('taskApi.cancel(task.id)')
    expect(src).toContain('taskApi.retry(task.id)')
    // 不加新端点：没有自造路径
    expect(src).not.toMatch(/http\.(get|post|put|delete)/)
  })

  it('失败节点卡片走同一条重试，跟练期间不露按钮', () => {
    const node = read('app/components/canvas/CanvasNode.vue')
    const workspace = read(WORKSPACE)
    expect(node).toContain("canvasTaskRetry.value = { seq: Date.now(), nodeId: props.id, taskId }")
    expect(node).toContain('canRetryTask')
    expect(node).toContain("t('重试')")
    expect(workspace).toContain('canvas-task-retry')
    expect(workspace).toContain('onRunQueueRetry({ id: payload.taskId, node_id: payload.nodeId }')
  })

  it('重试出来的新任务接回既有轮询并写回节点', () => {
    expect(src).toContain('opts.pollTask?.(fresh.node_id, fresh.id)')
    expect(src).toContain('opts.applyTaskToNode?.(nodeId, patch)')
  })
})

describe('画布接线', () => {
  it('入口在工具轨：图标按钮 + 进行中角标 + queue 事件', () => {
    const src = read(RAIL)
    expect(src).toContain("t('运行队列')")
    expect(src).toContain("emit('queue')")
    expect(src).toContain('canvas-tools__badge')
    expect(src).toContain('queueActive')
  })

  it('工作区：面板懒加载 + 定位复用 absPosition / setCenter + 与另外两个面板互相避让', () => {
    const src = read(WORKSPACE)
    expect(src).toContain("lazyOverlay(() => import('~/components/canvas/CanvasRunQueuePanel.vue'))")
    expect(src).toContain('@queue="toggleRunQueue()"')
    expect(src).toMatch(/function onRunQueueLocate\(/)
    expect(src).toContain('setCenter(abs.x + box.w / 2, abs.y + box.h / 2, { zoom })')
    expect(src).toContain('absPosition(node, nodes.value)')
    expect(src).toContain('node.selected = true')
    // 开一个关另一个：运行队列 ↔ 工作流 / 一稿多版
    expect(src).toMatch(/function toggleRunQueue\(\)[\s\S]{0,220}workflowPanelOpen\.value = false[\s\S]{0,120}matrixPanelOpen\.value = false/)
    expect(src).toMatch(/function openWorkflowPanel\(\)[\s\S]{0,200}runQueueOpen\.value = false/)
    expect(src).toMatch(/function toggleMatrixPanel\(\)[\s\S]{0,200}runQueueOpen\.value = false/)
  })

  it('提交任务的路径都通知队列（画布内提交后角标立刻出现）', () => {
    const workspace = read(WORKSPACE)
    // 所有提交路径共用的轮询入口被包了一层：先通知队列，再走原来的 pollTask / pollMediaJob
    expect(workspace).toContain('pollTask: pollTaskRaw')
    expect(workspace).toContain('pollMediaJob: pollMediaJobRaw')
    expect(workspace).toMatch(/function pollTask\(nodeId: string, taskId: number\) \{\s*runQueueNotify\.submitted\(\)\s*pollTaskRaw\(nodeId, taskId\)/)
    expect(workspace).toMatch(/function pollMediaJob\(nodeId: string, jobId: number\) \{\s*runQueueNotify\.submitted\(\)\s*pollMediaJobRaw\(nodeId, jobId\)/)
    expect(workspace).toContain('runQueueNotify.submitted = () => { void runQueue.noteSubmitted() }')
    // 对话栏的文本 / 结合画布任务不走节点轮询：由 chat emit → 页面 → 工作区
    const chat = read(CHAT)
    expect(chat).toContain('taskStarted: []')
    expect(chat.match(/emit\('taskStarted'\)/g)?.length).toBe(2)
    expect(read(PAGE)).toContain('@task-started="workspace?.refreshRunQueue()"')
    expect(workspace).toContain('openStyleLibrary, refreshRunQueue, locateNode, commentNodeHint })')
  })
})
