<script setup lang="ts">
const props = defineProps<{
  open: boolean
  html: string
}>()

const emit = defineEmits<{
  close: []
  save: [html: string]
}>()

const { t } = useI18n()
const editorRef = ref<HTMLElement | null>(null)
const colorOpen = ref(false)
const markOpen = ref(false)
const block = ref('p')

const TEXT_COLORS = ['#ffffff', '#18181b', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7']
const MARK_COLORS = ['#fde047', '#86efac', '#93c5fd', '#fda4af', '#e9d5ff', 'transparent']

const BLOCKS = [
  { id: 'p', label: '正文' },
  { id: 'h1', label: 'H1' },
  { id: 'h2', label: 'H2' },
  { id: 'h3', label: 'H3' },
  { id: 'h4', label: 'H4' },
] as const

watch(() => props.open, async (on) => {
  colorOpen.value = false
  markOpen.value = false
  if (!on)
    return
  await nextTick()
  if (editorRef.value) {
    editorRef.value.innerHTML = props.html || ''
    flattenBlocks(editorRef.value)
  }
  editorRef.value?.focus()
}, { immediate: true })

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

function run(command: string, value?: string) {
  const root = editorRef.value
  const mark = root ? saveOffsets(root) : null
  root?.focus()
  if (root && mark)
    restoreOffsets(root, mark)
  document.execCommand(command, false, value)
}

function selectionRange(root: HTMLElement) {
  const sel = window.getSelection()
  if (!sel?.rangeCount)
    return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer))
    return null
  return range
}

function saveOffsets(root: HTMLElement) {
  const range = selectionRange(root)
  if (!range)
    return null
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  return { start, end: start + range.toString().length }
}

function restoreOffsets(root: HTMLElement, mark: { start: number, end: number }) {
  const sel = window.getSelection()
  if (!sel)
    return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let seen = 0
  let startNode: Node | null = null
  let startOff = 0
  let endNode: Node | null = null
  let endOff = 0
  let node = walker.nextNode()
  while (node) {
    const len = node.textContent?.length ?? 0
    if (!startNode && seen + len >= mark.start) {
      startNode = node
      startOff = mark.start - seen
    }
    if (startNode && seen + len >= mark.end) {
      endNode = node
      endOff = mark.end - seen
      break
    }
    seen += len
    node = walker.nextNode()
  }
  if (!startNode)
    return
  const range = document.createRange()
  range.setStart(startNode, Math.min(startOff, startNode.textContent?.length ?? 0))
  range.setEnd(endNode || startNode, Math.min(endNode ? endOff : startOff, (endNode || startNode).textContent?.length ?? 0))
  sel.removeAllRanges()
  sel.addRange(range)
}

function isContentBlock(el: HTMLElement, root: HTMLElement) {
  if (el === root)
    return false
  const tag = el.tagName.toLowerCase()
  return tag === 'p' || tag === 'div' || tag === 'li' || tag === 'pre' || HEADINGS.includes(tag)
}

function nearestBlock(node: Node | null, root: HTMLElement) {
  let current: Node | null = node
  while (current && current !== root) {
    if (current instanceof HTMLElement && (isContentBlock(current, root) || current.tagName.toLowerCase() === 'blockquote'))
      return current
    current = current.parentNode
  }
  return null
}

function unwrapElement(el: HTMLElement) {
  const parent = el.parentNode
  if (!parent)
    return
  while (el.firstChild)
    parent.insertBefore(el.firstChild, el)
  el.remove()
}

/** 标题、引用再套一层时字号会按 em 连乘。只留最外一层。 */
function flattenNested(root: HTMLElement, tag: string) {
  const nested = [...root.querySelectorAll(`${tag} ${tag}`)].reverse()
  for (const node of nested) {
    if (node instanceof HTMLElement)
      unwrapElement(node)
  }
}

function flattenBlocks(root: HTMLElement) {
  for (const tag of HEADINGS)
    flattenNested(root, tag)
  flattenNested(root, 'blockquote')
}

function retag(block: HTMLElement, tag: string, root: HTMLElement) {
  if (block.tagName.toLowerCase() === tag)
    return block
  const next = document.createElement(tag)
  while (block.firstChild)
    next.appendChild(block.firstChild)
  block.replaceWith(next)
  const parent = next.parentElement
  if (parent && parent !== root && parent.tagName.toLowerCase() === tag)
    unwrapElement(next)
  return next
}

function hasStuff(node: Node) {
  if (node instanceof HTMLElement)
    return Boolean(node.textContent?.replace(/\u00a0/g, '').trim()) || Boolean(node.querySelector('img'))
  return Boolean(node.textContent?.replace(/\u00a0/g, '').trim())
}

function linesIn(container: HTMLElement) {
  const lines: Node[][] = [[]]
  for (const child of [...container.childNodes]) {
    if (child instanceof HTMLBRElement) {
      lines.push([])
      continue
    }
    lines[lines.length - 1]?.push(child)
  }
  while (lines.length > 1 && !lines[lines.length - 1]?.some(hasStuff))
    lines.pop()
  return lines
}

function lineIndexAt(container: HTMLElement, node: Node, offset: number) {
  let target: Node | null = node
  if (node === container)
    target = container.childNodes[Math.max(0, Math.min(offset, Math.max(container.childNodes.length - 1, 0)))] ?? null
  else {
    while (target && target.parentNode !== container)
      target = target.parentNode
  }
  if (!target)
    return 0
  let index = 0
  for (const child of container.childNodes) {
    if (child === target)
      return index
    if (child instanceof HTMLBRElement)
      index++
  }
  return index
}

function atLineStart(container: HTMLElement, node: Node, offset: number) {
  if (node === container)
    return offset === 0 || container.childNodes[offset - 1] instanceof HTMLBRElement
  if (offset !== 0)
    return false
  let target: Node | null = node
  while (target && target.parentNode !== container)
    target = target.parentNode
  if (!target)
    return false
  const prev = target.previousSibling
  return !prev || prev instanceof HTMLBRElement
}

/** 选区贴在换行上时，起点其实已经是下一行，终点则还停在上一行。 */
function atLineEnd(container: HTMLElement, node: Node, offset: number) {
  if (node instanceof HTMLBRElement)
    return true
  if (node === container)
    return container.childNodes[offset] instanceof HTMLBRElement || offset >= container.childNodes.length
  if (node.nodeType === Node.TEXT_NODE && offset === (node.textContent?.length ?? 0)) {
    let target: Node | null = node
    while (target && target.parentNode !== container)
      target = target.parentNode
    return target?.nextSibling instanceof HTMLBRElement
  }
  return false
}

function pointAtEdge(block: HTMLElement, node: Node, offset: number, atStart: boolean) {
  if (node !== block && !block.contains(node))
    return false
  const probe = document.createRange()
  const point = document.createRange()
  try {
    probe.selectNodeContents(block)
    probe.collapse(atStart)
    point.setStart(node, offset)
    point.collapse(true)
  }
  catch {
    return false
  }
  return point.compareBoundaryPoints(Range.START_TO_START, probe) === 0
}

function lineBounds(host: HTMLElement, range: Range) {
  const last = Math.max(linesIn(host).length - 1, 0)
  const startIn = host.contains(range.startContainer)
  const endIn = host.contains(range.endContainer)
  let from = startIn ? lineIndexAt(host, range.startContainer, range.startOffset) : 0
  let to = endIn ? lineIndexAt(host, range.endContainer, range.endOffset) : last
  if (!range.collapsed && startIn && atLineEnd(host, range.startContainer, range.startOffset) && from < last)
    from++
  if (!range.collapsed && to > from && endIn && atLineStart(host, range.endContainer, range.endOffset))
    to--
  if (from > to)
    from = to
  const start = Math.min(Math.max(from, 0), last)
  return { from: start, to: Math.min(Math.max(to, start), last) }
}

function innermostBlocks(root: HTMLElement) {
  const all = [...root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,pre')]
    .filter((el): el is HTMLElement => el instanceof HTMLElement && isContentBlock(el, root))
  return all.filter(el => !all.some(other => other !== el && el.contains(other)))
}

function quoteAncestor(node: Node | null, root: HTMLElement) {
  let current: Node | null = node
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.tagName.toLowerCase() === 'blockquote')
      return current
    current = current.parentNode
  }
  return null
}

function hostsFor(root: HTMLElement, range: Range) {
  const blocks = innermostBlocks(root)
  const start = nearestBlock(range.startContainer, root)
  const contentStart = start && isContentBlock(start, root) ? start : null
  const endBlock = nearestBlock(range.endContainer, root)
  const contentEnd = endBlock && isContentBlock(endBlock, root) ? endBlock : contentStart
  if (contentStart) {
    const from = blocks.indexOf(contentStart)
    const to = contentEnd ? blocks.indexOf(contentEnd) : from
    if (from < 0)
      return [contentStart]
    const slice = blocks.slice(Math.min(from, to < 0 ? from : to), Math.max(from, to < 0 ? from : to) + 1)
    if (range.collapsed)
      return slice
    const kept = slice.filter((block, index) => {
      const startIn = block.contains(range.startContainer)
      const endIn = block.contains(range.endContainer)
      if (startIn && endIn)
        return true
      if (index === 0 && startIn && !endIn && pointAtEdge(block, range.startContainer, range.startOffset, false))
        return false
      if (index === slice.length - 1 && !startIn && endIn && pointAtEdge(block, range.endContainer, range.endOffset, true))
        return false
      return true
    })
    return kept.length ? kept : [contentEnd || contentStart]
  }
  const quote = quoteAncestor(range.startContainer, root)
  return [quote || root]
}

function applyLines(host: HTMLElement, root: HTMLElement, tag: string, from: number, to: number, quote: boolean) {
  const lines = linesIn(host)
  if (!lines.length)
    return
  const last = lines.length - 1
  const start = Math.min(Math.max(from, 0), last)
  const end = Math.min(Math.max(to, start), last)
  const original = host === root ? 'div' : host.tagName.toLowerCase()
  const keep = original === 'blockquote' ? 'div' : original
  const whole = start === 0 && end === last
  if (whole && host !== root && quote && !host.parentElement?.closest('blockquote')) {
    const wrapper = document.createElement('blockquote')
    host.replaceWith(wrapper)
    wrapper.appendChild(host)
    return
  }
  if (whole && host !== root && !quote) {
    retag(host, tag, root)
    return
  }
  if (whole && host === root && quote) {
    const wrapper = document.createElement('blockquote')
    while (root.firstChild)
      wrapper.appendChild(root.firstChild)
    root.appendChild(wrapper)
    return
  }
  const frag = document.createDocumentFragment()
  let bucket: Node[][] = []
  const flush = () => {
    if (!bucket.length)
      return
    const el = document.createElement(keep)
    bucket.forEach((nodes, index) => {
      if (index)
        el.appendChild(document.createElement('br'))
      nodes.forEach(node => el.appendChild(node))
    })
    if (original === 'blockquote') {
      const wrapper = document.createElement('blockquote')
      wrapper.appendChild(el)
      frag.appendChild(wrapper)
    }
    else {
      frag.appendChild(el)
    }
    bucket = []
  }
  lines.forEach((nodes, index) => {
    const selected = index >= start && index <= end
    if (!selected || !nodes.some(hasStuff)) {
      if (!selected)
        bucket.push(nodes)
      return
    }
    flush()
    const inner = document.createElement(quote ? keep : tag)
    nodes.forEach(node => inner.appendChild(node))
    if (quote) {
      const wrapper = document.createElement('blockquote')
      wrapper.appendChild(inner)
      frag.appendChild(wrapper)
    }
    else {
      frag.appendChild(inner)
    }
  })
  flush()
  if (!frag.childNodes.length)
    return
  if (host === root)
    root.replaceChildren(frag)
  else
    host.replaceWith(frag)
}

function formatSelection(root: HTMLElement, tag: string, quote = false) {
  const range = selectionRange(root)
  if (!range)
    return
  const use = !quote && tag === 'p' ? 'div' : tag
  const plan = hostsFor(root, range).map(host => ({ host, ...lineBounds(host, range) }))
  for (const item of [...plan].reverse()) {
    if (!item.host.isConnected)
      continue
    applyLines(item.host, root, use, item.from, item.to, quote)
  }
}

function toggleQuote(root: HTMLElement) {
  const range = selectionRange(root)
  if (!range)
    return
  const quote = quoteAncestor(range.startContainer, root)
  if (quote) {
    if (![...quote.children].some(el => el instanceof HTMLElement && isContentBlock(el, root))) {
      const line = document.createElement('div')
      while (quote.firstChild)
        line.appendChild(quote.firstChild)
      quote.appendChild(line)
    }
    unwrapElement(quote)
    return
  }
  formatSelection(root, 'div', true)
}

function isEmptyBlock(el: Element) {
  return !el.textContent?.replace(/\u00a0/g, '').trim() && !el.querySelector('img')
}

function syncToolbar() {
  const root = editorRef.value
  if (!root)
    return
  const range = selectionRange(root)
  if (!range)
    return
  let tag = nearestBlock(range.startContainer, root)?.tagName.toLowerCase() || ''
  if (tag === 'blockquote') {
    const inner = nearestBlock(range.startContainer, root)
    const child = [...(inner?.children || [])].find(el => /^(p|h1|h2|h3|h4)$/i.test(el.tagName))
    tag = child?.tagName.toLowerCase() || 'p'
  }
  if (tag === 'div')
    tag = 'p'
  if (BLOCKS.some(item => item.id === tag))
    block.value = tag
}

function setBlock(tag: string) {
  const root = editorRef.value
  if (!root)
    return
  const mark = saveOffsets(root)
  root.focus()
  if (mark)
    restoreOffsets(root, mark)
  flattenBlocks(root)
  if (mark)
    restoreOffsets(root, mark)
  if (!selectionRange(root))
    return
  const before = new Set(root.querySelectorAll('p,div,li,pre,h1,h2,h3,h4,h5,h6,blockquote'))
  if (tag === 'blockquote')
    toggleQuote(root)
  else
    formatSelection(root, tag === 'p' ? 'div' : tag)
  for (const el of root.querySelectorAll('p,div,li,pre,h1,h2,h3,h4,h5,h6')) {
    if (!before.has(el) && isEmptyBlock(el))
      el.remove()
  }
  flattenBlocks(root)
  if (mark)
    restoreOffsets(root, mark)
  syncToolbar()
}

function setColor(value: string) {
  colorOpen.value = false
  run('foreColor', value)
}

function setMark(value: string) {
  markOpen.value = false
  run('hiliteColor', value === 'transparent' ? 'transparent' : value)
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

function save() {
  emit('save', editorRef.value?.innerHTML || '')
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask text-editor-mask" @click.self="emit('close')">
      <div class="studio-modal text-editor" role="dialog" aria-modal="true" aria-labelledby="text-editor-title">
        <header class="text-editor__head">
          <h2 id="text-editor-title">{{ t('编辑') }}</h2>
        </header>
        <div class="text-editor__tools" @mousedown.prevent>
          <button
            v-for="item in BLOCKS"
            :key="item.id"
            type="button"
            :class="{ 'is-on': block === item.id }"
            @click="setBlock(item.id)"
          >
            {{ t(item.label) }}
          </button>
          <span class="text-editor__div" />
          <button type="button" :aria-label="t('加粗')" @click="run('bold')">
            <b>B</b>
            <span class="canvas-tip canvas-tip--down">{{ t('加粗') }}</span>
          </button>
          <button type="button" :aria-label="t('斜体')" @click="run('italic')">
            <span class="text-editor__em">I</span>
            <span class="canvas-tip canvas-tip--down">{{ t('斜体') }}</span>
          </button>
          <button type="button" :aria-label="t('列表')" @click="run('insertUnorderedList')">
            <UIcon name="i-lucide-list" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('列表') }}</span>
          </button>
          <button type="button" @click="setBlock('blockquote')">{{ t('引用') }}</button>
          <button type="button" :aria-label="t('代码')" @click="setBlock('pre')">
            <UIcon name="i-lucide-code" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('代码') }}</span>
          </button>
          <div class="text-editor__popwrap">
            <button type="button" :class="{ 'is-on': colorOpen }" :aria-label="t('文字颜色')" @click="colorOpen = !colorOpen; markOpen = false">
              <UIcon name="i-lucide-baseline" class="size-4" />
              <span class="canvas-tip canvas-tip--down">{{ t('文字颜色') }}</span>
            </button>
            <div v-if="colorOpen" class="text-editor__pop">
              <button
                v-for="item in TEXT_COLORS"
                :key="item"
                type="button"
                class="text-editor__chip"
                :style="{ background: item }"
                @click="setColor(item)"
              />
            </div>
          </div>
          <div class="text-editor__popwrap">
            <button type="button" class="is-mark" :class="{ 'is-on': markOpen }" :aria-label="t('高亮')" @click="markOpen = !markOpen; colorOpen = false">
              A
              <span class="canvas-tip canvas-tip--down">{{ t('高亮') }}</span>
            </button>
            <div v-if="markOpen" class="text-editor__pop">
              <button
                v-for="item in MARK_COLORS"
                :key="item"
                type="button"
                class="text-editor__chip"
                :style="{ background: item === 'transparent' ? 'transparent' : item, borderStyle: item === 'transparent' ? 'dashed' : 'solid' }"
                @click="setMark(item)"
              />
            </div>
          </div>
          <button type="button" :aria-label="t('撤销')" @click="run('undo')">
            <UIcon name="i-lucide-undo-2" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('撤销') }}</span>
          </button>
          <button type="button" :aria-label="t('重做')" @click="run('redo')">
            <UIcon name="i-lucide-redo-2" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('重做') }}</span>
          </button>
        </div>
        <div
          ref="editorRef"
          class="text-editor__body"
          contenteditable="true"
          :data-placeholder="t('输入文本内容')"
          @keyup="syncToolbar"
          @mouseup="syncToolbar"
        />
        <footer class="text-editor__foot">
          <button type="button" class="text-editor__btn" @click="emit('close')">{{ t('取消') }}</button>
          <button type="button" class="text-editor__btn text-editor__btn--ok" @click="save">{{ t('确定') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
