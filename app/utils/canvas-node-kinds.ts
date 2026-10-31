import { PLACEHOLDER_VIDEO_URL } from './media'

export type CanvasNodeKind =
  | 'character'
  | 'scene'
  | 'director'
  | 'panorama'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'storyboard'
  | 'edit'

export type CanvasMenuKind = CanvasNodeKind | 'upload' | 'library'

export type CanvasNodeData = {
  kind: CanvasNodeKind
  label: string
  content: string
  prompt: string
  mode: 'idle' | 'write'
  /** 文本节点卡片背景色 */
  color?: string
  /** 文本节点字号 */
  fontSize?: number
  /** 节点内容对应的资产（上传/资产库选入或生成产物），作为下游任务的输入 */
  assetId?: number
  /** 参考素材（图生视频等），通过 Inspector「参考」设置 */
  refAssetId?: number
  refUrl?: string
  /** 手动添加的参考图列表；连线上游的图片不写在这里，从边推导 */
  refItems?: { assetId?: number, url: string, name?: string }[]
  /** 视频尾帧 */
  lastAssetId?: number
  lastUrl?: string
  /** 风格参考图 */
  styleAssetId?: number
  styleUrl?: string
  /** 局部修改蒙版 */
  markAssetId?: number
  markUrl?: string
  /** 元素标记（点选图片局部后的名称框），随画布保存 */
  markElements?: import('~/utils/canvas-mark').CanvasMarkElement[]
  /**
   * 该节点的模型（API.md 32：AI 建图 / 工作流模板 / 跟练备好写下来）。
   * Inspector 优先读它（大小写对不上会模糊匹配清单），其次才是
   * localStorage `easytv-canvas-last-model`；选中后会写回这里。
   * 注意别和 frameParams.model（拉片用的解读模型）混。
   */
  model?: string
  /** 该节点的参数默认值（ratio / clarity / quality / duration / resolution 等），Inspector 初始化时优先读它 */
  params?: Record<string, unknown>
  /** 分镜节点上的多条镜头提示词，拆开后各自成为一条视频 */
  storyboardShots?: import('~/utils/canvas-storyboard').StoryboardShot[]
  /** 宫格切分（L4）的作业壳：源节点的位置尺寸与每片的归一化矩形，产物回来按它摆到源节点右侧 */
  gridSplit?: {
    source: { x: number, y: number, w: number, h: number }
    cells: Array<{ index: number, row: number, col: number, x: number, y: number, w: number, h: number }>
  }
  /** 卡片左上角标签；有值时盖过默认的「图片2」这类编号 */
  tag?: string
  /** 音色 / 角色 / 场景参考 */
  voiceAssetId?: number
  voiceUrl?: string
  castAssetId?: number
  castUrl?: string
  setAssetId?: number
  setUrl?: string
  /** 引用的主体 id（API.md 10.2），最多 4 个，随画布保存 */
  subjectIds?: number[]
  /** 引用时锁定的主体版本 { 主体 id: 版本 }（API.md 14.2）；主体之后再改不影响这个节点，需要手动更新 */
  subjectVersions?: Record<string, number>
  /** 运镜预设（可多选）；cameraMove 为旧版单选，读取时兼容 */
  cameraMoves?: string[]
  cameraMove?: string
  fxPreset?: string
  /** 风格库预设（API.md 34）：生成时把 prompt 片段接到提示词末尾；negative 先存着不用 */
  stylePreset?: { id: number, name: string, prompt: string, negative?: string }
  /** 摄影配置（机身/镜头/焦段/光圈），开启后拼进提示词，见 canvas-camera.ts */
  camera?: import('~/utils/canvas-camera').CameraSetup
  /** 单独锁定：不能拖、不能删，随画布保存 */
  locked?: boolean
  /** 多段合成入点（秒），随节点记住，下次打开面板还在 */
  trimIn?: number
  /** 多段合成出点（秒），0 表示接到片尾 */
  trimOut?: number
  /** 视频节点的生成模式（全能参考 / 首尾帧 / 首帧 / 口播），随画布保存 */
  videoMode?: 'reference' | 'fl2v' | 'i2v' | 'talking'
  /** 爆款复刻节点的原片资产。再生成时从参考素材计数里排除它 */
  viralSourceAssetId?: number
  /** 爆款复刻拉片结果：分镜和可替换的角色 / 场景 / 元素。有它时悬浮条进入替换再生成，不再直接出片 */
  viralPlan?: import('~/utils/canvas-viral').ViralPlan | null
  /** 配乐节点生成完成后要混进的视频。混音作业提交成功后清掉 */
  bgmMix?: { videoNodeId: string, videoAssetId: number } | null
  /** 口播预设（API.md 24.9）：台词、语气、景别与手动时长 */
  talking?: import('~/utils/canvas-talking').TalkingData
  /** 3D 导演台节点的场景，随画布 graph 一起保存（机位截图和本地素材已摘掉，见 director/persist.ts） */
  scene?: import('~/utils/director/schema').DirectorProject
  /** 导演台卡片封面：离开时从 3D 视口拍一张缩略图，上传后只存 URL */
  previewUrl?: string
  /** 导演台预演帧：哪一镜、第几张、时间点；再导出时用来认出已有预演组 */
  previewFrame?: { shotIndex: number, index: number, time: number }
  /** 深度 / 白模控制图：没有独立通道时，预演视频会把它们按 reference 带上 */
  previewControl?: boolean
  /** 彩色预演视频：首尾帧 + 运镜提示词；同一镜的控制图按参考图提交 */
  previewSubmit?: 'first-last-prompt'
  /** 生成任务（POST /user/task）状态，随画布一起保存 */
  taskId?: number
  taskStatus?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | ''
  taskProgress?: number
  taskError?: string
  /** 新手跟练的成片卡：收尾步留在画布中央的那张（节点上带「跟练成片」角标，退出跟练随快照消失） */
  practiceShowcase?: boolean
  /** 视频高清节点参数（tag=高清 时使用）。interp / slowmo 只兼容旧画布，面板不再展示 */
  hdParams?: {
    model: string
    resolution: '1080P' | '2K' | '4K'
    interp: string
    slowmo: string
  }
  /** 片段重拍：选中的时间段，随画布保存 */
  retakeParams?: {
    sourceId: string
    sourceLabel: string
    start: number
    end: number
    total: number
    duration?: number
  }
  /** 逐帧拉片（媒体作业 storyboard）：抽帧数与是否生成解读，随画布保存 */
  frameParams?: {
    sourceId: string
    sourceLabel: string
    /** 抽帧数量，见 FRAME_PULL_COUNT_ITEMS */
    count?: number
    /** 抽帧后是否再建文本任务做画面解读 */
    analyze?: boolean
    /** 旧版字段（拆解维度 / 假模型标签），只为兼容旧画布保留 */
    dims?: Array<'shot' | 'motion' | 'music'>
    model?: string
  }
  /** 深度提取：结果视频节点，不连源节点 */
  depthParams?: {
    sourceId: string
    resolution: '480p' | '720p'
    model: string
  }
  /** 深度动作捕捉参数 */
  depthMotionParams?: {
    sourceId: string
    sourceLabel: string
    resolution: '480P' | '720P'
  }
  /** 画面裁切：在源视频上框选后生成的裁剪节点 */
  cropRect?: {
    x: number
    y: number
    w: number
    h: number
    width: number
    height: number
    sourceLabel?: string
  }
  /** 音视频分离出的无声视频 */
  silent?: boolean
  /** 媒体工具作业（API.md 23）：进行中的作业 id 与动作名，载入画布后据此恢复轮询 */
  mediaJobId?: number
  mediaAction?: string
  /** 一次出两份产物的作业（split_av）：第二份产物写到这个节点 */
  mediaLinkedId?: string
  /** 画布多段合成（compose）作业 id，载入画布后据此恢复轮询 */
  composeJobId?: number
  /** 语音转字幕（transcribe）产物的逐句时间轴（秒），随画布保存 */
  transcriptCues?: Array<{ start: number, end: number, text: string }>
  /**
   * 一稿多版矩阵（平台规格 × 多语言派生）的来源标记：派生节点带着它，便于分组 / 回滚
   * （回滚只收这批节点，用户自己放的照留）。见 utils/canvas-matrix.ts。
   */
  matrix?: {
    /** 一次派生的批次标记（同一批落图的节点共享），回滚按它认 */
    batchId: string
    sourceId: string
    sourceLabel: string
    /** 平台规格 id，见 MATRIX_PLATFORMS */
    platformId: string
    ratio: string
    /** 视频规格的分辨率；图片节点为空 */
    resolution: string
    /** 视频规格的时长（秒）；图片节点为 0 */
    durationSeconds: number
    /** 目标语种 code；没选多语言时不写 */
    lang?: string
  }
}

export const HD_DEFAULT_PARAMS: NonNullable<CanvasNodeData['hdParams']> = {
  /** 留空 = 后端按 upscale 能力位自动挑模型 */
  model: '',
  resolution: '1080P',
  interp: 'none',
  slowmo: '1x',
}

export const HD_RESOLUTION_ITEMS = ['1080P', '2K', '4K'] as const

export function isHdNode(data?: Pick<CanvasNodeData, 'tag' | 'hdParams'> | null) {
  return Boolean(data && (data.tag === '高清' || data.hdParams))
}

/**
 * 视频高清用的超分模型：面板选中的（且还在清单里）优先，否则取清单第一条。
 * 和提交时、以及后端「自动选择」同一份 models。
 */
export function pickHdUpscaleModel(params: { model?: string } | null | undefined, models: readonly string[]) {
  const picked = String(params?.model || '').trim()
  if (picked && models.includes(picked))
    return picked
  return String(models[0] || '')
}

export function isRetakeNode(data?: Pick<CanvasNodeData, 'tag' | 'retakeParams'> | null) {
  return Boolean(data && (data.tag === '片段重拍' || data.retakeParams))
}

export function isFramePullNode(data?: Pick<CanvasNodeData, 'tag' | 'frameParams'> | null) {
  return Boolean(data && (data.tag === '逐帧拉片' || data.frameParams))
}

export const FRAME_PULL_COUNT_ITEMS = [4, 6, 8, 12] as const

export const FRAME_PULL_DEFAULT_PARAMS: Required<Pick<NonNullable<CanvasNodeData['frameParams']>, 'count' | 'analyze'>> = {
  count: 6,
  analyze: true,
}

export const FRAME_PULL_STAGE_SIZE = { w: 280, h: 420, minW: 240, minH: 360 } as const

export function isDepthMotionNode(data?: Pick<CanvasNodeData, 'tag' | 'depthMotionParams'> | null) {
  return Boolean(data && (data.tag === '深度动作捕捉' || data.depthMotionParams))
}

export const DEPTH_MOTION_DEFAULT_PARAMS: Pick<NonNullable<CanvasNodeData['depthMotionParams']>, 'resolution'> = {
  resolution: '480P',
}

export const DEPTH_MOTION_RESOLUTION_ITEMS = ['480P', '720P'] as const

export function isCropNode(data?: Pick<CanvasNodeData, 'tag' | 'cropRect'> | null) {
  return Boolean(data && (data.tag === '裁剪' || data.cropRect))
}

export function isSilentNode(data?: Pick<CanvasNodeData, 'tag' | 'silent'> | null) {
  return Boolean(data && (data.tag === '无声' || data.silent))
}

export function isAudioTrackNode(data?: Pick<CanvasNodeData, 'tag'> | null) {
  return Boolean(data && (data.tag === '音轨' || data.tag === '人声' || data.tag === '背景音'))
}

export function isFrameCaptureNode(data?: Pick<CanvasNodeData, 'tag'> | null) {
  return Boolean(data && (data.tag === '截图' || data.tag === '首帧' || data.tag === '尾帧'))
}

export const RETAKE_SEGMENT_COUNT = 5

export function hdNodeTag(resolution?: string) {
  const res = resolution || HD_DEFAULT_PARAMS.resolution
  return `高清 (${res})`
}

/** 复制 / 粘贴 / 副本：带上参考图、主体、运镜等，清掉进行中的任务状态，避免两个节点抢同一个 taskId */
export function cloneContentNodeData(data: CanvasNodeData, extra?: Partial<CanvasNodeData>): CanvasNodeData {
  let scene = data.scene
  if (scene) {
    try {
      scene = JSON.parse(JSON.stringify(scene)) as CanvasNodeData['scene']
    }
    catch {
      scene = undefined
    }
  }
  return {
    ...data,
    refItems: data.refItems?.map(item => ({ ...item })),
    stylePreset: data.stylePreset ? { ...data.stylePreset } : undefined,
    subjectIds: data.subjectIds ? [...data.subjectIds] : undefined,
    subjectVersions: data.subjectVersions ? { ...data.subjectVersions } : undefined,
    cameraMoves: data.cameraMoves ? [...data.cameraMoves] : undefined,
    markElements: data.markElements?.map(item => ({ ...item, box: { ...item.box } })),
    camera: data.camera ? { ...data.camera } : undefined,
    talking: data.talking ? { ...data.talking } : undefined,
    storyboardShots: data.storyboardShots?.map(item => ({ ...item })),
    hdParams: data.hdParams ? { ...data.hdParams } : undefined,
    retakeParams: data.retakeParams ? { ...data.retakeParams } : undefined,
    frameParams: data.frameParams
      ? { ...data.frameParams, dims: data.frameParams.dims ? [...data.frameParams.dims] : undefined }
      : undefined,
    depthParams: data.depthParams ? { ...data.depthParams } : undefined,
    depthMotionParams: data.depthMotionParams ? { ...data.depthMotionParams } : undefined,
    cropRect: data.cropRect ? { ...data.cropRect } : undefined,
    silent: data.silent,
    scene,
    viralPlan: data.viralPlan ? JSON.parse(JSON.stringify(data.viralPlan)) as CanvasNodeData['viralPlan'] : data.viralPlan,
    bgmMix: undefined,
    taskId: undefined,
    taskStatus: '',
    taskProgress: 0,
    taskError: '',
    mediaJobId: undefined,
    mediaLinkedId: undefined,
    composeJobId: undefined,
    ...extra,
  }
}

/** 视频节点运镜库：选中后插到提示词光标处，没焦点则放文末。预览先用远程占位片。 */
export const CAMERA_MOVE_VIDEO = PLACEHOLDER_VIDEO_URL

/**
 * 有独立预览的运镜。本地片子已去掉，画面都走 CAMERA_MOVE_VIDEO。
 * 留在这张表里的运镜不再套 CSS 动作示意。
 */
const CAMERA_MOVE_OWN_VIDEO: Record<string, string> = {
  static: 'fixed.mp4',
}

export const CAMERA_MOVE_ITEMS = [
  { id: 'static', label: '固定镜头', prompt: '固定镜头，机位保持稳定' },
  { id: 'follow', label: '跟随拍摄', prompt: '跟随拍摄，镜头跟随主体移动' },
  { id: 'spiral-up', label: '盘旋抬升', prompt: '盘旋抬升，镜头环绕上升' },
  { id: 'spiral-down', label: '盘旋下降', prompt: '盘旋下降，镜头环绕下落' },
  { id: 'tilt-up', label: '镜头上摇', prompt: '镜头上摇' },
  { id: 'tilt-down', label: '镜头下摇', prompt: '镜头下摇' },
  { id: 'pan-left', label: '镜头左摇', prompt: '镜头左摇' },
  { id: 'pan-right', label: '镜头右摇', prompt: '镜头右摇' },
  { id: 'crane-up', label: '镜头抬升', prompt: '镜头抬升' },
  { id: 'crane-down', label: '镜头下降', prompt: '镜头下降' },
  { id: 'truck-left', label: '镜头左移', prompt: '镜头左移' },
  { id: 'truck-right', label: '镜头右移', prompt: '镜头右移' },
  { id: 'dolly-in', label: '镜头前推', prompt: '镜头前推' },
  { id: 'dolly-out', label: '镜头后移', prompt: '镜头后移' },
  { id: 'zoom-in', label: '变焦推进', prompt: '变焦推进' },
  { id: 'zoom-out', label: '变焦拉远', prompt: '变焦拉远' },
  { id: 'dolly-zoom', label: '柯克变焦', prompt: '柯克变焦，推进同时拉远焦距' },
  { id: 'orbit', label: '环绕拍摄', prompt: '环绕拍摄' },
  { id: 'roll', label: '滚筒旋转', prompt: '滚筒旋转' },
  { id: 'pov', label: '第一视角', prompt: '第一视角' },
  { id: 'drone', label: '无人机', prompt: '无人机航拍视角' },
  { id: 'aerial', label: '高空航拍', prompt: '高空航拍' },
  { id: 'handheld', label: '手持拍摄', prompt: '手持拍摄，轻微晃动' },
] as const

/**
 * 特效预设：后端不消费 params.fx（只在 assist 里剥掉），所以和运镜一样在前端展开成提示词文案随任务提交；
 * params.fx 照旧带上，方便统计与批量副本沿用。
 */
export const FX_PRESET_ITEMS = [
  { id: 'slowmo', label: '慢动作', prompt: '慢动作，动作放慢、细节清晰' },
  { id: 'flash', label: '闪白', prompt: '闪白转场，画面瞬间过曝后恢复' },
  { id: 'film', label: '胶片', prompt: '胶片质感，颗粒感、轻微褪色与暗角' },
  { id: 'rain', label: '雨雪', prompt: '雨雪天气效果，雨丝或雪花飘落' },
  { id: 'glow', label: '光斑', prompt: '光斑与柔光，逆光处有梦幻的散景光点' },
] as const

export function fxPresetLabel(id?: string) {
  const key = String(id || '').trim()
  return key ? FX_PRESET_ITEMS.find(item => item.id === key)?.label || '' : ''
}

/** 特效展开成提示词文案；未知 id 给空串（老数据里可能存着已下线的预设） */
export function fxPresetPrompt(id?: string) {
  const key = String(id || '').trim()
  return key ? FX_PRESET_ITEMS.find(item => item.id === key)?.prompt || '' : ''
}

/** 把特效文案接到提示词末尾；已经写了同样的话就不重复 */
export function appendFxPrompt(prompt: string, id?: string) {
  const text = fxPresetPrompt(id)
  const base = String(prompt || '')
  if (!text || base.includes(text))
    return base
  return base.trim() ? `${base.trimEnd()}\n\n${text}` : text
}

/** 风格负面词接到提示词里的前缀（给模型看，不是界面文案） */
export const STYLE_NEGATIVE_PREFIX = '不要：'

/** 把风格库片段接到提示词末尾；负面词一并接上。已经写了同样的话就不重复 */
export function appendStylePrompt(prompt: string, preset?: CanvasNodeData['stylePreset']) {
  const text = String(preset?.prompt || '').trim()
  const negative = String(preset?.negative || '').trim()
  let next = String(prompt || '')
  if (text && !next.includes(text))
    next = next.trim() ? `${next.trimEnd()}\n\n${text}` : text
  if (negative) {
    const line = `${STYLE_NEGATIVE_PREFIX}${negative}`
    if (!next.includes(line) && !next.includes(negative))
      next = next.trim() ? `${next.trimEnd()}\n\n${line}` : line
  }
  return next
}

const CAMERA_MOVE_ALIASES: Record<string, string> = {
  push: 'dolly-in',
  pull: 'dolly-out',
  'pan-l': 'truck-left',
  'pan-r': 'truck-right',
}

export function resolveCameraMoveId(id?: string) {
  const key = String(id || '').trim()
  if (!key)
    return ''
  return CAMERA_MOVE_ALIASES[key] || key
}

function knownCameraMoveId(id?: string) {
  const resolved = resolveCameraMoveId(id)
  if (!resolved || !CAMERA_MOVE_ITEMS.some(item => item.id === resolved))
    return ''
  return resolved
}

/** 这条运镜有自己的预览文件 */
export function cameraMoveHasOwnVideo(id?: string) {
  const resolved = knownCameraMoveId(id)
  return Boolean(resolved && CAMERA_MOVE_OWN_VIDEO[resolved])
}

/** 运镜预览地址。本地片子已去掉，一律用同一条远程视频占位。 */
export function cameraMoveVideoUrl(_id?: string) {
  return CAMERA_MOVE_VIDEO
}

/**
 * 没有独立片子时，运镜库用这个 id 做画面动作（推、摇、环绕）。
 * 有自己的预览、或根本不是运镜，返回空串。
 */
export function cameraMoveMotionPreview(id?: string) {
  const resolved = knownCameraMoveId(id)
  if (!resolved || cameraMoveHasOwnVideo(resolved))
    return ''
  return resolved
}

export function cameraMoveLabel(id?: string) {
  const resolved = resolveCameraMoveId(id)
  if (!resolved)
    return ''
  return CAMERA_MOVE_ITEMS.find(item => item.id === resolved)?.label || ''
}

export function normalizeCameraMoves(raw?: string[] | string | null) {
  const ids = Array.isArray(raw) ? raw : raw ? [raw] : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const resolved = resolveCameraMoveId(id)
    if (!resolved || seen.has(resolved) || !CAMERA_MOVE_ITEMS.some(item => item.id === resolved))
      continue
    seen.add(resolved)
    out.push(resolved)
  }
  return out
}

export function cameraMovesOf(data?: { cameraMoves?: string[], cameraMove?: string } | null) {
  if (!data)
    return []
  if (data.cameraMoves?.length)
    return normalizeCameraMoves(data.cameraMoves)
  return normalizeCameraMoves(data.cameraMove)
}

export function cameraMovesPrompt(ids: string[]) {
  return normalizeCameraMoves(ids)
    .map((id) => {
      const item = CAMERA_MOVE_ITEMS.find(row => row.id === id) as any
      return item?.prompt || item?.label || ''
    })
    .filter(Boolean)
    .join('，')
}

/** 提示词里的运镜标签，插在光标处；生成时再展开成文案 */
export const CAMERA_TOKEN_RE = /\{\{cam:([a-z0-9-]+)\}\}/g

export function cameraToken(id?: string) {
  const resolved = resolveCameraMoveId(id)
  return resolved ? `{{cam:${resolved}}}` : ''
}

export function cameraIdsInPrompt(prompt?: string) {
  const ids: string[] = []
  const re = new RegExp(CAMERA_TOKEN_RE.source, 'g')
  let match: RegExpExecArray | null
  const src = String(prompt || '')
  while ((match = re.exec(src))) {
    const id = resolveCameraMoveId(match[1])
    if (id && CAMERA_MOVE_ITEMS.some(item => item.id === id))
      ids.push(id)
  }
  return ids
}

export function hasCameraToken(prompt?: string) {
  return cameraIdsInPrompt(prompt).length > 0
}

export function insertCameraToken(prompt: string, id: string, index?: number | null) {
  const token = cameraToken(id)
  const src = String(prompt || '')
  if (!token)
    return { prompt: src, caret: index == null ? src.length : index }
  const at = index == null || index < 0 || index > src.length ? src.length : index
  return {
    prompt: src.slice(0, at) + token + src.slice(at),
    caret: at + token.length,
  }
}

export function stripCameraTokens(prompt?: string) {
  return String(prompt || '').replace(new RegExp(CAMERA_TOKEN_RE.source, 'g'), '')
}

export function expandCameraTokens(prompt?: string) {
  return String(prompt || '').replace(new RegExp(CAMERA_TOKEN_RE.source, 'g'), (_all, raw: string) => {
    const id = resolveCameraMoveId(raw)
    const item = CAMERA_MOVE_ITEMS.find(row => row.id === id) as any
    return item?.prompt || item?.label || ''
  })
}

export const CANVAS_NODE_ITEMS = [
  { kind: 'text', label: '文本', icon: 'i-lucide-file-text', badge: '' },
  { kind: 'image', label: '图片', icon: 'i-lucide-image', badge: '' },
  { kind: 'video', label: '视频', icon: 'i-lucide-play', badge: '' },
  { kind: 'audio', label: '音频', icon: 'i-lucide-music', badge: '' },
  { kind: 'storyboard', label: '分镜', icon: 'i-lucide-layout-list', badge: '' },
  { kind: 'director', label: '3D 导演台', icon: 'i-lucide-clapperboard', badge: 'New' },
  { kind: 'panorama', label: '全景图', icon: 'i-lucide-globe', badge: 'New' },
] as const

export const CANVAS_ASSET_ITEMS = [
  { kind: 'upload', label: '上传', icon: 'i-lucide-upload' },
  { kind: 'library', label: '从资产库选择', icon: 'i-lucide-folder-input' },
] as const

/** 空画布起步入口：点一下就落一个带好预设的节点 */
export const CANVAS_EMPTY_STARTS = [
  {
    id: 'script',
    kind: 'text' as const,
    label: '故事脚本',
    icon: 'i-lucide-scroll-text',
    tone: 'green',
    prompt: '写一个适合短视频的故事脚本，包含人物小传、核心冲突、三幕结构和每场的画面与台词提示。',
    hint: '写剧情与台词',
  },
  {
    id: 'view-char',
    kind: 'image' as const,
    label: '角色三视图',
    icon: 'i-lucide-user-round',
    tone: 'rose',
    prompt: '生成一张角色三视图设定图：同一画面从左到右排列全身正面、侧面、背面，同一角色、同一服装与比例，干净浅灰背景，不要场景和其他物体。',
    hint: '正面、侧面、背面',
  },
  {
    id: 'omni-video',
    kind: 'video' as const,
    label: '全能参考视频',
    icon: 'i-lucide-images',
    tone: 'blue',
    videoMode: 'reference' as const,
    hint: '图、视频或音频',
  },
  {
    id: 'talking',
    kind: 'video' as const,
    label: '口播视频',
    icon: 'i-lucide-audio-lines',
    tone: 'violet',
    videoMode: 'talking' as const,
    hint: '按台词对口型成片',
  },
  {
    id: 'bgm',
    kind: 'audio' as const,
    label: 'canvas.audio.kind.bgm',
    icon: 'i-lucide-music',
    tone: 'amber',
    prompt: '节奏感强的电子配乐，无人声，中等速度，适合产品展示和卡点转场',
    hint: 'canvas.audio.startHint',
    audioKind: 'bgm' as const,
  },
] as const

export type CanvasEmptyStart = (typeof CANVAS_EMPTY_STARTS)[number]

/**
 * 空画布技能起步卡：优先展示后台配置的 Skill（skillApi.list），接口失败或为空时
 * 回退到上面的固定预设。结构兼容对话栏的 ChatSkill，多带 prompt 供抽屉预填。
 */
export type CanvasStartSkill = {
  id: number
  title: string
  slug: string
  cover: string
  description: string
  prompt: string
  hasGuide: boolean
}

export const TEXT_TRY_ITEMS = [
  { key: 'write', label: '自己编写内容', icon: 'i-lucide-pen-line' },
] as const

export const IMAGE_TRY_ITEMS = [
  { key: 'i2i', label: '图生图', icon: 'i-lucide-upload' },
  { key: 'hd', label: '图片高清', icon: 'i-lucide-scan', badge: 'HD' },
] as const

export const CANVAS_STAGE_SIZE = {
  text: { w: 252, h: 220, minW: 160, minH: 140 },
  image: { w: 320, h: 220, minW: 220, minH: 160 },
  video: { w: 320, h: 220, minW: 220, minH: 160 },
  audio: { w: 280, h: 118, minW: 200, minH: 100 },
  storyboard: { w: 280, h: 280, minW: 220, minH: 200 },
  director: { w: 320, h: 220, minW: 220, minH: 160 },
  // 2:1 等距柱状，卡片按这个比例给，免得缩略图被裁得看不出是全景
  panorama: { w: 360, h: 220, minW: 240, minH: 160 },
} as const

/** 图片卡片宽随现有空节点，高允许拉长，竖图才能完整露出 */
export const CANVAS_MEDIA_MAX_W = 320
export const CANVAS_MEDIA_MAX_H = 640
export const CANVAS_MEDIA_MIN_SIDE = 160

/**
 * 按媒体像素等比算出画布卡片尺寸：先完整放进上限框，太扁/太瘦再抬最短边。
 * 图片和视频都用它改节点体积，避免固定 320×220 把画面裁掉。
 */
export function canvasFitMediaSize(width: number, height: number) {
  const fallback = CANVAS_STAGE_SIZE.image
  if (!width || !height || width < 0 || height < 0)
    return { w: fallback.w, h: fallback.h }
  let scale = Math.min(CANVAS_MEDIA_MAX_W / width, CANVAS_MEDIA_MAX_H / height)
  let w = width * scale
  let h = height * scale
  const short = Math.min(w, h)
  if (short > 0 && short < CANVAS_MEDIA_MIN_SIDE) {
    const up = CANVAS_MEDIA_MIN_SIDE / short
    w *= up
    h *= up
  }
  return {
    w: Math.max(1, Math.round(w)),
    h: Math.max(1, Math.round(h)),
  }
}

export function canvasMediaSizeClose(a: { w: number, h: number }, b: { w: number, h: number }) {
  return Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) < 2
}

export function canvasStageSize(kind: CanvasNodeKind) {
  if (kind in CANVAS_STAGE_SIZE)
    return CANVAS_STAGE_SIZE[kind as keyof typeof CANVAS_STAGE_SIZE]
  return null
}

export function canvasNodeIcon(kind: CanvasNodeKind) {
  return CANVAS_NODE_ITEMS.find(item => item.kind === kind)?.icon ?? 'i-lucide-box'
}

export function canvasNodeTitle(kind: CanvasNodeKind, index: number, tr: (key: string) => string = key => key) {
  const label = tr(CANVAS_NODE_ITEMS.find(item => item.kind === kind)?.label ?? '节点')
  if (kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'panorama')
    return `${label}${tr('节点')} ${index}`
  return `${label} ${index}`
}

/**
 * 全景图固定 2048×1024：等距柱状投影必须严格 2:1，
 * 后端 sizeFromRatio 把 2:1 映射成 1792x1024（1.75:1）会让画面变形，
 * 所以这里直接传 params.size，provider 优先用它。
 */
export const PANORAMA_SIZE = '2048x1024'
export const PANORAMA_RATIO = 2

/** 判断一张图是不是严格 2:1（允许 1% 误差，避免 2048x1025 这种被卡住） */
export function isPanoramaRatio(width: number, height: number) {
  if (!width || !height)
    return false
  return Math.abs(width / height - PANORAMA_RATIO) / PANORAMA_RATIO <= 0.01
}

/** 批注要能对上卡片：标题和卡片左上角同一套编号，摘要用节点正文方便认。 */
export function canvasCommentNodeHint(
  nodes: Array<{ id: string, position: { x: number, y: number }, data?: { kind?: string } | null }>,
  id: string,
  tr: (key: string) => string = key => key,
): { title: string, excerpt: string } | null {
  const node = nodes.find(item => item.id === id)
  const data = node?.data
  if (!node || !data?.kind)
    return null
  const content = data as Partial<CanvasNodeData>
  return {
    title: commentNodeTitle(nodes, node.id, content, tr),
    excerpt: commentNodeExcerpt(content),
  }
}

function commentNodeTitle(
  nodes: Array<{ id: string, position: { x: number, y: number }, data?: { kind?: string } | null }>,
  id: string,
  data: Partial<CanvasNodeData>,
  tr: (key: string) => string,
) {
  if (isHdNode(data))
    return hdNodeTag(data.hdParams?.resolution)
  if (isRetakeNode(data)) {
    const source = data.retakeParams?.sourceLabel
    return source ? `${source}-${tr('片段重拍')}` : tr('片段重拍')
  }
  if (isFramePullNode(data)) {
    const source = data.frameParams?.sourceLabel
    return source ? `${source}-${tr('逐帧拉片')}` : tr('逐帧拉片')
  }
  if (isDepthMotionNode(data)) {
    const source = data.depthMotionParams?.sourceLabel
    return source ? `${tr('深度动作捕捉')}-${source}` : tr('深度动作捕捉')
  }
  if (isCropNode(data)) {
    const source = data.cropRect?.sourceLabel
    return source ? `${source}_${tr('裁剪')}` : tr('裁剪')
  }
  if (isAudioTrackNode(data) || isSilentNode(data) || isFrameCaptureNode(data))
    return data.label || tr(data.tag || '节点')
  if (data.tag === '图片高清')
    return data.label || tr('图片高清')
  if (data.tag)
    return tr(data.tag)
  const label = CANVAS_NODE_ITEMS.find(item => item.kind === data.kind)?.label ?? ''
  if (!label)
    return tr('节点')
  const kind = data.kind || ''
  const index = kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio'
    ? canvasKindIndex(nodes, id, kind)
    : 0
  return index ? `${tr(label)}${index}` : tr(label)
}

function commentNodeExcerpt(data: Partial<CanvasNodeData>) {
  const raw = data.kind === 'text' ? (data.content || data.prompt || '') : (data.prompt || '')
  const text = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || /^(https?:|data:|blob:|\/)/i.test(text))
    return ''
  return text.length > 42 ? `${text.slice(0, 42)}…` : text
}

/** 同类型节点按画布位置编号，卡片标签用同一套数字。 */
export function canvasKindIndex(
  nodes: Array<{ id: string, position: { x: number, y: number }, data?: { kind?: string } | null }>,
  id: string,
  kind: string,
) {
  const ranked = nodes
    .filter(node => node.data?.kind === kind)
    .slice()
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const index = ranked.findIndex(node => node.id === id)
  return index >= 0 ? index + 1 : 0
}
