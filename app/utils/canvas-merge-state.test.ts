import { describe, expect, it } from 'vitest'
import { canvasMergeUploading, flushMergeUploads, hasPendingMergeUploads, trackMergeUpload } from './canvas-merge-state'

describe('hasPendingMergeUploads', () => {
  it('上传进行中为 true，结束后为 false', async () => {
    let release!: () => void
    const task = new Promise<void>((resolve) => { release = resolve })
    trackMergeUpload(task)
    expect(hasPendingMergeUploads()).toBe(true)
    expect(canvasMergeUploading.value).toBe(true)
    release()
    await flushMergeUploads()
    expect(hasPendingMergeUploads()).toBe(false)
    expect(canvasMergeUploading.value).toBe(false)
  })
})
