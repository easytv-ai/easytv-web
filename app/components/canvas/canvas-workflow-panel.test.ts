import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 工作流面板「官方预设」段的结构断言（vitest 是 node 环境、没有挂载能力，照
 * canvas-inspector-template.test.ts 的做法读源码）。
 * 这里锁的是配方库改造后最容易漏的接线：按场景分组、卡片带规格与点数、emit 不变。
 */
describe('CanvasWorkflowPanel（官方预设按场景分组）', () => {
  const src = readFileSync(resolve('app/components/canvas/CanvasWorkflowPanel.vue'), 'utf8')

  it('预设段按场景分组渲染：外面 v-for 分组，组内再 v-for 卡片', () => {
    expect(src).toContain('groupedWorkflowPresets')
    expect(src).toMatch(/v-for="group in presetGroups"/)
    expect(src).toMatch(/v-for="preset in group\.items"/)
    expect(src).toContain('group.scenario')
  })

  it('分组标题与说明都过 t()，组内卡片还是原来那张卡', () => {
    expect(src).toContain('t(group.label)')
    expect(src).toContain('t(group.note)')
    expect(src).toMatch(/class="canvas-wf__card"/)
    expect(src).toContain('t(preset.name)')
    expect(src).toContain('t(preset.hint)')
    expect(src).toContain('preset.teachingPoint')
    expect(src).toContain('class="canvas-wf__teach"')
    expect(src).toContain('@click.stop="toggleTeach(preset.id)"')
  })

  it('每条显示规格与预计点数（插值 key：规格行 + 点数行）', () => {
    expect(src).toContain('presetLine(preset)')
    expect(src).toContain('presetSpec(preset)')
    expect(src).toContain('presetPoints(preset)')
    expect(src).toContain('platform.shotLine')
    expect(src).toContain("t('{ratio} · {seconds} 秒 · {resolution}'")
    expect(src).toContain("t('预计 {n} 点'")
    expect(src).toContain("预计 {n} 点（高清另计）")
  })

  it('emit 不变：点卡片还是 usePreset 把整条预设递出去', () => {
    expect(src).toContain("emit('usePreset', preset)")
    expect(src).toContain('usePreset: [preset: WorkflowPreset]')
  })

  it('「我的工作流」段原样保留：搜索、改名、删除与 use 事件都还在', () => {
    expect(src).toContain("t('我的工作流')")
    expect(src).toContain("emit('use', item.id)")
    expect(src).toContain('@keyup.enter="commitRename()"')
    expect(src).toContain('@click.stop="remove(item)"')
  })
})
