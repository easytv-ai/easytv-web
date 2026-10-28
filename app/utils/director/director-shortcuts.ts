export function isDirectorTypingTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object')
    return false
  const el = target as { isContentEditable?: boolean, tagName?: string }
  return Boolean(el.isContentEditable) || ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(el.tagName || ''))
}

/**
 * 导演台撤销 / 重做。输入框里不抢；只读时按了也吞掉，避免落到画布那一层。
 */
export function dispatchDirectorShortcut(
  event: KeyboardEvent,
  api: { undo: () => void, redo: () => void, copy?: () => void, paste?: () => void },
) {
  if (event.defaultPrevented || isDirectorTypingTarget(event.target))
    return false
  const cmd = event.ctrlKey || event.metaKey
  if (!cmd || event.altKey)
    return false
  const key = event.key.toLowerCase()
  if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault()
    api.redo()
    return true
  }
  if (key === 'z') {
    event.preventDefault()
    api.undo()
    return true
  }
  if (key === 'c' && api.copy) {
    event.preventDefault()
    api.copy()
    return true
  }
  if (key === 'v' && api.paste) {
    event.preventDefault()
    api.paste()
    return true
  }
  return false
}
