<script setup lang="ts">
/**
 * 3D 导演台独立页。
 *
 * 从画布节点进来，场景写回同一张画布的 graph。截图和运镜视频上传后在节点右侧排开。
 */
import CanvasDirectorStage from '~/components/canvas/CanvasDirectorStage.vue'
import canvasApi from '~/api/canvas'
import assetApi from '~/api/asset'
import { batchApi } from '~/api/batch'
import taskApi from '~/api/task'
import type { GenerationModel } from '~/types/creative'
import { effectiveUnitPrice, estimateTaskPoints } from '~/utils/model-price'
import { graphHeavyNames, isDirectorProject, isGraphNearLimit, isGraphOverLimit } from '~/utils/director/persist'
import type { DirectorProject } from '~/utils/director/schema'
import { absPosition, defaultGroupColor, isContentNode, nodeSize, type CanvasFlowData, type CanvasFlowNode } from '~/utils/canvas-group'
import { canvasNodeTitle, canvasStageSize } from '~/utils/canvas-node-kinds'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'
import type { CanvasGraph } from '~/types/creative'
import {
  beginSave,
  createSaveMachine,
  createSerialRunner,
  finishSave,
  hasPendingChanges,
  hasUnsavedChanges,
  isCanvasVersionConflictMessage,
  markChanged,
  needsFollowUp,
  type SaveOutcome,
} from '~/utils/canvas-save-machine'
import { mergeDirectorEdits } from '~/utils/director-page-merge'
import { downloadExportedVideo } from '~/utils/director/playback/video-export'
import { batchActive } from '~/utils/create-batch'
import { nextPreviewLeft, pickPreviewVideoModel, planPreviewClipGraph, previewBatchItems, previewClipPoints, previewControlLinks } from '~/utils/director/export/preview-clip-graph'

const { t } = useI18n()
const previewPlacing = useState('director-preview-placing', () => false)
const previewAbort = useState<AbortController | null>('director-preview-abort', () => null)
const localePath = useLocalePath()
const route = useRoute()
const toast = useToast()
const { confirm } = useConfirm()
const { isMember, refresh: refreshWallet } = useWallet()
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const generationModelsLoaded = useState('generation-models-loaded', () => false)
let modelsTask: Promise<void> | null = null

/** 和检查器共用一份模型清单，用来给预演视频报价。失败可以再试，不标记成已加载。 */
function ensureGenerationModels() {
  if (generationModels.value.length)
    return Promise.resolve()
  if (modelsTask)
    return modelsTask
  modelsTask = taskApi.models().then((res) => {
    if (res?.success && Array.isArray(res.data)) {
      generationModels.value = res.data
      generationModelsLoaded.value = true
    }
  }).finally(() => {
    modelsTask = null
  })
  return modelsTask
}

function quotePreviewModel(model: string, durationSeconds: number) {
  const found = generationModels.value.find(item => item.model === model)
  if (!found?.priced)
    return 0
  return estimateTaskPoints(effectiveUnitPrice(found, isMember.value), found.unit, 1, durationSeconds)
}

definePageMeta({
  layout: false,
  middleware: 'auth',
})

useHead({ title: t('3D 导演台') })

const canvasId = computed(() => Number(route.query.id) || 0)
const nodeId = computed(() => String(route.query.node || '').trim())

const loading = ref(true)
const readonly = ref(false)
const canvasName = ref('')
const version = ref(1)
const graph = ref<CanvasGraph | null>(null)
const stageRef = shallowRef<InstanceType<typeof CanvasDirectorStage> | null>(null)
let leaveTask: Promise<boolean> | null = null
/** 已确认离开（goBack 里已经存过 / 用户同意丢弃），路由守卫不再拦第二次 */
let leaving = false
/** 本次打开后改过场景：离开时才需要重新截封面 */
let sceneChanged = false
const machine = ref(createSaveMachine({ persisted: true }))
/** 本页对 graph 的改动范围，版本冲突时据此合并到最新版（见 director-page-merge.ts） */
const edits = {
  addedNodeIds: new Set<string>(),
  addedEdgeIds: new Set<string>(),
  removedEdgeIds: new Set<string>(),
}

const directorNode = computed(() => {
  const list = (graph.value?.nodes ?? []) as CanvasFlowNode[]
  const node = list.find(item => item.id === nodeId.value)
  return node && isContentNode(node) && node.data.kind === 'director' ? node : null
})

const scene = computed(() => {
  const node = directorNode.value
  if (!node)
    return null
  return isDirectorProject(node.data.scene) ? node.data.scene : null
})

const panorama = computed(() => {
  const id = nodeId.value
  const current = graph.value
  if (!id || !current)
    return null
  const list = (current.nodes ?? []) as CanvasFlowNode[]
  for (const edge of current.edges ?? []) {
    if (edge.target !== id)
      continue
    const src = list.find(item => item.id === edge.source)
    if (!src || !isContentNode(src) || src.data.kind !== 'panorama')
      continue
    const raw = String(src.data.content || '').trim()
    if (!isMediaUrl(raw))
      continue
    return { url: resolveMediaUrl(raw), name: src.data.label || '全景图.png', edgeId: String(edge.id), sourceNodeId: src.id }
  }
  return null
})

/** 画布上指定的角色图：节点自己的角色芯片，或连进来的图片 */
const look = computed(() => {
  const node = directorNode.value
  const rawCast = String(node?.data.castUrl || '').trim()
  if (isMediaUrl(rawCast))
    return { url: resolveMediaUrl(rawCast), name: '角色.jpg' }

  const id = nodeId.value
  const current = graph.value
  if (!id || !current)
    return null
  const list = (current.nodes ?? []) as CanvasFlowNode[]
  for (const edge of current.edges ?? []) {
    if (edge.target !== id)
      continue
    const src = list.find(item => item.id === edge.source)
    if (!src || !isContentNode(src) || src.data.kind !== 'image')
      continue
    const raw = String(src.data.content || '').trim()
    if (!isMediaUrl(raw))
      continue
    return { url: resolveMediaUrl(raw), name: src.data.label || '角色.jpg' }
  }
  return null
})

function notify(title: string, color: 'neutral' | 'error' | 'warning' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function canvasPath() {
  return localePath({
    path: '/canvas',
    query: canvasId.value ? { id: String(canvasId.value) } : {},
  })
}

/**
 * 离开前把视口拉远、把场上的人都收进卡片封面。
 * 没改过且封面已在、场上还是默认那两人时不重截，避免进出就多一张资产。
 * 上传失败就保留旧封面，不把 base64 写进 graph（会撑大画布数据）。
 */
async function snapshotCardPreview() {
  if (readonly.value)
    return
  const objectCount = (scene.value?.objects ?? []).length
  // 人加过之后即使这次只是进来看一眼，旧封面也还是最初那两个人，要重截
  if (!sceneChanged && directorNode.value?.data.previewUrl && objectCount <= 2)
    return
  const node = directorNode.value
  if (!node)
    return
  const dataUrl = await stageRef.value?.captureCardPreview()
  if (!dataUrl)
    return
  try {
    const file = new File([dataUrlToBlob(dataUrl)], 'director-preview.jpg', { type: 'image/jpeg' })
    const res = await assetApi.upload(file)
    if (!res?.success || !res.data?.url)
      return
    node.data.previewUrl = res.data.url
    sceneChanged = false
    markDirty()
  }
  catch {}
}

/** 截封面并把改动存完；存不上时问用户是否仍要离开。返回是否可以离开。 */
function prepareLeave(): Promise<boolean> {
  if (!leaveTask) {
    leaveTask = (async () => {
      try {
        await snapshotCardPreview()
        await flushSave()
        if (!hasUnsavedChanges(machine.value))
          return true
        return await confirm({
          title: t('离开导演台'),
          message: machine.value.conflict
            ? t('画布与其他地方的修改冲突，导演台的修改尚未保存，确定离开？')
            : t('导演台的修改没有保存成功，确定离开？'),
          confirmText: t('离开'),
          danger: true,
        })
      }
      finally {
        leaveTask = null
      }
    })()
  }
  return leaveTask
}

async function goBack() {
  if (!await prepareLeave())
    return
  leaving = true
  await navigateTo(canvasPath())
}

async function load() {
  if (!canvasId.value || !nodeId.value) {
    await navigateTo(canvasPath())
    return
  }
  loading.value = true
  const res = await canvasApi.get(canvasId.value)
  if (!res?.success || !res.data) {
    notify(res?.message || t('画布不存在或已删除'), 'error')
    await navigateTo(localePath('/canvas'))
    return
  }
  readonly.value = Boolean(res.data.readonly)
  canvasName.value = res.data.name || t('未命名草稿')
  version.value = res.data.version
  graph.value = res.data.graph
  machine.value = createSaveMachine({ persisted: true })
  if (!directorNode.value) {
    notify(t('导演台节点已不在画布上'), 'error')
    await navigateTo(canvasPath())
    return
  }
  loading.value = false
}

function onSceneChange(payload: { nodeId: string, scene: DirectorProject }) {
  const list = (graph.value?.nodes ?? []) as CanvasFlowNode[]
  const node = list.find(item => item.id === payload.nodeId)
  if (!node || !isContentNode(node))
    return
  node.data.scene = payload.scene
  sceneChanged = true
  markDirty()
}

function onPanoramaRemoved(payload: { edgeId: string, sourceNodeId: string }) {
  const current = graph.value
  if (!current || !payload.edgeId)
    return
  current.edges = (current.edges ?? []).filter(edge => String(edge.id) !== payload.edgeId)
  edits.removedEdgeIds.add(payload.edgeId)
  markDirty()
}

function dataUrlToBlob(dataUrl: string) {
  const [head, body] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head || '')?.[1] || 'image/png'
  const bin = atob(body || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++)
    bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function nextKindIndex(list: CanvasFlowNode[], kind: 'image' | 'video') {
  const re = kind === 'image' ? /^image-(\d+)$/ : /^video-(\d+)$/
  let max = 0
  for (const node of list) {
    const match = re.exec(node.id)
    if (match)
      max = Math.max(max, Number(match[1]))
  }
  return max
}

async function onCaptures(items: { dataUrl: string, fileName: string }[]) {
  const current = graph.value
  const node = directorNode.value
  if (!current || !node) {
    notify(t('导演台节点已不在画布上'), 'error')
    return
  }
  if (!current.edges)
    current.edges = []
  const list = current.nodes as CanvasFlowNode[]
  const size = nodeSize(node)
  const abs = absPosition(node, list)
  const gap = 24
  const stage = canvasStageSize('image')
  const stepY = (stage?.h || 220) + gap
  let offset = (current.edges as { source: string }[]).filter(edge => edge.source === node.id).length
  let index = nextKindIndex(list, 'image')
  let done = 0
  for (const item of items) {
    const file = new File([dataUrlToBlob(item.dataUrl)], item.fileName, { type: 'image/png' })
    const res = await assetApi.upload(file)
    if (!res?.success || !res.data) {
      notify(res?.message || t('截图上传失败'), 'error')
      break
    }
    index += 1
    const id = `image-${index}`
    list.push({
      id,
      type: 'easytv',
      position: { x: abs.x + size.w + 60, y: abs.y + offset * stepY },
      data: {
        kind: 'image',
        label: canvasNodeTitle('image', index, t),
        content: res.data.url,
        assetId: res.data.id,
        prompt: '',
        mode: 'idle',
      },
    })
    edits.addedNodeIds.add(id)
    edits.addedEdgeIds.add(`e-${node.id}-${id}`)
    current.edges.push({
      id: `e-${node.id}-${id}`,
      source: node.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
    })
    offset += 1
    done += 1
  }
  if (done) {
    markDirty()
    await flushSave()
    notify(t('已把 {n} 张机位截图放进画布', { n: done }))
  }
}

async function onExportVideo(item: { blob: Blob, fileName: string, duration?: number }) {
  if (!item.blob.size) {
    notify(t('视频导出失败，再试一次'), 'error')
    return
  }
  const current = graph.value
  const node = directorNode.value
  if (readonly.value) {
    downloadExportedVideo(item.blob, item.fileName)
    notify(t('只读画布，已本地下载运镜视频'))
    return
  }
  if (!current || !node) {
    downloadExportedVideo(item.blob, item.fileName)
    notify(t('导演台节点已不在画布上'), 'error')
    return
  }
  const mime = item.blob.type || 'video/webm'
  const file = new File([item.blob], item.fileName, { type: mime })
  let res
  try {
    res = await assetApi.upload(file)
  }
  catch (error) {
    downloadExportedVideo(item.blob, item.fileName)
    notify((error as Error).message || t('运镜视频上传失败'), 'error')
    return
  }
  if (!res?.success || !res.data) {
    downloadExportedVideo(item.blob, item.fileName)
    notify(res?.message || t('运镜视频上传失败'), 'error')
    return
  }
  if (!current.edges)
    current.edges = []
  const list = current.nodes as CanvasFlowNode[]
  const size = nodeSize(node)
  const abs = absPosition(node, list)
  const gap = 24
  const stage = canvasStageSize('video')
  const stepY = (stage?.h || 220) + gap
  const offset = (current.edges as { source: string }[]).filter(edge => edge.source === node.id).length
  const index = nextKindIndex(list, 'video') + 1
  const id = `video-${index}`
  const label = item.fileName.replace(/\.[^.]+$/, '') || canvasNodeTitle('video', index, t)
  list.push({
    id,
    type: 'easytv',
    position: { x: abs.x + size.w + 60, y: abs.y + offset * stepY },
    data: {
      kind: 'video',
      label,
      tag: '运镜',
      content: res.data.url,
      assetId: res.data.id,
      prompt: '',
      mode: 'idle',
    },
  })
  edits.addedNodeIds.add(id)
  edits.addedEdgeIds.add(`e-${node.id}-${id}`)
  current.edges.push({
    id: `e-${node.id}-${id}`,
    source: node.id,
    target: id,
    sourceHandle: 'out',
    targetHandle: 'in',
  })
  markDirty()
  await flushSave()
  notify(t('canvas.director.export.placed'))
}

async function onExportPreview(item: {
  frames: { dataUrl: string, fileName: string, shotIndex: number, time: number, label: string }[]
  prompts: string[]
  output: 'color' | 'depth' | 'matte'
  generate?: boolean
}) {
  if (readonly.value) {
    notify(t('只读画布，预演帧没有放进画布'))
    return
  }
  const current = graph.value
  const node = directorNode.value
  if (!current || !node) {
    notify(t('导演台节点已不在画布上'), 'error')
    return
  }
  if (previewPlacing.value)
    return
  previewPlacing.value = true
  try {
  const signal = previewAbort.value?.signal
  const uploads: { shotIndex: number, time: number, url: string, assetId: number }[] = []
  for (const frame of item.frames) {
    if (signal?.aborted) {
      notify(t('已取消导出预演'))
      return
    }
    const file = new File([dataUrlToBlob(frame.dataUrl)], frame.fileName, { type: 'image/png' })
    const res = await assetApi.upload(file)
    if (!res?.success || !res.data) {
      notify(res?.message || t('截图上传失败'), 'error')
      return
    }
    uploads.push({ shotIndex: frame.shotIndex, time: frame.time, url: res.data.url, assetId: res.data.id })
  }
  if (signal?.aborted) {
    notify(t('已取消导出预演'))
    return
  }
  const control = item.output === 'depth' || item.output === 'matte'
  if (!control)
    await ensureGenerationModels()
  const videoModel = pickPreviewVideoModel(generationModels.value)
  const clip = planPreviewClipGraph(
    item.frames.map(frame => ({ time: frame.time, shotIndex: frame.shotIndex, label: frame.label })),
    item.prompts,
    uploads,
    { imagesOnly: control, videoModel },
  )
  if (!clip.nodes.length)
    return
  const points = control ? 0 : previewClipPoints(clip, quotePreviewModel)
  if (!current.edges)
    current.edges = []
  const list = current.nodes as CanvasFlowNode[]
  const size = nodeSize(node)
  const abs = absPosition(node, list)
  const previewBoxes = list
    .filter(item => !item.parentNode && item.type === 'group' && list.some(child => child.parentNode === item.id && Boolean(child.data && 'previewFrame' in child.data && child.data.previewFrame)))
    .map((item) => {
      const box = absPosition(item, list)
      return { x: box.x, width: nodeSize(item).w }
    })
  const originX = nextPreviewLeft(abs.x + size.w + 60, previewBoxes)
  const stamp = Date.now().toString(36)
  const idOf = (id: string) => `${id}-${stamp}`
  for (const placed of clip.nodes) {
    const id = idOf(placed.id)
    if (placed.kind === 'group') {
      list.push({
        id,
        type: 'group',
        position: { x: originX + placed.x, y: abs.y + placed.y },
        width: placed.width,
        height: placed.height,
        style: { width: `${placed.width}px`, height: `${placed.height}px` },
        selectable: true,
        draggable: true,
        zIndex: 0,
        data: {
          kind: 'group',
          label: String(placed.data.label ?? ''),
          color: defaultGroupColor(),
          layout: 'row',
        },
      })
      edits.addedNodeIds.add(id)
      continue
    }
    const parentId = placed.parentId ? idOf(placed.parentId) : undefined
    list.push({
      id,
      type: 'easytv',
      parentNode: parentId,
      extent: parentId ? 'parent' : undefined,
      expandParent: Boolean(parentId),
      position: parentId
        ? { x: placed.x, y: placed.y }
        : { x: originX + placed.x, y: abs.y + placed.y },
      width: placed.width,
      height: placed.height,
      data: {
        ...placed.data,
        kind: placed.kind,
        label: String(placed.data.label ?? ''),
        content: String(placed.data.content ?? ''),
        prompt: String(placed.data.prompt ?? ''),
        mode: 'idle',
      } as CanvasFlowData,
    })
    edits.addedNodeIds.add(id)
  }
  for (const link of clip.edges) {
    const id = `e-${idOf(link.source)}-${idOf(link.target)}`
    edits.addedEdgeIds.add(id)
    current.edges.push({
      id,
      source: idOf(link.source),
      target: idOf(link.target),
      sourceHandle: 'out',
      targetHandle: 'in',
    })
  }
  const extraControls: Array<{ shotIndex: number, assetId: number }> = []
  const seenExtra = new Set<string>()
  for (const link of previewControlLinks(list, current.edges)) {
    const extraKey = `${link.shotIndex}:${link.assetId}`
    if (!seenExtra.has(extraKey)) {
      seenExtra.add(extraKey)
      extraControls.push({ shotIndex: link.shotIndex, assetId: link.assetId })
    }
    const edgeId = `e-${link.source}-${link.target}`
    edits.addedEdgeIds.add(edgeId)
    current.edges.push({
      id: edgeId,
      source: link.source,
      target: link.target,
      sourceHandle: 'out',
      targetHandle: 'in',
    })
  }
  markDirty()
  await flushSave()
  if (control) {
    notify(t('canvas.director.preview.controlPlaced', { n: uploads.length }))
    return
  }
  const items = item.generate ? previewBatchItems(clip, idOf, extraControls) : []
  if (items.length && canvasId.value) {
    const latest = await batchApi.latest(canvasId.value)
    if (latest?.success && batchActive(latest.data)) {
      notify(t('canvas.director.preview.busy'))
      return
    }
    const res = await batchApi.create(canvasId.value, {
      items,
      budget_points: Math.max(0, Math.floor(points) || 0),
    })
    if (res?.success && res.data) {
      refreshWallet()
      notify(extraControls.length
        ? t('canvas.director.preview.okWithControl', { n: items.length, points: res.data.estimate_points || points, c: extraControls.length })
        : t('canvas.director.preview.ok', { n: items.length, points: res.data.estimate_points || points }))
      return
    }
    notify(res?.message || t('canvas.director.preview.submitFail', { n: uploads.length }))
    return
  }
  notify(points > 0
    ? t('已把 {n} 张预演帧放进画布，点视频节点生成大约 {points} 积分', { n: uploads.length, points })
    : t('已把 {n} 张预演帧放进画布', { n: uploads.length }))
  }
  finally {
    previewPlacing.value = false
    previewAbort.value = null
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let graphNearWarned = false

function markDirty() {
  if (readonly.value || loading.value)
    return
  machine.value = markChanged(machine.value)
  scheduleSave()
}

function scheduleSave() {
  if (saveTimer)
    clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void flushSave()
  }, 1500)
}

/** 立即保存并等队列清空（途中的新改动也会跟着存掉） */
async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (readonly.value || !graph.value || !canvasId.value)
    return
  await saver.request(false)
}

const saver = createSerialRunner(async () => {
  if (!graph.value || (!hasPendingChanges(machine.value) && !machine.value.failed))
    return
  machine.value = beginSave(machine.value)
  let outcome: SaveOutcome = 'ok'
  try {
    outcome = await saveOnce()
    // 冲突：导演台只拥有自己那块，叠到最新版上重试一次，不弹「覆盖 / 重载」让用户选
    if (outcome === 'conflict' && await mergeIntoLatest())
      outcome = await saveOnce()
  }
  catch (error) {
    outcome = 'error'
    notify((error as Error).message || t('保存失败'), 'error')
  }
  machine.value = finishSave(machine.value, outcome)
  if (outcome === 'ok') {
    edits.addedNodeIds.clear()
    edits.addedEdgeIds.clear()
    edits.removedEdgeIds.clear()
  }
  else if (outcome === 'conflict') {
    notify(t('画布已在其他地方修改，导演台的修改没能保存'), 'error')
  }
  if (needsFollowUp(machine.value) && !saveTimer)
    scheduleSave()
})

async function saveOnce(): Promise<SaveOutcome> {
  if (graph.value && isGraphOverLimit(graph.value)) {
    const names = graphHeavyNames(graph.value)
    throw new Error(names ? t('canvas.graph.tooLargeDetail', { names }) : t('canvas.graph.tooLarge'))
  }
  if (graph.value && isGraphNearLimit(graph.value)) {
    if (!graphNearWarned) {
      graphNearWarned = true
      const names = graphHeavyNames(graph.value)
      notify(names ? t('canvas.graph.nearLimitDetail', { names }) : t('canvas.graph.nearLimit'), 'warning')
    }
  }
  else {
    graphNearWarned = false
  }
  const res = await canvasApi.save(canvasId.value, {
    version: version.value,
    name: canvasName.value,
    graph: graph.value!,
  })
  if (res?.success && res.data) {
    version.value = res.data.version
    return 'ok'
  }
  if (isCanvasVersionConflictMessage(res?.message))
    return 'conflict'
  const latest = await canvasApi.get(canvasId.value)
  if (latest?.success && latest.data && latest.data.version !== version.value)
    return 'conflict'
  throw new Error(res?.message || t('保存失败'))
}

async function mergeIntoLatest() {
  const latest = await canvasApi.get(canvasId.value)
  if (!latest?.success || !latest.data || !graph.value)
    return false
  const merged = mergeDirectorEdits(latest.data.graph, graph.value, { nodeId: nodeId.value, ...edits })
  if (!merged)
    return false
  graph.value = merged
  version.value = latest.data.version
  return true
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsavedChanges(machine.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  void load()
  void ensureGenerationModels()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (saveTimer)
    clearTimeout(saveTimer)
})

onBeforeRouteLeave(async () => {
  if (leaving)
    return true
  return await prepareLeave()
})
</script>

<template>
  <ClientOnly>
    <div v-if="loading" class="director-page">
      <div class="director-page__fallback">{{ t('视口加载中…') }}</div>
    </div>
    <CanvasDirectorStage
      v-else-if="directorNode"
      ref="stageRef"
      :node-id="nodeId"
      :scene="scene"
      :panorama="panorama"
      :look="look"
      :readonly="readonly"
      @close="goBack"
      @scene-change="onSceneChange"
      @captures="onCaptures"
      @export-video="onExportVideo"
      @export-preview="onExportPreview"
      @panorama-removed="onPanoramaRemoved"
    />
    <template #fallback>
      <div class="director-page">
        <div class="director-page__fallback">{{ t('视口加载中…') }}</div>
      </div>
    </template>
  </ClientOnly>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio.css';
</style>
