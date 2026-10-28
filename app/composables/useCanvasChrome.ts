import { computed, ref, type Ref } from 'vue'
import { nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import {
  canvasClampZoomPct,
  canvasMinimapBox,
  canvasViewRect,
} from '~/utils/canvas-viewport'

/**
 * 选择 / 抓手、空格平移、缩放条、小地图包围盒。
 */
export function useCanvasChrome(opts: {
  nodes: Ref<CanvasFlowNode[]>
  viewport: { value: { x: number, y: number, zoom: number } }
  dimensions: { value: { width: number, height: number } }
  zoomTo: (zoom: number) => void
  isMac: Ref<boolean> | { value: boolean }
  menu: Ref<unknown>
  showHelp: Ref<boolean>
}) {
  const canvasTool = ref<'select' | 'pan'>('select')
  const spacePan = ref(false)
  const SPACE_TAP_MS = 280
  let spaceDownAt = 0
  let spaceMoved = false
  let spaceOriginX = 0
  let spaceOriginY = 0
  let spaceListening = false
  const isPanning = computed(() => canvasTool.value === 'pan' || spacePan.value)
  const toolMenu = ref(false)
  const showMinimap = ref(false)
  const zoomMenu = ref(false)
  const zoomDraft = ref('100')
  const zoomPct = computed(() => Math.round((opts.viewport.value.zoom || 1) * 100))
  const zoomCmd = computed(() => opts.isMac.value ? '⌘' : 'Ctrl')

  function setTool(tool: 'select' | 'pan') {
    canvasTool.value = tool
    toolMenu.value = false
  }

  function onSpacePointer(event: PointerEvent) {
    if (event.type === 'pointerdown') {
      spaceOriginX = event.clientX
      spaceOriginY = event.clientY
      return
    }
    if (!event.buttons)
      return
    if (Math.hypot(event.clientX - spaceOriginX, event.clientY - spaceOriginY) > 5)
      spaceMoved = true
  }

  function listenSpacePan() {
    if (spaceListening)
      return
    spaceListening = true
    window.addEventListener('pointerdown', onSpacePointer, true)
    window.addEventListener('pointermove', onSpacePointer, true)
  }

  function unlistenSpacePan() {
    if (!spaceListening)
      return
    spaceListening = false
    window.removeEventListener('pointerdown', onSpacePointer, true)
    window.removeEventListener('pointermove', onSpacePointer, true)
  }

  function beginSpacePan() {
    spacePan.value = true
    spaceDownAt = performance.now()
    spaceMoved = false
    listenSpacePan()
  }

  function endSpacePan(commitTap: boolean) {
    if (!spacePan.value)
      return
    const tapped = commitTap && !spaceMoved && performance.now() - spaceDownAt < SPACE_TAP_MS
    unlistenSpacePan()
    spacePan.value = false
    spaceDownAt = 0
    // 点空格只切到抓手，不会再切回移动；按住拖完松开则回到原来的工具
    if (tapped)
      setTool('pan')
  }

  function toggleToolMenu() {
    toolMenu.value = !toolMenu.value
    opts.menu.value = null
    opts.showHelp.value = false
    zoomMenu.value = false
  }

  function toggleZoomMenu() {
    zoomMenu.value = !zoomMenu.value
    if (zoomMenu.value) {
      zoomDraft.value = String(zoomPct.value)
      opts.menu.value = null
      toolMenu.value = false
      opts.showHelp.value = false
    }
  }

  function applyZoomPct(value: number, close = false) {
    const pct = canvasClampZoomPct(value)
    opts.zoomTo(pct / 100)
    zoomDraft.value = String(Math.round(pct))
    if (close)
      zoomMenu.value = false
  }

  function applyZoomDraft() {
    const n = Number.parseInt(zoomDraft.value.replace(/[^\d]/g, ''), 10)
    if (!Number.isFinite(n)) {
      zoomDraft.value = String(zoomPct.value)
      return
    }
    applyZoomPct(n)
  }

  function onDockPointer(event: PointerEvent) {
    const el = event.target as HTMLElement
    if (!el.closest('.canvas-dock__zoom-wrap'))
      zoomMenu.value = false
  }

  function nodeBox(node: CanvasFlowNode) {
    return nodeSize(node)
  }

  const viewRect = computed(() => canvasViewRect(opts.viewport.value, opts.dimensions.value))
  const mini = computed(() => canvasMinimapBox(
    opts.nodes.value.map((node) => {
      const box = nodeBox(node)
      return { x: node.position.x, y: node.position.y, w: box.w, h: box.h }
    }),
    viewRect.value,
  ))

  return {
    canvasTool,
    spacePan,
    isPanning,
    toolMenu,
    showMinimap,
    zoomMenu,
    zoomDraft,
    zoomPct,
    zoomCmd,
    viewRect,
    mini,
    setTool,
    beginSpacePan,
    endSpacePan,
    toggleToolMenu,
    toggleZoomMenu,
    applyZoomPct,
    applyZoomDraft,
    onDockPointer,
    nodeBox,
  }
}
