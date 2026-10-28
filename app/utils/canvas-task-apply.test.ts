import { describe, expect, it } from 'vitest'
import { canvasTaskPatch } from './canvas-task-apply'

describe('canvasTaskPatch', () => {
  it('进行中只写状态，不改 content', () => {
    expect(canvasTaskPatch({
      id: 9,
      status: 'running',
      progress: 40,
      type: 'image',
      result_text: '',
      result_url: '',
      result_asset_id: 0,
      error_msg: '',
    }, '生成失败')).toEqual({
      taskId: 9,
      taskStatus: 'running',
      taskProgress: 40,
      taskError: '',
    })
  })

  it('图片成功写回地址和资产', () => {
    expect(canvasTaskPatch({
      id: 2,
      status: 'succeeded',
      progress: 100,
      type: 'image',
      result_text: '',
      result_url: 'https://cdn.example/a.png',
      result_asset_id: 88,
      error_msg: '',
    }, '生成失败')).toEqual({
      taskId: 2,
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
      content: 'https://cdn.example/a.png',
      assetId: 88,
    })
  })

  it('文本成功优先写 result_text', () => {
    const patch = canvasTaskPatch({
      id: 3,
      status: 'succeeded',
      progress: 100,
      type: 'text',
      result_text: 'hello',
      result_url: 'https://cdn.example/ignore.png',
      result_asset_id: 0,
      error_msg: '',
    }, '生成失败')
    expect(patch.content).toBe('hello')
  })

  it('失败带上后端错误，没有时用兜底文案', () => {
    expect(canvasTaskPatch({
      id: 4,
      status: 'failed',
      progress: 0,
      type: 'video',
      result_text: '',
      result_url: '',
      result_asset_id: 0,
      error_msg: '',
    }, '生成失败').taskError).toBe('生成失败')
  })
})
