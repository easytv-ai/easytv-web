<script setup lang="ts">
import { cameraMoveLabel, cameraToken, hasCameraToken, insertCameraToken } from '~/utils/canvas-node-kinds'
import { markToken } from '~/utils/canvas-mark'
import { applyRefMatch, applyRefMatches, atWordAt, matchAllRefs, matchRefAt, newRefNames, refToken, switchRefToken, type RefCandidate, type RefMatch } from '~/utils/canvas-autolink'
import { slashQueryAt } from '~/utils/canvas-slash'

const { t } = useI18n()

// 建议条与切换弹层是 Teleport 出去的兄弟节点，根节点不再唯一
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue: string
  placeholder?: string
  /**
   * 跟练只读：contenteditable 关掉，onInput / onKeydown / onPaste 三个入口早退，
   * update:modelValue 不再发出（提示词框本体是 contenteditable，HTML readonly 对它无效）。
   */
  readonly?: boolean
  /** 旧数据只有单选运镜、提示词里还没有标签时，打开后落到文末 */
  cameraMove?: string
  marks?: Array<{ id: string, name: string }>
  /** 可被智能引用的参考素材（L1，API.md 31.2） */
  refs?: RefCandidate[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'open-cam': []
  'remove-mark': [id: string]
  /** 打了 "/" 时把查询词抛给上层开面板，退出 slash 状态时给 null */
  slash: [query: string | null]
  /** slash 面板开着时的上下键与回车 */
  'slash-move': [delta: number]
  'slash-confirm': []
  /** 打了 @ 但没有素材可引用：让上层开素材库 / 画布选节点，选完自动插引用标签 */
  'pick-ref': [source: 'asset' | 'canvas']
}>()

const editorRef = ref<HTMLElement | null>(null)
const lastCaret = ref<number | null>(null)
const composing = ref(false)
let fromInside = false

/** 光标处的引用建议，Tab 确认 */
const suggest = ref<RefMatch | null>(null)
const suggestRect = ref<{ x: number, y: number } | null>(null)
/** 点开的引用标签：切换它指向的素材 */
const switching = ref<{ name: string, nth: number, x: number, y: number } | null>(null)
/** 光标前刚打了 @ 又没素材可配：给一条「从素材库选 / 从画布选」的入口（L21） */
const atHint = ref<{ start: number, end: number } | null>(null)
/** 从 @ 入口选素材时记下 @ 那段的位置，素材回来后整段换成引用标签 */
let pendingAt: { start: number, end: number } | null = null
let refsSnapshot: RefCandidate[] = []
/** slash 面板是否开着，由上层回填，决定要不要吃掉上下键与回车 */
const slashOpen = defineModel<boolean>('slashOpen', { default: false })

const refList = computed(() => props.refs || [])

function editorEl() {
  return editorRef.value as HTMLElement | null
}

const VIDEO_ICON = '<svg class="canvas-inspector__cam-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>'
const SPARKLE_ICON = '<svg class="canvas-inspector__mark-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>'
const CLOSE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
const LINK_ICON = '<svg class="canvas-inspector__ref-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/></svg>'
const TOKEN_RE = /\{\{(cam|mark|ref):([^{}]{1,40})\}\}/g

function chipTokenOf(el: HTMLElement) {
  if (el.dataset.camId)
    return cameraToken(el.dataset.camId)
  if (el.dataset.markId)
    return markToken(el.dataset.markId)
  if (el.dataset.refName)
    return refToken(el.dataset.refName)
  return ''
}

function isChip(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && !!(node.dataset.camId || node.dataset.markId || node.dataset.refName)
}

function serializeNode(root: HTMLElement) {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent || ''
      return
    }
    if (isChip(node)) {
      out += chipTokenOf(node)
      return
    }
    if (node.nodeName === 'BR') {
      out += '\n'
      return
    }
    if (node.nodeName === 'DIV' || node.nodeName === 'P') {
      if (out && !out.endsWith('\n'))
        out += '\n'
    }
    node.childNodes.forEach(walk)
  }
  root.childNodes.forEach(walk)
  return out.replace(/^\n/, '')
}

function offsetInPrompt(root: HTMLElement, target: Node, targetOffset: number) {
  let n = 0
  let done = false
  const walk = (node: Node) => {
    if (done)
      return
    if (node === target && node.nodeType === Node.TEXT_NODE) {
      n += targetOffset
      done = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      n += node.textContent?.length || 0
      return
    }
    if (isChip(node)) {
      if (node === target || node.contains(target)) {
        done = true
        return
      }
      n += chipTokenOf(node).length
      return
    }
    if (node.nodeName === 'BR') {
      if (node === target) {
        done = true
        return
      }
      n += 1
      return
    }
    if (node === target && node === root) {
      const children = Array.from(node.childNodes)
      for (let i = 0; i < Math.min(targetOffset, children.length); i++)
        walk(children[i]!)
      done = true
      return
    }
    node.childNodes.forEach(walk)
  }
  walk(root)
  return n
}

function rememberCaret() {
  const root = editorEl()
  const sel = window.getSelection()
  if (!root || !sel || !sel.rangeCount)
    return
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer) && range.startContainer !== root)
    return
  lastCaret.value = offsetInPrompt(root, range.startContainer, range.startOffset)
}

function placeCaret(offset: number) {
  const root = editorEl()
  const sel = window.getSelection()
  if (!root || !sel)
    return
  const range = document.createRange()
  let n = 0
  const place = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length || 0
      if (n + len >= offset) {
        range.setStart(node, Math.max(0, offset - n))
        range.collapse(true)
        return true
      }
      n += len
      return false
    }
    if (isChip(node)) {
      const len = chipTokenOf(node).length
      if (n + len >= offset) {
        range.setStartAfter(node)
        range.collapse(true)
        return true
      }
      n += len
      return false
    }
    if (node.nodeName === 'BR') {
      if (n + 1 >= offset) {
        range.setStartAfter(node)
        range.collapse(true)
        return true
      }
      n += 1
      return false
    }
    for (const child of Array.from(node.childNodes)) {
      if (place(child))
        return true
    }
    return false
  }
  if (!place(root)) {
    range.selectNodeContents(root)
    range.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(range)
  lastCaret.value = offset
}

function bindChipButtons(chip: HTMLElement, onHit?: () => void, onClear?: () => void) {
  const hit = chip.querySelector('.canvas-inspector__cam-hit') as HTMLButtonElement | null
  const close = chip.querySelector('.canvas-inspector__cam-clear') as HTMLButtonElement | null
  hit?.addEventListener('mousedown', event => event.preventDefault())
  hit?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const range = document.createRange()
    range.setStartAfter(chip)
    range.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    rememberCaret()
    onHit?.()
  })
  close?.addEventListener('mousedown', event => event.preventDefault())
  close?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    chip.remove()
    emitPrompt()
    rememberCaret()
    onClear?.()
  })
}

function createCamChip(id: string) {
  const label = t(cameraMoveLabel(id) || id)
  const chip = document.createElement('span')
  chip.className = 'canvas-inspector__cam-tag'
  chip.contentEditable = 'false'
  chip.dataset.camId = id
  chip.setAttribute('title', t('运镜'))
  chip.innerHTML = `<button type="button" class="canvas-inspector__cam-hit">${VIDEO_ICON}<b></b></button><button type="button" class="canvas-inspector__cam-clear" aria-label="${t('清除')}">${CLOSE_ICON}</button>`
  const name = chip.querySelector('b')
  if (name)
    name.textContent = label
  bindChipButtons(chip, () => emit('open-cam'))
  return chip
}

function markLabel(id: string) {
  return props.marks?.find(item => item.id === id)?.name || t('标记')
}

function createMarkChip(id: string) {
  const chip = document.createElement('span')
  chip.className = 'canvas-inspector__cam-tag is-mark'
  chip.contentEditable = 'false'
  chip.dataset.markId = id
  chip.setAttribute('title', t('标记'))
  chip.innerHTML = `<button type="button" class="canvas-inspector__cam-hit">${SPARKLE_ICON}<b></b></button><button type="button" class="canvas-inspector__cam-clear" aria-label="${t('清除')}">${CLOSE_ICON}</button>`
  const name = chip.querySelector('b')
  if (name)
    name.textContent = markLabel(id)
  bindChipButtons(chip, undefined, () => emit('remove-mark', id))
  return chip
}

/** 引用标签：点标签本身可以换成别的参考素材 */
function createRefChip(name: string, nth: number) {
  const chip = document.createElement('span')
  chip.className = 'canvas-inspector__cam-tag is-ref'
  chip.contentEditable = 'false'
  chip.dataset.refName = name
  chip.setAttribute('title', t('点击可切换引用的素材'))
  chip.innerHTML = `<button type="button" class="canvas-inspector__cam-hit">${LINK_ICON}<b></b></button><button type="button" class="canvas-inspector__cam-clear" aria-label="${t('清除')}">${CLOSE_ICON}</button>`
  const label = chip.querySelector('b')
  if (label)
    label.textContent = name
  bindChipButtons(chip, () => {
    if (refList.value.length < 2)
      return
    const rect = chip.getBoundingClientRect()
    switching.value = { name, nth, x: rect.left, y: rect.bottom + 6 }
  })
  return chip
}

function render(prompt: string) {
  const root = editorEl()
  if (!root)
    return
  root.replaceChildren()
  const src = String(prompt || '')
  const re = new RegExp(TOKEN_RE.source, 'g')
  let last = 0
  let match: RegExpExecArray | null
  let refSeen = 0
  while ((match = re.exec(src))) {
    if (match.index > last)
      root.appendChild(document.createTextNode(src.slice(last, match.index)))
    if (match[1] === 'cam')
      root.appendChild(createCamChip(match[2] || ''))
    else if (match[1] === 'ref')
      root.appendChild(createRefChip((match[2] || '').trim(), refSeen++))
    else
      root.appendChild(createMarkChip(match[2] || ''))
    last = match.index + match[0].length
  }
  if (last < src.length)
    root.appendChild(document.createTextNode(src.slice(last)))
  root.classList.toggle('is-empty', !src)
}

function emitPrompt() {
  const root = editorEl()
  if (!root)
    return
  fromInside = true
  const next = serializeNode(root)
  root.classList.toggle('is-empty', !next)
  emit('update:modelValue', next)
  nextTick(() => {
    fromInside = false
  })
}

/** 光标处的屏幕坐标，用来把建议条贴在光标下面 */
function caretPoint() {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount)
    return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width || rect.height)
    return { x: rect.left, y: rect.bottom + 6 }
  const root = editorEl()?.getBoundingClientRect()
  return root ? { x: root.left, y: root.bottom + 6 } : null
}

/**
 * 当前提示词：以编辑器里的内容为准。父级的 prop 回流要晚一拍，
 * 输入当下读 props.modelValue 会拿到上一轮的值。
 */
function currentPrompt() {
  const root = editorEl()
  return root ? serializeNode(root) : (props.modelValue || '')
}

/** 每次输入后重算引用建议与 slash 状态 */
function refreshHints() {
  const prompt = currentPrompt()
  const caret = lastCaret.value ?? prompt.length
  const slash = slashQueryAt(prompt, caret)
  emit('slash', slash ? slash.query : null)
  if (slash) {
    suggest.value = null
    return
  }
  const hit = matchRefAt(prompt, caret, refList.value)
  suggest.value = hit
  atHint.value = hit ? null : atWordAt(prompt, caret)
  suggestRect.value = hit || atHint.value ? caretPoint() : null
}

/** @ 入口：记住 @ 的范围，交给上层开选择器；素材回来时在 refs 的 watch 里落标签 */
function pickRefFrom(source: 'asset' | 'canvas') {
  const range = atHint.value
  if (!range)
    return
  pendingAt = { ...range }
  // 以点击这一刻的素材列表为基准：选回来的那张才是「新出现的」，
  // 不然第一次触发时快照还是空的，会把早就挂着的素材当成新选的
  refsSnapshot = [...refList.value]
  atHint.value = null
  suggestRect.value = null
  emit('pick-ref', source)
}

function onInput() {
  if (props.readonly || composing.value)
    return
  // 用户又接着打字了，之前那次「@ 选素材」就作废，别把后来选的素材塞进旧位置
  pendingAt = null
  rememberCaret()
  emitPrompt()
  nextTick(refreshHints)
}

async function applyPrompt(next: { prompt: string, caret: number }) {
  lastCaret.value = next.caret
  fromInside = true
  emit('update:modelValue', next.prompt)
  await nextTick()
  render(next.prompt)
  placeCaret(next.caret)
  fromInside = false
  suggest.value = null
}

/** Tab 确认光标处这一条 */
async function confirmSuggest() {
  const hit = suggest.value
  if (!hit)
    return
  await applyPrompt(applyRefMatch(currentPrompt(), hit))
}

/** Shift+Tab 把整段里能认出来的素材名一次全确认 */
async function confirmAllSuggests() {
  const prompt = currentPrompt()
  const all = matchAllRefs(prompt, refList.value)
  if (!all.length)
    return
  await applyPrompt(applyRefMatches(prompt, all))
}

async function pickSwitch(name: string) {
  const open = switching.value
  switching.value = null
  if (!open || name === open.name)
    return
  const next = switchRefToken(currentPrompt(), open.name, name, open.nth)
  await applyPrompt({ prompt: next, caret: lastCaret.value ?? next.length })
}

function onKeydown(event: KeyboardEvent) {
  if (props.readonly || event.isComposing)
    return
  if (slashOpen.value) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      emit('slash-move', event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      emit('slash-confirm')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      emit('slash', null)
      return
    }
  }
  if (event.key === 'Tab' && (suggest.value || event.shiftKey)) {
    event.preventDefault()
    void (event.shiftKey ? confirmAllSuggests() : confirmSuggest())
    return
  }
  if (event.key === 'Escape' && suggest.value) {
    event.preventDefault()
    suggest.value = null
    return
  }
  if (event.key !== 'Enter')
    return
  event.preventDefault()
  document.execCommand('insertText', false, '\n')
}

function onPaste(event: ClipboardEvent) {
  if (props.readonly)
    return
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') || ''
  if (text)
    document.execCommand('insertText', false, text)
}

function onFocus() {
  document.addEventListener('selectionchange', rememberCaret)
  rememberCaret()
}

function onBlur() {
  rememberCaret()
  document.removeEventListener('selectionchange', rememberCaret)
  // 建议条与切换弹层里的点击要先落地，延后一拍再收
  setTimeout(() => {
    suggest.value = null
    atHint.value = null
  }, 160)
}

/** 清掉提示词里的一段（slash 选中后由上层调） */
async function replaceRange(start: number, end: number, text = '') {
  const src = currentPrompt()
  const from = Math.max(0, Math.min(start, src.length))
  const to = Math.max(from, Math.min(end, src.length))
  await applyPrompt({ prompt: src.slice(0, from) + text + src.slice(to), caret: from + text.length })
}

function caretOffset() {
  return lastCaret.value ?? currentPrompt().length
}

async function insertCameraMove(id: string) {
  const result = insertCameraToken(props.modelValue || '', id, lastCaret.value)
  lastCaret.value = result.caret
  fromInside = true
  emit('update:modelValue', result.prompt)
  await nextTick()
  render(result.prompt)
  placeCaret(result.caret)
  fromInside = false
}

function focus() {
  editorEl()?.focus()
}

watch(() => props.modelValue, (value) => {
  if (fromInside)
    return
  render(value || '')
})

watch(() => props.marks, () => {
  if (fromInside)
    return
  render(props.modelValue || '')
}, { deep: true })

// 参考素材变了（连线增删、上传），已有标签的文案不动，只重算建议；
// 如果是从 @ 入口选回来的，把 @ 那段换成新素材的引用标签
watch(() => props.refs, async (refs) => {
  const added = newRefNames(refsSnapshot, refs || [])
  refsSnapshot = [...(refs || [])]
  const range = pendingAt
  if (range && added.length) {
    pendingAt = null
    const token = refToken(added[added.length - 1])
    const src = currentPrompt()
    const end = Math.min(range.end, src.length)
    const start = Math.min(range.start, end)
    if (token)
      await applyPrompt({ prompt: src.slice(0, start) + token + src.slice(end), caret: start + token.length })
    return
  }
  if (!fromInside)
    refreshHints()
}, { deep: true })

onMounted(() => {
  refsSnapshot = [...refList.value]
  const prompt = props.modelValue || ''
  if (props.cameraMove && !hasCameraToken(prompt)) {
    const result = insertCameraToken(prompt, props.cameraMove)
    fromInside = true
    emit('update:modelValue', result.prompt)
    render(result.prompt)
    lastCaret.value = result.caret
    nextTick(() => {
      fromInside = false
    })
    return
  }
  render(prompt)
})

onUnmounted(() => {
  document.removeEventListener('selectionchange', rememberCaret)
})

defineExpose({ insertCameraMove, focus, replaceRange, caretOffset, confirmAllSuggests })
</script>

<template>
  <!-- 多根（编辑器 + Teleport）时 Vue 不会把透传属性放到任何一根上，data-guide 会被静默丢掉；
       inheritAttrs 已关，这里显式把 $attrs 绑到编辑器上——跟练的高亮锚点 inspector-prompt 就挂在它上面。 -->
  <div
    ref="editorRef"
    v-bind="$attrs"
    class="canvas-inspector__prompt"
    :class="{ 'is-empty': !modelValue }"
    :contenteditable="!readonly"
    data-canvas-inspector-input
    spellcheck="false"
    :data-placeholder="placeholder"
    @input="onInput"
    @keydown="onKeydown"
    @paste="onPaste"
    @focus="onFocus"
    @blur="onBlur"
    @keyup="rememberCaret"
    @mouseup="rememberCaret"
  />
  <Teleport to="body">
    <!-- @ 后没有素材可配（L21）：从素材库或画布上选一个，选完自动插引用标签 -->
    <div
      v-if="!suggest && atHint && suggestRect"
      class="canvas-autolink"
      :style="{ left: `${suggestRect.x}px`, top: `${suggestRect.y}px` }"
      @pointerdown.prevent.stop
    >
      <span class="canvas-autolink__name">@</span>
      <button type="button" class="canvas-autolink__act" @click="pickRefFrom('asset')">
        <UIcon name="i-lucide-images" class="size-3.5" />
        {{ t('从资产库选') }}
      </button>
      <i />
      <button type="button" class="canvas-autolink__act" @click="pickRefFrom('canvas')">
        <UIcon name="i-lucide-mouse-pointer-click" class="size-3.5" />
        {{ t('从画布选节点') }}
      </button>
    </div>
    <!-- 智能引用建议（L1）：贴在光标下面，Tab 确认 -->
    <div
      v-if="suggest && suggestRect"
      class="canvas-autolink"
      :style="{ left: `${suggestRect.x}px`, top: `${suggestRect.y}px` }"
      @pointerdown.prevent.stop="confirmSuggest()"
    >
      <span class="canvas-autolink__name">@{{ suggest.name }}</span>
      <kbd>Tab</kbd>
      <em>{{ t('引用') }}</em>
      <i />
      <kbd>Shift+Tab</kbd>
      <em>{{ t('全部') }}</em>
    </div>
    <!-- 切换标签引用的素材 -->
    <div v-if="switching" class="canvas-autolink__mask" @pointerdown="switching = null" />
    <div
      v-if="switching"
      class="canvas-autolink__switch"
      :style="{ left: `${switching.x}px`, top: `${switching.y}px` }"
      @pointerdown.stop
    >
      <p>{{ t('换成') }}</p>
      <button
        v-for="item in refList"
        :key="item.name"
        type="button"
        :class="{ 'is-on': item.name === switching.name }"
        @click="pickSwitch(item.name)"
      >
        <img v-if="item.url" :src="item.url" alt="">
        <span>{{ item.name }}</span>
      </button>
    </div>
  </Teleport>
</template>
