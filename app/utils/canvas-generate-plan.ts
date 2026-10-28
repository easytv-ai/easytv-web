import { isContentNode, type CanvasFlowNode } from '~/utils/canvas-group'
import { buildCameraPrompt, normalizeCameraSetup } from '~/utils/canvas-camera'
import {
  appendFxPrompt,
  appendStylePrompt,
  cameraIdsInPrompt,
  cameraMoveLabel,
  expandCameraTokens,
  PANORAMA_SIZE,
} from '~/utils/canvas-node-kinds'
import { expandMarkTokens } from '~/utils/canvas-mark'
import { audioUsesVoice, buildAudioPrompt, parseAudioKind } from '~/utils/canvas-audio'
import type { GeneratePayload, GenerationModel, TaskInput, TaskType } from '~/types/creative'

/** 一次批量出图最多几张 */
export const CANVAS_MAX_BATCH = 4

export type CanvasGenerateNotice = {
  key: string
  params?: Record<string, unknown>
  track?: { event: string, props: Record<string, unknown> }
  /** 有这个字段时，调用方把模型记进「本会话已提醒」，避免同一模型反复弹失败率 */
  warnModel?: string
}

export type CanvasGeneratePlan = {
  ok: true
  type: TaskType
  model: string
  prompt: string
  params: Record<string, unknown>
  inputs: TaskInput[]
  subjectIds: number[]
  subjectVersions?: Record<string, number>
  lang?: string
  voice?: string
  wanted: number
  notices: CanvasGenerateNotice[]
  /** 图片比例，调用方用来改节点尺寸；全景图不返回 */
  ratio?: string
}

export type CanvasGenerateReject = {
  ok: false
  messageKey: string
}

/** 节点种类对应的任务类型。角色 / 场景 / 编辑 / 全景都出图，导演台出视频。 */
export function canvasGenerateTaskType(kind: string): TaskType | null {
  const type = (
    kind === 'director'
      ? 'video'
      : kind === 'character' || kind === 'scene' || kind === 'edit' || kind === 'panorama'
        ? 'image'
        : kind
  ) as TaskType
  if (!['text', 'image', 'video', 'audio'].includes(type))
    return null
  return type
}

/**
 * 生成能不能提交、请求体长什么样。
 * 不扣点、不调接口：跟练回放和重拍片段由调用方在进这里之前接住。
 */
export function planCanvasGenerate(input: {
  node: CanvasFlowNode | null | undefined
  payload?: GeneratePayload
  connectedText?: string
  plainText?: string
  inputs?: TaskInput[]
  unlinkedRefs?: number
  canvasId?: number
  translate?: (key: string) => string
  alreadyWarned?: boolean
  recentWarn?: Pick<GenerationModel, 'recent_warn' | 'recent_fail_rate'> | null
}): CanvasGeneratePlan | CanvasGenerateReject {
  const node = input.node
  if (!node || !isContentNode(node))
    return { ok: false, messageKey: '请先选择节点' }
  const kind = node.data.kind
  const type = canvasGenerateTaskType(kind)
  if (!type)
    return { ok: false, messageKey: '请先选择节点' }
  const payload = input.payload
  if (!payload?.model)
    return { ok: false, messageKey: '请在节点面板里选择模型后点击生成' }

  let prompt = (payload.prompt || node.data.prompt || '').trim()
  if (!prompt && (type === 'image' || type === 'video' || kind === 'director'))
    prompt = String(input.connectedText || '').trim()
  if (!prompt && type !== 'audio')
    return { ok: false, messageKey: '请先填写提示词' }
  if (type === 'text') {
    const existing = String(input.plainText || '')
    if (existing && existing !== prompt)
      prompt = `${prompt}\n\n【当前文本】\n${existing}`
  }
  if (node.data.taskStatus === 'pending' || node.data.taskStatus === 'running')
    return { ok: false, messageKey: '该节点正在生成中' }

  const params = { ...payload.params }
  const notices: CanvasGenerateNotice[] = []
  const unlinkedRefs = input.unlinkedRefs || 0
  if (unlinkedRefs) {
    notices.push({
      key: '有 {n} 个参考素材不在你的资产库里（常见于复制来的画布），本次生成不会使用，请重新上传或从资产库选入',
      params: { n: unlinkedRefs },
      track: {
        event: 'ref_missing',
        props: { source: 'canvas_unlinked', count: unlinkedRefs, canvas_id: input.canvasId || 0, type },
      },
    })
  }

  const camIds = cameraIdsInPrompt(prompt)
  if (camIds.length)
    prompt = expandCameraTokens(prompt)
  prompt = expandMarkTokens(prompt, node.data.markElements)
  const camId = camIds.at(-1) || node.data.cameraMove
  if (camId) {
    params.camera = camId
    if (!camIds.length) {
      const camText = input.translate?.(cameraMoveLabel(camId) || '') || ''
      if (camText && type === 'video' && !prompt.includes(camText))
        prompt = prompt ? `${prompt}\n\n${camText}` : camText
    }
  }
  if (node.data.fxPreset) {
    params.fx = node.data.fxPreset
    if (type === 'image' || type === 'video')
      prompt = appendFxPrompt(prompt, node.data.fxPreset)
  }
  if (node.data.stylePreset && (type === 'image' || type === 'video')) {
    prompt = appendStylePrompt(prompt, node.data.stylePreset)
    params.style_preset = node.data.stylePreset.id
  }
  const cameraPrompt = buildCameraPrompt(node.data.camera)
  if (cameraPrompt && (type === 'image' || type === 'video')) {
    prompt = `${prompt}\n\n${cameraPrompt}`
    params.camera_setup = normalizeCameraSetup(node.data.camera)
  }
  const audioKind = type === 'audio' ? parseAudioKind(params.audioKind ?? payload.params?.audioKind) : 'narration'
  if (type === 'audio') {
    prompt = buildAudioPrompt(audioKind, prompt, typeof params.mood === 'string' ? params.mood : '')
    if (!prompt)
      return { ok: false, messageKey: '请先填写提示词' }
    if (!audioUsesVoice(audioKind)) {
      delete params.lang
      delete params.voice
    }
  }

  const subjectIds = (payload.subject_ids ?? node.data.subjectIds ?? []).slice(0, 4)
  if (kind === 'panorama') {
    params.size = PANORAMA_SIZE
    delete params.ratio
  }
  const wanted = type === 'image' && kind !== 'panorama'
    ? Math.max(1, Math.min(CANVAS_MAX_BATCH, Number(params.count) || 1))
    : 1
  params.count = 1

  const info = input.recentWarn
  if (info?.recent_warn && payload.model && !input.alreadyWarned) {
    notices.push({
      key: '这个模型近 7 天失败率 {rate}%，可以换一个再试',
      params: { rate: Math.round(Number(info.recent_fail_rate) || 0) },
      warnModel: payload.model,
    })
  }

  const ratio = (type === 'image' || type === 'video') && kind !== 'panorama' && typeof params.ratio === 'string'
    ? params.ratio
    : undefined

  return {
    ok: true,
    type,
    model: payload.model,
    prompt,
    params,
    inputs: input.inputs || [],
    subjectIds,
    subjectVersions: payload.subject_versions ?? node.data.subjectVersions,
    lang: type === 'audio' && !audioUsesVoice(audioKind) ? undefined : payload.lang,
    voice: type === 'audio' && !audioUsesVoice(audioKind) ? undefined : payload.voice,
    wanted,
    notices,
    ratio,
  }
}
