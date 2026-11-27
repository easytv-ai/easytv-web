<script setup lang="ts">
import assetApi from '~/api/asset'
import taskApi from '~/api/task'
import type { GenerationModel, GenerationTask } from '~/types/creative'
import { cropImage } from '~/utils/canvas-image-edit'
import { buildSmartEditPrompt } from '~/utils/canvas-smart-edit'
import { listImageEditModels } from '~/utils/image-input'
import { effectiveUnitPrice, estimateTaskPoints, modelPromoDisplay } from '~/utils/model-price'
import { shortModelName } from '~/utils/model-name'
import { resolveMediaUrl } from '~/utils/media'

export type SmartEditRef = { assetId: number, url: string, label?: string }

const { t, locale } = useI18n()
const { isMember } = useWallet()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  /** 原图资产编号，识别上传后的图片仍记在素材上 */
  assetId?: number
  refs: SmartEditRef[]
  submitting?: boolean
  box?: { left: number, top: number, width: number, height: number } | null
  panelStyle?: Record<string, string> | null
  /** 跟练只读：识别会真提交文本任务（媒体裁切 / assetApi.upload + taskApi.create），先退出跟练 */
  readonly?: boolean
}>(), {
  submitting: false,
  assetId: 0,
  box: null,
  panelStyle: null,
  readonly: false,
})

const editIntent = ref<'edit' | 'move'>('edit')
const paintBox = ref<SmartRegion | null>(null)

const composerStyle = computed(() => {
  const box = props.box
  const base = props.panelStyle
  const width = box
    ? `${Math.max(260, Math.round(Math.min(box.width, 420)))}px`
    : 'min(420px, calc(100vw - 32px))'
  if (base?.left && base?.top)
    return { ...base, width }
  if (!box)
    return null
  return {
    left: `${box.left + box.width / 2}px`,
    top: `${box.top + box.height + 12}px`,
    width,
  }
})

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

const emit = defineEmits<{
  close: []
  cite: []
  'update:refs': [items: SmartEditRef[]]
  submit: [payload: { prompt: string, mask: Blob | null, model: string }]
}>()

const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const { resolveVisionTextModel } = useCanvasCatalog()
const generationModelsLoaded = useState('generation-models-loaded', () => false)
const imgRef = ref<HTMLImageElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
type SmartRegion = { id: number, x: number, y: number, w: number, h: number, note: string }
type SmartSnap = { paint: ImageData, regions: SmartRegion[] }
type BoxHandle = 'nw' | 'ne' | 'sw' | 'se'

const BOX_HANDLES: BoxHandle[] = ['nw', 'ne', 'sw', 'se']
const HANDLE_CURSORS: Record<BoxHandle, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
}

const DEFAULT_BRUSH = 2
const paintNote = ref('')
const linePlaceholder = computed(() => editIntent.value === 'move'
  ? t('描述要把选区移到哪里')
  : t('描述要改的地方，例如把衣服换成红色'))
const tool = ref<'paint' | 'box'>('box')
const paintMode = ref<'brush' | 'erase'>('brush')
const brush = ref(DEFAULT_BRUSH)
const drawing = ref(false)
const uploading = ref(false)
const recognizingIds = ref<number[]>([])
const namedRefs = computed(() => props.refs.filter(item => item.label))
let recognizeGen = 0
const undos = ref<SmartSnap[]>([])
const redos = ref<SmartSnap[]>([])
const regions = ref<SmartRegion[]>([])
const activeRegionId = ref(0)
const draft = ref<SmartRegion | null>(null)
const listOpen = ref(false)
const modelId = ref('')
let regionSeq = 1
let drag: { id: number, px: number, py: number, x: number, y: number } | null = null
let resize: { id: number, handle: BoxHandle, px: number, py: number, orig: SmartRegion } | null = null
let drawOrigin: { x: number, y: number } | null = null
let maskEl: HTMLCanvasElement | null = null
let overlayEl: HTMLCanvasElement | null = null
let lastPt: { x: number, y: number } | null = null
const MAX_WORK = 2048
const MAX_EXPORT = 4096
const brushTip = ref({ x: 0, y: 0, on: false })
const photoReady = ref(false)

function ctx() {
  return canvasRef.value?.getContext('2d') ?? null
}

function maskCtx() {
  return maskEl?.getContext('2d', { willReadFrequently: true }) ?? null
}

function overlayCtx() {
  return overlayEl?.getContext('2d') ?? null
}

function workingSize() {
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
  const scale = Math.min(1, MAX_WORK / Math.max(w, h, 1))
  return {
    w: Math.max(1, Math.round((w || 1) * scale)),
    h: Math.max(1, Math.round((h || 1) * scale)),
    srcW: nw || w || 1,
    srcH: nh || h || 1,
  }
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

function ensureWorkSurface() {
  const canvas = canvasRef.value
  if (!canvas)
    return false
  if (!canvas.width || !canvas.height) {
    const size = workingSize()
    canvas.width = size.w
    canvas.height = size.h
  }
  sizeMask(canvas.width, canvas.height)
  return Boolean(maskEl && maskEl.width)
}

function redrawView() {
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
  if (drew && maskEl && overlayEl) {
    const overlay = overlayCtx()
    if (overlay) {
      overlay.setTransform(1, 0, 0, 1, 0, 0)
      overlay.globalCompositeOperation = 'source-over'
      overlay.globalAlpha = 1
      overlay.clearRect(0, 0, overlayEl.width, overlayEl.height)
      overlay.drawImage(maskEl, 0, 0)
      overlay.globalCompositeOperation = 'source-in'
      overlay.fillStyle = '#fff'
      overlay.fillRect(0, 0, overlayEl.width, overlayEl.height)
      overlay.globalCompositeOperation = 'source-over'
      view.drawImage(overlayEl, 0, 0)
    }
  }
  view.restore()
}

function clearPaintMask() {
  const mask = maskCtx()
  if (!mask || !maskEl)
    return
  mask.setTransform(1, 0, 0, 1, 0, 0)
  mask.globalCompositeOperation = 'source-over'
  mask.clearRect(0, 0, maskEl.width, maskEl.height)
  lastPt = null
  redrawView()
}

function syncToolFromSnap() {
  if (regions.value.length)
    tool.value = 'box'
  else if (markHasPaint())
    tool.value = 'paint'
}

function setTool(next: 'paint' | 'box') {
  if (tool.value === next)
    return
  drawing.value = false
  lastPt = null
  snapshot()
  if (next === 'paint') {
    regions.value = []
    activeRegionId.value = 0
    draft.value = null
    listOpen.value = false
    paintMode.value = 'brush'
  }
  else {
    clearPaintMask()
    listOpen.value = false
  }
  tool.value = next
  refreshMaskFlag()
}

function imageSize() {
  const canvas = canvasRef.value
  const img = imgRef.value
  return {
    w: canvas?.width || img?.naturalWidth || 1,
    h: canvas?.height || img?.naturalHeight || 1,
  }
}

function cloneRegions() {
  return regions.value.map(item => ({ ...item }))
}

function regionStyle(item: SmartRegion) {
  const { w, h } = imageSize()
  return {
    left: `${item.x / w * 100}%`,
    top: `${item.y / h * 100}%`,
    width: `${item.w / w * 100}%`,
    height: `${item.h / h * 100}%`,
  }
}

function currentMark() {
  if (tool.value === 'box')
    return regions.value.find(item => item.id === activeRegionId.value) || null
  return paintBox.value
}

const markChip = computed(() => {
  if (draft.value || drawing.value)
    return null
  return currentMark()
})

const placeCount = computed(() => tool.value === 'paint' ? (paintBox.value ? 1 : 0) : regions.value.length)
const hasMarks = computed(() => placeCount.value > 0)

function chipOnLeft(item: SmartRegion) {
  const { w } = imageSize()
  return (item.x + item.w) / w > 0.62
}

function shotStyle(item: SmartRegion) {
  const { w, h } = imageSize()
  const nw = Math.max(item.w / w, 0.001)
  const nh = Math.max(item.h / h, 0.001)
  return {
    width: `${100 / nw}%`,
    height: `${100 / nh}%`,
    left: `${-(item.x / w) / nw * 100}%`,
    top: `${-(item.y / h) / nh * 100}%`,
  }
}

function chipStyle(item: SmartRegion) {
  const { w, h } = imageSize()
  const right = (item.x + item.w) / w
  const top = item.y / h
  if (right > 0.62) {
    return {
      right: `${(1 - item.x / w) * 100}%`,
      top: `${top * 100}%`,
    }
  }
  return {
    left: `${right * 100}%`,
    top: `${top * 100}%`,
  }
}

function measurePaint() {
  const mask = maskCtx()
  if (!mask || !maskEl?.width) {
    paintBox.value = null
    return
  }
  const { width, height } = maskEl
  const data = mask.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if ((data[(row + x) * 4 + 3] ?? 0) <= 12)
        continue
      if (x < minX)
        minX = x
      if (y < minY)
        minY = y
      if (x > maxX)
        maxX = x
      if (y > maxY)
        maxY = y
    }
  }
  if (maxX < 0) {
    paintBox.value = null
    return
  }
  const pad = 6
  const x = Math.max(0, minX - pad)
  const y = Math.max(0, minY - pad)
  paintBox.value = {
    id: 0,
    x,
    y,
    w: Math.min(width, maxX + pad) - x,
    h: Math.min(height, maxY + pad) - y,
    note: '',
  }
}

function normalizeRect(a: { x: number, y: number }, b: { x: number, y: number }) {
  const { w: maxW, h: maxH } = imageSize()
  const x = Math.max(0, Math.min(a.x, b.x))
  const y = Math.max(0, Math.min(a.y, b.y))
  return {
    x,
    y,
    w: Math.min(maxW - x, Math.abs(a.x - b.x)),
    h: Math.min(maxH - y, Math.abs(a.y - b.y)),
  }
}

const UNIT_LABEL: Record<string, string> = { second: '秒', image: '张', call: '次' }
const modelMenu = ref(false)
const editModels = computed(() => listImageEditModels(generationModels.value, false))
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

function pickModel(id: string) {
  modelId.value = id
  modelMenu.value = false
}

function toggleModel() {
  modelMenu.value = !modelMenu.value
}

function onDocPointer(event: PointerEvent) {
  if (!modelMenu.value)
    return
  const el = event.target as HTMLElement | null
  if (el?.closest('.canvas-smart__composer, .canvas-inspector__models, .canvas-smart__model'))
    return
  modelMenu.value = false
}

function syncModel() {
  if (!editModels.value.some(item => item.model === modelId.value))
    modelId.value = editModels.value[0]?.model || ''
}

function markHasPaint() {
  const mask = maskCtx()
  if (!mask || !maskEl || !maskEl.width)
    return false
  const data = mask.getImageData(0, 0, maskEl.width, maskEl.height).data
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 12)
      return true
  }
  return false
}

function refreshMaskFlag() {
  measurePaint()
  syncModel()
}

function fitCanvas() {
  const canvas = canvasRef.value
  const img = imgRef.value
  if (!canvas || !img || !img.naturalWidth)
    return
  const size = workingSize()
  canvas.width = size.w
  canvas.height = size.h
  sizeMask(canvas.width, canvas.height)
  clearPaintMask()
  undos.value = []
  redos.value = []
  regions.value = []
  activeRegionId.value = 0
  draft.value = null
  paintBox.value = null
  paintMode.value = 'brush'
  syncModel()
}

function point(event: PointerEvent) {
  const canvas = canvasRef.value
  const layer = canvas?.parentElement
  const box = (canvas || layer)?.getBoundingClientRect()
  const { w, h } = imageSize()
  if (!box)
    return { x: 0, y: 0, r: brush.value }
  return {
    x: (event.clientX - box.left) / box.width * w,
    y: (event.clientY - box.top) / box.height * h,
    r: brush.value * (w / Math.max(box.width, 1)),
  }
}

function currentSnap(): SmartSnap | null {
  const mask = maskCtx()
  if (!mask || !maskEl)
    return null
  return { paint: mask.getImageData(0, 0, maskEl.width, maskEl.height), regions: cloneRegions() }
}

function restoreSnap(snap: SmartSnap) {
  const mask = maskCtx()
  if (!mask || !maskEl)
    return
  mask.putImageData(snap.paint, 0, 0)
  redrawView()
  regions.value = snap.regions.map(item => ({ ...item }))
  if (!regions.value.some(item => item.id === activeRegionId.value))
    activeRegionId.value = regions.value[0]?.id || 0
  syncToolFromSnap()
  refreshMaskFlag()
}

function snapshot() {
  const snap = currentSnap()
  if (!snap)
    return
  undos.value.push(snap)
  if (undos.value.length > 24)
    undos.value.shift()
  redos.value = []
}

function strokeOn(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  style: string | CanvasPattern,
  erase: boolean,
) {
  c.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  c.strokeStyle = erase ? '#000' : style
  c.fillStyle = erase ? '#000' : style
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.lineWidth = Math.max(1, r * 2)
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

function paintDot(event: PointerEvent) {
  if (!ensureWorkSurface())
    return
  const mask = maskCtx()
  if (!mask)
    return
  const { x, y, r } = point(event)
  strokeOn(mask, x, y, r, '#fff', paintMode.value === 'erase')
  lastPt = { x, y }
  redrawView()
}

function onDown(event: PointerEvent) {
  if (tool.value !== 'paint')
    return
  if (!ensureWorkSurface())
    return
  drawing.value = true
  lastPt = null
  snapshot()
  ;(event.currentTarget as HTMLCanvasElement).setPointerCapture(event.pointerId)
  paintDot(event)
}

function trackTip(event: PointerEvent) {
  const layer = canvasRef.value?.parentElement
  const box = layer?.getBoundingClientRect()
  if (!box)
    return
  brushTip.value = {
    x: event.clientX - box.left,
    y: event.clientY - box.top,
    on: tool.value === 'paint',
  }
}

function onPaintPointer(event: PointerEvent) {
  trackTip(event)
  if (drawing.value)
    paintDot(event)
}

function onUp() {
  if (!drawing.value)
    return
  drawing.value = false
  lastPt = null
  refreshMaskFlag()
}

function hideTip() {
  brushTip.value = { ...brushTip.value, on: false }
}

function onHitDown(event: PointerEvent) {
  if (tool.value !== 'box')
    return
  listOpen.value = false
  drawOrigin = point(event)
  draft.value = { id: 0, x: drawOrigin.x, y: drawOrigin.y, w: 0, h: 0, note: '' }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onHitMove(event: PointerEvent) {
  if (!drawOrigin)
    return
  const rect = normalizeRect(drawOrigin, point(event))
  draft.value = { id: 0, ...rect, note: '' }
}

function onHitUp() {
  if (!drawOrigin)
    return
  const next = draft.value
  drawOrigin = null
  draft.value = null
  if (!next || next.w < 12 || next.h < 12)
    return
  snapshot()
  const id = regionSeq++
  regions.value = [...regions.value, { ...next, id, note: '' }]
  activeRegionId.value = id
  editIntent.value = 'edit'
  refreshMaskFlag()
  nextTick(() => focusActiveLine())
}

function onRegionDown(event: PointerEvent, item: SmartRegion) {
  if (tool.value !== 'box')
    return
  event.stopPropagation()
  listOpen.value = false
  activeRegionId.value = item.id
  snapshot()
  const p = point(event)
  drag = { id: item.id, px: p.x, py: p.y, x: item.x, y: item.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onRegionMove(event: PointerEvent) {
  const p = point(event)
  if (drag) {
    const { w, h } = imageSize()
    const item = regions.value.find(entry => entry.id === drag!.id)
    if (!item)
      return
    item.x = Math.max(0, Math.min(w - item.w, drag.x + (p.x - drag.px)))
    item.y = Math.max(0, Math.min(h - item.h, drag.y + (p.y - drag.py)))
    return
  }
  if (resize) {
    const { w, h } = imageSize()
    const item = regions.value.find(entry => entry.id === resize!.id)
    if (!item)
      return
    const orig = resize.orig
    let x1 = orig.x
    let y1 = orig.y
    let x2 = orig.x + orig.w
    let y2 = orig.y + orig.h
    if (resize.handle.includes('w'))
      x1 = Math.max(0, Math.min(x2 - 12, orig.x + (p.x - resize.px)))
    if (resize.handle.includes('e'))
      x2 = Math.max(x1 + 12, Math.min(w, orig.x + orig.w + (p.x - resize.px)))
    if (resize.handle.includes('n'))
      y1 = Math.max(0, Math.min(y2 - 12, orig.y + (p.y - resize.py)))
    if (resize.handle.includes('s'))
      y2 = Math.max(y1 + 12, Math.min(h, orig.y + orig.h + (p.y - resize.py)))
    item.x = x1
    item.y = y1
    item.w = x2 - x1
    item.h = y2 - y1
  }
}

function onRegionUp() {
  drag = null
  resize = null
}

function onHandleDown(event: PointerEvent, item: SmartRegion, handle: BoxHandle) {
  event.stopPropagation()
  if (tool.value !== 'box')
    return
  activeRegionId.value = item.id
  snapshot()
  const p = point(event)
  resize = { id: item.id, handle, px: p.x, py: p.y, orig: { ...item } }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function removeRegion(id: number) {
  snapshot()
  regions.value = regions.value.filter(item => item.id !== id)
  if (activeRegionId.value === id)
    activeRegionId.value = regions.value[0]?.id || 0
  refreshMaskFlag()
}

function isRecognizing(id: number) {
  return recognizingIds.value.includes(id)
}

function cleanLabel(text: string) {
  const line = (text.split(/\n/)[0] || '').trim()
  return line
    .replace(/^[\s"'“”‘’「」『』《》【】（）()[\]：:.。!！?？,，、]+/, '')
    .replace(/[\s"'“”‘’「」『』《》【】（）()[\]：:.。!！?？,，、]+$/, '')
    .slice(0, 16)
}

function recognizePrompt() {
  return String(locale.value).startsWith('zh')
    ? '这是从一张大图里裁出的局部。请用两到六个汉字说出图中最主要的物体或区域名称，只返回名称，不要标点、不要解释。'
    : 'This is a crop from a larger image. Reply with a short name (2–6 words) for the main object or area. Name only, no punctuation or explanation.'
}

function regionNorm(item: SmartRegion) {
  const work = canvasRef.value
  const img = imgRef.value
  const cw = Math.max(1, work?.width || img?.naturalWidth || 1)
  const ch = Math.max(1, work?.height || img?.naturalHeight || 1)
  const x = Math.min(1, Math.max(0, item.x / cw))
  const y = Math.min(1, Math.max(0, item.y / ch))
  const w = Math.min(1 - x, Math.max(0.002, item.w / cw))
  const h = Math.min(1 - y, Math.max(0.002, item.h / ch))
  return { x, y, w, h }
}

async function cropRegionBlob(item: SmartRegion) {
  const work = canvasRef.value
  const img = imgRef.value
  const cw = work?.width || img?.naturalWidth || 1
  const ch = work?.height || img?.naturalHeight || 1
  const srcW = img?.naturalWidth || cw
  const srcH = img?.naturalHeight || ch
  const box = regionNorm(item)
  return cropImage(props.src, {
    x: box.x * srcW,
    y: box.y * srcH,
    w: box.w * srcW,
    h: box.h * srcH,
  })
}

async function uploadRegionCrop(item: SmartRegion, gen: number): Promise<{ id: number, url: string } | null> {
  const blob = await cropRegionBlob(item)
  if (gen !== recognizeGen || !props.open)
    return null
  const file = new File([blob], `smart-region-${item.id}.jpg`, { type: 'image/jpeg' })
  const uploaded = await assetApi.upload(file)
  if (gen !== recognizeGen || !props.open)
    return null
  if (!uploaded?.success || !uploaded.data)
    throw new Error(uploaded?.message || t('识别失败，请稍后重试'))
  return { id: uploaded.data.id, url: uploaded.data.url }
}

async function waitRecognizeTask(id: number, gen: number): Promise<GenerationTask | null | undefined> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (gen !== recognizeGen || !props.open)
      return null
    await new Promise(resolve => setTimeout(resolve, 1600))
    if (gen !== recognizeGen || !props.open)
      return null
    const poll = await taskApi.get(id)
    if (!poll?.success || !poll.data)
      continue
    const task = poll.data
    if (task.status === 'pending' || task.status === 'running')
      continue
    return task
  }
  return undefined
}

async function recognizeRegion(item: SmartRegion) {
  if (props.readonly || isRecognizing(item.id))
    return
  recognizingIds.value = [...recognizingIds.value, item.id]
  const gen = recognizeGen
  try {
    const model = await resolveVisionTextModel()
    if (!model) {
      useToast().add({ title: t('暂无可用的识别模型'), color: 'error' })
      return
    }
    const cropped = await uploadRegionCrop(item, gen)
    if (!cropped || gen !== recognizeGen || !props.open)
      return
    const created = await taskApi.create({
      type: 'text',
      model,
      prompt: recognizePrompt(),
      inputs: [{ asset_id: cropped.id, role: 'image' }],
    })
    if (gen !== recognizeGen || !props.open)
      return
    if (!created?.success || !created.data) {
      useToast().add({ title: created?.message || t('识别失败，请稍后重试'), color: 'error' })
      return
    }
    let task = created.data
    if (task.status === 'pending' || task.status === 'running') {
      const polled = await waitRecognizeTask(task.id, gen)
      if (polled === null)
        return
      if (!polled) {
        useToast().add({ title: t('识别超时，请稍后重试'), color: 'error' })
        return
      }
      task = polled
    }
    if (gen !== recognizeGen || !props.open)
      return
    if (task.status !== 'succeeded') {
      useToast().add({ title: task.error_msg || t('识别失败，请稍后重试'), color: 'error' })
      return
    }
    const label = cleanLabel(task.result_text || '') || t('未命名')
    if (props.refs.some(entry => entry.assetId === cropped.id))
      return
    emit('update:refs', [...props.refs, {
      assetId: cropped.id,
      url: cropped.url,
      label,
    }])
  }
  catch (error) {
    if (gen === recognizeGen && props.open)
      useToast().add({ title: error instanceof Error && error.message ? error.message : t('识别失败，请稍后重试'), color: 'error' })
  }
  finally {
    recognizingIds.value = recognizingIds.value.filter(id => id !== item.id)
  }
}

function undo() {
  const snap = undos.value.pop()
  const current = currentSnap()
  if (!snap || !current)
    return
  redos.value.push(current)
  restoreSnap(snap)
}

function redo() {
  const snap = redos.value.pop()
  const current = currentSnap()
  if (!snap || !current)
    return
  undos.value.push(current)
  restoreSnap(snap)
}

function exportMask(): Promise<Blob | null> {
  const src = maskEl || canvasRef.value
  if (!src || !src.width)
    return Promise.resolve(null)
  const img = imgRef.value
  const srcW = img?.naturalWidth || src.width
  const srcH = img?.naturalHeight || src.height
  const scale = Math.min(1, MAX_EXPORT / Math.max(srcW, srcH, 1))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(srcW * scale))
  out.height = Math.max(1, Math.round(srcH * scale))
  const c = out.getContext('2d')
  if (!c)
    return Promise.resolve(null)
  c.imageSmoothingEnabled = false
  c.drawImage(src as unknown as CanvasImageSource, 0, 0, out.width, out.height)
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
  c.putImageData(data, 0, 0)
  const noted = regions.value.filter(item => item.note.trim())
  if (noted.length) {
    const sx = out.width / src.width
    const sy = out.height / src.height
    c.fillStyle = '#fff'
    for (const item of noted)
      c.fillRect(item.x * sx, item.y * sy, item.w * sx, item.h * sy)
    marked += noted.length
  }
  if (!marked)
    return Promise.resolve(null)
  return new Promise((resolve) => {
    out.toBlob(blob => resolve(blob), 'image/png')
  })
}

function instruction() {
  const { w, h } = imageSize()
  const imageInput = currentApiModel.value?.image_input === 'edits' ? 'edits' : 'url'
  if (tool.value === 'paint') {
    const text = paintNote.value.trim()
    if (!text || !paintBox.value)
      return ''
    return buildSmartEditPrompt([{ box: paintBox.value, text }], { w, h }, imageInput)
  }
  return buildSmartEditPrompt(
    regions.value.map(item => ({ box: item, text: item.note })),
    { w, h },
    imageInput,
  )
}

function focusActiveLine() {
  const root = document.querySelector('.canvas-smart__composer')
  const row = root?.querySelector<HTMLInputElement>('.canvas-smart__line.is-on input')
    || root?.querySelector<HTMLInputElement>('.canvas-smart__line input')
  row?.focus()
}

function openEdit(intent: 'edit' | 'move') {
  editIntent.value = intent
  nextTick(focusActiveLine)
}

async function submit() {
  const text = instruction()
  if (!text) {
    useToast().add({ title: t('请先描述你想要的修改'), color: 'error' })
    return
  }
  if (!modelId.value) {
    useToast().add({ title: t('暂无支持图片编辑的模型，请联系运营开通'), color: 'error' })
    return
  }
  const mask = await exportMask()
  emit('submit', { prompt: text, mask, model: modelId.value })
}

function removeRef(id: number) {
  emit('update:refs', props.refs.filter(item => item.assetId !== id))
}

async function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length)
    return
  uploading.value = true
  const next = props.refs.slice()
  try {
    for (const file of files) {
      const res = await assetApi.upload(file)
      if (!res?.success || !res.data)
        continue
      if (next.some(item => item.assetId === res.data!.id))
        continue
      next.push({ assetId: res.data.id, url: res.data.url })
    }
    emit('update:refs', next)
  }
  finally {
    uploading.value = false
  }
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    if (modelMenu.value) {
      event.stopPropagation()
      modelMenu.value = false
      return
    }
    event.stopPropagation()
    if (draft.value || drawOrigin) {
      draft.value = null
      drawOrigin = null
      return
    }
    if (listOpen.value) {
      listOpen.value = false
      return
    }
    emit('close')
  }
  if ((event.key === 'Backspace' || event.key === 'Delete') && activeRegionId.value && tool.value === 'box') {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'))
      return
    event.preventDefault()
    removeRegion(activeRegionId.value)
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT'))
      return // 文本框里留给原生撤销
    event.preventDefault()
    if (event.shiftKey)
      redo()
    else
      undo()
  }
}

watch(() => props.open, (open) => {
  recognizeGen++
  recognizingIds.value = []
  if (!open)
    return
  paintNote.value = ''
  editIntent.value = 'edit'
  paintBox.value = null
  tool.value = 'box'
  paintMode.value = 'brush'
  brush.value = DEFAULT_BRUSH
  regions.value = []
  activeRegionId.value = 0
  draft.value = null
  listOpen.value = false
  modelMenu.value = false
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
  recognizeGen++
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onDocPointer, true)
})
</script>

<template>
  <Teleport to="body">
    <template v-if="open && layerStyle">
      <img
        ref="imgRef"
        :src="src"
        alt=""
        class="canvas-smart__probe"
        @load="fitCanvas"
      >
      <div class="canvas-smart-layer nodrag nopan" :style="layerStyle">
        <div
          class="canvas-smart__tools"
          role="toolbar"
          :aria-label="t('智能编辑')"
          @pointerdown.stop
        >
          <button type="button" class="canvas-smart__close" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-3.5" />
            <span>{{ t('智能编辑') }}</span>
          </button>
          <span class="canvas-smart__split" />
          <button type="button" class="canvas-smart__icon" :class="{ 'is-on': tool === 'box' }" :aria-label="t('框选')" @click="setTool('box')">
            <UIcon name="i-lucide-square-dashed" class="size-3.5" />
            <span class="canvas-tip canvas-tip--down">{{ t('框选') }}</span>
          </button>
          <button type="button" class="canvas-smart__icon" :class="{ 'is-on': tool === 'paint' }" :aria-label="t('涂抹')" @click="setTool('paint')">
            <UIcon name="i-lucide-paintbrush" class="size-3.5" />
            <span class="canvas-tip canvas-tip--down">{{ t('涂抹') }}</span>
          </button>
          <template v-if="tool === 'paint'">
            <label class="canvas-smart__brush">
              <input v-model.number="brush" type="range" min="1" max="48" :aria-label="t('笔刷')">
            </label>
            <button
              type="button"
              class="canvas-smart__icon"
              :class="{ 'is-on': paintMode === 'erase' }"
              :aria-label="t('橡皮')"
              @click="paintMode = paintMode === 'erase' ? 'brush' : 'erase'"
            >
              <UIcon name="i-lucide-eraser" class="size-3.5" />
              <span class="canvas-tip canvas-tip--down">{{ t('橡皮') }}</span>
            </button>
          </template>
          <div v-else-if="regions.length" class="canvas-smart__list-wrap">
            <button type="button" class="canvas-smart__icon" :class="{ 'is-on': listOpen }" :disabled="!regions.length" :aria-label="t('框选列表')" @click="listOpen = !listOpen">
              <UIcon name="i-lucide-list" class="size-3.5" />
              <i v-if="regions.length">{{ regions.length }}</i>
              <span class="canvas-tip canvas-tip--down">{{ t('框选列表') }}</span>
            </button>
            <div v-if="listOpen" class="canvas-smart__list">
              <button
                v-for="(item, index) in regions"
                :key="item.id"
                type="button"
                :class="{ 'is-on': activeRegionId === item.id }"
                @click="activeRegionId = item.id; listOpen = false"
              >
                <b>{{ index + 1 }}</b>
                <span>{{ Math.round(item.w) }}×{{ Math.round(item.h) }}</span>
                <i
                  role="button"
                  :aria-label="t('智能识别图片内容')"
                  @click.stop="recognizeRegion(item)"
                >
                  <UIcon :name="isRecognizing(item.id) ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'" class="size-3.5" :class="{ 'animate-spin': isRecognizing(item.id) }" />
                </i>
                <i
                  role="button"
                  :aria-label="t('删除框选')"
                  @click.stop="removeRegion(item.id)"
                >
                  <UIcon name="i-lucide-trash-2" class="size-3.5" />
                </i>
              </button>
            </div>
          </div>
          <button type="button" class="canvas-smart__icon" :disabled="!undos.length" :aria-label="t('撤销')" @click="undo">
            <UIcon name="i-lucide-undo-2" class="size-3.5" />
          </button>
          <button type="button" class="canvas-smart__icon" :disabled="!redos.length" :aria-label="t('重做')" @click="redo">
            <UIcon name="i-lucide-redo-2" class="size-3.5" />
          </button>
        </div>
        <div class="canvas-smart__stage">
          <div v-show="photoReady" class="canvas-smart__check" aria-hidden="true" />
          <canvas
            ref="canvasRef"
            class="canvas-smart__paint"
            :class="{ 'is-idle': tool === 'box', 'is-erase': paintMode === 'erase' }"
            @pointerdown.prevent.stop="onDown"
            @pointermove.prevent="onPaintPointer"
            @pointerup="onUp"
            @pointercancel="onUp"
            @pointerleave="hideTip"
          />
          <i
            v-show="brushTip.on"
            class="canvas-smart__tip"
            :class="{ 'is-erase': paintMode === 'erase' }"
            :style="{
              left: `${brushTip.x}px`,
              top: `${brushTip.y}px`,
              width: `${brush * 2}px`,
              height: `${brush * 2}px`,
            }"
          />
        </div>
        <div
          v-if="tool === 'box'"
          class="canvas-smart__hit"
          @pointerdown.prevent.stop="onHitDown"
          @pointermove.prevent="onHitMove"
          @pointerup="onHitUp"
          @pointercancel="onHitUp"
        />
        <p v-if="!regions.length && !paintBox && !draft" class="canvas-smart__hint">{{ t('标记你想要修改的对象') }}</p>
        <div
          v-for="item in regions"
          :key="item.id"
          class="canvas-smart__region"
          :class="{ 'is-on': activeRegionId === item.id, 'is-edit': tool === 'box' }"
          :style="regionStyle(item)"
          @pointerdown.prevent="onRegionDown($event, item)"
          @pointermove.prevent="onRegionMove"
          @pointerup="onRegionUp"
          @pointercancel="onRegionUp"
        >
          <i
            v-for="handle in BOX_HANDLES"
            :key="handle"
            class="canvas-smart__handle"
            :class="`is-${handle}`"
            :style="{ cursor: HANDLE_CURSORS[handle] }"
            @pointerdown.prevent="onHandleDown($event, item, handle)"
            @pointermove.prevent="onRegionMove"
            @pointerup="onRegionUp"
            @pointercancel="onRegionUp"
          />
        </div>
        <div
          v-if="tool === 'paint' && paintBox && !drawing"
          class="canvas-smart__region"
          :style="regionStyle(paintBox)"
        />
        <div
          v-if="draft && draft.w > 2 && draft.h > 2"
          class="canvas-smart__region is-draft"
          :style="regionStyle(draft)"
        />
        <div
          v-if="markChip"
          class="canvas-smart__chip"
          :class="{ 'is-left': chipOnLeft(markChip) }"
          :style="chipStyle(markChip)"
          @pointerdown.stop
        >
          <span class="canvas-smart__chip-name">
            <i class="canvas-smart__chip-shot">
              <img :src="src" alt="" :style="shotStyle(markChip)">
            </i>
            {{ t('选区') }}
          </span>
          <button type="button" @pointerdown.stop @click="openEdit('edit')">
            <UIcon name="i-lucide-pen-line" class="size-3.5" />
            {{ t('修改') }}
          </button>
          <button v-if="tool === 'box'" type="button" @pointerdown.stop @click="openEdit('move')">
            <UIcon name="i-lucide-move" class="size-3.5" />
            {{ t('移动') }}
          </button>
        </div>
      </div>
      <div
        v-if="composerStyle"
        class="canvas-smart__composer nodrag nopan nowheel"
        :class="{ 'is-pending': !hasMarks }"
        :style="composerStyle"
        @pointerdown.stop
        @dblclick.stop
      >
        <button v-if="!hasMarks" type="button" class="canvas-smart__pending" @click="openEdit('edit')">
          <UIcon name="i-lucide-pen-line" class="size-3.5" />
          <span>{{ t('编辑内容') }}</span>
          <em>{{ t('待添加') }}</em>
        </button>
        <template v-else>
          <div class="canvas-smart__dock-head">
            <UIcon name="i-lucide-list" class="size-3.5" />
            <span>{{ t('编辑内容') }}</span>
            <em>{{ placeCount }}{{ t('处') }}</em>
            <button type="button" :aria-label="t('引用图片')" @click="emit('cite')">
              <UIcon name="i-lucide-image-plus" class="size-3.5" />
              <span class="canvas-tip canvas-tip--down">{{ t('引用图片') }}</span>
            </button>
            <button type="button" :disabled="uploading" :aria-label="t('上传图片')" @click="fileInput?.click()">
              <UIcon :name="uploading ? 'i-lucide-loader-circle' : 'i-lucide-plus'" class="size-3.5" :class="{ 'animate-spin': uploading }" />
              <span v-if="!uploading" class="canvas-tip canvas-tip--down">{{ t('上传图片') }}</span>
            </button>
            <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilesChosen">
          </div>
          <div class="canvas-smart__lines">
            <label
              v-for="item in regions"
              :key="item.id"
              class="canvas-smart__line"
              :class="{ 'is-on': activeRegionId === item.id }"
            >
              <i class="canvas-smart__chip-shot">
                <img :src="src" alt="" :style="shotStyle(item)">
              </i>
              <span>{{ t('选区') }}</span>
              <input
                v-model="item.note"
                type="text"
                :placeholder="linePlaceholder"
                @focus="activeRegionId = item.id"
                @keydown.enter.prevent="submit"
              >
            </label>
            <label v-if="tool === 'paint' && paintBox" class="canvas-smart__line is-on">
              <i class="canvas-smart__chip-shot">
                <img :src="src" alt="" :style="shotStyle(paintBox)">
              </i>
              <span>{{ t('选区') }}</span>
              <input
                v-model="paintNote"
                type="text"
                :placeholder="linePlaceholder"
                @keydown.enter.prevent="submit"
              >
            </label>
          </div>
          <div v-if="namedRefs.length" class="canvas-smart__tags">
            <button
              v-for="item in namedRefs"
              :key="item.assetId"
              type="button"
              class="canvas-smart__tag"
              :aria-label="t('移除')"
              @click="removeRef(item.assetId)"
            >
              <img :src="resolveMediaUrl(item.url)" alt="">
              <span>{{ item.label }}</span>
            </button>
          </div>
          <div class="canvas-smart__dock-actions">
            <button v-if="currentPicker" type="button" class="canvas-smart__model" @pointerdown.stop @click.stop="toggleModel">
              {{ currentPicker.name }}
            </button>
            <div class="canvas-smart__pair">
            <button type="button" class="canvas-smart__cancel" @click="emit('close')">{{ t('取消') }}</button>
            <button
              type="button"
              class="canvas-smart__go"
              :disabled="submitting || uploading"
              @click="submit"
            >
              <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-zap'" class="size-3.5" :class="{ 'animate-spin': submitting }" />
              <template v-if="typeof zapCost === 'number'">{{ zapCost }}</template>
              {{ t('生成') }}
            </button>
            </div>
          </div>
          <div v-if="modelMenu && currentPicker" class="canvas-inspector__models nowheel" @pointerdown.stop @wheel.stop>
            <button
              v-for="item in pickerModels"
              :key="item.id"
              type="button"
              :class="{ 'is-on': modelId === item.id }"
              @pointerdown.stop.prevent="pickModel(item.id)"
            >
              <span class="canvas-inspector__model-mark" />
              <span>
                <strong>{{ item.name }}</strong>
                <em v-if="item.desc" :title="item.desc">{{ item.desc }}</em>
              </span>
            </button>
          </div>
        </template>
      </div>
    </template>
  </Teleport>
</template>
