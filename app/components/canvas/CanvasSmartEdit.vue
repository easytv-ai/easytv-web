<script setup lang="ts">
import assetApi from '~/api/asset'
import mediaApi from '~/api/media'
import taskApi from '~/api/task'
import type { GenerationModel, GenerationTask, MediaJob } from '~/types/creative'
import { cropImage } from '~/utils/canvas-image-edit'
import { isMediaJobActive, mediaOutputsOf } from '~/utils/canvas-media-job'
import { listImageEditModels, pickVisionTextModel } from '~/utils/image-input'
import { effectiveUnitPrice, estimateTaskPoints, modelPromoDisplay } from '~/utils/model-price'
import { shortModelName } from '~/utils/model-name'
import { resolveMediaUrl } from '~/utils/media'

export type SmartEditRef = { assetId: number, url: string, label?: string }

const { t, locale } = useI18n()
const { isMember } = useWallet()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  /** 原图资产。有编号时框选识别走服务端裁切，避免浏览器跨域读不到像素 */
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
const { growth: growthConfig } = useStudioAppConfig()
const generationModelsLoaded = useState('generation-models-loaded', () => false)
const imgRef = ref<HTMLImageElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
type SmartRegion = { id: number, x: number, y: number, w: number, h: number }
type SmartSnap = { paint: ImageData, regions: SmartRegion[] }
type BoxHandle = 'nw' | 'ne' | 'sw' | 'se'

const BOX_HANDLES: BoxHandle[] = ['nw', 'ne', 'sw', 'se']
const HANDLE_CURSORS: Record<BoxHandle, string> = {
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
}

const DEFAULT_BRUSH = 12
const prompt = ref('')
const tool = ref<'paint' | 'box'>('paint')
const paintMode = ref<'brush' | 'erase'>('brush')
const brush = ref(DEFAULT_BRUSH)
const drawing = ref(false)
const uploading = ref(false)
const recognizingIds = ref<number[]>([])
const namedRefs = computed(() => props.refs.filter(item => item.label))
const plainRefs = computed(() => props.refs.filter(item => !item.label))
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
let checkerTile: HTMLCanvasElement | null = null
let lastPt: { x: number, y: number } | null = null
const MAX_WORK = 2048
const MAX_EXPORT = 4096
const MASK_TINT = 'rgba(225, 29, 119, 0.62)'
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
const needMask = ref(false)
const modelMenu = ref(false)
const editModels = computed(() => listImageEditModels(generationModels.value, needMask.value))
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
  if (el?.closest('.canvas-inspector__model'))
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
  needMask.value = markHasPaint() || regions.value.length > 0
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
  paintMode.value = 'brush'
  needMask.value = false
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
  draft.value = { id: 0, x: drawOrigin.x, y: drawOrigin.y, w: 0, h: 0 }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onHitMove(event: PointerEvent) {
  if (!drawOrigin)
    return
  const rect = normalizeRect(drawOrigin, point(event))
  draft.value = { id: 0, ...rect }
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
  regions.value = [...regions.value, { ...next, id }]
  activeRegionId.value = id
  refreshMaskFlag()
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

/** 识别要看图：只用能读图片的文本模型（后端文本任务会把 inputs 里的图片随消息发给模型） */
function pickRecognizeModel() {
  return pickVisionTextModel(generationModels.value, growthConfig.value?.vision_text_model)
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

/** 框选区域交给服务端裁成一张图。OSS 没有跨域头时浏览器 canvas 裁不出来 */
async function cropRegionOnServer(item: SmartRegion, gen: number): Promise<{ id: number, url: string } | null> {
  const created = await mediaApi.create({
    action: 'crop',
    asset_id: props.assetId,
    params: { rect: regionNorm(item) },
  })
  if (gen !== recognizeGen || !props.open)
    return null
  if (!created?.success || !created.data)
    throw new Error(created?.message || t('识别失败，请稍后重试'))
  let job: MediaJob = created.data
  const deadline = Date.now() + 90_000
  while (isMediaJobActive(job.status)) {
    if (Date.now() > deadline)
      throw new Error(t('识别超时，请稍后重试'))
    await new Promise(resolve => setTimeout(resolve, 1600))
    if (gen !== recognizeGen || !props.open)
      return null
    const poll = await mediaApi.get(job.id)
    if (poll?.success && poll.data)
      job = poll.data
  }
  if (job.status !== 2)
    throw new Error(job.error || t('识别失败，请稍后重试'))
  const output = mediaOutputsOf(job).find(row => row.asset_id > 0 && row.url)
  if (!output)
    throw new Error(t('识别失败，请稍后重试'))
  return { id: output.asset_id, url: output.url }
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
    if (!generationModels.value.length) {
      const res = await taskApi.models()
      if (res?.success && Array.isArray(res.data))
        generationModels.value = res.data
    }
    const model = pickRecognizeModel()
    if (!model) {
      useToast().add({ title: t('暂无可用的识别模型'), color: 'error' })
      return
    }
    const cropped = props.assetId > 0
      ? await cropRegionOnServer(item, gen)
      : await uploadRegionCrop(item, gen)
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
  if (regions.value.length) {
    const sx = out.width / src.width
    const sy = out.height / src.height
    c.fillStyle = '#fff'
    for (const item of regions.value)
      c.fillRect(item.x * sx, item.y * sy, item.w * sx, item.h * sy)
    marked += regions.value.length
  }
  if (!marked)
    return Promise.resolve(null)
  return new Promise((resolve) => {
    out.toBlob(blob => resolve(blob), 'image/png')
  })
}

async function submit() {
  const text = prompt.value.trim()
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
  prompt.value = ''
  tool.value = 'paint'
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
          <div class="canvas-smart__switch" role="group" :aria-label="t('智能编辑')">
            <button type="button" :class="{ 'is-on': tool === 'paint' }" @click="setTool('paint')">
              <UIcon name="i-lucide-paintbrush" class="size-3.5" />
              {{ t('涂抹') }}
            </button>
            <button type="button" :class="{ 'is-on': tool === 'box' }" @click="setTool('box')">
              <UIcon name="i-lucide-square-dashed" class="size-3.5" />
              {{ t('框选') }}
            </button>
          </div>
          <template v-if="tool === 'paint'">
            <div class="canvas-smart__switch" role="group" :aria-label="t('笔刷')">
              <button
                type="button"
                class="canvas-smart__icon"
                :class="{ 'is-on': paintMode === 'brush' }"
                :aria-label="t('涂抹')"
                @click="paintMode = 'brush'"
              >
                <UIcon name="i-lucide-paintbrush" class="size-3.5" />
              </button>
              <button
                type="button"
                class="canvas-smart__icon"
                :class="{ 'is-on': paintMode === 'erase' }"
                :aria-label="t('橡皮')"
                @click="paintMode = 'erase'"
              >
                <UIcon name="i-lucide-eraser" class="size-3.5" />
              </button>
            </div>
            <label class="canvas-smart__brush">
              <input v-model.number="brush" type="range" min="8" max="80" :aria-label="t('笔刷')">
            </label>
          </template>
          <div v-else class="canvas-smart__list-wrap">
            <button type="button" :class="{ 'is-on': listOpen }" :disabled="!regions.length" @click="listOpen = !listOpen">
              <UIcon name="i-lucide-list" class="size-3.5" />
              {{ t('框选列表') }}
              <i>{{ regions.length }}</i>
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
                  :aria-label="t('删除框选')"
                  @click.stop="removeRegion(item.id)"
                >
                  <UIcon name="i-lucide-trash-2" class="size-3.5" />
                </i>
              </button>
            </div>
          </div>
          <button type="button" :disabled="!undos.length" :aria-label="t('撤销')" @click="undo">
            <UIcon name="i-lucide-undo-2" class="size-3.5" />
          </button>
          <button type="button" :disabled="!redos.length" :aria-label="t('重做')" @click="redo">
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
        <div
          v-for="(item, index) in regions"
          :key="item.id"
          class="canvas-smart__region"
          :class="{ 'is-on': activeRegionId === item.id, 'is-edit': tool === 'box' }"
          :style="regionStyle(item)"
          @pointerdown.prevent="onRegionDown($event, item)"
          @pointermove.prevent="onRegionMove"
          @pointerup="onRegionUp"
          @pointercancel="onRegionUp"
        >
          <b>{{ index + 1 }}</b>
          <button type="button" class="canvas-smart__drop" :aria-label="t('删除框选')" @pointerdown.stop @click.stop="removeRegion(item.id)">
            <UIcon name="i-lucide-trash-2" class="size-3.5" />
          </button>
          <button
            v-if="tool === 'box'"
            type="button"
            class="canvas-smart__plus"
            :class="{ 'is-busy': isRecognizing(item.id) }"
            :aria-label="t('智能识别图片内容')"
            @pointerdown.stop
            @click.stop="recognizeRegion(item)"
          >
            <UIcon
              :name="isRecognizing(item.id) ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'"
              class="size-3.5"
              :class="{ 'animate-spin': isRecognizing(item.id) }"
            />
            <span v-if="!isRecognizing(item.id)" class="canvas-tip canvas-tip--up">{{ t('智能识别图片内容') }}</span>
          </button>
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
          v-if="draft && draft.w > 2 && draft.h > 2"
          class="canvas-smart__region is-draft"
          :style="regionStyle(draft)"
        />
      </div>
      <div
        v-if="panelStyle"
        class="canvas-smart__composer nodrag nopan nowheel"
        :style="panelStyle"
        @pointerdown.stop
        @dblclick.stop
      >
        <div class="canvas-smart__attach">
          <button type="button" class="canvas-inspector__chip" @click="emit('cite')">
            <UIcon name="i-lucide-image-plus" class="size-3.5" />
            {{ t('引用') }}
          </button>
          <button type="button" class="canvas-inspector__chip" :disabled="uploading" @click="fileInput?.click()">
            <UIcon name="i-lucide-plus" class="size-3.5" />
            {{ uploading ? t('上传中…') : t('上传') }}
          </button>
          <span v-for="item in plainRefs" :key="item.assetId" class="canvas-smart__thumb">
            <img :src="resolveMediaUrl(item.url)" alt="">
            <button type="button" :aria-label="t('移除')" @click="removeRef(item.assetId)">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </span>
          <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilesChosen">
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
        <textarea
          v-model="prompt"
          rows="3"
          :placeholder="t('描述你想要的修改，例如「把背景换成海边」；也可上传图片或点「引用」使用画布上其他图片作为参考')"
        />
        <div class="canvas-smart__bar">
          <div v-if="currentPicker" class="canvas-inspector__model">
            <button
              type="button"
              class="canvas-inspector__model-btn"
              :title="currentPicker.desc || currentPicker.name"
              :aria-expanded="modelMenu"
              :aria-label="t('模型')"
              @click="toggleModel"
            >
              <span class="canvas-inspector__model-mark" />
              <span class="canvas-inspector__model-name">{{ currentPicker.name }}</span>
              <UIcon :name="modelMenu ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
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
          <span class="canvas-inspector__grow" />
          <span v-if="zapCost !== ''" class="canvas-smart__cost">
            <UIcon name="i-lucide-zap" class="size-3.5" />
            {{ zapCost }}
          </span>
          <button
            type="button"
            class="canvas-smart__send"
            :disabled="submitting || uploading"
            :aria-label="t('生成')"
            @click="submit"
          >
            <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'" class="size-3.5" :class="{ 'animate-spin': submitting }" />
          </button>
        </div>
      </div>
    </template>
  </Teleport>
</template>
