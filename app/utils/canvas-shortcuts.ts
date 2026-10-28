export type CanvasShortcutEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  preventDefault: () => void
}

export type CanvasShortcutApi = {
  markPickOpen: boolean
  closeMarkPick: () => void
  smartEditOpen: boolean
  markOpen: boolean
  cropOpen: boolean
  eraseOpen: boolean
  outpaintOpen: boolean
  flipOpen: boolean
  depthOpen: boolean
  lightOpen: boolean
  angleOpen: boolean
  viralOpen: boolean
  closeDepth: () => void
  closeLight: () => void
  closeAngle: () => void
  closeViral: () => void
  dismissChrome: () => void
  isTyping: boolean
  readonly: boolean
  /** 跟练只读：编辑类快捷键命中即 return；空格平移 / 缩放 / ⌘0 / ⌘Enter / ? / V 一律放行 */
  practiceReadonly?: boolean
  organizeCanvas: () => void
  toggleHelp: () => void
  openMenuAtAdd: () => void
  setToolSelect: () => void
  beginSpacePan: () => void
  groupSelected: () => void
  ungroupSelected: () => void
  copySelected: () => void
  pasteClip: () => void
  duplicateSelected: () => void
  connectSelected: () => void
  onGenerate: () => void
  zoomIn: () => void
  zoomOut: () => void
  fitView: () => void
  undo: () => void
  redo: () => void
  removeSelectedNodes: () => void
  findOpen?: boolean
  openFind: () => void
  closeFind: () => void
  alignSelection: (name: string) => void
  toggleLockSelected: () => void
  findStep: (delta: number) => void
  nudgeSelection: (key: string, shift: boolean, repeat: boolean) => void
}

/**
 * 跟练只读（practiceReadonly）下要吞掉的编辑类键：Tab、Delete/Backspace、
 * ⌘/Ctrl+C/V/D/G/L/Z（含 ⇧，redo 是 ⇧⌘Z）、Alt+⇧+F（整理画布会挪节点）、
 * Alt+方向键 / Alt+H/V（对齐会挪节点）、方向键微移、⇧⌘L（锁定）。
 * 放行的读操作：空格平移、⌘±、⌘0、⌘F / F3（查找）、⌘Enter（生成→回放）、? //（帮助）、V（选择工具）、Escape（关浮层）。
 * Tab 只 return 不 preventDefault：跟练里它只是不加节点，别把键盘焦点导航也锁死。
 */
function practiceBlockedShortcut(event: CanvasShortcutEvent, cmd: boolean) {
  const key = event.key
  if (event.altKey && event.shiftKey && key.toLowerCase() === 'f')
    return true
  if (event.altKey && (key.startsWith('Arrow') || 'hv'.includes(key.toLowerCase())))
    return true
  if (!event.altKey && key.startsWith('Arrow'))
    return true
  if (key === 'Tab' || key === 'Delete' || key === 'Backspace')
    return true
  return cmd && 'cvdglz'.includes(key.toLowerCase())
}

/**
 * 画布快捷键路由。早退顺序和原来 onKeydown 一致，只决定走哪条。
 */
export function dispatchCanvasShortcut(event: CanvasShortcutEvent, api: CanvasShortcutApi) {
  const key = event.key
  const cmd = event.ctrlKey || event.metaKey
  if (api.markPickOpen) {
    if (key === 'Escape')
      api.closeMarkPick()
    return
  }
  // 智能编辑 / 标记区域 / 裁剪 / 扩图 / 去字幕打开时快捷键归弹层
  if (api.smartEditOpen || api.markOpen || api.cropOpen || api.eraseOpen || api.outpaintOpen || api.flipOpen)
    return

  if (key === 'Escape') {
    if (api.findOpen) {
      api.closeFind()
      return
    }
    if (api.depthOpen) {
      api.closeDepth()
      return
    }
    if (api.lightOpen) {
      api.closeLight()
      return
    }
    if (api.angleOpen) {
      api.closeAngle()
      return
    }
    if (api.viralOpen) {
      api.closeViral()
      return
    }
    api.dismissChrome()
    return
  }
  if (cmd && key.toLowerCase() === 'f') {
    event.preventDefault()
    api.openFind()
    return
  }
  if (key === 'F3') {
    event.preventDefault()
    api.findStep(event.shiftKey ? -1 : 1)
    return
  }
  if (api.isTyping || api.readonly)
    return
  // 跟练只读：编辑类快捷键命中即 return（工作区 onKeydown 入口侧也拦了一道，这里兜住其它调用点）
  if (api.practiceReadonly && practiceBlockedShortcut(event, cmd))
    return
  // 深度 / 打光面板跟着源节点：面板开着时不响应删除、撤销等快捷键，免得把源节点删掉
  if (api.depthOpen || api.lightOpen || api.angleOpen)
    return

  if (event.altKey && event.shiftKey && key.toLowerCase() === 'f') {
    event.preventDefault()
    api.organizeCanvas()
    return
  }
  if (key === '?' || (key === '/' && event.shiftKey)) {
    event.preventDefault()
    api.toggleHelp()
    return
  }
  if (key === 'Tab') {
    event.preventDefault()
    api.openMenuAtAdd()
    return
  }
  if (!cmd && !event.altKey && key.toLowerCase() === 'v') {
    api.setToolSelect()
    return
  }
  if (!cmd && !event.altKey && key === ' ') {
    event.preventDefault()
    if (!event.repeat)
      api.beginSpacePan()
    return
  }
  if ((cmd || event.altKey) && key.toLowerCase() === 'g') {
    event.preventDefault()
    if (event.shiftKey)
      api.ungroupSelected()
    else
      api.groupSelected()
    return
  }
  if (cmd && key.toLowerCase() === 'c') {
    event.preventDefault()
    api.copySelected()
    return
  }
  if (cmd && key.toLowerCase() === 'v') {
    event.preventDefault()
    api.pasteClip()
    return
  }
  if (cmd && key.toLowerCase() === 'd') {
    event.preventDefault()
    api.duplicateSelected()
    return
  }
  if (cmd && key.toLowerCase() === 'l') {
    event.preventDefault()
    if (event.shiftKey)
      api.toggleLockSelected()
    else
      api.connectSelected()
    return
  }
  if (event.altKey && !cmd) {
    const align = alignShortcutName(key, event.shiftKey)
    if (align) {
      event.preventDefault()
      api.alignSelection(align)
      return
    }
  }
  if (!cmd && !event.altKey && key.startsWith('Arrow')) {
    event.preventDefault()
    api.nudgeSelection(key, event.shiftKey, event.repeat)
    return
  }
  if (cmd && key === 'Enter') {
    event.preventDefault()
    api.onGenerate()
    return
  }
  if (cmd && (key === '=' || key === '+')) {
    event.preventDefault()
    api.zoomIn()
    return
  }
  if (cmd && key === '-') {
    event.preventDefault()
    api.zoomOut()
    return
  }
  if (cmd && key === '0') {
    event.preventDefault()
    api.fitView()
    return
  }
  if (cmd && key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey)
      api.redo()
    else
      api.undo()
    return
  }
  if (!cmd && (key === 'Delete' || key === 'Backspace')) {
    event.preventDefault()
    api.removeSelectedNodes()
  }
}

function alignShortcutName(key: string, shift: boolean): string | null {
  if (key === 'ArrowLeft')
    return 'align-left'
  if (key === 'ArrowRight')
    return 'align-right'
  if (key === 'ArrowUp')
    return 'align-top'
  if (key === 'ArrowDown')
    return 'align-bottom'
  const letter = key.toLowerCase()
  if (letter === 'h')
    return shift ? 'distribute-h' : 'align-center'
  if (letter === 'v')
    return shift ? 'distribute-v' : 'align-middle'
  return null
}
