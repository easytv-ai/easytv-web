import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(path), 'utf8')

describe('画布多段合成接线', () => {
  it('面板只定选项，提交走 compose 时间线快照', () => {
    const panel = read('app/components/canvas/CanvasComposePanel.vue')
    expect(panel).toContain('canvas.compose.title')
    expect(panel).toContain('emit(\'confirm\'')
    expect(panel).toContain('preview')
    expect(panel).toContain('pickComposeBgmId')
    expect(panel).toContain("t('canvas.compose.trimIn')")
    expect(panel).toContain("t('canvas.compose.trimOut')")
    expect(panel).toContain('item.trimIn')
    expect(panel).toContain("emit('persist'")
    expect(panel).not.toContain('timelineApi')
    expect(panel).not.toContain('composeApi')
  })

  it('工作区多选视频才露出入口，确认后交给 useCanvasCompose', () => {
    const workspace = read('app/components/canvas/CanvasWorkspace.vue')
    expect(workspace).toContain('composeAvailable')
    expect(workspace).toContain(':compose-ready="barMode === \'pick\' && composeAvailable"')
    expect(workspace).toContain("mediaActionIfListed(mediaActions.value, 'compose')")
    expect(workspace).toContain('CanvasComposePanel')
    expect(workspace).toContain('submitCompose')
    expect(workspace).toContain('persistComposeTrims')
    expect(workspace).toContain('composeResume')
    expect(workspace).not.toContain('timelineApi.save')
  })

  it('驱动器把时间线放进这次合成请求，不存成片时间线', () => {
    const driver = read('app/composables/useCanvasCompose.ts')
    expect(driver).toContain('composeApi.create')
    expect(driver).toContain('timeline')
    expect(driver).toContain('requestSave')
    expect(driver).toContain('onNode')
    expect(driver).toContain('settleSubmit')
    expect(driver).not.toContain('timelineApi')
  })
})
