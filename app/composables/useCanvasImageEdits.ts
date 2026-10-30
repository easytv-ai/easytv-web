/**
 * 画布上的图片编辑、视频处理条和分镜拼接。
 * 从 CanvasWorkspace 整段搬出，调用名和提交参数保持原样。
 */
import { computed, nextTick, reactive, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useStudioAppConfig } from '~/composables/useStudioAppConfig'
import assetApi from '~/api/asset'
import mediaApi from '~/api/media'
import taskApi from '~/api/task'
import { hasNativeAudio } from '~/utils/canvas-talking'
import { buildViralShotPrompt, parseViralBreakdown, pickViralModel, viralAnalysisInstruction, viralDuration, viralMappedEntities, viralModels, viralRatio, viralResolution, type ViralPlan } from '~/utils/canvas-viral'
import {
  IMAGE_EDIT_PROMPTS,
  outpaintPrompt,
  promptReverseInstruction,
  promptReverseVideoInstruction,
  upscaleClarity,
  upscalePrompt,
  upscaleRatio,
  upscaleTierSize,
} from '~/utils/canvas-image-edit'
import {
  captureVideoFrame,
  probeMediaDuration,
  probeVideoDuration,
  promptReverseFrameRanges,
  samplePromptReverseTimes,
} from '~/utils/canvas-video-frame'
import { isGptImageModel, pickCanvasImageEditModel, pickImageEditModel, pickImageUpscaleModel, pickVisionTextModel, preferredImageModel } from '~/utils/image-input'
import { cellNodeLayout, type GridCell } from '~/utils/canvas-grid-split'
import { montageNodeSize, montageParams, type MontageOptions, type MontageSource } from '~/utils/canvas-montage'
import { applyOptimizedPrompt, canOptimizePrompt, cleanOptimizedPrompt, promptOptimizeInstruction } from '~/utils/canvas-prompt-optimize'
import { mediaActionState, mediaSourceRef } from '~/utils/canvas-media-job'
import { expandPromptTokens } from '~/utils/canvas-mark'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'
import {
  canvasFitMediaSize,
  canvasKindIndex,
  canvasNodeTitle,
  isDepthMotionNode,
  isFramePullNode,
} from '~/utils/canvas-node-kinds'
import {
  defaultGroupColor,
  isContentNode,
  isGroupNode,
  isNodeLocked,
  layoutGroupChildren,
  nodeSize,
  nodesBounds,
  storyboardCols,
  type CanvasFlowNode,
} from '~/utils/canvas-group'
import type { Asset, GenerationModel, MediaAction, MediaJob, TaskInput } from '~/types/creative'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'

export function useCanvasImageEdits(opts: { blocked?: () => boolean } & Record<string, any>) {
  const {
    selected,
    selectedGroup,
    notify,
    t,
    locale,
    closeOverlays,
    updateNodeData,
    pushHistory,
    counts,
    addNodes,
    addEdges,
    addSelectedNodes,
    defaultEdgeOptions,
    ensureMediaAction,
    mediaSourceOf,
    mediaSourceNode,
    spawnMediaNode,
    spawnDerivedImage,
    spawnDerivedText,
    submitDerivedTask,
    submitMediaJob,
    gateSpend,
    estimateSpend,
    applyTaskToNode,
    pollTask,
    refreshWallet,
    waitTask,
    applyMediaNodeSize,
    openAssetPicker,
    canvasId,
    spawnDepthNode,
    runSubjectAction,
    relabelGroups,
    editSrc,
    montageOpen,
    gridSplitOpen,
    gridSplitNodeId,
    groupCount,
    angleBusy,
    angleNodeId,
    angleOpen,
    angleSrc,
    cropNodeId,
    cropOpen,
    cropVariant,
    depthBusy,
    depthResolution,
    depthModel,
    depthNodeId,
    depthOpen,
    eraseMode,
    eraseNodeId,
    eraseOpen,
    flipNodeId,
    flipOpen,
    lightBusy,
    lightNodeId,
    lightOpen,
    lightSrc,
    mattingBusy,
    mattingNodeId,
    mattingOpen,
    optimizeBusy,
    optimizeError,
    optimizeModel,
    optimizeNodeId,
    optimizeOpen,
    optimizeOriginal,
    optimizePoints,
    optimizeResult,
    outpaintBusy,
    outpaintNodeId,
    outpaintOpen,
    smartEditAssetId,
    smartEditBusy,
    smartEditNodeId,
    smartEditOpen,
    smartEditPick,
    smartEditSrc,
    viralBusy,
    viralDurationPick,
    viralModelId,
    viralNodeId,
    viralOpen,
    viralRatioPick,
    viralResolutionPick,
    viralSourceSeconds,
    viralStep,
  } = opts
  const nodes = opts.nodes as Ref<CanvasFlowNode[]>
  const findNode = opts.findNode as (id: string) => CanvasFlowNode | undefined
  function nodeFrozen(node: CanvasFlowNode | undefined | null) {
    return isNodeLocked(node, nodes.value)
  }
  const waitMediaJob = opts.waitMediaJob as (id: number) => Promise<MediaJob | null>
  const smartEditRefs = opts.smartEditRefs as Ref<Array<{ assetId: number, url: string }>>
  const connectedRefThumbs = opts.connectedRefThumbs as (nodeId: string) => Array<{ url: string, kind?: 'image' | 'video' | 'audio', assetId?: number }>
  const mediaActions = opts.mediaActions as Ref<MediaAction[]>
  const montageSources = opts.montageSources as ComputedRef<MontageSource[]>
  const uploadedRefList = opts.uploadedRefList as (data: CanvasNodeData) => Array<{ assetId?: number, url: string, name?: string }>
  const collectRefImages = opts.collectRefImages as (node: CanvasFlowNode) => Array<{ url: string, assetId?: number }>
  const mediaKindOfUrl = opts.mediaKindOfUrl as (url: string) => 'image' | 'video' | 'audio'
  const nodeImageUrl = opts.nodeImageUrl as (node: CanvasFlowNode) => string
  let optimizeSeq = 0

function currentImageSrc(node = selected.value) {
  if (!node || !isContentNode(node))
    return ''
  const content = node.data.content?.trim() || ''
  if (content && isMediaUrl(content))
    return resolveMediaUrl(content)
  if (node.data.refUrl && isMediaUrl(node.data.refUrl))
    return resolveMediaUrl(node.data.refUrl)
  return ''
}

/** 打光 / 多角度提交用的图片编辑模型；面板报价必须读同一份 */
const imageEditModel = computed(() => {
  const list = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  return pickCanvasImageEditModel(list) || ''
})

function defaultImageModel() {
  const list = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  return preferredImageModel(list) || 'lib-image'
}

function openSmartEdit() {
  const node = selected.value
  const src = currentImageSrc(node)
  if (!node || !isContentNode(node) || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  closeOverlays(['depth', 'light', 'angle', 'crop', 'outpaint', 'flip', 'mark'])
  smartEditNodeId.value = node.id
  smartEditSrc.value = src
  smartEditAssetId.value = Number(node.data.assetId || node.data.refAssetId || 0)
  smartEditRefs.value = []
  smartEditOpen.value = true
}

const depthExtractModels = computed(() => (mediaActions.value.find(item => item.action === 'depth_extract')?.models || []).map(String).filter(Boolean))

function openDepthBar() {
  const node = selected.value
  if (!node || !isContentNode(node) || !currentImageSrc(node)) {
    notify(t('请先生成或添加素材'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  if (node.data.kind !== 'image' && node.data.kind !== 'video' && node.data.kind !== 'director') {
    notify(t('请先选择图片或视频节点'), 'error')
    return
  }
  if (!ensureMediaAction('depth_extract'))
    return
  if (depthOpen.value && depthNodeId.value === node.id) {
    depthOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'light', 'angle', 'crop', 'outpaint', 'flip', 'mark', 'erase', 'matting', 'viral', 'extendStrip', 'clipStrip', 'splitStrip'])
  depthNodeId.value = node.id
  depthResolution.value = '480p'
  depthModel.value = depthExtractModels.value[0] || ''
  depthOpen.value = true
}

const reverseBusy = ref(false)

type VideoReverseMaterial = {
  inputs: TaskInput[]
  ranges: ReturnType<typeof promptReverseFrameRanges>
  duration: number
  width: number
  height: number
}

/**
 * 视频反推的原料：浏览器抽关键帧 → 上传成图片素材，顺带带回原片时长与像素尺寸。
 * 浏览器读不到（OSS 视频没有 CORS 头）时返回 null，由 collectVideoReverseInputsServer 兜底。
 */
async function collectVideoReverseInputs(src: string): Promise<VideoReverseMaterial | null> {
  notify(t('正在抽取关键帧…'))
  let duration = 0
  try {
    duration = await probeVideoDuration(src)
  }
  catch {
    return null
  }
  const times = samplePromptReverseTimes(duration)
  const ranges = promptReverseFrameRanges(times, duration)
  const inputs: TaskInput[] = []
  let width = 0
  let height = 0
  try {
    for (const frame of ranges) {
      const snapped = await captureVideoFrame(src, frame.timeSec)
      width ||= snapped.width
      height ||= snapped.height
      const file = new File([snapped.blob], `reverse-frame-${frame.index}.jpg`, { type: 'image/jpeg' })
      const uploaded = await assetApi.upload(file)
      if (!uploaded?.success || !uploaded.data?.id) {
        notify(uploaded?.message || t('关键帧上传失败'), 'error')
        return null
      }
      inputs.push({ asset_id: uploaded.data.id, role: 'image' })
    }
  }
  catch {
    return null
  }
  if (!inputs.length)
    return null
  return { inputs, ranges, duration, width, height }
}

/**
 * 反推原料的服务端兜底：浏览器抽不到帧时提交 extract_frames（mode=spread，免费本地 ffmpeg）由服务端均匀抽帧，
 * 用产物的 time 与作业写回的资产 duration / width / height 还原时间轴（API.md 23 / 29）。
 */
async function collectVideoReverseInputsServer(from: CanvasFlowNode & { data: CanvasNodeData }): Promise<VideoReverseMaterial | null> {
  const source = mediaSourceOf(from)
  if (!source)
    return null
  notify(t('浏览器读不到这段视频，改由服务端抽帧…'))
  const res = await mediaApi.create({
    action: 'extract_frames',
    ...source,
    params: { mode: 'spread', count: 8 },
    canvas_id: canvasId() || undefined,
  })
  if (!res?.success || !res.data) {
    notify(res?.message || t('抽取关键帧失败，请确认视频可跨域读取'), 'error')
    return null
  }
  const job = await waitMediaJob(res.data.id)
  const frames = (job?.outputs || []).filter(item => item.type === 'image' && Number(item.asset_id) > 0)
  if (!job || job.status !== 2 || !frames.length) {
    notify(job?.error || t('抽取关键帧失败，请确认视频可跨域读取'), 'error')
    return null
  }
  let duration = 0
  let width = 0
  let height = 0
  const assetId = Number(('asset_id' in source && source.asset_id) || job.source_asset_id)
  if (assetId > 0) {
    const asset = await assetApi.get(assetId)
    if (asset?.success && asset.data) {
      duration = Number(asset.data.duration) || 0
      width = Number(asset.data.width) || 0
      height = Number(asset.data.height) || 0
    }
  }
  const step = duration > 0 ? duration / Math.max(1, frames.length) : 2
  const times = frames.map((item, i) => {
    const at = Number(item.time)
    return Number.isFinite(at) && (at > 0 || i === 0) ? at : i * step
  })
  if (!duration)
    duration = times[times.length - 1]! + step
  return {
    inputs: frames.map(item => ({ asset_id: item.asset_id, role: 'image' as const })),
    ranges: promptReverseFrameRanges(times, duration),
    duration,
    width,
    height,
  }
}

/** 视频反推：浏览器抽关键帧 → 上传 → 看图模型输出 Timestamped prompts */
async function runVideoPromptReverse(
  from: CanvasFlowNode & { data: CanvasNodeData },
  model: string,
) {
  const src = currentImageSrc(from)
  if (!src) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  const material = await collectVideoReverseInputs(src) || await collectVideoReverseInputsServer(from)
  if (!material)
    return
  await submitDerivedTask(spawnDerivedText(from, 'Timestamped prompts'), '反推提示词', {
    type: 'text',
    model,
    prompt: promptReverseVideoInstruction(locale.value, material.ranges, material.duration),
    params: { reverse: 'timestamped', frames: material.ranges.length },
    inputs: material.inputs,
  })
}

/** 反推提示词：图片一段词；视频抽多帧，按时间戳分段 */
async function runPromptReverse() {
  const from = selected.value
  if (!from || !isContentNode(from) || reverseBusy.value)
    return
  const isVideo = from.data.kind === 'video' || from.data.kind === 'director'
  if (!currentImageSrc(from)) {
    notify(isVideo ? t('请先生成或添加一段视频') : t('请先生成或添加一张图片'), 'error')
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickVisionTextModel(models, growthConfig.value?.vision_text_model)
  if (!model) {
    notify(t('暂无能识别图片的文本模型，请联系运营开通'), 'error')
    return
  }
  reverseBusy.value = true
  try {
    if (isVideo) {
      await runVideoPromptReverse(from, model)
      return
    }
    const assetId = await ensureNodeImageAsset(from)
    if (!assetId) {
      notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
      return
    }
    await submitDerivedTask(spawnDerivedText(from, '反推提示词'), '反推提示词', {
      type: 'text',
      model,
      prompt: promptReverseInstruction(locale.value),
      params: {},
      inputs: [{ asset_id: assetId, role: 'image' }],
    })
  }
  finally {
    reverseBusy.value = false
  }
}

function openLightPanel() {
  const node = selected.value
  const src = currentImageSrc(node)
  if (!node || !isContentNode(node) || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  if (lightOpen.value && lightNodeId.value === node.id) {
    lightOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'crop', 'outpaint', 'flip', 'mark', 'angle'])
  lightNodeId.value = node.id
  lightSrc.value = src
  lightOpen.value = true
}

async function onLightSubmit(payload: { prompt: string }) {
  const from = findNode(lightNodeId.value) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from) || nodeFrozen(from) || lightBusy.value)
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  const model = imageEditModel.value
  if (!model) {
    notify(t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return
  }
  lightBusy.value = true
  try {
    const assetId = await ensureNodeImageAsset(from)
    if (!assetId) {
      notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
      return
    }
    await submitDerivedTask(spawnDerivedImage(from, '打光', payload.prompt), '打光', {
      type: 'image',
      model,
      prompt: payload.prompt,
      params: {},
      inputs: [{ asset_id: assetId, role: 'image' }],
    })
  }
  finally {
    lightBusy.value = false
  }
}

async function runUpscale(scale: import('~/utils/canvas-image-edit').UpscaleScale) {
  const from = selected.value
  if (!from || !isContentNode(from))
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (from.data.taskStatus === 'pending' || from.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickImageUpscaleModel(models, defaultImageModel())
  if (!model) {
    notify(t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return
  }
  if (isGptImageModel(model)) {
    notify(t('当前图片模型无法输出 2K / 4K，图片高清需要支持更大尺寸的图片模型'), 'error')
    return
  }
  const assetId = await ensureNodeImageAsset(from)
  if (!assetId) {
    notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
    return
  }
  const px = await imagePixelSize(currentImageSrc(from))
  const size = upscaleTierSize(px.width, px.height, scale)
  const clarity = upscaleClarity(scale)
  const ratio = upscaleRatio(px.width, px.height)
  const prompt = upscalePrompt(scale)
  const label = `${t('高清')} ${scale}x`
  const sibling = spawnDerivedImage(from, '图片高清', prompt, { label })
  if (isContentNode(sibling)) {
    sibling.data.model = model
    sibling.data.params = { ratio, clarity, size }
  }
  await submitDerivedTask(sibling, label, {
    type: 'image',
    model,
    prompt,
    params: { edit: 'upscale', mode: 'i2i', scale, size, clarity, ratio },
    inputs: [{ asset_id: assetId, role: 'image' }],
  })
}

function imagePixelSize(src: string) {
  return new Promise<{ width: number, height: number }>((resolve) => {
    if (!src) {
      resolve({ width: 0, height: 0 })
      return
    }
    const img = new Image()
    img.onload = () => resolve({
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0,
    })
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = src
  })
}

async function runRemoveBg(action: 'bg-object' | 'bg-person') {
  const from = selected.value
  if (!from || !isContentNode(from))
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (from.data.taskStatus === 'pending' || from.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickImageEditModel(models, defaultImageModel(), false)
  if (!model) {
    notify(t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return
  }
  const assetId = await ensureNodeImageAsset(from)
  if (!assetId) {
    notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
    return
  }
  const tag = action === 'bg-person' ? '保留人物' : '保留物品'
  const prompt = IMAGE_EDIT_PROMPTS[action]
  await submitDerivedTask(spawnDerivedImage(from, tag, prompt), tag, {
    type: 'image',
    model,
    prompt,
    params: { edit: action, mode: 'i2i' },
    inputs: [{ asset_id: assetId, role: 'image' }],
  })
}

const THREE_VIEW_TAG = {
  'view-char': '角色三视图设定图',
  'view-face': '脸部三视图设定图',
  'view-prop': '道具三视图设定图',
} as const

async function runThreeView(action: 'view-char' | 'view-face' | 'view-prop') {
  const from = selected.value
  if (!from || !isContentNode(from))
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (from.data.taskStatus === 'pending' || from.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickImageEditModel(models, defaultImageModel(), false)
  if (!model) {
    notify(t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return
  }
  const assetId = await ensureNodeImageAsset(from)
  if (!assetId) {
    notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
    return
  }
  const tag = THREE_VIEW_TAG[action]
  const prompt = IMAGE_EDIT_PROMPTS[action]
  const size = nodeSize(from)
  await submitDerivedTask(spawnDerivedImage(from, tag, prompt, {
    place: 'down',
    w: Math.round(size.w * 2.35),
    h: Math.round(size.h * 0.82),
  }), tag, {
    type: 'image',
    model,
    prompt,
    params: { edit: action, mode: 'i2i' },
    inputs: [{ asset_id: assetId, role: 'image' }],
  })
}

function openAnglePanel() {
  const node = selected.value
  const src = currentImageSrc(node)
  if (!node || !isContentNode(node) || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  if (angleOpen.value && angleNodeId.value === node.id) {
    angleOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'crop', 'outpaint', 'flip', 'mark'])
  angleNodeId.value = node.id
  angleSrc.value = src
  angleOpen.value = true
}

async function onAngleSubmit(payload: { prompt: string }) {
  const from = findNode(angleNodeId.value) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from) || nodeFrozen(from) || angleBusy.value)
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  const model = imageEditModel.value
  if (!model) {
    notify(t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return
  }
  angleBusy.value = true
  try {
    const assetId = await ensureNodeImageAsset(from)
    if (!assetId) {
      notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
      return
    }
    await submitDerivedTask(spawnDerivedImage(from, '多视角', payload.prompt), '多视角', {
      type: 'image',
      model,
      prompt: payload.prompt,
      params: {},
      inputs: [{ asset_id: assetId, role: 'image' }],
    })
  }
  finally {
    angleBusy.value = false
  }
}

async function onDepthSubmit() {
  const from = findNode(depthNodeId.value) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from) || nodeFrozen(from) || depthBusy.value)
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加素材'), 'error')
    return
  }
  if (!ensureMediaAction('depth_extract'))
    return
  const source = mediaSourceOf(from)
  if (!source)
    return
  const node = spawnDepthNode(from)
  if (!node || !isContentNode(node))
    return
  depthBusy.value = true
  depthOpen.value = false
  try {
    await submitMediaJob(node, 'depth_extract', source, {
      resolution: depthResolution.value,
    }, {
      label: '深度提取',
      model: depthModel.value || undefined,
      dropOnFail: [node.id],
    })
  }
  finally {
    depthBusy.value = false
  }
}

function onSmartEditCite() {
  smartEditPick.value = true
  openAssetPicker({
    mode: 'attach',
    attach: 'ref',
    title: t('选择参考图片'),
    accept: ['image'],
    nodeId: smartEditNodeId.value,
  })
}

async function onSmartEditSubmit(payload: { prompt: string, mask: Blob | null, model: string }) {
  const node = findNode(smartEditNodeId.value) as CanvasFlowNode | undefined
  if (!node || !isContentNode(node) || nodeFrozen(node))
    return
  smartEditBusy.value = true
  try {
    let maskAssetId: number | null = null
    if (payload.mask) {
      const file = new File([payload.mask], 'smart-edit-mask.png', { type: 'image/png' })
      const res = await assetApi.upload(file)
      if (!res?.success || !res.data) {
        notify(res?.message || t('标记上传失败'), 'error')
        return
      }
      // 蒙版只作本次编辑的输入，不写回节点：写回后检查器里的普通生成会一直带着它
      maskAssetId = res.data.id
    }
    const ok = await runImageEdit('smart-edit', payload.prompt, payload.model, node, {
      maskAssetId,
      extraImageIds: smartEditRefs.value.map(item => item.assetId),
    })
    if (ok)
      smartEditOpen.value = false
  }
  finally {
    smartEditBusy.value = false
  }
}

function openCropEditor() {
  const node = selected.value
  const src = currentImageSrc(node)
  if (!node || !isContentNode(node) || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'outpaint', 'flip', 'mark', 'erase'])
  cropNodeId.value = node.id
  cropVariant.value = 'image'
  editSrc.value = src
  cropOpen.value = true
}

function openFrameCropEditor() {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
    return
  const content = node.data.content?.trim() || ''
  if (!content || !isMediaUrl(content)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'outpaint', 'flip', 'mark', 'extendStrip', 'erase'])
  cropNodeId.value = node.id
  cropVariant.value = 'video'
  editSrc.value = resolveMediaUrl(content)
  cropOpen.value = true
}

function openEraseBar(mode: 'smart' | 'box') {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
    return
  const content = node.data.content?.trim() || ''
  if (!content || !isMediaUrl(content)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  if (eraseOpen.value && eraseNodeId.value === node.id && eraseMode.value === mode) {
    eraseOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'crop', 'outpaint', 'flip', 'mark', 'extendStrip', 'clipStrip', 'splitStrip', 'matting', 'viral'])
  eraseNodeId.value = node.id
  eraseMode.value = mode
  eraseOpen.value = true
}

function openMattingBar() {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
    return
  if (isFramePullNode(node.data) || isDepthMotionNode(node.data))
    return
  const content = node.data.content?.trim() || ''
  if (!content || !isMediaUrl(content)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  if (mattingOpen.value && mattingNodeId.value === node.id) {
    mattingOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'erase', 'outpaint', 'flip', 'mark', 'extendStrip', 'clipStrip', 'splitStrip', 'matting', 'viral'])
  mattingNodeId.value = node.id
  mattingOpen.value = true
}

async function onMattingSubmit() {
  if (mattingBusy.value || nodeFrozen(findNode(mattingNodeId.value)))
    return
  mattingBusy.value = true
  mattingOpen.value = false
  try {
    await runSubjectAction('smart-matting', mattingNodeId.value)
  }
  finally {
    mattingBusy.value = false
  }
}

/** 原片时长读完才允许点拉片；读的过程中积分显示为省略号 */
const viralDurationReady = ref(false)

/** 当前原片上的拉片结果。没有分镜就当还没拉过 */
const viralPlan = computed(() => {
  const node = findNode(viralNodeId.value) as CanvasFlowNode | undefined
  const plan = node && isContentNode(node) ? node.data.viralPlan : null
  return plan?.shots?.length ? plan : null
})

const viralAnalyzePoints = computed(() => {
  const vision = pickVisionTextModel(generationModelList.value, growthConfig.value?.vision_text_model)
  return vision ? estimateSpend(vision, {}) : 0
})

const viralGeneratePoints = computed(() => {
  const plan = viralPlan.value
  if (!plan)
    return 0
  const model = viralModels(generationModelList.value).find(item => item.model === viralModelId.value)
  if (!model)
    return 0
  return plan.shots.reduce((sum, shot) => {
    const seconds = viralDuration(Math.max(0, shot.end - shot.start), model.durations)
    return sum + estimateSpend(model.model, { duration: seconds })
  }, 0)
})

/** 爆款复刻：在源视频右侧挂悬浮条，参考素材数量 + 一键按原片结构复刻 */
function openViralBar() {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'video' || nodeFrozen(node))
    return
  const content = node.data.content?.trim() || ''
  if (!content || !isMediaUrl(content)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  if (viralOpen.value && viralNodeId.value === node.id) {
    viralOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'erase', 'outpaint', 'flip', 'mark', 'extendStrip', 'clipStrip', 'splitStrip', 'matting'])
  viralNodeId.value = node.id
  viralOpen.value = true
  ensureViralModel()
  void loadViralDuration(node)
}

/** 原片时长：悬浮条按它估复刻扣分；只读 metadata 不用跨域（带 crossOrigin 在 OSS 没 CORS 头时要等满 12 秒），读不到用资产库的时长兜底 */
async function loadViralDuration(node: CanvasFlowNode & { data: CanvasNodeData }) {
  viralDurationReady.value = false
  viralSourceSeconds.value = 0
  try {
    const src = currentImageSrc(node)
    if (src) {
      try {
        const probed = await probeMediaDuration(src)
        if (probed > 0) {
          viralSourceSeconds.value = probed
          return
        }
      }
      catch {
        // 读不到时走资产库
      }
    }
    const assetId = Number(node.data.assetId)
    if (!(assetId > 0))
      return
    const res = await assetApi.get(assetId)
    if (res?.success && res.data)
      viralSourceSeconds.value = Number(res.data.duration) || 0
  }
  finally {
    viralDurationReady.value = true
  }
}

const VIRAL_MODEL_STORAGE_KEY = 'easytv:viral-model'

function rememberedViralModel() {
  try {
    return localStorage.getItem(VIRAL_MODEL_STORAGE_KEY) || ''
  }
  catch {
    return ''
  }
}

function rememberViralModel(id: string) {
  try {
    localStorage.setItem(VIRAL_MODEL_STORAGE_KEY, id)
  }
  catch {}
}

const generationModelList = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => [])
const { growth: growthConfig } = useStudioAppConfig()

/** 自动挑的复刻模型：只列能吃参考视频的视频模型（能力位 video_reference），当前选中的还在清单里就不动 */
function ensureViralModel() {
  const usable = viralModels(generationModelList.value)
  if (viralModelId.value && usable.some(item => item.model === viralModelId.value))
    return
  viralModelId.value = pickViralModel(usable, {
    remembered: rememberedViralModel(),
    configModel: growthConfig.value?.compose_video_model,
  })?.model || ''
}

/** 模型换了就清掉手选参数，提交按原片自动跟比例和时长 */
watch(viralModelId, () => {
  viralRatioPick.value = ''
  viralResolutionPick.value = ''
  viralDurationPick.value = 0
})

function currentViralNode() {
  const node = findNode(viralNodeId.value) as CanvasFlowNode | undefined
  return node && isContentNode(node) ? node : null
}

function writeViralPlan(plan: ViralPlan | null, history = true, nodeId = viralNodeId.value) {
  if (!nodeId || !findNode(nodeId))
    return
  updateNodeData(nodeId, { viralPlan: plan })
  if (history)
    pushHistory()
}

function onViralReset() {
  writeViralPlan(null)
}

function onViralExtra(text: string) {
  const plan = viralPlan.value
  if (!plan)
    return
  writeViralPlan({ ...plan, extra: text.slice(0, 300) }, false)
}

function onViralShot(index: number, text: string) {
  const plan = viralPlan.value
  const shot = plan?.shots[index]
  if (!plan || !shot)
    return
  const shots = plan.shots.map((item, itemIndex) => itemIndex === index ? { ...item, text: text.slice(0, 400) } : item)
  writeViralPlan({ ...plan, shots }, false)
}

function onViralCommit() {
  if (viralPlan.value)
    pushHistory()
}

function onViralClear(entityId: string) {
  const plan = viralPlan.value
  if (!plan)
    return
  writeViralPlan({
    ...plan,
    entities: plan.entities.map(item => item.id === entityId
      ? { id: item.id, kind: item.kind, name: item.name, note: item.note }
      : item),
  })
}

function onViralPick(entityId: string) {
  const plan = viralPlan.value
  const entity = plan?.entities.find(item => item.id === entityId)
  if (!plan || !entity)
    return
  openAssetPicker({
    mode: 'attach',
    accept: ['image'],
    title: t('选择替换素材'),
    chatPick: (assets: Asset[]) => {
      const asset = assets[0]
      if (!asset?.id)
        return
      const latest = viralPlan.value
      if (!latest)
        return
      writeViralPlan({
        ...latest,
        entities: latest.entities.map(item => item.id === entityId
          ? {
              ...item,
              assetId: asset.id,
              url: resolveMediaUrl(asset.url || '') || asset.url || '',
              assetName: String(asset.name || '').trim(),
            }
          : item),
      })
    },
  })
}

/**
 * 爆款复刻分两段，对齐「先拉片、再替换、后逐镜出片」：
 * 1. 还没有拉片结果时，抽帧交给看图模型拆镜头和可替换对象，写回原片节点，悬浮条留在替换面板；
 * 2. 已有拉片结果时，每个镜头单独交一个视频任务。原片作 reference_video，替换图按面板顺序作 reference。
 * 拉片失败就不进入出片。
 */
async function onViralSubmit() {
  const from = currentViralNode()
  if (!from || nodeFrozen(from) || viralBusy.value)
    return
  if (from.data.viralPlan?.shots?.length) {
    await generateViralShots(from)
    return
  }
  await analyzeViral(from)
}

async function analyzeViral(from: CanvasFlowNode & { data: CanvasNodeData }) {
  const sourceAssetId = Number(from.data.assetId)
  if (!(sourceAssetId > 0)) {
    notify(t('请先把视频保存到资产库'), 'error')
    return
  }
  const src = currentImageSrc(from)
  if (!src) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  const vision = pickVisionTextModel(generationModelList.value, growthConfig.value?.vision_text_model)
  if (!vision) {
    notify(t('暂无看图模型，暂时不能拉片'), 'error')
    return
  }
  viralBusy.value = true
  viralStep.value = 'analyze'
  try {
    const material = await collectVideoReverseInputs(src) || await collectVideoReverseInputsServer(from)
    if (!material || !findNode(from.id))
      return
    const textNode = spawnDerivedText(from, 'Timestamped prompts')
    const task = await submitDerivedTask(textNode, '拉片', {
      type: 'text',
      model: vision,
      prompt: viralAnalysisInstruction(locale.value, material.ranges, material.duration),
      params: { reverse: 'timestamped', frames: material.ranges.length },
      inputs: material.inputs,
    })
    if (!task)
      return
    const done = task.status === 'pending' || task.status === 'running'
      ? await waitTask(textNode.id, task.id)
      : task
    if (!findNode(from.id))
      return
    const parsed = done?.status === 'succeeded' ? parseViralBreakdown(done.result_text || '', material.duration) : null
    if (!parsed) {
      notify(t('拉片没有得到分镜，请重试'), 'error')
      return
    }
    let duration = material.duration
    let width = material.width
    let height = material.height
    if (!duration) {
      const asset = await assetApi.get(sourceAssetId)
      if (asset?.success && asset.data) {
        duration = Number(asset.data.duration) || 0
        width = width || Number(asset.data.width) || 0
        height = height || Number(asset.data.height) || 0
      }
    }
    writeViralPlan({
      sourceAssetId,
      duration,
      width,
      height,
      shots: parsed.shots,
      entities: parsed.entities,
      extra: '',
    }, true, from.id)
    notify(t('拉片完成。替换角色、场景或元素后再生成，每个镜头会单独出一条视频'))
  }
  finally {
    viralBusy.value = false
    viralStep.value = ''
  }
}

async function generateViralShots(from: CanvasFlowNode & { data: CanvasNodeData }) {
  const plan = from.data.viralPlan
  if (!plan?.shots.length)
    return
  const sourceAssetId = Number(plan.sourceAssetId) || Number(from.data.assetId)
  if (!(sourceAssetId > 0)) {
    notify(t('请先把视频保存到资产库'), 'error')
    return
  }
  ensureViralModel()
  const model = viralModels(generationModelList.value).find(item => item.model === viralModelId.value)
  if (!model) {
    notify(t('暂无支持参考视频的模型，请联系运营开通'), 'error')
    return
  }
  rememberViralModel(model.model)
  const mapped = viralMappedEntities(plan.entities)
  const inputs: TaskInput[] = [
    { asset_id: sourceAssetId, role: 'reference_video' },
    ...mapped.map(item => ({ asset_id: Number(item.assetId), role: 'reference' as const })),
  ]
  const prepared = plan.shots.map(shot => ({
    shot,
    seconds: viralDurationPick.value || viralDuration(Math.max(0, shot.end - shot.start), model.durations),
  }))
  const total = prepared.reduce((sum, item) => sum + estimateSpend(model.model, { duration: item.seconds }), 0)
  if (!await gateSpend(total))
    return
  const ratio = viralRatioPick.value || viralRatio(plan.width, plan.height)
  const resolution = viralResolutionPick.value || viralResolution(model.resolutions)
  const size = nodeSize(from)
  viralBusy.value = true
  viralStep.value = 'generate'
  let submitted = 0
  try {
    for (let index = 0; index < prepared.length; index++) {
      const item = prepared[index]!
      const prompt = buildViralShotPrompt({
        locale: locale.value,
        shot: item.shot,
        entities: plan.entities,
        extra: plan.extra,
      })
      const params: Record<string, unknown> = {
        mode: 'reference',
        ratio,
        duration: item.seconds,
        audio: hasNativeAudio(model),
      }
      if (resolution)
        params.resolution = resolution
      const sibling = spawnMediaNode(from, 'video', '爆款复刻', `${from.data.label || t('视频')}_${t('镜头')}${index + 1}`, {
        at: { x: from.position.x + size.w + 420, y: from.position.y + index * (size.h + 36) },
        data: {
          prompt,
          videoMode: 'reference',
          viralSourceAssetId: sourceAssetId,
        },
      })
      const task = await submitDerivedTask(sibling, '爆款复刻', {
        type: 'video',
        model: model.model,
        prompt,
        params,
        inputs,
      }, { confirm: false })
      if (!task)
        break
      submitted++
    }
    if (submitted === prepared.length) {
      viralOpen.value = false
      notify(t('已按 {n} 个镜头提交复刻', { n: submitted }))
    }
    else if (submitted > 0) {
      notify(t('部分镜头提交失败'), 'error')
    }
  }
  finally {
    viralBusy.value = false
    viralStep.value = ''
  }
}

/** 智能 / 框选去字幕：模型动作 remove_subtitle，框选区域原样透传（归一化 0~1） */
async function onEraseSubmit(regions: Array<{ x: number, y: number, w: number, h: number }>) {
  const from = findNode(eraseNodeId.value) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from) || from.data.kind !== 'video' || nodeFrozen(from))
    return
  if (!ensureMediaAction('remove_subtitle'))
    return
  const source = mediaSourceOf(from)
  if (!source)
    return
  eraseOpen.value = false
  const params: Record<string, unknown> = { regions, mode: eraseMode.value }
  if (regions[0])
    params.rect = regions[0]
  const sourceLabel = from.data.label || t('视频节点')
  const sibling = spawnMediaNode(from, 'video', '去字幕', `${sourceLabel}_${t('去字幕')}`, { select: true })
  await submitMediaJob(sibling, 'remove_subtitle', source, params, { label: '智能去字幕', dropOnFail: [sibling.id] })
}

/**
 * 音视频分离 / 人声提取 / 背景音提取（API.md 23.3）：
 * 音轨走本地 split_av，一次出音轨 + 无声视频两份产物，分别写进音频节点与视频节点；
 * 人声 / 背景音走模型动作 vocal_separation / bgm_separation，只出一个音频节点。
 */
async function onSeparateAv(audioTag: '音轨' | '人声' | '背景音' = '音轨') {
  const from = selected.value
  if (!from || !isContentNode(from) || from.data.kind !== 'video')
    return
  const src = from.data.content?.trim() || ''
  if (!src || !isMediaUrl(src)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  const action = audioTag === '人声' ? 'vocal_separation' : audioTag === '背景音' ? 'bgm_separation' : 'split_av'
  if (!ensureMediaAction(action))
    return
  const source = mediaSourceOf(from)
  if (!source)
    return
  const index = canvasKindIndex(nodes.value, from.id, 'video')
  const sourceLabel = from.data.label || canvasNodeTitle('video', index, t)
  const audioLabel = t(audioTag)

  if (action !== 'split_av') {
    const audioNode = spawnMediaNode(from, 'audio', audioTag, `${sourceLabel}_${audioLabel}`, { select: true })
    await submitMediaJob(audioNode, action, source, {}, {
      label: audioTag === '人声' ? '人声提取' : '背景音提取',
      dropOnFail: [audioNode.id],
    })
    return
  }

  const audioNode = spawnMediaNode(from, 'audio', audioTag, `${sourceLabel}_${audioLabel}`, { place: 'up' })
  const silentNode = spawnMediaNode(from, 'video', '无声', `${sourceLabel}_${t('无声')}`, {
    data: { prompt: String(from.data.prompt || ''), silent: true },
    select: true,
  })
  await submitMediaJob(silentNode, 'split_av', source, {}, {
    label: '音视频分离',
    dropOnFail: [audioNode.id, silentNode.id],
    linkedId: audioNode.id,
  })
}

/** 选中的视频 / 音频节点作为媒体动作的源：内容得是已落资产库的媒体 */
function selectedMediaSource() {
  const from = selected.value
  if (!from || !isContentNode(from) || (from.data.kind !== 'video' && from.data.kind !== 'audio'))
    return null
  const src = String(from.data.content || '').trim()
  if (!src || !isMediaUrl(src)) {
    notify(t('请先生成或添加一段视频或音频'), 'error')
    return null
  }
  const source = mediaSourceOf(from)
  if (!source)
    return null
  return { from, source, src }
}

/**
 * 语音转字幕（API.md 35.2）：模型动作 transcribe，派生一个文本节点承接 SRT。
 * 先弹小窗选语种 / 区分说话人并显示预估积分（弹窗里已经给了花费，不再走二次确认）。
 */
const transcribeDialog = reactive({ open: false, sourceId: '', sourceLabel: '', duration: 0 })
const transcribeModels = computed(() => (mediaActions.value.find(item => item.action === 'transcribe')?.models || []).map(String))

function transcribeEstimate(model: string) {
  const duration = transcribeDialog.duration
  return estimateSpend(model || transcribeModels.value[0] || '', duration > 0 ? { duration: Math.ceil(duration) } : {})
}

async function onTranscribe() {
  if (!ensureMediaAction('transcribe'))
    return
  const picked = selectedMediaSource()
  if (!picked)
    return
  const { from, src } = picked
  // 弹窗先开，时长读到后再补上预估积分
  Object.assign(transcribeDialog, {
    open: true,
    sourceId: from.id,
    sourceLabel: from.data.label || t(from.data.kind === 'audio' ? '音频' : '视频'),
    duration: 0,
  })
  const duration = await probeMediaDuration(src)
  if (transcribeDialog.sourceId === from.id)
    transcribeDialog.duration = duration
}

async function onTranscribeConfirm(opts: { language: string, diarize: boolean, model: string }) {
  transcribeDialog.open = false
  const from = findNode(transcribeDialog.sourceId) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from))
    return
  const source = mediaSourceOf(from)
  if (!source)
    return
  const textNode = spawnDerivedText(from, '字幕') as CanvasFlowNode & { data: CanvasNodeData }
  updateNodeData(textNode.id, { label: `${transcribeDialog.sourceLabel}_${t('字幕')}` })
  const params: Record<string, unknown> = { language: opts.language }
  if (opts.diarize)
    params.diarize = true
  await submitMediaJob(textNode, 'transcribe', source, params, { label: '语音转字幕', model: opts.model, dropOnFail: [textNode.id] })
}

/** 去停顿（API.md 35.3）：本地免费动作 remove_silence，派生一个同类节点承接产物 */
async function onRemoveSilence() {
  if (!ensureMediaAction('remove_silence'))
    return
  const picked = selectedMediaSource()
  if (!picked)
    return
  const { from, source } = picked
  const kind = from.data.kind === 'audio' ? 'audio' : 'video'
  const sourceLabel = from.data.label || t(kind === 'audio' ? '音频' : '视频')
  const sibling = spawnMediaNode(from, kind, '去停顿', `${sourceLabel}_${t('去停顿')}`, {
    data: { prompt: String(from.data.prompt || '') },
    select: true,
  })
  await submitMediaJob(sibling, 'remove_silence', source, {}, { label: '去停顿', dropOnFail: [sibling.id] })
}

function readNodeVideoTime(nodeId: string) {
  const el = document.querySelector(`.vue-flow__node[data-id="${nodeId}"] video`) as HTMLVideoElement | null
  if (!el || !Number.isFinite(el.currentTime))
    return 0
  return Math.max(0, el.currentTime)
}

async function onCaptureVideoFrame(kind: 'current' | 'first' | 'last') {
  const from = selected.value
  if (!from || !isContentNode(from) || from.data.kind !== 'video')
    return
  const raw = from.data.content?.trim() || ''
  if (!raw || !isMediaUrl(raw)) {
    notify(t('请先生成或添加一段视频'), 'error')
    return
  }
  const src = resolveMediaUrl(raw)
  let time = 0
  if (kind === 'current')
    time = readNodeVideoTime(from.id)
  else if (kind === 'last')
    time = Number.POSITIVE_INFINITY

  notify(t('正在截取画面，请稍候...'))
  try {
    const frame = await captureVideoFrame(src, time)
    const file = new File([frame.blob], `frame-${kind}.jpg`, { type: 'image/jpeg' })
    const res = await assetApi.upload(file)
    if (!res?.success || !res.data) {
      notify(res?.message || t('截取失败'), 'error')
      return
    }
    const tag = kind === 'current' ? '截图' : kind === 'first' ? '首帧' : '尾帧'
    const label = kind === 'current'
      ? `${t('截图')} ${formatFrameClock(frame.time)}`
      : t(tag)
    const size = nodeSize(from)
    const next = canvasFitMediaSize(res.data.width || frame.width, res.data.height || frame.height)
    const gap = 80
    const y = kind === 'current'
      ? from.position.y - next.h - 48
      : kind === 'first'
        ? from.position.y
        : from.position.y + size.h + 48
    counts.image += 1
    const id = `image-${counts.image}`
    const sibling: CanvasFlowNode = {
      id,
      type: 'easytv',
      position: { x: from.position.x + size.w + gap, y },
      width: next.w,
      height: next.h,
      style: {
        width: `${next.w}px`,
        height: `${next.h}px`,
      },
      data: {
        kind: 'image',
        label,
        tag,
        content: res.data.url,
        assetId: res.data.id,
        prompt: '',
        mode: 'idle',
      },
    }
    if (from.parentNode) {
      sibling.parentNode = from.parentNode
      sibling.extent = 'parent'
      sibling.expandParent = true
    }
    for (const node of nodes.value)
      node.selected = false
    sibling.selected = true
    addNodes(sibling)
    addEdges({
      id: `e-${from.id}-${id}-${Date.now()}`,
      source: from.id,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in',
      ...defaultEdgeOptions,
    })
    pushHistory()
    notify(t('已截取画面'))
    nextTick(() => {
      const created = findNode(id)
      if (created)
        addSelectedNodes([created])
    })
  }
  catch {
    // OSS 没对本地开 CORS 时前端截不到帧：回退到服务端 extract_frame
    await captureFrameViaMedia(from, kind, time)
  }
}

/** 取帧的服务端兜底：媒体作业 extract_frame，at = first / last / 秒数 */
async function captureFrameViaMedia(from: CanvasFlowNode & { data: CanvasNodeData }, kind: 'current' | 'first' | 'last', time: number) {
  const state = mediaActionState(mediaActions.value, 'extract_frame')
  if (!state.available) {
    notify(t('截取失败，视频可能无法跨域读取'), 'error')
    return
  }
  const source = mediaSourceOf(from)
  if (!source)
    return
  const at = kind === 'first' ? 'first' : kind === 'last' ? 'last' : Math.round(Math.max(0, time) * 100) / 100
  const tag = kind === 'current' ? '截图' : kind === 'first' ? '首帧' : '尾帧'
  const label = kind === 'current' ? `${t('截图')} ${formatFrameClock(Math.max(0, time))}` : t(tag)
  const size = nodeSize(from)
  const sibling = spawnMediaNode(from, 'image', tag, label, {
    place: kind === 'current' ? 'up' : kind === 'first' ? 'right' : 'down',
    w: 320,
    h: Math.max(120, Math.min(640, Math.round(320 * size.h / Math.max(1, size.w)))),
    select: true,
  })
  await submitMediaJob(sibling, 'extract_frame', source, { at }, { label: '取帧', dropOnFail: [sibling.id] })
}

function openOutpaintEditor() {
  const node = selected.value
  const src = currentImageSrc(node)
  if (!node || !isContentNode(node) || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  if (outpaintOpen.value && outpaintNodeId.value === node.id) {
    outpaintOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'flip', 'mark'])
  outpaintNodeId.value = node.id
  editSrc.value = src
  outpaintOpen.value = true
}

async function onOutpaintSubmit(payload: { model: string, ratio: string }) {
  const from = selected.value
  if (!from || !isContentNode(from) || nodeFrozen(from) || outpaintBusy.value)
    return
  if (!currentImageSrc(from)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickImageEditModel(models, payload.model || defaultImageModel(), false)
  if (!model) {
    notify(t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return
  }
  outpaintBusy.value = true
  try {
    const assetId = await ensureNodeImageAsset(from)
    if (!assetId) {
      notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
      return
    }
    const prompt = outpaintPrompt(payload.ratio)
    const sibling = spawnDerivedImage(from, 'AI图像扩展', prompt)
    const [aw, ah] = payload.ratio.split(':').map(Number)
    if (aw && ah)
      applyMediaNodeSize(sibling.id, aw, ah)
    const ok = await submitDerivedTask(sibling, 'AI图像扩展', {
      type: 'image',
      model,
      prompt,
      params: { edit: 'outpaint', mode: 'i2i', ratio: payload.ratio },
      inputs: [{ asset_id: assetId, role: 'image' }],
    })
    if (ok)
      outpaintOpen.value = false
  }
  finally {
    outpaintBusy.value = false
  }
}

function openFlipEditor() {
  const node = selected.value
  const src = currentImageSrc(node)
  if (!node || !isContentNode(node) || !src) {
    notify(t('请先生成或添加一张图片'), 'error')
    return
  }
  if (nodeFrozen(node))
    return
  if (flipOpen.value && flipNodeId.value === node.id) {
    flipOpen.value = false
    return
  }
  closeOverlays(['smartEdit', 'depth', 'light', 'angle', 'crop', 'outpaint', 'mark'])
  flipNodeId.value = node.id
  editSrc.value = src
  flipOpen.value = true
}

async function applyLocalImage(blob: Blob, name: string) {
  const node = selected.value
  if (!node || !isContentNode(node))
    return
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' })
  const res = await assetApi.upload(file)
  if (!res?.success || !res.data) {
    notify(res?.message || t('处理失败'), 'error')
    return
  }
  applyMediaNodeSize(node.id, res.data.width, res.data.height)
  updateNodeData(node.id, { content: res.data.url, assetId: res.data.id })
  pushHistory()
  notify(t('已更新图片'))
}

/**
 * 等一个文本任务跑完，拿 result_text；超时或失败抛错。每 2 秒问一次，最多 60 次。
 * alive 判定这次等待是否还有效（默认绑提示词优化的 optimizeSeq），被新一轮取代就抛 cancelled
 */
async function waitTextTask(taskId: number, seq: number, alive: () => boolean = () => seq === optimizeSeq) {
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (!alive())
      throw new Error('cancelled')
    const res = await taskApi.get(taskId)
    const task = res?.data
    if (!res?.success || !task)
      continue
    if (task.status === 'succeeded')
      return String(task.result_text || '')
    if (task.status === 'failed' || task.status === 'cancelled')
      throw new Error(task.error_msg || t('改写失败'))
  }
  throw new Error(t('改写超时，请稍后再试'))
}

/**
 * 提示词优化（L15）：把当前节点的提示词交给文本模型改写成结构化版本，弹对照由用户决定填回。
 * 模型选型与反推提示词同一套（growth.vision_text_model → 已定价看图模型）；走普通文本任务计费。
 */
async function runPromptOptimize() {
  // 跟练期间画布只读：这条是真提交（taskApi.create），回放拦不到它，先退出跟练
  if (opts.blocked?.()) {
    notify(t('跟练中不能派生：先退出跟练'), 'error')
    return
  }
  const node = selected.value
  if (!node || !isContentNode(node) || nodeFrozen(node) || optimizeBusy.value)
    return
  const current = expandPromptTokens(String(node.data.prompt || ''), node.data.markElements).trim()
  if (!canOptimizePrompt(current)) {
    notify(current ? t('提示词太长了，先精简到 2000 字以内') : t('先写一句想要的画面，再让 AI 帮你补全'), 'error')
    return
  }
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const model = pickVisionTextModel(models, growthConfig.value?.vision_text_model)
  if (!model) {
    notify(t('暂无可用的文本模型，请联系运营开通'), 'error')
    return
  }
  const points = estimateSpend(model, {})
  if (!await gateSpend(points))
    return
  const kind = node.data.kind === 'video' || node.data.kind === 'director' ? 'video' : 'image'
  const seq = ++optimizeSeq
  optimizeNodeId.value = node.id
  optimizeOriginal.value = current
  optimizeResult.value = ''
  optimizeError.value = ''
  optimizeModel.value = model
  optimizePoints.value = points
  optimizeBusy.value = true
  optimizeOpen.value = true
  try {
    const res = await taskApi.create({
      type: 'text',
      model,
      prompt: promptOptimizeInstruction(kind, current, locale.value),
      params: { optimize: kind },
      canvas_id: canvasId() || undefined,
    })
    if (!res?.success || !res.data)
      throw new Error(res?.message || t('提交失败'))
    void refreshWallet()
    const text = res.data.status === 'succeeded' ? String(res.data.result_text || '') : await waitTextTask(res.data.id, seq)
    if (seq !== optimizeSeq)
      return
    const cleaned = cleanOptimizedPrompt(text)
    if (!cleaned)
      throw new Error(t('模型没有返回内容'))
    optimizeResult.value = cleaned
  }
  catch (error) {
    if (seq !== optimizeSeq)
      return
    const message = error instanceof Error ? error.message : String(error)
    if (message !== 'cancelled')
      optimizeError.value = message
  }
  finally {
    if (seq === optimizeSeq)
      optimizeBusy.value = false
  }
}

function closeOptimize() {
  optimizeSeq++
  optimizeOpen.value = false
  optimizeBusy.value = false
}

function onOptimizeApply(mode: OptimizeApplyMode) {
  const node = findNode(optimizeNodeId.value) as CanvasFlowNode | undefined
  const result = optimizeResult.value
  closeOptimize()
  if (!node || !isContentNode(node) || !result)
    return
  updateNodeData(node.id, { prompt: applyOptimizedPrompt(mode, String(node.data.prompt || ''), result) })
  pushHistory()
  notify(mode === 'replace' ? t('已替换为优化后的提示词') : t('已追加优化后的提示词'))
}

/**
 * 分镜组拼接确认：结果节点落在选区右侧，作业交给本地 ffmpeg（免费）。
 * asset_ids 已按阅读顺序排好，请求的 asset_id 取第一张（后端要求它在列表里）。
 */
async function onMontageConfirm(opts: MontageOptions) {
  const ordered = montageSources.value
  montageOpen.value = false
  if (ordered.length < 2)
    return
  if (ordered.some(item => nodeFrozen(findNode(item.id))))
    return
  const first = findNode(ordered[0]!.id) as CanvasFlowNode | undefined
  if (!first || !isContentNode(first))
    return
  const right = Math.max(...ordered.map(item => item.x + item.w))
  const top = Math.min(...ordered.map(item => item.y))
  const size = montageNodeSize(ordered.length, opts, ordered[0])
  const sibling = spawnMediaNode(first, 'image', t('分镜组'), t('分镜组 {n} 张', { n: ordered.length }), {
    at: { x: right + 80, y: top },
    w: size.w,
    h: size.h,
    data: { prompt: '' },
  })
  await submitMediaJob(sibling, 'montage', { asset_id: ordered[0]!.assetId }, montageParams(ordered, opts), {
    label: '分镜组拼接',
    dropOnFail: [sibling.id],
  })
  // 源节点按阅读顺序收进一个分镜组（可改列数 / 转普通组）；已经在别的组里的不动，避免重挂父节点
  groupStoryboard(ordered.map(item => item.id), opts.cols)
}

/**
 * 把一串图片节点（已按阅读顺序）打成分镜组：grid 排版按 cols 铺开。
 * 任一节点已经在组里就跳过（不重挂父节点），返回 false。
 */
function groupStoryboard(ids: string[], cols?: number) {
  const picked = ids
    .map(id => findNode(id) as CanvasFlowNode | undefined)
    .filter((node): node is CanvasFlowNode => Boolean(node))
  if (picked.length < 2 || picked.some(node => node.parentNode || nodeFrozen(node)))
    return false
  const box = nodesBounds(picked, nodes.value)
  if (!box)
    return false
  const pad = 28
  groupCount.value += 1
  const id = `group-${groupCount.value}`
  const group: CanvasFlowNode = {
    id,
    type: 'group',
    position: { x: box.x - pad, y: box.y - pad },
    data: {
      kind: 'group',
      label: t('分镜组'),
      color: defaultGroupColor(),
      layout: 'grid',
      storyboard: { cols: storyboardCols(picked.length, cols) },
    },
    selectable: true,
    draggable: true,
    zIndex: 0,
    width: box.w + pad * 2,
    height: box.h + pad * 2,
    style: { width: `${box.w + pad * 2}px`, height: `${box.h + pad * 2}px` },
  }
  addNodes(group)
  nextTick(() => {
    const created = findNode(id) as CanvasFlowNode | undefined
    if (!created || !isGroupNode(created))
      return
    for (const node of picked) {
      node.parentNode = id
      node.extent = 'parent'
      node.expandParent = true
      node.selected = false
    }
    relabelGroups()
    // 先让 vue-flow 把 parentNode 变更消化掉（这一拍里它还会按旧的绝对坐标处理子节点），下一拍再按列数排
    nextTick(() => {
      const kids = nodes.value.filter(node => node.parentNode === id)
      layoutGroupChildren(created, kids, 'grid')
      pushHistory()
    })
  })
  return true
}

/** 分镜组工具条：改列数（夹到 1..n）后立刻按阅读顺序重排 */
function onStoryboardCols(cols: number) {
  const group = selectedGroup.value
  if (!group || !isGroupNode(group) || !group.data.storyboard || nodeFrozen(group))
    return
  const kids = nodes.value.filter(node => node.parentNode === group.id)
  const next = storyboardCols(Math.max(1, kids.length), cols)
  if (next === group.data.storyboard.cols)
    return
  group.data.storyboard = { cols: next }
  group.data.layout = 'grid'
  if (!group.data.collapsed)
    layoutGroupChildren(group, kids, 'grid', next)
  pushHistory()
}

/** 分镜组转普通组：只摘掉 storyboard 标记，排版仍是 grid、名字不动 */
function onStoryboardOff() {
  const group = selectedGroup.value
  if (!group || !isGroupNode(group) || !group.data.storyboard || nodeFrozen(group))
    return
  delete group.data.storyboard
  pushHistory()
}

function onGridSplit() {
  const node = selected.value
  if (!node || !isContentNode(node) || node.data.kind !== 'image' || nodeFrozen(node))
    return
  if (!nodeImageUrl(node)) {
    notify(t('这个节点还没有图片'), 'error')
    return
  }
  gridSplitNodeId.value = node.id
  gridSplitOpen.value = true
}

/**
 * 宫格切分确认：一次 grid_split 作业出 N 片（本地 ffmpeg，免费）。
 * 首版在浏览器里裁，实测 OSS 图片没有 CORS 头读不到像素；拆成 N 个 crop 作业又会撞单用户 3 个的排队上限。
 * 作业挂在第一片的位置上，产物回来后第一片落在它身上、其余按原行列摆开，一起打成一组。
 */
async function onGridSplitConfirm(cells: GridCell[]) {
  const node = findNode(gridSplitNodeId.value) as CanvasFlowNode | undefined
  gridSplitOpen.value = false
  if (!node || !isContentNode(node) || !cells.length)
    return
  if (!ensureMediaAction('grid_split'))
    return
  const assetId = Number(node.data.assetId)
  if (!(assetId > 0)) {
    notify(t('请先把图片保存到资产库'), 'error')
    return
  }
  const box = nodeSize(node)
  const source = { x: node.position.x, y: node.position.y, w: box.w, h: box.h }
  const label = node.data.label || t('图片')
  const first = cellNodeLayout(cells[0]!, source)
  const holder = spawnMediaNode(node, 'image', t('宫格切分'), `${label}_1`, {
    at: { x: first.x, y: first.y },
    w: first.w,
    h: first.h,
    // 切片沿用源图提示词（产物回来后其余切片也从这里抄）
    data: { prompt: String(node.data.prompt || ''), gridSplit: { source, cells: cells.map(cell => ({ ...cell })) } },
  })
  await submitMediaJob(holder, 'grid_split', { asset_id: assetId }, {
    cells: cells.map(cell => ({ x: cell.x, y: cell.y, w: cell.w, h: cell.h })),
  }, { label: '宫格切分', dropOnFail: [holder.id] })
}

async function onCropConfirm(box: {
  x: number
  y: number
  w: number
  h: number
  rect?: { x: number, y: number, w: number, h: number }
}) {
  if (nodeFrozen(findNode(cropNodeId.value)))
    return
  const isVideo = cropVariant.value === 'video'
  const nodeId = cropNodeId.value
  cropOpen.value = false
  if (isVideo) {
    spawnVideoCropNode(box)
    return
  }
  await submitImageCrop(nodeId, box)
}

/**
 * 图片裁剪走服务端 crop 作业。OSS 图没有跨域头，浏览器 canvas 读不到像素。
 * 原图留着，裁切结果落到下方新节点。
 */
async function submitImageCrop(nodeId: string, box: {
  x: number
  y: number
  w: number
  h: number
  rect?: { x: number, y: number, w: number, h: number }
}) {
  const from = findNode(nodeId) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from) || from.data.kind !== 'image')
    return
  if (!ensureMediaAction('crop'))
    return
  const assetId = Number(from.data.assetId || from.data.refAssetId || 0)
  const source = assetId > 0 ? { asset_id: assetId } : mediaSourceRef(from.data)
  if (!source) {
    notify(t('请先把图片保存到资产库'), 'error')
    return
  }
  const rect = box.rect
  if (!rect || !(rect.w > 0) || !(rect.h > 0))
    return
  const index = canvasKindIndex(nodes.value, from.id, 'image')
  const sourceLabel = from.data.label || canvasNodeTitle('image', index, t)
  const next = canvasFitMediaSize(Math.max(8, box.w), Math.max(8, box.h))
  const sibling = spawnMediaNode(from, 'image', '裁剪', `${sourceLabel}_${t('裁剪')}`, {
    place: 'down',
    w: next.w,
    h: next.h,
    select: true,
    data: {
      prompt: String(from.data.prompt || ''),
      cropRect: {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        width: Math.max(8, Math.round(box.w)),
        height: Math.max(8, Math.round(box.h)),
        sourceLabel,
      },
    },
  })
  await submitMediaJob(sibling, 'crop', source, {
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
  }, { label: '画面裁切', dropOnFail: [sibling.id] })
}

function spawnVideoCropNode(box: {
  x: number
  y: number
  w: number
  h: number
  rect?: { x: number, y: number, w: number, h: number }
}) {
  const from = findNode(cropNodeId.value) as CanvasFlowNode | undefined
  if (!from || !isContentNode(from) || from.data.kind !== 'video')
    return
  const src = from.data.content?.trim() || ''
  if (!src)
    return
  notify(t('正在裁剪视频，请稍候...'))
  const index = canvasKindIndex(nodes.value, from.id, 'video')
  const sourceLabel = from.data.label || canvasNodeTitle('video', index, t)
  const size = nodeSize(from)
  const cropW = Math.max(8, Math.round(box.w))
  const cropH = Math.max(8, Math.round(box.h))
  const next = canvasFitMediaSize(cropW, cropH)
  const rect = box.rect || {
    x: size.w ? box.x / size.w : 0,
    y: size.h ? box.y / size.h : 0,
    w: size.w ? box.w / size.w : 1,
    h: size.h ? box.h / size.h : 1,
  }
  counts.video += 1
  const id = `video-${counts.video}`
  const sibling: CanvasFlowNode = {
    id,
    type: 'easytv',
    position: { x: from.position.x, y: from.position.y + size.h + 80 },
    width: next.w,
    height: next.h,
    style: {
      ...(typeof from.style === 'object' && from.style ? from.style : {}),
      width: `${next.w}px`,
      height: `${next.h}px`,
    },
    data: {
      kind: 'video',
      label: `${sourceLabel}_${t('裁剪')}`,
      tag: '裁剪',
      content: src,
      assetId: from.data.assetId,
      prompt: String(from.data.prompt || ''),
      mode: 'idle',
      cropRect: {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        width: cropW,
        height: cropH,
        sourceLabel,
      },
    },
  }
  if (from.parentNode) {
    sibling.parentNode = from.parentNode
    sibling.extent = 'parent'
    sibling.expandParent = true
  }
  for (const node of nodes.value)
    node.selected = false
  sibling.selected = true
  addNodes(sibling)
  addEdges({
    id: `e-${from.id}-${id}-${Date.now()}`,
    source: from.id,
    target: id,
    sourceHandle: 'out',
    targetHandle: 'in',
    ...defaultEdgeOptions,
  })
  pushHistory()
  nextTick(() => {
    const created = findNode(id)
    if (created)
      addSelectedNodes([created])
  })
}

async function onFlipSave(blob: Blob) {
  if (nodeFrozen(findNode(flipNodeId.value)))
    return
  flipOpen.value = false
  try {
    await applyLocalImage(blob, 'flip.jpg')
  }
  catch {
    notify(t('处理失败，图片可能无法跨域读取'), 'error')
  }
}

async function ensureNodeImageAsset(node: CanvasFlowNode & { data: import('~/utils/canvas-node-kinds').CanvasNodeData }) {
  if (node.data.assetId)
    return node.data.assetId
  if (node.data.refAssetId)
    return node.data.refAssetId
  const src = currentImageSrc(node)
  if (!src)
    return 0
  try {
    const blob = await fetch(src).then(r => r.blob())
    const file = new File([blob], 'source.jpg', { type: blob.type || 'image/jpeg' })
    const res = await assetApi.upload(file)
    if (res?.success && res.data) {
      updateNodeData(node.id, { assetId: res.data.id })
      return res.data.id
    }
  }
  catch {
    // 跨域失败时仍用提示词 + 已有参考提交
  }
  return 0
}

async function runImageEdit(
  action: import('~/utils/canvas-image-edit').ImageEditAction,
  promptOverride?: string,
  preferredModel?: string,
  target?: CanvasFlowNode,
  extra?: { maskAssetId?: number | null, extraImageIds?: number[], scale?: number },
) {
  // 跟练期间画布只读：这条是真提交（taskApi.create），回放拦不到它，先退出跟练
  if (opts.blocked?.()) {
    notify(t('跟练中不能派生：先退出跟练'), 'error')
    return false
  }
  const node = target ?? selected.value
  if (!node || !isContentNode(node) || nodeFrozen(node))
    return false
  if (!currentImageSrc(node)) {
    notify(t('请先生成或添加一张图片'), 'error')
    return false
  }
  if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running') {
    notify(t('该节点正在生成中'))
    return false
  }
  // 编辑要把原图（和蒙版）真正交给模型：只有支持参考图的模型能做，带蒙版只有 edits 方式的模型能做
  const maskId = extra && 'maskAssetId' in extra ? extra.maskAssetId : node.data.markAssetId
  const needMask = Boolean(maskId)
  const models = useState<import('~/types/creative').GenerationModel[]>('generation-models', () => []).value
  const editModel = pickImageEditModel(models, preferredModel || defaultImageModel(), needMask)
  if (!editModel) {
    notify(needMask ? t('暂无支持局部修改的图片模型，请联系运营开通 gpt-image 系模型') : t('暂无支持图片编辑的模型，请联系运营开通'), 'error')
    return false
  }
  const assetId = await ensureNodeImageAsset(node)
  if (!assetId) {
    notify(t('原图无法读取，请先把图片上传到资产库再编辑'), 'error')
    return false
  }
  const inputs: TaskInput[] = [{ asset_id: assetId, role: 'image' }]
  const seen = new Set<number>([assetId])
  if (maskId)
    inputs.push({ asset_id: maskId, role: 'mask' })
  for (const id of extra?.extraImageIds || []) {
    if (!id || seen.has(id))
      continue
    seen.add(id)
    inputs.push({ asset_id: id, role: 'image' })
  }
  const prompt = expandPromptTokens((promptOverride || node.data.prompt || IMAGE_EDIT_PROMPTS[action]).trim(), node.data.markElements)
  if (!await gateSpend(estimateSpend(editModel, { edit: action, mode: 'i2i', ...(extra?.scale ? { scale: extra.scale } : {}) })))
    return false
  const res = await taskApi.create({
    type: 'image',
    model: editModel,
    prompt,
    params: {
      edit: action,
      mode: 'i2i',
      ...(extra?.scale ? { scale: extra.scale } : {}),
    },
    inputs,
    canvas_id: canvasId() || undefined,
    node_id: node.id,
  })
  if (!res?.success || !res.data) {
    notify(res?.message || t('提交失败'), 'error')
    return false
  }
  applyTaskToNode(node.id, res.data)
  pushHistory()
  void refreshWallet()
  if (res.data.status === 'pending' || res.data.status === 'running') {
    notify(t('已提交编辑任务'))
    pollTask(node.id, res.data.id)
  }
  else if (res.data.status === 'failed') {
    notify(res.data.error_msg || t('生成失败'), 'error')
  }
  return res.data
}


  return {
    currentImageSrc,
    imageEditModel,
    lightModel: imageEditModel,
    defaultImageModel,
    openSmartEdit,
    openDepthBar,
    runPromptReverse,
    openLightPanel,
    onLightSubmit,
    runUpscale,
    runRemoveBg,
    runThreeView,
    openAnglePanel,
    onAngleSubmit,
    onDepthSubmit,
    depthExtractModels,
    onSmartEditCite,
    onSmartEditSubmit,
    openCropEditor,
    openFrameCropEditor,
    openEraseBar,
    openMattingBar,
    onMattingSubmit,
    viralPlan,
    viralDurationReady,
    viralAnalyzePoints,
    viralGeneratePoints,
    openViralBar,
    onViralSubmit,
    onViralReset,
    onViralPick,
    onViralClear,
    onViralExtra,
    onViralShot,
    onViralCommit,
    onEraseSubmit,
    onSeparateAv,
    transcribeDialog,
    transcribeModels,
    transcribeEstimate,
    onTranscribe,
    onTranscribeConfirm,
    onRemoveSilence,
    onCaptureVideoFrame,
    openOutpaintEditor,
    onOutpaintSubmit,
    openFlipEditor,
    waitTextTask,
    runPromptOptimize,
    closeOptimize,
    onOptimizeApply,
    onMontageConfirm,
    onStoryboardCols,
    onStoryboardOff,
    onGridSplit,
    onGridSplitConfirm,
    onCropConfirm,
    onFlipSave,
    ensureNodeImageAsset,
    runImageEdit,
  }
}
