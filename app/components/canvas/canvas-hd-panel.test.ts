import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { estimateSecondDuration } from '~/utils/model-price'

describe('视频高清面板', () => {
  const panel = readFileSync(new URL('./CanvasHdPanel.vue', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('./CanvasWorkspace.vue', import.meta.url), 'utf8')
  const tools = readFileSync(new URL('../../composables/useCanvasVideoTools.ts', import.meta.url), 'utf8')

  it('没有单价时写未定价，单价从工作区目录接进来', () => {
    const hdTag = workspace.match(/<CanvasHdPanel[\s\S]*?\/>/)?.[0] || ''
    expect(panel).toContain("return t('未定价')")
    expect(panel).not.toContain('cost: 24')
    expect(hdTag).toContain('CanvasHdPanel')
    expect(hdTag).toContain(':cost="hdCost"')
  })

  it('按秒计价与服务端同一口径：不足 1 秒按 5 秒', () => {
    expect(estimateSecondDuration(12.9)).toBe(12)
    expect(estimateSecondDuration(1)).toBe(1)
    expect(estimateSecondDuration(0)).toBe(5)
    expect(estimateSecondDuration(0.4)).toBe(5)
  })

  it('报价读源视频时长，提交把同一条 duration 带上', () => {
    expect(workspace).toContain('estimateSecondDuration(hdSourceSeconds.value)')
    expect(workspace).not.toContain('duration: 5')
    expect(tools).toContain('loadHdSourceSeconds')
    expect(tools).toContain('jobParams.duration = estimateSecondDuration(hdSourceSeconds.value)')
  })

  it('节点在跑时禁用提交，深度捕捉同一条 busy', () => {
    expect(workspace).toContain(':submitting="mediaPanelSubmitting"')
    expect(workspace).toContain("node.data.taskStatus === 'pending' || node.data.taskStatus === 'running'")
    expect(panel).toContain(':disabled="submitting || !upscaleState.available"')
  })
})
