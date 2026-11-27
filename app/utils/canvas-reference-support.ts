/**
 * 画布参考素材能力：按模型详情 params 的 input_references 判断首帧、尾帧、参考图、参考视频、参考音频。
 * 口径和模型广场 Playground 的素材槽一致：role / type 都声明时取交集。
 * 详情没给素材表时不下结论（known=false），避免把还没加载完的模型全部打叉。
 * 图片模型没有素材表时，用 image_input：none 不收参考图，url / edits 只收参考图。
 * 图片参数里的 images / image 数组若写了 maxItems，或描述里写了张数（1-3 images、up to 14 images），参考图按这个数封顶。
 */

export type CanvasRefRole = 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'

export interface CanvasRefSupport {
  known: boolean
  roles: Set<CanvasRefRole>
  /** 各槽最多几份。视频看 media_constraints，图片看 images 数组；都没写时为空，不猜上限。 */
  maxCount: Partial<Record<CanvasRefRole, number>>
}

const ROLE_TYPE: Record<CanvasRefRole, string> = {
  first_frame: 'image',
  last_frame: 'image',
  reference_image: 'image',
  reference_video: 'video',
  reference_audio: 'audio',
}

const DEFAULT_ROLES: CanvasRefRole[] = [
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
]

const VIDEO_KEYS = ['video', 'videos', 'video_generation', 'text_to_video', 'image_to_video']
const IMAGE_KEYS = ['image', 'images', 'image_generation']
const AUDIO_KEYS = ['audio', 'speech', 'tts', 'audio_speech']

type ParamProp = {
  type?: string
  description?: string
  maxItems?: unknown
  max?: unknown
  enum?: unknown[]
  items?: { properties?: Record<string, ParamProp> }
  media_constraints?: Record<string, { max_count?: unknown }>
}

type DetailLike = {
  params?: Record<string, { properties?: Record<string, ParamProp> }>
} | null | undefined

function groupKeys(kind: string): string[] {
  if (kind === 'video' || kind === 'director')
    return VIDEO_KEYS
  if (kind === 'audio')
    return AUDIO_KEYS
  if (kind === 'image')
    return IMAGE_KEYS
  return []
}

function propertiesOf(detail: DetailLike, keys: string[]): Record<string, ParamProp> | null {
  const params = detail?.params
  if (!params)
    return null
  for (const key of keys) {
    const properties = params[key]?.properties
    if (properties && Object.keys(properties).length)
      return properties
  }
  return null
}

function enumLower(prop: ParamProp | undefined): string[] {
  if (!Array.isArray(prop?.enum))
    return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of prop.enum) {
    const value = String(item ?? '').trim().toLowerCase()
    if (!value || seen.has(value))
      continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function isRole(value: string): value is CanvasRefRole {
  return value in ROLE_TYPE
}

function rolesForTypes(types: Set<string>): Set<CanvasRefRole> {
  const roles = new Set<CanvasRefRole>()
  for (const role of DEFAULT_ROLES) {
    if (types.has(ROLE_TYPE[role]))
      roles.add(role)
  }
  return roles
}

function typesForRoles(roles: Set<CanvasRefRole>): Set<string> {
  const types = new Set<string>()
  for (const role of roles)
    types.add(ROLE_TYPE[role])
  return types
}

function readMaxCount(ref: ParamProp | undefined): Partial<Record<CanvasRefRole, number>> {
  const raw = ref?.media_constraints
  if (!raw || typeof raw !== 'object')
    return {}
  const out: Partial<Record<CanvasRefRole, number>> = {}
  for (const role of DEFAULT_ROLES) {
    const rule = raw[role]
    const max = rule?.max_count
    if (typeof max === 'number' && Number.isInteger(max) && max >= 0)
      out[role] = max
  }
  return out
}

function supportFromProperties(properties: Record<string, ParamProp> | null): CanvasRefSupport | null {
  const ref = properties?.input_references
  if (!ref)
    return null
  const maxCount = readMaxCount(ref)
  const item = ref.items?.properties
  const declaredRoles = enumLower(item?.role).filter(isRole)
  const declaredTypes = enumLower(item?.type)
  if (!declaredRoles.length && !declaredTypes.length)
    return { known: true, roles: new Set(DEFAULT_ROLES), maxCount }

  let roles: Set<CanvasRefRole>
  let types: Set<string>
  if (!declaredRoles.length) {
    types = new Set(declaredTypes)
    roles = rolesForTypes(types)
  }
  else if (!declaredTypes.length) {
    roles = new Set(declaredRoles)
    types = typesForRoles(roles)
  }
  else {
    roles = new Set(declaredRoles)
    types = new Set(declaredTypes)
  }

  const out = new Set<CanvasRefRole>()
  for (const role of roles) {
    if (types.has(ROLE_TYPE[role]))
      out.add(role)
  }
  return { known: true, roles: out, maxCount }
}

function imageFallback(imageInput: string | undefined): CanvasRefSupport | null {
  if (imageInput === 'none')
    return { known: true, roles: new Set(), maxCount: {} }
  if (imageInput === 'url' || imageInput === 'edits')
    return { known: true, roles: new Set(['reference_image']), maxCount: {} }
  return null
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** 网关把张数写在数组说明里，没有 maxItems。例如 "1-3 images"、"up to 14 images"。 */
function imageArrayMax(prop: ParamProp | undefined): number | undefined {
  if (!prop || String(prop.type || '').toLowerCase() !== 'array')
    return undefined
  const direct = positiveInt(prop.maxItems) ?? positiveInt(prop.max)
  if (direct)
    return direct
  const desc = String(prop.description ?? '')
  const range = desc.match(/(\d+)\s*[-~～–—]\s*(\d+)\s+images?\b/i)
  if (range)
    return Number(range[2])
  const upTo = desc.match(/\b(?:up to|at most|maximum of|max)\s+(\d+)\s+images?\b/i)
  if (upTo)
    return Number(upTo[1])
  const zh = desc.match(/最多\s*(\d+)\s*张/)
  if (zh)
    return Number(zh[1])
  return undefined
}

function imageRefMaxFromProperties(properties: Record<string, ParamProp> | null): number | undefined {
  if (!properties)
    return undefined
  return imageArrayMax(properties.images) ?? imageArrayMax(properties.image)
}

export function canvasRefSupport(input: {
  kind?: string
  detail?: DetailLike
  imageInput?: string
}): CanvasRefSupport {
  const kind = String(input.kind || '')
  const properties = propertiesOf(input.detail, groupKeys(kind))
  const fromParams = supportFromProperties(properties)
  let support: CanvasRefSupport | null = fromParams
  // 视频参数已经拉到，但没有素材表：这个模型就是纯文生，不是「还没加载」。
  if (!support && (kind === 'video' || kind === 'director') && properties)
    support = { known: true, roles: new Set(), maxCount: {} }
  if (!support && kind === 'image')
    support = imageFallback(input.imageInput)
  if (!support)
    return { known: false, roles: new Set(), maxCount: {} }
  if (kind === 'image' && support.known && support.roles.has('reference_image') && support.maxCount.reference_image == null) {
    const max = imageRefMaxFromProperties(properties)
    if (max)
      support = { ...support, maxCount: { ...support.maxCount, reference_image: max } }
  }
  return support
}

const IMAGE_REF_ROLES = new Set(['image', 'reference', 'character', 'scene', 'style', 'subject'])

/** 已知不支持的角色从提交里拿掉。mask / voice 不是参考素材槽，保留。 */
export function canvasRefInputAllowed(support: CanvasRefSupport, role: string | undefined): boolean {
  if (!support.known)
    return true
  const name = String(role || '')
  if (name === 'first_frame')
    return support.roles.has('first_frame')
  if (name === 'last_frame')
    return support.roles.has('last_frame')
  if (name === 'reference_video')
    return support.roles.has('reference_video')
  if (name === 'reference_audio')
    return support.roles.has('reference_audio')
  if (IMAGE_REF_ROLES.has(name))
    return support.roles.has('reference_image')
  return true
}

export function filterUnsupportedRefInputs<T extends { role?: string }>(inputs: T[], support: CanvasRefSupport): T[] {
  if (!support.known)
    return inputs
  return inputs.filter(item => canvasRefInputAllowed(support, item.role))
}

/**
 * 画布视频生成方式，按模型素材槽长出来，不是固定菜单。
 * 文生视频始终在。
 * 图生视频：只有首帧、没有尾帧，只吃一张图。
 * 首尾帧：同时有首帧和尾帧，1～2 张图，和参考素材互斥。
 * 图片参考：只有参考图，没有参考视频 / 音频。
 * 全能参考：参考图、视频、音频里至少两类，不能只挂音频。
 * 视频续写：能收参考视频。
 * 口播：能力位 native_audio，不在 LibTV 的模式条里，能出声才多出一项。
 * 详情还没到时不猜首尾帧和图生视频。
 */
export const CANVAS_VIDEO_MODE_IDS = ['t2v', 'reference', 'imageRef', 'i2v', 'fl2v', 'extend', 'talking'] as const
export type CanvasVideoModeId = (typeof CANVAS_VIDEO_MODE_IDS)[number]

/** 当前模式不在这个模型的列表里时，改成列表里有的。全能参考只剩参考图时改成图片参考。 */
export function canvasActiveVideoMode(current: string, modes: readonly string[]): string {
  if (!modes.length || modes.includes(current))
    return current
  if (current === 'reference' && modes.includes('imageRef'))
    return 'imageRef'
  return modes.find(id => id === 't2v') ?? modes.find(id => id !== 'talking') ?? modes[0] ?? current
}

export function canvasVideoModes(input: {
  support: CanvasRefSupport
  nativeAudio?: boolean
  videoReference?: boolean
}): CanvasVideoModeId[] {
  const modes: CanvasVideoModeId[] = ['t2v']
  if (!input.support.known) {
    if (input.videoReference)
      modes.push('reference', 'extend')
    if (input.nativeAudio)
      modes.push('talking')
    return modes
  }
  const roles = input.support.roles
  const hasImage = roles.has('reference_image')
  const hasVideo = roles.has('reference_video')
  const hasAudio = roles.has('reference_audio')
  const mixed = [hasImage, hasVideo, hasAudio].filter(Boolean).length
  if (mixed >= 2)
    modes.push('reference')
  else if (hasImage)
    modes.push('imageRef')
  if (roles.has('first_frame') && !roles.has('last_frame'))
    modes.push('i2v')
  if (roles.has('first_frame') && roles.has('last_frame'))
    modes.push('fl2v')
  if (hasVideo)
    modes.push('extend')
  if (input.nativeAudio)
    modes.push('talking')
  return modes
}

const ALWAYS_KEEP = new Set(['mask', 'voice', 'style', 'character', 'scene'])

/** 当前模式真正会提交的素材角色。没列入的模式不裁。首尾帧仍保留 reference，导演台预演控制图走这条。 */
const MODE_MEDIA_ROLES: Partial<Record<CanvasVideoModeId, Set<string>>> = {
  t2v: new Set(),
  i2v: new Set(['first_frame']),
  fl2v: new Set(['first_frame', 'last_frame', 'reference', 'image']),
  imageRef: new Set(['reference', 'image']),
  reference: new Set(['reference', 'image', 'reference_video', 'reference_audio']),
  extend: new Set(['reference', 'image', 'reference_video', 'reference_audio']),
}

function countRole(role: string | undefined): CanvasRefRole | null {
  if (role === 'first_frame' || role === 'last_frame' || role === 'reference_video' || role === 'reference_audio')
    return role
  if (role === 'reference' || role === 'image')
    return 'reference_image'
  return null
}

/** 按当前模式丢掉用不上的素材，再按 max_count 裁掉多出来的。 */
export function filterCanvasModeInputs<T extends { role?: string }>(inputs: T[], mode: string, support: CanvasRefSupport): T[] {
  const allowed = MODE_MEDIA_ROLES[mode as CanvasVideoModeId]
  const kept = inputs.filter((item) => {
    const role = String(item.role || '')
    if (!role || ALWAYS_KEEP.has(role))
      return true
    if (allowed && !allowed.has(role))
      return false
    return canvasRefInputAllowed(support, role)
  })
  const seen = new Map<CanvasRefRole, number>()
  return kept.filter((item) => {
    const role = countRole(item.role)
    if (!role)
      return true
    const max = support.maxCount[role]
    const used = seen.get(role) || 0
    if (max != null && used >= max)
      return false
    seen.set(role, used + 1)
    return true
  })
}

/** 模式条底下的数量说明。没有上限就不写。 */
export function canvasModeLimitText(mode: string, support: CanvasRefSupport): string {
  if (!support.known)
    return ''
  const parts: string[] = []
  const image = support.maxCount.reference_image
  const video = support.maxCount.reference_video
  const audio = support.maxCount.reference_audio
  const wantsImage = mode === 'reference' || mode === 'imageRef' || (mode === 'extend' && support.roles.has('reference_image'))
  const wantsVideo = mode === 'reference' || mode === 'extend'
  const wantsAudio = (mode === 'reference' || mode === 'extend') && support.roles.has('reference_audio')
  if (wantsImage && image != null)
    parts.push(`参考图最多 ${image} 张`)
  if (wantsVideo && video != null && support.roles.has('reference_video'))
    parts.push(`参考视频最多 ${video} 段`)
  if (wantsAudio && audio != null)
    parts.push(`参考音频最多 ${audio} 段`)
  return parts.join('，')
}

/**
 * 缩略图该不该打叉。index 是同类素材里的序号，从 0 起。
 * 返回空字符串表示这个模式下能用。
 */
export function canvasThumbIssue(input: {
  mode: string
  kind: 'image' | 'video' | 'audio'
  key?: string
  index: number
  support: CanvasRefSupport
}): string {
  if (!input.support.known)
    return ''
  const key = String(input.key || '')
  if (key === 'voice' || key === 'style' || key === 'cast' || key === 'set')
    return ''
  const { mode, kind, index, support } = input
  const over = (role: CanvasRefRole, noun: string) => {
    const max = support.maxCount[role]
    if (max != null && index >= max)
      return `${noun}最多 ${max} 个`
    return ''
  }
  if (mode === 't2v') {
    if (kind === 'image') {
      if (!support.roles.has('first_frame'))
        return '当前模型不支持首帧'
      if (index > 0)
        return '文生视频只用一张图当首帧'
      return ''
    }
    return kind === 'video' ? '文生视频不收参考视频' : '文生视频不收参考音频'
  }
  if (mode === 'i2v') {
    if (kind === 'image') {
      if (!support.roles.has('first_frame'))
        return '当前模型不支持首帧'
      if (index > 0)
        return '图生视频只吃一张图'
      return ''
    }
    return kind === 'video' ? '图生视频不收参考视频' : '图生视频不收参考音频'
  }
  if (mode === 'fl2v') {
    if (kind === 'video')
      return '首尾帧不收参考视频'
    if (kind === 'audio')
      return '首尾帧不收参考音频'
    if (kind === 'image' && index >= 2)
      return '首尾帧最多 2 张图'
    if (key === 'last' && !support.roles.has('last_frame'))
      return '当前模型不支持尾帧'
    if ((key === 'first' || index === 0) && !support.roles.has('first_frame'))
      return '当前模型不支持首帧'
    return ''
  }
  if (mode === 'imageRef') {
    if (kind === 'video')
      return '图片参考不收参考视频'
    if (kind === 'audio')
      return '图片参考不收参考音频'
    if (!support.roles.has('reference_image'))
      return '当前模型不支持参考图'
    return over('reference_image', '参考图')
  }
  const role: CanvasRefRole = kind === 'video' ? 'reference_video' : kind === 'audio' ? 'reference_audio' : 'reference_image'
  const noun = kind === 'video' ? '参考视频' : kind === 'audio' ? '参考音频' : '参考图'
  if (!support.roles.has(role))
    return `当前模型不支持${noun}`
  return over(role, noun)
}
