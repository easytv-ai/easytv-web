<script setup lang="ts">
import taskApi from '~/api/task'
import type { GenerationModel } from '~/types/creative'
import { markGridToMask } from '~/utils/canvas-mark'
import { listImageEditModels } from '~/utils/image-input'
import { effectiveUnitPrice, estimateTaskPoints, modelPromoDisplay } from '~/utils/model-price'
import { shortModelName } from '~/utils/model-name'

const { t } = useI18n()
const toast = useToast()
const { isMember } = useWallet()
/** 蒙版计算网格的长边（像素级泛洪在 4K 图上太慢，蒙版边缘粗一点不影响局部重绘） */
const MASK_GRID = 512
/** 标记画布的工作尺寸上限：按原图尺寸建 4K 画布时每步撤销快照约 64MB，30 步能吃掉 2GB；导出蒙版时再放大回原图尺寸 */
const WORK_MAX = 2048

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  /** mark = 画笔标注；erase = 涂抹擦除（移除物体） */
  mode?: 'mark' | 'erase'
  maskUrl?: string
  submitting?: boolean
  box?: { left: number, top: number, width: number, height: number } | null
}>(), {
  mode: 'mark',
  maskUrl: '',
  submitting: false,
  box: null,
})

const emit = defineEmits<{
  close: []
  confirm: [blob: Blob, model?: string]
}>()

type MarkTool = 'pen' | 'eraser' | 'rect' | 'arrow' | 'text'

const TOOLS: { id: MarkTool, icon: string, label: string }[] = [
  { id: 'pen', icon: 'i-lucide-pencil', label: '画笔' },
  { id: 'eraser', icon: 'i-lucide-eraser', label: '橡皮擦' },
  { id: 'rect', icon: 'i-lucide-square', label: '矩形' },
  { id: 'arrow', icon: 'i-lucide-move-up-right', label: '箭头' },
  { id: 'text', icon: '', label: '文字' },
]

const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de', '#ff4d9a', '#ffffff', '#111111']
const UNIT_LABEL: Record<string, string> = { second: '秒', image: '张', call: '次' }
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const generationModelsLoaded = useState('generation-models-loaded', () => false)
const modelId = ref('')
const modelMenu = ref(false)
const editModels = computed(() => listImageEditModels(generationModels.value, true))
const pickerModels = computed(() => editModels.value.map((item) => {
  const name = shortModelName(item)
  const label = String(item.label || '').trim()
  const desc = label && label !== name ? label : (item.provider || '')
  const promo = item.priced ? modelPromoDisplay(item, isMember.value) : null
  return {
    id: item.model,
    name,
    desc,
    ...(promo ? { promo: { ...promo, unit: UNIT_LABEL[item.unit] || '次' } } : {}),
  }
}))
const currentPicker = computed(() => pickerModels.value.find(item => item.id === modelId.value) || pickerModels.value[0] || null)
const currentApiModel = computed(() => editModels.value.find(item => item.model === modelId.value) || editModels.value[0] || null)
const zapCost = computed<number | string>(() => {
  const m = currentApiModel.value
  if (!m)
    return ''
  if (!m.priced)
    return t('未定价')
  return estimateTaskPoints(effectiveUnitPrice(m, isMember.value), m.unit, 1)
})

function syncModel() {
  if (!editModels.value.some(item => item.model === modelId.value))
    modelId.value = editModels.value[0]?.model || ''
}

function pickModel(id: string) {
  modelId.value = id
  modelMenu.value = false
}

function toggleModel() {
  colorOpen.value = false
  modelMenu.value = !modelMenu.value
}

const imgRef = ref<HTMLImageElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)
const tool = ref<MarkTool>('pen')
const color = ref('#ff3b30')
const colorOpen = ref(false)
const drawing = ref(false)
const brushSize = ref(32)
const undos = ref<ImageData[]>([])
const redos = ref<ImageData[]>([])
const textDraft = ref<{ x: number, y: number, text: string } | null>(null)
const photoReady = ref(false)
const brushTip = ref({ x: 0, y: 0, on: false })
let startPt: { x: number, y: number } | null = null
let lastPt: { x: number, y: number } | null = null
let shapeSnap: ImageData | null = null
let maskEl: HTMLCanvasElement | null = null
let overlayEl: HTMLCanvasElement | null = null
let checkerTile: HTMLCanvasElement | null = null
const MASK_TINT = 'rgba(225, 29, 119, 0.62)'
const DEFAULT_BRUSH = 12

const layerStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
})

const textStyle = computed(() => {
  const draft = textDraft.value
  const canvas = canvasRef.value
  if (!draft || !canvas?.width || !canvas.height)
    return null
  const box = canvas.getBoundingClientRect()
  return {
    left: `${draft.x / Math.max(box.width, 1) * 100}%`,
    top: `${draft.y / Math.max(box.height, 1) * 100}%`,
    color: color.value,
  }
})

function ctx() {
  return canvasRef.value?.getContext('2d', { willReadFrequently: true }) ?? null
}

function viewBox() {
  const canvas = canvasRef.value
  const box = canvas?.getBoundingClientRect()
  const w = Math.max(box?.width || 0, 1)
  const h = Math.max(box?.height || 0, 1)
  return {
    w,
    h,
    sx: (canvas?.width || 1) / w,
    sy: (canvas?.height || 1) / h,
  }
}

function applyStroke(c: CanvasRenderingContext2D, mode: 'pen' | 'shape' | 'erase' = 'pen') {
  const { sx, sy } = viewBox()
  c.setTransform(sx, 0, 0, sy, 0, 0)
  if (mode === 'erase') {
    c.globalCompositeOperation = 'destination-out'
    c.lineWidth = 10
    c.lineCap = 'round'
    c.lineJoin = 'round'
    return
  }
  c.globalCompositeOperation = 'source-over'
  c.strokeStyle = color.value
  c.fillStyle = color.value
  c.lineWidth = 2
  if (mode === 'shape') {
    c.lineCap = 'butt'
    c.lineJoin = 'miter'
    c.miterLimit = 1.5
    return
  }
  c.lineCap = 'round'
  c.lineJoin = 'round'
}

function maskCtx() {
  return maskEl?.getContext('2d', { willReadFrequently: true }) ?? null
}

function overlayCtx() {
  return overlayEl?.getContext('2d') ?? null
}

function checkerPattern(c: CanvasRenderingContext2D) {
  if (!checkerTile) {
    checkerTile = document.createElement('canvas')
    checkerTile.width = 20
    checkerTile.height = 20
    const tile = checkerTile.getContext('2d')
    if (tile) {
      tile.fillStyle = '#d8d8de'
      tile.fillRect(0, 0, 20, 20)
      tile.fillStyle = '#8e8e96'
      tile.fillRect(0, 0, 10, 10)
      tile.fillRect(10, 10, 10, 10)
    }
  }
  return c.createPattern(checkerTile, 'repeat') || '#cfcfd4'
}

function sizeMask(w: number, h: number) {
  if (!maskEl)
    maskEl = document.createElement('canvas')
  if (maskEl.width !== w || maskEl.height !== h) {
    maskEl.width = w
    maskEl.height = h
  }
  if (!overlayEl)
    overlayEl = document.createElement('canvas')
  if (overlayEl.width !== w || overlayEl.height !== h) {
    overlayEl.width = w
    overlayEl.height = h
  }
}

function smearWorkSize() {
  const img = imgRef.value
  const box = props.box
  const nw = img?.naturalWidth || 0
  const nh = img?.naturalHeight || 0
  let w = 0
  let h = 0
  if (box && box.width > 2 && box.height > 2) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = Math.round(box.width * dpr)
    h = Math.round(box.height * dpr)
  }
  else if (nw && nh) {
    w = nw
    h = nh
  }
  const scale = Math.min(1, WORK_MAX / Math.max(w, h, 1))
  return {
    w: Math.max(1, Math.round((w || 1) * scale)),
    h: Math.max(1, Math.round((h || 1) * scale)),
  }
}

function ensureSmearSurface() {
  const canvas = canvasRef.value
  if (!canvas)
    return false
  if (!maskEl || !canvas.width || !canvas.height) {
    const size = smearWorkSize()
    canvas.width = size.w
    canvas.height = size.h
  }
  sizeMask(canvas.width, canvas.height)
  return Boolean(maskEl && maskEl.width)
}

function redrawSmear() {
  const canvas = canvasRef.value
  const view = ctx()
  const img = imgRef.value
  if (!canvas || !view || !canvas.width)
    return
  view.save()
  view.setTransform(1, 0, 0, 1, 0, 0)
  view.globalCompositeOperation = 'source-over'
  view.globalAlpha = 1
  view.clearRect(0, 0, canvas.width, canvas.height)
  let drew = false
  if (img?.naturalWidth) {
    try {
      view.drawImage(img as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height)
      drew = true
    }
    catch {
      drew = false
    }
  }
  photoReady.value = drew
  if (maskEl && overlayEl) {
    const overlay = overlayCtx()
    if (overlay) {
      overlay.setTransform(1, 0, 0, 1, 0, 0)
      overlay.globalCompositeOperation = 'source-over'
      overlay.globalAlpha = 1
      overlay.clearRect(0, 0, overlayEl.width, overlayEl.height)
      overlay.drawImage(maskEl, 0, 0)
      overlay.globalCompositeOperation = 'source-in'
      overlay.fillStyle = checkerPattern(overlay)
      overlay.fillRect(0, 0, overlayEl.width, overlayEl.height)
      overlay.globalCompositeOperation = 'source-atop'
      overlay.fillStyle = MASK_TINT
      overlay.fillRect(0, 0, overlayEl.width, overlayEl.height)
      overlay.globalCompositeOperation = 'source-over'
      view.globalAlpha = 0.72
      view.drawImage(overlayEl, 0, 0)
      view.globalAlpha = 1
    }
  }
  view.restore()
}

function smearPoint(event: PointerEvent) {
  const canvas = canvasRef.value
  const layer = canvas?.parentElement
  const box = (canvas || layer)?.getBoundingClientRect()
  const w = canvas?.width || 1
  const h = canvas?.height || 1
  if (!box)
    return { x: 0, y: 0, r: brushSize.value }
  return {
    x: (event.clientX - box.left) / box.width * w,
    y: (event.clientY - box.top) / box.height * h,
    r: brushSize.value * (w / Math.max(box.width, 1)),
  }
}

function strokeSmear(c: CanvasRenderingContext2D, x: number, y: number, r: number, erase: boolean) {
  c.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  c.strokeStyle = erase ? '#000' : '#fff'
  c.fillStyle = erase ? '#000' : '#fff'
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.lineWidth = Math.max(2, r * 2)
  if (lastPt) {
    c.beginPath()
    c.moveTo(lastPt.x, lastPt.y)
    c.lineTo(x, y)
    c.stroke()
  }
  else {
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fill()
  }
  c.globalCompositeOperation = 'source-over'
}

function paintSmear(event: PointerEvent) {
  if (!ensureSmearSurface())
    return
  const mask = maskCtx()
  if (!mask || !maskEl)
    return
  const { x, y, r } = smearPoint(event)
  strokeSmear(mask, x, y, r, tool.value === 'eraser')
  lastPt = { x, y }
  redrawSmear()
}

function trackTip(event: PointerEvent) {
  const layer = canvasRef.value?.parentElement
  const box = layer?.getBoundingClientRect()
  if (!box)
    return
  brushTip.value = {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
    on: true,
  }
}

function hideTip() {
  brushTip.value = { ...brushTip.value, on: false }
}

function point(event: PointerEvent) {
  const canvas = canvasRef.value!
  const box = canvas.getBoundingClientRect()
  return {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
  }
}

function pushUndo() {
  if (props.mode === 'erase') {
    if (!ensureSmearSurface())
      return
    const mask = maskCtx()
    if (!mask || !maskEl)
      return
    undos.value.push(mask.getImageData(0, 0, maskEl.width, maskEl.height))
    if (undos.value.length > 30)
      undos.value.shift()
    redos.value = []
    return
  }
  const c = ctx()
  const canvas = canvasRef.value
  if (!c || !canvas)
    return
  undos.value.push(c.getImageData(0, 0, canvas.width, canvas.height))
  if (undos.value.length > 30)
    undos.value.shift()
  redos.value = []
}

function tintOverlay(c: CanvasRenderingContext2D, w: number, h: number) {
  const data = c.getImageData(0, 0, w, h)
  const raw = color.value.replace('#', '')
  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  for (let i = 0; i < data.data.length; i += 4) {
    if ((data.data[i + 3] ?? 0) > 12) {
      data.data[i] = r
      data.data[i + 1] = g
      data.data[i + 2] = b
      data.data[i + 3] = 220
    }
  }
  c.putImageData(data, 0, 0)
}

function fitCanvas() {
  const canvas = canvasRef.value
  const img = imgRef.value
  if (!canvas)
    return
  if (props.mode === 'erase') {
    const size = smearWorkSize()
    canvas.width = size.w
    canvas.height = size.h
    sizeMask(canvas.width, canvas.height)
    maskCtx()?.clearRect(0, 0, canvas.width, canvas.height)
    lastPt = null
    redrawSmear()
    return
  }
  if (!img?.naturalWidth)
    return
  const workScale = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight))
  canvas.width = Math.max(1, Math.round(img.naturalWidth * workScale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * workScale))
  const c = canvas.getContext('2d', { willReadFrequently: true })
  if (!c)
    return
  c.clearRect(0, 0, canvas.width, canvas.height)
  if (!props.maskUrl)
    return
  const mask = new Image()
  mask.crossOrigin = 'anonymous'
  mask.onload = () => {
    c.drawImage(mask, 0, 0, canvas.width, canvas.height)
    tintOverlay(c, canvas.width, canvas.height)
  }
  mask.src = props.maskUrl
}

function drawRect(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1)
  const y = Math.min(y0, y1)
  const w = Math.abs(x1 - x0)
  const h = Math.abs(y1 - y0)
  c.beginPath()
  c.moveTo(x, y)
  c.lineTo(x + w, y)
  c.lineTo(x + w, y + h)
  c.lineTo(x, y + h)
  c.closePath()
  c.stroke()
}

function drawArrow(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy)
  if (len < 2)
    return
  const ux = dx / len
  const uy = dy / len
  const head = Math.min(18, Math.max(12, len * 0.18))
  const wing = head * 0.55
  const bx = x1 - ux * head
  const by = y1 - uy * head
  c.beginPath()
  c.moveTo(x0, y0)
  c.lineTo(bx, by)
  c.stroke()
  c.beginPath()
  c.moveTo(x1, y1)
  c.lineTo(bx - uy * wing, by + ux * wing)
  c.lineTo(bx + uy * wing, by - ux * wing)
  c.closePath()
  c.fill()
}

function previewShape(pt: { x: number, y: number }) {
  const c = ctx()
  if (!c || !shapeSnap || !startPt)
    return
  c.putImageData(shapeSnap, 0, 0)
  applyStroke(c, 'shape')
  if (tool.value === 'rect')
    drawRect(c, startPt.x, startPt.y, pt.x, pt.y)
  else if (tool.value === 'arrow')
    drawArrow(c, startPt.x, startPt.y, pt.x, pt.y)
}

function commitText() {
  const draft = textDraft.value
  const c = ctx()
  const value = draft?.text.trim() || ''
  textDraft.value = null
  if (!draft || !c || !value)
    return
  pushUndo()
  applyStroke(c, 'shape')
  c.font = '700 18px ui-sans-serif, system-ui, sans-serif'
  c.textBaseline = 'top'
  c.fillText(value, draft.x, draft.y)
}

function openText(pt: { x: number, y: number }) {
  commitText()
  textDraft.value = { x: pt.x, y: pt.y, text: '' }
  nextTick(() => textInputRef.value?.focus())
}

function setTool(next: MarkTool) {
  if (tool.value === 'text')
    commitText()
  tool.value = next
  colorOpen.value = false
}

function pickColor(value: string) {
  color.value = value
  colorOpen.value = false
}

function onDown(event: PointerEvent) {
  if (colorOpen.value)
    colorOpen.value = false
  if (props.mode === 'erase') {
    drawing.value = true
    lastPt = null
    pushUndo()
    ;(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
    trackTip(event)
    paintSmear(event)
    return
  }
  if (tool.value === 'text') {
    openText(point(event))
    return
  }
  const c = ctx()
  if (!c)
    return
  drawing.value = true
  const pt = point(event)
  startPt = pt
  lastPt = pt
  pushUndo()
  ;(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
  if (tool.value === 'pen' || tool.value === 'eraser') {
    applyStroke(c, tool.value === 'eraser' ? 'erase' : 'pen')
    c.beginPath()
    c.moveTo(pt.x, pt.y)
    c.lineTo(pt.x + 0.01, pt.y)
    c.stroke()
    return
  }
  applyStroke(c, 'shape')
  const canvas = canvasRef.value
  if (canvas)
    shapeSnap = c.getImageData(0, 0, canvas.width, canvas.height)
}

function onMove(event: PointerEvent) {
  if (props.mode === 'erase') {
    trackTip(event)
    if (drawing.value)
      paintSmear(event)
    return
  }
  if (!drawing.value)
    return
  const pt = point(event)
  if (tool.value === 'pen' || tool.value === 'eraser') {
    const c = ctx()
    if (!c || !lastPt)
      return
    applyStroke(c, tool.value === 'eraser' ? 'erase' : 'pen')
    c.beginPath()
    c.moveTo(lastPt.x, lastPt.y)
    c.lineTo(pt.x, pt.y)
    c.stroke()
    lastPt = pt
    return
  }
  previewShape(pt)
}

function onUp() {
  drawing.value = false
  startPt = null
  lastPt = null
  shapeSnap = null
  const c = ctx()
  if (c)
    c.globalCompositeOperation = 'source-over'
}

function undo() {
  const snap = undos.value.pop()
  if (!snap)
    return
  if (props.mode === 'erase') {
    const mask = maskCtx()
    if (!mask || !maskEl)
      return
    redos.value.push(mask.getImageData(0, 0, maskEl.width, maskEl.height))
    mask.putImageData(snap, 0, 0)
    redrawSmear()
    return
  }
  const c = ctx()
  const canvas = canvasRef.value
  if (!c || !canvas)
    return
  redos.value.push(c.getImageData(0, 0, canvas.width, canvas.height))
  c.putImageData(snap, 0, 0)
}

function redo() {
  const snap = redos.value.pop()
  if (!snap)
    return
  if (props.mode === 'erase') {
    const mask = maskCtx()
    if (!mask || !maskEl)
      return
    undos.value.push(mask.getImageData(0, 0, maskEl.width, maskEl.height))
    mask.putImageData(snap, 0, 0)
    redrawSmear()
    return
  }
  const c = ctx()
  const canvas = canvasRef.value
  if (!c || !canvas)
    return
  undos.value.push(c.getImageData(0, 0, canvas.width, canvas.height))
  c.putImageData(snap, 0, 0)
}

/**
 * 导出局部修改蒙版（白色不透明 = 要改，后端 OpenAIMaskFromMark 反转 alpha）。
 * 标记是细线 / 矩形框 / 箭头 / 文字：在缩小的网格上把圈住的区域填满、线条向外膨胀，
 * 否则只会重绘一圈 2px 的线（markGridToMask）。
 */
function confirm() {
  if (props.submitting)
    return
  commitText()
  if (props.mode === 'erase' && !(modelId.value || currentPicker.value?.id)) {
    toast.add({ title: t('暂无支持局部修改的图片模型，请联系运营开通 gpt-image 系模型'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  if (props.mode === 'erase') {
    const src = maskEl
    if (!src || !src.width)
      return
    const img = imgRef.value
    const srcW = img?.naturalWidth || src.width
    const srcH = img?.naturalHeight || src.height
    const out = document.createElement('canvas')
    out.width = srcW
    out.height = srcH
    const c = out.getContext('2d')
    if (!c)
      return
    c.imageSmoothingEnabled = false
    c.drawImage(src, 0, 0, out.width, out.height)
    const data = c.getImageData(0, 0, out.width, out.height)
    let marked = 0
    for (let i = 0; i < data.data.length; i += 4) {
      if ((data.data[i + 3] ?? 0) > 12) {
        data.data[i] = 255
        data.data[i + 1] = 255
        data.data[i + 2] = 255
        data.data[i + 3] = 255
        marked++
      }
      else {
        data.data[i + 3] = 0
      }
    }
    if (!marked) {
      toast.add({ title: t('请先涂抹要移除的区域'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    c.putImageData(data, 0, 0)
    out.toBlob((blob) => {
      if (blob)
        emit('confirm', blob, modelId.value || currentPicker.value?.id)
    }, 'image/png')
    return
  }
  const src = canvasRef.value
  if (!src || !src.width || !src.height)
    return
  const scale = Math.min(1, MASK_GRID / Math.max(src.width, src.height))
  const gw = Math.max(1, Math.round(src.width * scale))
  const gh = Math.max(1, Math.round(src.height * scale))
  const small = document.createElement('canvas')
  small.width = gw
  small.height = gh
  const sc = small.getContext('2d', { willReadFrequently: true })
  if (!sc)
    return
  sc.drawImage(src as unknown as CanvasImageSource, 0, 0, gw, gh)
  const px = sc.getImageData(0, 0, gw, gh)
  const marked = new Uint8Array(gw * gh)
  let count = 0
  for (let i = 0; i < marked.length; i++) {
    if ((px.data[i * 4 + 3] ?? 0) > 12) {
      marked[i] = 1
      count++
    }
  }
  if (!count) {
    emit('close')
    return
  }
  const mask = markGridToMask(marked, gw, gh, Math.max(gw, gh) * 0.015)
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    const on = mask[i] ? 255 : 0
    px.data[o] = 255
    px.data[o + 1] = 255
    px.data[o + 2] = 255
    px.data[o + 3] = on
  }
  sc.putImageData(px, 0, 0)
  const natural = imgRef.value
  const out = document.createElement('canvas')
  out.width = natural?.naturalWidth || src.width
  out.height = natural?.naturalHeight || src.height
  const c = out.getContext('2d')
  if (!c)
    return
  c.imageSmoothingEnabled = false
  c.drawImage(small, 0, 0, out.width, out.height)
  out.toBlob((blob) => {
    if (blob)
      emit('confirm', blob)
  }, 'image/png')
}

function onDocPointer(event: PointerEvent) {
  if (!colorOpen.value && !modelMenu.value)
    return
  const el = event.target as HTMLElement | null
  if (el?.closest('.canvas-mark__color, .canvas-inspector__model'))
    return
  colorOpen.value = false
  modelMenu.value = false
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  const cmd = event.ctrlKey || event.metaKey
  if (event.key === 'Escape') {
    event.stopPropagation()
    if (textDraft.value) {
      textDraft.value = null
      return
    }
    if (colorOpen.value) {
      colorOpen.value = false
      return
    }
    if (modelMenu.value) {
      modelMenu.value = false
      return
    }
    emit('close')
    return
  }
  if (cmd && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    event.stopPropagation()
    if (event.shiftKey)
      redo()
    else
      undo()
    return
  }
  if (cmd && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    event.stopPropagation()
    redo()
  }
}

watch(() => [props.open, props.src, props.maskUrl, props.mode], () => {
  undos.value = []
  redos.value = []
  tool.value = 'pen'
  color.value = props.mode === 'erase' ? '#ec4899' : '#ff3b30'
  brushSize.value = props.mode === 'erase' ? DEFAULT_BRUSH : 2
  colorOpen.value = false
  modelMenu.value = false
  textDraft.value = null
  drawing.value = false
  photoReady.value = false
  hideTip()
  startPt = null
  lastPt = null
  shapeSnap = null
  nextTick(fitCanvas)
}, { immediate: true })

watch(editModels, syncModel, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onDocPointer, true)
  if (!generationModelsLoaded.value) {
    generationModelsLoaded.value = true
    void taskApi.models().then((res) => {
      if (res?.success && Array.isArray(res.data))
        generationModels.value = res.data
    })
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onDocPointer, true)
})

defineExpose({ confirm })
</script>

<template>
  <Teleport to="body">
    <template v-if="open && layerStyle">
      <img
        ref="imgRef"
        :src="src"
        alt=""
        class="canvas-smart__probe"
        :crossorigin="mode === 'mark' ? 'anonymous' : undefined"
        @load="fitCanvas"
      >
      <div
        class="nodrag nopan"
        :class="mode === 'erase' ? 'canvas-smart-layer' : 'canvas-mark-layer'"
        :style="layerStyle"
      >
        <div
          v-if="mode === 'erase'"
          class="canvas-smart__tools nodrag nopan nowheel"
          role="toolbar"
          :aria-label="t('涂抹擦除')"
          @pointerdown.stop
        >
          <button type="button" class="canvas-smart__close" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-3.5" />
            <span>{{ t('涂抹擦除') }}</span>
          </button>
          <span class="canvas-smart__split" />
          <div class="canvas-smart__switch" role="group" :aria-label="t('笔刷')">
            <button
              type="button"
              class="canvas-smart__icon"
              :class="{ 'is-on': tool === 'pen' }"
              :aria-label="t('涂抹')"
              @click="setTool('pen')"
            >
              <UIcon name="i-lucide-paintbrush" class="size-3.5" />
            </button>
            <button
              type="button"
              class="canvas-smart__icon"
              :class="{ 'is-on': tool === 'eraser' }"
              :aria-label="t('橡皮')"
              @click="setTool('eraser')"
            >
              <UIcon name="i-lucide-eraser" class="size-3.5" />
            </button>
          </div>
          <label class="canvas-smart__brush">
            <input v-model.number="brushSize" type="range" min="8" max="80" :aria-label="t('笔刷')">
          </label>
          <button type="button" :disabled="!undos.length" :aria-label="t('撤销')" @click="undo">
            <UIcon name="i-lucide-undo-2" class="size-3.5" />
          </button>
          <button type="button" :disabled="!redos.length" :aria-label="t('重做')" @click="redo">
            <UIcon name="i-lucide-redo-2" class="size-3.5" />
          </button>
        </div>
        <div
          v-else
          class="canvas-mark__tools nodrag nopan nowheel"
          role="toolbar"
          :aria-label="t('画笔标记')"
          @pointerdown.stop
        >
          <button type="button" class="canvas-mark__close" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-3.5" />
            <span>{{ t('画笔标记') }}</span>
            <span class="canvas-tip canvas-tip--up">{{ t('关闭') }}</span>
          </button>
          <span class="canvas-smart__split" />
          <div class="canvas-mark__color">
              <button
                type="button"
                class="canvas-mark__swatch"
                :style="{ background: color }"
                :aria-label="t('颜色')"
                @click="colorOpen = !colorOpen"
              >
                <span class="canvas-tip canvas-tip--up">{{ t('颜色') }}</span>
              </button>
              <div v-if="colorOpen" class="canvas-mark__colors">
                <button
                  v-for="item in COLORS"
                  :key="item"
                  type="button"
                  :class="{ 'is-on': color === item }"
                  :style="{ background: item }"
                  :aria-label="item"
                  @click="pickColor(item)"
                />
              </div>
            </div>
            <button
              v-for="item in TOOLS"
              :key="item.id"
              type="button"
              class="canvas-mark__icon"
              :class="{ 'is-on': tool === item.id }"
              :aria-label="t(item.label)"
              @click="setTool(item.id)"
            >
              <UIcon v-if="item.icon" :name="item.icon" class="size-3.5" />
              <b v-else>T</b>
              <span class="canvas-tip canvas-tip--up">{{ t(item.label) }}</span>
            </button>
        </div>
        <div v-if="mode === 'erase'" class="canvas-smart__stage">
          <div v-show="photoReady" class="canvas-smart__check" aria-hidden="true" />
          <canvas
            ref="canvasRef"
            class="canvas-smart__paint nodrag nopan nowheel"
            :class="{ 'is-erase': tool === 'eraser' }"
            @pointerdown.prevent.stop="onDown"
            @pointermove.prevent="onMove"
            @pointerup="onUp"
            @pointercancel="onUp"
            @pointerleave="hideTip"
          />
          <i
            v-show="brushTip.on"
            class="canvas-smart__tip"
            :class="{ 'is-erase': tool === 'eraser' }"
            :style="{
              left: `${brushTip.x}px`,
              top: `${brushTip.y}px`,
              width: `${brushSize * 2}px`,
              height: `${brushSize * 2}px`,
            }"
          />
        </div>
        <canvas
          v-else
          ref="canvasRef"
          class="canvas-mark__paint nodrag nopan nowheel"
          :class="{ 'is-text': tool === 'text', 'is-erase': tool === 'eraser' }"
          @pointerdown.prevent.stop="onDown"
          @pointermove.prevent="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
        />
        <input
          v-if="textDraft"
          ref="textInputRef"
          v-model="textDraft.text"
          class="canvas-mark__input nodrag nowheel"
          :style="textStyle || undefined"
          :placeholder="t('输入文字')"
          @pointerdown.stop
          @keydown.enter.prevent="commitText"
          @keydown.esc.prevent="textDraft = null"
        >
        <div v-if="mode === 'erase'" class="canvas-outpaint__tools nodrag nopan nowheel" @pointerdown.stop>
          <div v-if="currentPicker" class="canvas-outpaint__model canvas-inspector__model">
            <button
              type="button"
              class="canvas-inspector__model-btn"
              :class="{ 'is-on': modelMenu }"
              :title="currentPicker.desc || currentPicker.name"
              :aria-expanded="modelMenu"
              :aria-label="t('模型')"
              @click="toggleModel"
            >
              <UIcon name="i-lucide-sparkles" class="size-3.5" />
              <span class="canvas-inspector__model-name">{{ currentPicker.name }}</span>
              <UIcon name="i-lucide-chevron-down" class="size-3.5" />
            </button>
            <div v-if="modelMenu" class="canvas-inspector__models nowheel" @pointerdown.stop @wheel.stop>
              <button
                v-for="item in pickerModels"
                :key="item.id"
                type="button"
                :class="{ 'is-on': modelId === item.id }"
                @click="pickModel(item.id)"
              >
                <span class="canvas-inspector__model-mark" />
                <span>
                  <strong>{{ item.name }}</strong>
                  <em v-if="item.desc" :title="item.desc">{{ item.desc }}</em>
                  <small v-if="item.promo" class="canvas-promo">
                    <s>{{ item.promo.origin }}</s>
                    {{ t('{n} 积分/{unit}', { n: item.promo.price, unit: t(item.promo.unit) }) }}
                    <i class="canvas-promo__chip">{{ item.promo.label || t('促销') }}</i>
                  </small>
                </span>
              </button>
            </div>
          </div>
          <span v-if="zapCost !== ''" class="canvas-smart__cost">
            <UIcon name="i-lucide-zap" class="size-3.5" />
            {{ zapCost }}
          </span>
          <button
            type="button"
            class="canvas-smart__send"
            :disabled="submitting || !currentPicker"
            :aria-label="t('生成')"
            @click="confirm"
          >
            <UIcon
              :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'"
              class="size-3.5"
              :class="{ 'animate-spin': submitting }"
            />
          </button>
        </div>
        <div v-else class="canvas-mark__bar nodrag nopan nowheel" @pointerdown.stop>
          <button type="button" :disabled="!undos.length" :aria-label="t('撤销')" @click="undo">
            <UIcon name="i-lucide-undo-2" class="size-3.5" />
            <span class="canvas-tip canvas-tip--up">{{ t('撤销') }}</span>
          </button>
          <button type="button" :disabled="!redos.length" :aria-label="t('重做')" @click="redo">
            <UIcon name="i-lucide-redo-2" class="size-3.5" />
            <span class="canvas-tip canvas-tip--up">{{ t('重做') }}</span>
          </button>
          <button type="button" class="canvas-mark__ok" @click="confirm">
            {{ t('保存') }}
          </button>
        </div>
      </div>
    </template>
  </Teleport>
</template>
