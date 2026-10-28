import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('多角度面板', () => {
  const panel = readFileSync(new URL('./CanvasAnglePanel.vue', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('./CanvasWorkspace.vue', import.meta.url), 'utf8')
  const edits = readFileSync(new URL('../../composables/useCanvasImageEdits.ts', import.meta.url), 'utf8')

  it('报价只认工作区传入的模型，不再自己另挑一条', () => {
    expect(panel).toContain('item.model === props.model')
    expect(panel).not.toContain('pickImageEditModel')
  })

  it('提交和面板读同一条 imageEditModel', () => {
    const angleTag = workspace.match(/<CanvasAnglePanel[\s\S]*?\/>/)?.[0] || ''
    expect(angleTag).toContain(':model="imageEditModel"')
    expect(edits).toContain('const model = imageEditModel.value')
    expect(edits).toMatch(/async function onAngleSubmit[\s\S]*?const model = imageEditModel\.value/)
  })
})
