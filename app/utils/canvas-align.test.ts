import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alignedPositions, distributedPositions, snapNodeAlign, type AlignBox } from './canvas-align'
import { nudgeFlowNodes, type CanvasFlowNode } from './canvas-group'

const moving: AlignBox = { id: 'a', x: 100, y: 40, w: 80, h: 50 }

describe('snapNodeAlign', () => {
  it('左边靠近时吸到同一条竖线，线盖住两张卡片', () => {
    const other: AlignBox = { id: 'b', x: 104, y: 200, w: 60, h: 40 }
    const snapped = snapNodeAlign(moving, [other], 6)
    expect(snapped.x).toBe(104)
    expect(snapped.y).toBe(40)
    expect(snapped.guides).toEqual([
      { dir: 'v', at: 104, from: 40, to: 240 },
    ])
  })

  it('顶边靠近时吸到横线', () => {
    const other: AlignBox = { id: 'b', x: 400, y: 36, w: 90, h: 70 }
    const snapped = snapNodeAlign(moving, [other], 6)
    expect(snapped.y).toBe(36)
    expect(snapped.guides[0]).toMatchObject({ dir: 'h', at: 36, from: 100, to: 490 })
  })

  it('超出阈值不吸、不画线', () => {
    const other: AlignBox = { id: 'b', x: 200, y: 200, w: 30, h: 30 }
    const snapped = snapNodeAlign(moving, [other], 6)
    expect(snapped.x).toBe(100)
    expect(snapped.guides).toEqual([])
  })

  it('同时靠近两条边时取更近的一条', () => {
    const near: AlignBox = { id: 'b', x: 102, y: 0, w: 20, h: 20 }
    const far: AlignBox = { id: 'c', x: 105, y: 300, w: 20, h: 20 }
    const snapped = snapNodeAlign(moving, [near, far], 8)
    expect(snapped.x).toBe(102)
    expect(snapped.guides).toHaveLength(1)
    expect(snapped.guides[0]?.at).toBe(102)
  })

  it('右边和另一张的右边对齐时，竖线画在右边缘', () => {
    const other: AlignBox = { id: 'b', x: 300, y: 180, w: 78, h: 60 }
    const dragged: AlignBox = { id: 'a', x: 210, y: 20, w: 170, h: 80 }
    const snapped = snapNodeAlign(dragged, [other], 6)
    expect(snapped.x + dragged.w).toBe(378)
    expect(snapped.guides[0]).toMatchObject({ dir: 'v', at: 378 })
  })
})

describe('alignedPositions / distributedPositions', () => {
  const a: AlignBox = { id: 'a', x: 10, y: 20, w: 40, h: 20 }
  const b: AlignBox = { id: 'b', x: 50, y: 60, w: 20, h: 40 }
  const c: AlignBox = { id: 'c', x: 130, y: 10, w: 30, h: 10 }

  it('左对齐贴最左边，右对齐贴最右边', () => {
    expect(alignedPositions([a, b], 'left')).toEqual([
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 10, y: 60 },
    ])
    expect(alignedPositions([a, b], 'right')).toEqual([
      { id: 'a', x: 30, y: 20 },
      { id: 'b', x: 50, y: 60 },
    ])
  })

  it('水平居中按包围盒中线', () => {
    const [left, right] = alignedPositions([a, b], 'center')
    expect(left!.x + a.w / 2).toBe(right!.x + b.w / 2)
  })

  it('水平分布首尾不动，中间均分空隙', () => {
    const next = distributedPositions([a, b, c], 'horizontal')
    const byId = Object.fromEntries(next.map(item => [item.id, item]))
    expect(byId.a?.x).toBe(10)
    expect(byId.c?.x).toBe(130)
    expect(byId.b?.x).toBe(80)
  })

  it('两个节点不分布', () => {
    expect(distributedPositions([a, b], 'horizontal')).toEqual([
      { id: 'a', x: 10, y: 20 },
      { id: 'b', x: 50, y: 60 },
    ])
  })

  it('多选工具条有对齐入口', () => {
    const src = readFileSync('app/components/canvas/CanvasSelBar.vue', 'utf8')
    expect(src).toContain("t('canvas.align.menu')")
    expect(src).toContain('align-left')
    expect(src).toContain('distribute-h')
    const ws = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(ws).toContain('alignFlowNodes')
    expect(ws).toContain('distributeFlowNodes')
    expect(ws).toContain('alignSelection: applySelectionAlign')
    expect(ws).toContain('toggleLockSelected')
    expect(ws).toContain('isNodeLocked')
    expect(ws).toContain('nudgeFlowNodes')
    expect(ws).toContain('@toggle-lock')
    const shortcuts = readFileSync('app/utils/canvas-shortcuts.ts', 'utf8')
    expect(shortcuts).toContain('align-left')
    expect(shortcuts).toContain('toggleLockSelected')
    expect(shortcuts).toContain('findStep')
    expect(shortcuts).toContain('nudgeSelection')
    const group = readFileSync('app/components/canvas/CanvasGroupNode.vue', 'utf8')
    expect(group).toContain('const groupLocked = computed')
    expect(group).toContain('i-lucide-lock')
    const inspector = readFileSync('app/components/canvas/CanvasInspector.vue', 'utf8')
    expect(inspector).toContain("t('canvas.lock.hint')")
    expect(inspector).toContain("emit('toggle-lock')")
    expect(inspector).toContain('const writeBlocked = computed(() => props.readonly || props.locked)')
    expect(inspector).toContain(':disabled="readonly"')
    expect(inspector).toContain(':disabled="writeBlocked"')
    expect(inspector).toContain(':disabled="noModels || talkingNoModel || submitting || locked"')
    const groups = readFileSync('app/composables/useCanvasGroups.ts', 'utf8')
    expect(groups).toContain('isNodeLocked')
    expect(groups).toContain('if (!group || isNodeLocked(group, opts.nodes.value))')
    const selbar = readFileSync('app/components/canvas/CanvasSelBar.vue', 'utf8')
    expect(selbar).toContain('is-write-blocked')
    expect(selbar).toContain('data-keep')
    expect(selbar).toContain(':disabled="locked"')
    expect(ws).toContain('selectionWriteBlocked()')
    expect(ws).toContain('picked.every(item => nodeLocked(item))')
    expect(ws).toContain('const selectionLocked = computed')
    expect(ws).toContain(':locked="selectionLocked"')
    expect(ws).toContain("const allowWhenLocked = name === 'download'")
    expect(ws).toContain('!node.parentNode && !nodeLocked(node)')
    expect(ws).toContain('function syncLockHandles()')
    expect(ws).toContain('if (!node || !isContentNode(node) || nodeLocked(node))')
    const edits = readFileSync('app/composables/useCanvasImageEdits.ts', 'utf8')
    expect(edits).toContain('function nodeFrozen')
    expect(edits).toContain('nodeFrozen(from)')
    expect(edits).toContain('if (nodeFrozen(node))')
    const videoOps = readFileSync('app/composables/useCanvasVideoOps.ts', 'utf8')
    expect(videoOps).toContain('!isNodeLocked(videoOpsNode.value, opts.nodes.value)')
    expect(videoOps).toContain("openExtendStudio('extend')")
    expect(ws).not.toContain('CanvasExtendModal')
    const tools = readFileSync('app/composables/useCanvasVideoTools.ts', 'utf8')
    expect(tools).toContain('function nodeFrozen')
    expect(tools).toContain('|| nodeFrozen(node)')
    expect(ws).toContain('closeOverlaysForNodes')
    expect(ws).toContain('!canvasLocked.value && !nodeLocked(node)')
    const card = readFileSync('app/components/canvas/CanvasNode.vue', 'utf8')
    expect(card).toContain('const writeFrozen = computed(() => practiceLocked.value || nodeLocked.value)')
    expect(card).toContain('v-if="nodeLocked"')
    const dock = readFileSync('app/components/canvas/CanvasDock.vue', 'utf8')
    expect(dock).toContain('i-lucide-lock-open')
    expect(dock).toContain("t('canvas.lock.canvas')")
    expect(dock).not.toContain('i-lucide-share-2')
    expect(ws).toContain('snapOn.value ? (shift ? cell * 4 : cell)')
    const clip = readFileSync('app/composables/useCanvasClipboard.ts', 'utf8')
    expect(clip).toContain('locked: false')
    expect(clip).toContain('!isNodeLocked(node, opts.nodes.value)')
    const menu = readFileSync('app/components/canvas/CanvasNodeMenu.vue', 'utf8')
    expect(menu).toContain(":disabled=\"locked\"")
    expect(menu).toContain("emit('copy')")
    expect(menu).toContain("t('canvas.lock.hint')")
    expect(menu).toContain('emit(\'duplicate\')')
    expect(inspector).toContain('emit(\'chip\', \'skill\')')
    expect(inspector).toContain(':disabled="writeBlocked"')
    expect(inspector).toContain(':title="writeBlockedTitle"')
    const tree = readFileSync('app/components/canvas/director/panels/DirectorObjectTree.vue', 'utf8')
    expect(tree).toContain('store.readonly.value || item.locked')
    expect(tree).toContain('function unlockedIds')
    const assist = readFileSync('app/components/canvas/director/agent/DirectorAssistant.vue', 'utf8')
    expect(assist).toContain('store.readonly.value')
    expect(assist).toContain("t('只读画布不能修改')")
    const char = readFileSync('app/components/canvas/director/panels/DirectorCharacterPanel.vue', 'utf8')
    expect(char).toContain('const writeBlocked = computed')
    expect(char).toContain(':disabled="writeBlocked"')
    const prop = readFileSync('app/components/canvas/director/panels/DirectorPropPanel.vue', 'utf8')
    expect(prop).toContain('Boolean(prop.value?.locked)')
    const commands = readFileSync('app/utils/director/agent/commands.ts', 'utf8')
    expect(commands).toContain('function requireUnlocked')
    const paste = readFileSync('app/utils/director/store/actions-clipboard.ts', 'utf8')
    expect(paste).toContain('locked: false')
  })
})

describe('nudgeFlowNodes', () => {
  it('未锁定节点按增量挪，锁定的跳过', () => {
    const a = { id: 'a', position: { x: 10, y: 20 }, data: { kind: 'image', locked: false } } as CanvasFlowNode
    const b = { id: 'b', position: { x: 40, y: 20 }, data: { kind: 'image', locked: true } } as CanvasFlowNode
    nudgeFlowNodes([a, b], [a, b], 8, -4)
    expect(a.position).toEqual({ x: 18, y: 16 })
    expect(b.position).toEqual({ x: 40, y: 20 })
  })

  it('父组锁定时子节点也不挪', () => {
    const group = { id: 'g', position: { x: 0, y: 0 }, data: { kind: 'group', locked: true } } as CanvasFlowNode
    const kid = { id: 'c', parentNode: 'g', position: { x: 8, y: 8 }, data: { kind: 'image', locked: false } } as CanvasFlowNode
    nudgeFlowNodes([kid], [group, kid], 10, 0)
    expect(kid.position).toEqual({ x: 8, y: 8 })
  })
})
