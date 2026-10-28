import { nextTick, type ComputedRef, type Ref } from 'vue'
import {
  absPosition,
  collapsedGroupSize,
  collapseLayoutForKids,
  defaultGroupColor,
  isContentNode,
  isGroupNode,
  isNodeLocked,
  layoutFreeNodes,
  layoutGroupChildren,
  nodeSize,
  nodesBounds,
  setGroupSize,
  type CanvasFlowNode,
  type CanvasGroupData,
  type CanvasGroupLayout,
} from '~/utils/canvas-group'
import type { CanvasBarMode } from '~/utils/canvas-bar-mode'

/**
 * 成组 / 拆组 / 折叠 / 排版。下载和纯文本提取仍留在工作区。
 */
export function useCanvasGroups(opts: {
  nodes: Ref<CanvasFlowNode[]>
  selectedNodes: ComputedRef<CanvasFlowNode[]>
  selectedGroup: ComputedRef<CanvasFlowNode | null>
  selected: ComputedRef<CanvasFlowNode | null>
  barMode: ComputedRef<CanvasBarMode | null>
  groupCount: Ref<number>
  addNodes: (node: CanvasFlowNode) => void
  findNode: (id: string) => CanvasFlowNode | undefined
  addSelectedNodes: (nodes: any[]) => void
  updateNode: (id: string, patch: Record<string, unknown>) => void
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  pushHistory: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  function relabelGroups() {
    const groups = opts.nodes.value
      .filter(isGroupNode)
      .sort((a, b) => {
        const na = Number(a.id.replace(/\D/g, '')) || 0
        const nb = Number(b.id.replace(/\D/g, '')) || 0
        return na - nb
      })
    // 分镜组保留自己的名字，不占普通组的序号
    let index = 0
    for (const group of groups) {
      if (group.data.storyboard)
        continue
      index += 1
      group.data.label = `${opts.t('组')} ${index}`
    }
  }

  function groupSelected() {
    const picked = opts.selectedNodes.value.filter(node => node.data && !isNodeLocked(node, opts.nodes.value))
    if (picked.length < 2)
      return
    const box = nodesBounds(picked, opts.nodes.value)
    if (!box)
      return
    const pad = 28
    opts.groupCount.value += 1
    const id = `group-${opts.groupCount.value}`
    const group: CanvasFlowNode = {
      id,
      type: 'group',
      position: { x: box.x - pad, y: box.y - pad },
      data: {
        kind: 'group',
        label: `${opts.t('组')} ${opts.nodes.value.filter(isGroupNode).length + 1}`,
        color: defaultGroupColor(),
        layout: 'grid',
      },
      selectable: true,
      draggable: true,
      zIndex: 0,
      width: box.w + pad * 2,
      height: box.h + pad * 2,
      style: { width: `${box.w + pad * 2}px`, height: `${box.h + pad * 2}px` },
    }
    opts.addNodes(group)
    nextTick(() => {
      for (const node of picked) {
        const abs = absPosition(node, opts.nodes.value)
        node.parentNode = id
        node.extent = 'parent'
        node.expandParent = true
        node.position = { x: abs.x - group.position.x, y: abs.y - group.position.y }
        node.selected = false
      }
      const created = opts.findNode(id)
      if (created)
        opts.addSelectedNodes([created])
      relabelGroups()
      opts.pushHistory()
    })
  }

  function ungroupSelected() {
    const group = opts.selectedGroup.value
    if (!group || isNodeLocked(group, opts.nodes.value))
      return
    const kids = opts.nodes.value.filter(node => node.parentNode === group.id)
    for (const kid of kids) {
      const abs = absPosition(kid, opts.nodes.value)
      kid.parentNode = undefined
      kid.extent = undefined
      kid.expandParent = undefined
      kid.hidden = false
      kid.position = abs
      kid.selected = true
    }
    opts.nodes.value = opts.nodes.value.filter(node => node.id !== group.id)
    relabelGroups()
    opts.pushHistory()
  }

  function setGroupKidsVisible(kids: CanvasFlowNode[], visible: boolean) {
    for (const kid of kids) {
      kid.hidden = !visible
      kid.expandParent = visible
      opts.updateNode(kid.id, { hidden: !visible, expandParent: visible })
    }
  }

  function applyGroupNodeSize(group: CanvasFlowNode, w: number, h: number) {
    setGroupSize(group, w, h)
    opts.updateNode(group.id, {
      width: w,
      height: h,
      style: { ...(group.style || {}), width: `${w}px`, height: `${h}px` },
    })
  }

  function expandGroup(group: CanvasFlowNode & { data: CanvasGroupData }, kids: CanvasFlowNode[]) {
    setGroupKidsVisible(kids, true)
    group.data.collapsed = false
    const w = group.data.expandedW
    const h = group.data.expandedH
    if (w && h)
      applyGroupNodeSize(group, w, h)
    else
      layoutGroupChildren(group, kids, group.data.layout)
  }

  function toggleGroupCollapse() {
    const group = opts.selectedGroup.value
    if (!group || !isGroupNode(group) || isNodeLocked(group, opts.nodes.value))
      return
    const kids = opts.nodes.value.filter(node => node.parentNode === group.id)
    if (group.data.collapsed) {
      expandGroup(group, kids)
    }
    else {
      const size = nodeSize(group)
      group.data.expandedW = size.w
      group.data.expandedH = size.h
      setGroupKidsVisible(kids, false)
      group.data.collapsed = true
      const box = collapsedGroupSize(kids.length, collapseLayoutForKids(kids, group.data.layout))
      applyGroupNodeSize(group, box.w, box.h)
    }
    opts.pushHistory()
  }

  function setGroupColor(color: string) {
    const group = opts.selectedGroup.value
    if (!group || !isGroupNode(group) || isNodeLocked(group, opts.nodes.value))
      return
    group.data.color = color
    opts.pushHistory()
  }

  function setTextColor(color: string) {
    const node = opts.selected.value
    if (!node || !isContentNode(node) || node.data.kind !== 'text' || isNodeLocked(node, opts.nodes.value))
      return
    opts.updateNodeData(node.id, { color })
    opts.pushHistory()
  }

  function onBarColor(color: string) {
    if (opts.barMode.value === 'text')
      setTextColor(color)
    else
      setGroupColor(color)
  }

  function scaleTextNode(factor: number) {
    const node = opts.selected.value
    if (!node || !isContentNode(node) || node.data.kind !== 'text' || isNodeLocked(node, opts.nodes.value))
      return
    const next = Math.min(48, Math.max(10, Math.round((node.data.fontSize || 16) * factor)))
    opts.updateNodeData(node.id, { fontSize: next })
    opts.pushHistory()
  }

  function setGroupLayout(mode: CanvasGroupLayout) {
    const group = opts.selectedGroup.value
    if (opts.barMode.value === 'group' && group && isGroupNode(group)) {
      if (isNodeLocked(group, opts.nodes.value))
        return
      const kids = opts.nodes.value.filter(node => node.parentNode === group.id)
      if (group.data.collapsed)
        expandGroup(group, kids)
      group.data.layout = mode
      layoutGroupChildren(group, kids, mode)
      opts.pushHistory()
      return
    }
    const free = opts.selectedNodes.value.filter(item => !isNodeLocked(item, opts.nodes.value))
    if (free.length < 2)
      return
    layoutFreeNodes(free, opts.nodes.value, mode)
    opts.pushHistory()
  }

  return {
    relabelGroups,
    groupSelected,
    ungroupSelected,
    setGroupKidsVisible,
    applyGroupNodeSize,
    expandGroup,
    toggleGroupCollapse,
    setGroupColor,
    setTextColor,
    onBarColor,
    scaleTextNode,
    setGroupLayout,
  }
}
