import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 提示词输入区两套渲染路径：图片/视频走 CanvasPromptInput，其余走兜底 textarea。
 * 两者必须用相邻的 v-if/v-else 配对——一旦把 v-if 浮层（如 slash 面板）插在
 * 它们之间，v-else 会挂到错误的前驱上，导致两个控件同时渲染、占位文案与输入内容重复。
 */
describe('CanvasInspector 提示词输入区', () => {
  it('CanvasPromptInput 与兜底 textarea 紧邻成对，中间不插 v-if 浮层', () => {
    const src = readFileSync(resolve('app/components/canvas/CanvasInspector.vue'), 'utf8')
    const inputIdx = src.indexOf('<CanvasPromptInput')
    expect(inputIdx).toBeGreaterThan(-1)
    // 自闭合标签结束位置
    const closeIdx = src.indexOf('/>', inputIdx)
    expect(closeIdx).toBeGreaterThan(-1)
    const until = src.indexOf('<textarea', closeIdx)
    expect(until).toBeGreaterThan(-1)
    const between = src.slice(closeIdx, until)
    // 两者之间只允许注释和空白，不能出现 v-if 浮层
    expect(between).not.toMatch(/v-if\b/)
  })

  it('同一节点上备好的模型与模式会同步进面板，不会继续显示上次选的', () => {
    const src = readFileSync(resolve('app/components/canvas/CanvasInspector.vue'), 'utf8')
    expect(src).toContain("watch(() => String(props.model || '')")
    expect(src).toContain("watch(() => String(props.videoMode || 'reference')")
    expect(src).toContain('syncModelFromNode()')
    expect(src).toContain('function defaultModel(kind: string)')
    expect(src).toContain('resolveCatalogModel(')
    expect(src).toContain("emit('update:model', id)")
    const workspace = readFileSync(resolve('app/components/canvas/CanvasWorkspace.vue'), 'utf8')
    expect(workspace).toContain('@update:model="onInspectorModel"')
    expect(workspace).toContain('function onInspectorModel(')
  })

  it('没有可用模型时不画假的模型下拉', () => {
    const src = readFileSync(resolve('app/components/canvas/CanvasInspector.vue'), 'utf8')
    expect(src).toContain('v-if="!noModels" class="canvas-inspector__model"')
    expect(src).toContain(':disabled="noModels || talkingNoModel || submitting || locked"')
  })

  it('音频语种和音色写回节点 params，选中时再读回来', () => {
    const src = readFileSync(resolve('app/components/canvas/CanvasInspector.vue'), 'utf8')
    expect(src).toContain('function persistAudioParams()')
    expect(src).toContain("emit('update:params', next)")
    expect(src).toContain("audioLang.value = paramText('lang', audioLang.value) || 'zh'")
    expect(src).toContain('params.lang = audioLang.value')
    expect(src).toContain('params.voice = voice')
    expect(src).toContain("next.audioKind = audioKind.value")
    expect(src).toContain('function setAudioKind(')
    expect(src).toContain('canvas.audio.kind')
    const workspace = readFileSync(resolve('app/components/canvas/CanvasWorkspace.vue'), 'utf8')
    expect(workspace).toContain('@update:params="onInspectorParams"')
    expect(workspace).toContain('function onInspectorParams(')
    expect(workspace).toContain("name === 'add-bgm'")
    expect(workspace).toContain('function addBgmForSelected(')
    expect(workspace).toContain("submitMediaJob(mixed, 'mix_bgm'")
  })
})
