<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import subjectApi from '~/api/subject'
import taskApi from '~/api/task'
import CanvasSubjectPicker from '~/components/canvas/CanvasSubjectPicker.vue'
import type { GenerationModel, GenerationModelDetail, GeneratePayload, Subject } from '~/types/creative'
import { effectiveUnitPrice, estimateTaskPoints, modelPromoDisplay } from '~/utils/model-price'
import { prettyModelSlug, shortModelName } from '~/utils/model-name'
import { resolveCatalogModel } from '~/utils/canvas-catalog-model'
import { hasVideoReference } from '~/utils/canvas-viral'
import CanvasPromptInput from '~/components/canvas/CanvasPromptInput.vue'
import type { RefCandidate } from '~/utils/canvas-autolink'
import { clearSlashQuery, filterSlashItems, moveSlashIndex, slashQueryAt } from '~/utils/canvas-slash'
import { resolveMediaUrl } from '~/utils/media'
import { useToast } from '#imports'
import type { TalkingData } from '~/utils/canvas-talking'
import { buildTalkingPrompt, hasNativeAudio, normalizeTalkingData, TALKING_FRAMINGS, TALKING_PRESET, TALKING_SCRIPT_MAX, TALKING_TONES, talkingDuration } from '~/utils/canvas-talking'
import {
  AUDIO_KIND_DEFAULT_SECONDS,
  AUDIO_KINDS,
  AUDIO_MOODS,
  applyAudioMoodPrompt,
  audioUsesVoice,
  parseAudioKind,
  parseAudioMood,
  type AudioKind,
} from '~/utils/canvas-audio'
const { t } = useI18n()
const toast = useToast()

/** GET /generation/models 的结果，跨实例共享，只拉一次 */
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const generationModelsLoaded = useState('generation-models-loaded', () => false)
const { isMember } = useWallet()
const { load: loadModelDetail, peek: peekModelDetail } = useGenerationModelDetail()

async function loadGenerationModels() {
  if (generationModelsLoaded.value)
    return
  generationModelsLoaded.value = true
  const res = await taskApi.models()
  if (res?.success && Array.isArray(res.data))
    generationModels.value = res.data
}

function taskTypeOf(kind: string) {
  if (kind === 'director')
    return 'video'
  // 全景就是一次图片生成，只是尺寸锁死 2048x1024
  if (kind === 'panorama')
    return 'image'
  return kind
}

const LAST_MODEL_KEY = 'easytv-canvas-last-model'
const lastModelByType = useState<Record<string, string>>('canvas-last-model', () => ({}))

function readLastModels() {
  if (Object.keys(lastModelByType.value).length)
    return lastModelByType.value
  if (typeof localStorage === 'undefined')
    return lastModelByType.value
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_MODEL_KEY) || '{}') as Record<string, string>
    if (raw && typeof raw === 'object')
      lastModelByType.value = raw
  }
  catch {
    // 忽略坏数据
  }
  return lastModelByType.value
}

function rememberModel(kind: string, id: string) {
  if (!id)
    return
  lastModelByType.value = { ...readLastModels(), [taskTypeOf(kind)]: id }
  try {
    localStorage.setItem(LAST_MODEL_KEY, JSON.stringify(lastModelByType.value))
  }
  catch {
    // 忽略
  }
}

const IMAGE_CHIPS = [
  { key: 'ref', label: t('参考'), icon: 'i-lucide-plus' },
  { key: 'mark', label: t('标记'), icon: 'i-lucide-scan-search' },
  { key: 'style', label: t('风格'), icon: 'i-lucide-box' },
  { key: 'stylelib', label: t('风格库'), icon: 'i-lucide-palette' },
  { key: 'grid', label: t('宫格'), icon: 'i-lucide-layout-grid' },
  { key: 'lens', label: t('镜头'), icon: 'i-lucide-aperture' },
  { key: 'optimize', label: t('优化'), icon: 'i-lucide-sparkles' },
] as const

const VIDEO_CHIPS = [
  { key: 'mark', label: t('标记'), icon: 'i-lucide-scan-search' },
  { key: 'cast', label: t('角色素材'), icon: 'i-lucide-user-round' },
  { key: 'stylelib', label: t('风格库'), icon: 'i-lucide-palette' },
  { key: 'cam', label: t('运镜'), icon: 'i-lucide-video' },
  { key: 'lens', label: t('镜头'), icon: 'i-lucide-aperture' },
  { key: 'optimize', label: t('优化'), icon: 'i-lucide-sparkles' },
] as const

const AUDIO_CHIPS = [
  { key: 'ref', label: t('参考'), icon: 'i-lucide-plus' },
  { key: 'voice', label: t('音色'), icon: 'i-lucide-audio-lines' },
] as const

const DIRECTOR_CHIPS = [
  { key: 'ref', label: t('参考'), icon: 'i-lucide-plus' },
  { key: 'cast', label: t('角色'), icon: 'i-lucide-user-round' },
  { key: 'set', label: t('场景'), icon: 'i-lucide-box' },
  { key: 'lens', label: t('镜头'), icon: 'i-lucide-aperture' },
] as const

const VIDEO_MODES = [
  { id: 'reference', label: t('全能参考') },
  { id: 'fl2v', label: t('首尾帧') },
  { id: 'i2v', label: t('首帧') },
  { id: 'talking', label: t('口播') },
] as const
type VideoModeId = (typeof VIDEO_MODES)[number]['id']
const EXTRA_THUMB_KEYS = new Set(['style', 'cast', 'set', 'voice'])

const QUALITY_ITEMS = [
  { id: 'low', label: t('低画质') },
  { id: 'std', label: t('标准画质') },
  { id: 'high', label: t('高画质') },
] as const

const CLARITY_ITEMS = ['1K', '2K', '4K'] as const
const RATIO_ITEMS = ['1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'] as const
const COUNT_ITEMS = [1, 2, 4] as const
const VIDEO_RES_ITEMS = ['480P', '720P', '1080P'] as const
const VIDEO_DURATION_ITEMS = ['5s', '10s', '15s'] as const
const AUDIO_DURATION_ITEMS = ['5s', '10s', '15s', '30s'] as const

function ratioBox(ratio: string) {
  const [aw, ah] = ratio.split(':').map(Number)
  const w = Math.max(1, aw || 1)
  const h = Math.max(1, ah || 1)
  const scale = Math.min(22 / w, 14 / h)
  return {
    width: `${Math.max(6, Math.round(w * scale))}px`,
    height: `${Math.max(6, Math.round(h * scale))}px`,
  }
}

const UNIT_LABEL: Record<string, string> = { second: '秒', image: '张', call: '次' }

type ModelOption = {
  id: string
  name: string
  desc: string
  /** 促销中：促销价 / 划线原价 / 标签（会员按会员价对比） */
  promo?: { price: number, origin: number, label: string, unit: string }
  /** 网关详情（API.md 28）：有则优先作副文案 */
  detail?: GenerationModelDetail | null
  /** 近 7 天失败偏多（API.md 37）：名字后带「近期失败多」小标 */
  warn?: boolean
  failRate?: number
}

/** 副文案：优先网关 description，其次 category/vendor，最后 label/provider */
function modelOptionDesc(item: GenerationModel, detail?: GenerationModelDetail | null) {
  const name = shortModelName(item)
  if (detail?.gateway_available) {
    const description = String(detail.description || '').trim()
    if (description)
      return description
    const vendor = String(detail.vendor?.name || '').trim()
    const category = String(detail.category || '').trim()
    if (vendor && category)
      return `${vendor} · ${category}`
    if (vendor || category)
      return vendor || category
  }
  const label = String(item.label || '').trim()
  if (label && label !== name)
    return label
  return item.provider || ''
}

function apiModelsFor(kind: string, only?: (item: GenerationModel) => boolean): ModelOption[] {
  const type = taskTypeOf(kind)
  return generationModels.value
    .filter(item => item.type === type && (!only || only(item)))
    .map((item) => {
      const detail = peekModelDetail(item.model)
      const promo = item.priced ? modelPromoDisplay(item, isMember.value) : null
      return {
        id: item.model,
        name: shortModelName(item),
        desc: modelOptionDesc(item, detail),
        detail,
        ...(promo ? { promo: { ...promo, unit: UNIT_LABEL[item.unit] || '次' } } : {}),
        ...(item.recent_warn ? { warn: true, failRate: item.recent_fail_rate } : {}),
      }
    })
}

function defaultModel(kind: string) {
  const type = taskTypeOf(kind)
  const fromApi = apiModelsFor(kind)
  // 节点自带的模型优先（跟练 / 配方 / AI 建图写下来的 data.model）。
  // 清单 id 大小写对不上就模糊匹配；对不上也绝不改用上次选的——
  // 以前精确匹配失败会落到 easytv-canvas-last-model，卡片写 Kling 面板却是 Seedance。
  const wanted = String(props.model || '').trim()
  if (wanted) {
    const hit = resolveCatalogModel(wanted, generationModels.value, { type, preferPriced: true })
    if (hit)
      return hit
    return wanted
  }
  const last = readLastModels()[type]
  if (last) {
    const hit = resolveCatalogModel(last, generationModels.value, { type, preferPriced: true })
    if (hit)
      return hit
    if (fromApi.some(item => item.id === last))
      return last
  }
  if (fromApi.length)
    return fromApi[0]!.id
  // 列表里一个可用模型都没有就不猜：猜出来的 id 后端多半没有定价，提交只会白跑一趟
  return ''
}

const props = withDefaults(defineProps<{
  prompt: string
  kind?: string
  expanded?: boolean
  panelStyle?: Record<string, string> | null
  /** 涂抹擦除时叠在标记层上面，避免模型菜单被挡住 */
  overMark?: boolean
  /** 已设置的参考素材地址，用于「参考」按钮高亮 */
  refUrl?: string
  chipState?: Partial<Record<string, boolean>>
  /** 已套用的风格库预设名（API.md 34），「风格库」芯片点亮后显示「已选风格：名字」 */
  stylePresetName?: string
  /** 提示词区可叉掉的参考缩略图（参考 / 尾帧 / 风格等） */
  attachThumbs?: Array<{ key: string, url: string, label: string, kind: 'image' | 'video' | 'audio' }>
  /** 引用的主体 id（API.md 10.2），存在节点 data.subjectIds 上，最多 4 个 */
  subjectIds?: number[]
  /** 锁定的主体版本 */
  subjectVersions?: Record<string, number>
  /** 已选运镜预设 id，提示词区显示为可点标签 */
  cameraMove?: string
  /** 元素标记名称，展示在「标记」按钮下方 */
  markElements?: Array<{ id: string, name: string }>
  /** 片段重拍：提示词里的来源片段标签 */
  retakeClip?: { label: string, range: string, seconds: string } | null
  /** 视频节点上保存的生成模式（全能参考 / 首尾帧 / 首帧 / 口播） */
  videoMode?: string
  /** 口播预设（API.md 24.9），存在节点 data.talking 上 */
  talking?: TalkingData | null
  /** 可被智能引用的参考素材（L1，API.md 31.2），顺序与提交时的参考顺序一致 */
  refs?: RefCandidate[]
  /**
   * 节点上带下来的模型（data.model，API.md 32：AI 建图 / 工作流模板写入）。
   * 初始化时优先读它，其次才是 localStorage 里记的上次选择。
   */
  model?: string
  /** 节点上带下来的参数默认值（data.params），只认 ratio / clarity / quality / duration / resolution / lang / voice / audioKind / mood 这几个键 */
  params?: Record<string, unknown> | null
  /**
   * 跟练只读（设计 §四 #10）：提示词区与 chips / 模型 / 模式 / 规格 / 主体 / 展开全部禁用，
   * 只保留生成按钮可用（跟练靠它演回放）。写入侧由 Workspace 的 practiceBlocked() 兜底。
   */
  readonly?: boolean
  /** 当前节点已单独锁定 */
  locked?: boolean
  /** 生成请求还没返回：按钮置灰，挡住连点 */
  submitting?: boolean
}>(), {
  kind: 'image',
  expanded: false,
  panelStyle: null,
  overMark: false,
  refUrl: '',
  chipState: () => ({}),
  stylePresetName: '',
  attachThumbs: () => [],
  subjectIds: () => [],
  subjectVersions: () => ({}),
  cameraMove: '',
  markElements: () => [],
  retakeClip: null,
  videoMode: 'reference',
  talking: null,
  refs: () => [],
  model: '',
  params: null,
  readonly: false,
  locked: false,
  submitting: false,
})

/** 跟练只读时给禁用控件的统一悬停说明 */
const readonlyTitle = computed(() => (props.readonly ? t('跟练中不可编辑') : undefined))
/** 跟练或节点锁定：冻住提示词 / chips / 模型 / 生成；锁定芯片仍可点，方便解锁 */
const writeBlocked = computed(() => props.readonly || props.locked)
const writeBlockedTitle = computed(() => {
  if (props.readonly)
    return t('跟练中不可编辑')
  if (props.locked)
    return t('canvas.lock.hint')
  return undefined
})

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:expanded': [value: boolean]
  send: []
  generate: [payload: GeneratePayload]
  chip: [key: string]
  'clear-chip': [key: string]
  'remove-mark': [id: string]
  quota: []
  'update:subjectIds': [ids: number[], versions: Record<string, number>]
  'update:videoMode': [mode: VideoModeId]
  'update:talking': [data: TalkingData]
  'update:params': [params: Record<string, unknown>]
  'update:model': [model: string]
  'toggle-lock': []
}>()

const isText = computed(() => props.kind === 'text')
const isPanorama = computed(() => props.kind === 'panorama')
/** 全景复用图片的模型与配置，只有「比例 / 张数」两项不适用 */
const isImage = computed(() => props.kind === 'image' || isPanorama.value)
const isVideo = computed(() => props.kind === 'video')
const isAudio = computed(() => props.kind === 'audio')
const audioKind = ref<AudioKind>(parseAudioKind(props.params?.audioKind))
const audioMood = ref(parseAudioMood(props.params?.mood) || (parseAudioKind(props.params?.audioKind) === 'bgm' ? 'pulse' : ''))
const kindMenu = ref(false)
const isDirector = computed(() => props.kind === 'director')
const isMedia = computed(() => isImage.value || isVideo.value || isAudio.value || isDirector.value)
const isRoomy = computed(() => isMedia.value)
const CHIP_ON_LABEL: Record<string, string> = {
  ref: t('已选参考'),
  first: t('已选首帧'),
  style: t('已选风格'),
  voice: t('已选音色'),
  cast: t('已选角色'),
  set: t('已选场景'),
  last: t('已选尾帧'),
  cam: t('已选运镜'),
  fx: t('已选特效'),
  lens: t('已配镜头'),
}
const videoMode = ref<VideoModeId>(VIDEO_MODES.some(item => item.id === props.videoMode) ? props.videoMode as VideoModeId : 'reference')
/** 口播模式（API.md 24.9）：台词 → 固定机位口播提示词，只列原生带声的模型 */
const isTalkingMode = computed(() => isVideo.value && videoMode.value === 'talking')
/** 全能参考连了参考视频：只列能吃 reference_video 的模型（能力位 video_reference），否则提交到网关才被拒 */
const hasRefVideo = computed(() => isVideo.value && videoMode.value === 'reference' && props.attachThumbs.some(item => item.kind === 'video'))
/** 点亮后的文案：风格库带上风格名，其余走静态表 */
function chipOnLabel(chip: { key: string, label: string }) {
  if (chip.key === 'stylelib')
    return props.stylePresetName ? t('已选风格：{name}', { name: props.stylePresetName }) : t('已选风格')
  return CHIP_ON_LABEL[chip.key] || chip.label
}
function chipOn(key: string) {
  if (key === 'mark')
    return false
  if (key === 'ref' || key === 'first')
    return Boolean(props.chipState.ref || props.refUrl)
  return Boolean(props.chipState[key])
}
const isFl2vMode = computed(() => isVideo.value && videoMode.value === 'fl2v')
const isFrameMode = computed(() => isVideo.value && (videoMode.value === 'fl2v' || videoMode.value === 'i2v'))
const refThumbs = computed(() => props.attachThumbs.filter(item => !EXTRA_THUMB_KEYS.has(item.key) && item.key !== 'last'))
const extraThumbs = computed(() => props.attachThumbs.filter(item => EXTRA_THUMB_KEYS.has(item.key)))
const firstThumb = computed(() => props.attachThumbs.find(item => item.key === 'first') || refThumbs.value[0] || null)
const lastThumb = computed(() => {
  const explicit = props.attachThumbs.find(item => item.key === 'last')
  if (explicit)
    return explicit
  const firstUrl = firstThumb.value?.url
  return refThumbs.value.find(item => item.url && item.url !== firstUrl) || null
})
const displayThumbs = computed(() => isFrameMode.value
  ? extraThumbs.value
  : props.attachThumbs.filter(item => item.key !== 'last'))
const chips = computed(() => {
  if (isVideo.value)
    return VIDEO_CHIPS
  if (isImage.value)
    return IMAGE_CHIPS
  if (isAudio.value)
    return audioUsesVoice(audioKind.value) ? AUDIO_CHIPS : AUDIO_CHIPS.filter(item => item.key !== 'voice')
  if (isDirector.value)
    return DIRECTOR_CHIPS
  return []
})
const models = computed<readonly ModelOption[]>(() => {
  // 依赖 tick：详情预取完成后刷新 description / vendor 副文案
  void modelDetailTick.value
  // 口播只能用原生带声的视频模型；一个都没有就空着，不回落到占位模型
  if (isTalkingMode.value)
    return apiModelsFor(props.kind, hasNativeAudio)
  if (hasRefVideo.value)
    return apiModelsFor(props.kind, hasVideoReference)
  // 模型一律以 GET /generation/models 为准：以前这里兜过一组写死的 gvlm / lib-image / v2，
  // 那些 id 线上并不存在（或未定价），选中后提交只会拿到「模型未定价」。空列表就如实空着，
  // 由 noModels 拦住提交并提示联系运营开通。
  return apiModelsFor(props.kind)
})
/** 一个可用模型都没有：模型选择器显示占位，提交前拦一道 */
const noModels = computed(() => !models.value.length)
const modelMenu = ref(false)
const modelMenuRef = ref<HTMLElement | null>(null)
/** 模型列表项的 DOM 引用，用于把选中项滚到可见位置 */
const modelMenuItems = ref<HTMLElement[]>([])
/** 检查器根节点：在它上面挂 wheel 监听，区分要自己滚还是放给画布 */
const inspectorRootRef = ref<HTMLElement | null>(null)
const modeMenu = ref(false)
const specMenu = ref(false)
/** 触发 models 计算属性在详情缓存写入后刷新副文案 */
const modelDetailTick = ref(0)
const modelId = ref(defaultModel(props.kind))
/** data.params 里的枚举值：只认面板上真有的档位，其余（模型乱写的）当没给 */
function paramEnum<T extends string>(key: string, items: readonly T[], fallback: T): T {
  const raw = props.params?.[key]
  const value = typeof raw === 'string' ? raw : ''
  return (items as readonly string[]).includes(value) ? value as T : fallback
}
/** 具体档位由模型声明决定（如 resolution），这里只挡空值，合法性交给下面的 watch */
function paramText(key: string, fallback: string): string {
  const raw = props.params?.[key]
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value || fallback
}
/** data.params.duration 是秒数（int），面板上按 `${n}s` 的档位存 */
function paramSeconds(key: string, fallback: string): string {
  const raw = props.params?.[key]
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''))
  return Number.isFinite(n) && n > 0 ? `${n}s` : fallback
}
const quality = ref<(typeof QUALITY_ITEMS)[number]['id']>(paramEnum('quality', QUALITY_ITEMS.map(item => item.id), 'std'))
const clarity = ref<(typeof CLARITY_ITEMS)[number]>(paramEnum('clarity', CLARITY_ITEMS, '2K'))
const ratio = ref<(typeof RATIO_ITEMS)[number]>(paramEnum('ratio', RATIO_ITEMS, '16:9'))
const count = ref<(typeof COUNT_ITEMS)[number]>(1)
const videoRes = ref<string>(paramText('resolution', '720P'))
const videoDuration = ref<string>(paramSeconds('duration', '5s'))
const audioDuration = ref<string>(paramSeconds('duration', '10s'))
const audioLang = ref(paramText('lang', 'zh'))
const audioVoice = ref(typeof props.params?.voice === 'string' ? props.params.voice : '')
const audioOn = ref(true)

/** 主体引用（API.md 10.2）：图片 / 视频节点可引用最多 4 个主体，选择结果存回节点 data */
const MAX_SUBJECTS = 4
const subjectPickerOpen = ref(false)
const subjectCache = useState<Record<number, Subject>>('canvas-subject-cache', () => ({}))
const canUseSubjects = computed(() => isImage.value || isVideo.value)
const subjectIds = computed(() => (props.subjectIds ?? []).slice(0, MAX_SUBJECTS))
const subjectChips = computed(() => subjectIds.value.map((id) => {
  const row = subjectCache.value[id]
  const locked = Number(props.subjectVersions?.[String(id)]) || 0
  const latest = Number(row?.version) || 0
  return {
    id,
    name: row?.name || t('主体 #{id}', { id }),
    url: row ? (row.cover_url || row.refs?.[0]?.url || '') : '',
    locked,
    latest,
    /** 锁定的版本落后于主体当前版本 */
    outdated: locked > 0 && latest > locked,
  }
}))
const showTagRow = computed(() => Boolean(canUseSubjects.value && subjectChips.value.length))

/** 节点上引用了但缓存里没有的主体：拉一次列表，拿到名称、封面和当前版本（判断有没有新版本） */
watch(subjectIds, async (ids) => {
  if (!ids.some(id => !subjectCache.value[id]))
    return
  const res = await subjectApi.list({ page: 1, page_size: 100 })
  if (!res?.success || !res.data)
    return
  const next = { ...subjectCache.value }
  for (const row of res.data.items)
    next[row.id] = row
  subjectCache.value = next
}, { immediate: true })

/** 选主体时锁定当前版本；已经锁过的保持原版本 */
function lockedVersions(ids: number[]) {
  const out: Record<string, number> = {}
  for (const id of ids) {
    const key = String(id)
    const kept = Number(props.subjectVersions?.[key]) || 0
    const latest = Number(subjectCache.value[id]?.version) || 0
    if (kept || latest)
      out[key] = kept || latest
  }
  return out
}

function onSubjectPick(ids: number[], rows: Subject[]) {
  if (rows.length) {
    const next = { ...subjectCache.value }
    for (const row of rows)
      next[row.id] = row
    subjectCache.value = next
  }
  const picked = ids.slice(0, MAX_SUBJECTS)
  emit('update:subjectIds', picked, lockedVersions(picked))
}

function removeSubject(id: number) {
  const ids = subjectIds.value.filter(item => item !== id)
  emit('update:subjectIds', ids, lockedVersions(ids))
}

function upgradeSubject(id: number) {
  const versions = lockedVersions(subjectIds.value)
  versions[String(id)] = Number(subjectCache.value[id]?.version) || versions[String(id)] || 0
  emit('update:subjectIds', subjectIds.value, versions)
}

/** 配音语种与音色（API.md 10.4）：服务端按语种先翻译台词再 TTS；选中结果写回 data.params */
const { langs, load: loadLangs, langLabel } = useLangs()

const currentModel = computed<ModelOption>(() => {
  const hit = models.value.find(item => item.id === modelId.value)
  if (hit)
    return hit
  const fuzzy = resolveCatalogModel(modelId.value, generationModels.value, { type: taskTypeOf(props.kind), preferPriced: true })
  const viaFuzzy = fuzzy ? models.value.find(item => item.id === fuzzy) : null
  if (viaFuzzy)
    return viaFuzzy
  // 节点已经指定了模型但清单对不上：显示这个 id，不要拿列表第一项（上次的 Seedance）顶掉
  if (modelId.value)
    return { id: modelId.value, name: prettyModelSlug(modelId.value) || modelId.value, desc: '' }
  return models.value[0] ?? { id: '', name: t('暂无可用模型'), desc: t('请联系运营开通') }
})
const currentMode = computed(() => VIDEO_MODES.find(item => item.id === videoMode.value) ?? VIDEO_MODES[0])
const qualityLabel = computed(() => QUALITY_ITEMS.find(item => item.id === quality.value)?.label ?? t('标准画质'))
const specSummary = computed(() => {
  if (isVideo.value || isDirector.value)
    return `${ratio.value} · ${videoRes.value} · ${videoSeconds.value}s`
  if (isAudio.value) {
    if (audioUsesVoice(audioKind.value))
      return `${audioDuration.value} · ${langLabel(audioLang.value)}`
    const mood = AUDIO_MOODS.find(item => item.id === audioMood.value)
    return `${audioDuration.value} · ${mood ? t(`canvas.audio.mood.${mood.id}`) : t(`canvas.audio.kind.${audioKind.value}`)}`
  }
  if (isPanorama.value)
    return `2048×1024 · ${qualityLabel.value}`
  return `${ratio.value} · ${qualityLabel.value} · ${clarity.value} · ${count.value}${t('张')}`
})
/** 当前模型的定价 / 能力信息：优先用模型详情（选中后才拉），没有再回落到列表项 */
const currentApiModel = computed(() => {
  void modelDetailTick.value
  const detail = peekModelDetail(modelId.value)
  if (detail)
    return detail
  return generationModels.value.find(item => item.model === modelId.value) ?? null
})

/**
 * 时长选项：模型声明了 durations 就只给这些秒数（API.md 6.1），否则用通用档位。
 * sora-2 只吃 4/8/12 秒，硬给 10 秒网关会回 400，用户白等一轮再退款。
 */
function durationItems(fallback: readonly string[]) {
  const list = currentApiModel.value?.durations
  if (!list?.length)
    return [...fallback]
  return list.map(n => `${n}s`)
}
/** 分辨率同理：hailuo-02 只收 512P/768P/1080P，硬给 720P 网关同样回 400 */
const videoResItems = computed(() => {
  const list = currentApiModel.value?.resolutions
  if (!list?.length)
    return [...VIDEO_RES_ITEMS]
  return list
})
watch(videoResItems, (items) => {
  if (items.length && !items.includes(videoRes.value))
    videoRes.value = items[0]!
}, { immediate: true })

const videoDurationItems = computed(() => durationItems(VIDEO_DURATION_ITEMS))
const audioDurationItems = computed(() => durationItems(AUDIO_DURATION_ITEMS))

// 换模型后原来的秒数可能不在新列表里，回落到第一档，避免提交一个该模型不支持的时长
watch(videoDurationItems, (items) => {
  if (items.length && !items.includes(videoDuration.value))
    videoDuration.value = items[0]!
}, { immediate: true })
watch(audioDurationItems, (items) => {
  if (items.length && !items.includes(audioDuration.value))
    audioDuration.value = items[0]!
}, { immediate: true })

/** 口播配置：以节点 data.talking 为准，改动即时写回节点 */
const talking = computed(() => normalizeTalkingData(props.talking))
function patchTalking(patch: Partial<TalkingData>) {
  if (writeBlocked.value)
    return
  const next: TalkingData = { ...talking.value, ...patch }
  if (patch.duration === undefined && 'duration' in patch)
    delete next.duration
  emit('update:talking', next)
}
function onTalkingScript(event: Event) {
  patchTalking({ script: (event.target as HTMLTextAreaElement).value.slice(0, TALKING_SCRIPT_MAX) })
}
/** 自动时长档：按台词长度落到当前模型的 durations 档位（API.md 24.9） */
const talkingAutoSeconds = computed(() => talkingDuration(talking.value.script, currentApiModel.value?.durations ?? null))
const videoDurationNumbers = computed(() => videoDurationItems.value.map(item => Number.parseInt(item)).filter(n => n > 0))
/** 手动改过的档位仍在当前模型档位里才生效，换模型后档位没了就回到自动 */
const talkingManualSeconds = computed(() => {
  const n = talking.value.duration
  return n && videoDurationNumbers.value.includes(n) ? n : null
})
/** 实际提交的视频秒数：口播按台词档，其余按面板档 */
const videoSeconds = computed(() => {
  if (isTalkingMode.value)
    return talkingManualSeconds.value ?? talkingAutoSeconds.value
  return Number.parseInt(videoDuration.value) || 0
})
const talkingNoModel = computed(() => isTalkingMode.value && !models.value.length)
const talkingScriptEmpty = computed(() => isTalkingMode.value && !talking.value.script.trim())

function matchListedModel(list: readonly ModelOption[], wanted: string) {
  if (!wanted)
    return null
  const exact = list.find(item => item.id === wanted)
  if (exact)
    return exact
  const fuzzy = resolveCatalogModel(wanted, list.map(item => ({ model: item.id })))
  return fuzzy ? list.find(item => item.id === fuzzy) ?? null : null
}

// 口播需要原生带声的模型：当前模型不在列表里就切到第一个并提示；一个都没有时由 talkingNoModel 禁掉生成。
// 跟练只读时不抢：prepare 已经写过模型，切走会让卡片和节点对不上。
watch([isTalkingMode, models], ([on, list]) => {
  if (!on || !list.length || list.some(item => item.id === modelId.value))
    return
  const hit = matchListedModel(list, String(props.model || modelId.value || ''))
  if (hit) {
    applyModel(hit.id, { persist: !writeBlocked.value })
    return
  }
  if (writeBlocked.value)
    return
  const next = list[0]!
  applyModel(next.id)
  toast.add({ title: t('口播需要原生带声的模型，已切换到 {model}', { model: next.name }), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
}, { immediate: true })

watch([hasRefVideo, models], ([on, list]) => {
  if (!on)
    return
  if (!list.length) {
    toast.add({ title: t('暂无支持参考视频的模型，请联系运营开通'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  if (list.some(item => item.id === modelId.value))
    return
  const hit = matchListedModel(list, String(props.model || modelId.value || ''))
  if (hit) {
    applyModel(hit.id, { persist: !writeBlocked.value })
    return
  }
  if (writeBlocked.value)
    return
  const next = list[0]!
  applyModel(next.id)
  toast.add({ title: t('连了参考视频，已切换到支持参考视频的 {model}', { model: next.name }), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
}, { immediate: true })

/** 积分预估：按 GET /generation/models 附带的单价 × 参数；运营未定价显示「未定价」 */
const zapCost = computed<number | string>(() => {
  const m = currentApiModel.value
  if (!m)
    return isVideo.value ? 135 : isDirector.value ? 80 : isImage.value ? 18 : isAudio.value ? 12 : 6
  if (!m.priced)
    return t('未定价')
  // 与服务端 EstimateTaskPoints 一致：促销期内按 effective_* 单价（会员取会员实际价）
  const unitPrice = effectiveUnitPrice(m, isMember.value)
  return estimateTaskPoints(unitPrice, m.unit, isImage.value ? count.value : 1, videoSeconds.value)
})
/** 当前模型促销中（生成按钮旁的预估高亮） */
const zapPromo = computed(() => {
  const m = currentApiModel.value
  return Boolean(m?.priced && modelPromoDisplay(m, isMember.value))
})
const countUnit = computed(() => {
  if (isAudio.value)
    return t('条')
  if (isImage.value)
    return t('张')
  return t('个')
})

// 节点 data.params / model / videoMode 被跟练备好、工作流落图改写时同步面板。
// 这三个 ref 只在创建时读一次 props；同一节点 :key 不变，不 watch 就会继续显示上次选的模型。
watch(() => props.params, (params) => {
  if (!params)
    return
  quality.value = paramEnum('quality', QUALITY_ITEMS.map(item => item.id), quality.value)
  clarity.value = paramEnum('clarity', CLARITY_ITEMS, clarity.value)
  ratio.value = paramEnum('ratio', RATIO_ITEMS, ratio.value)
  videoRes.value = paramText('resolution', videoRes.value)
  videoDuration.value = paramSeconds('duration', videoDuration.value)
  audioDuration.value = paramSeconds('duration', audioDuration.value)
  audioLang.value = paramText('lang', audioLang.value) || 'zh'
  audioVoice.value = typeof params.voice === 'string' ? params.voice : ''
  audioKind.value = parseAudioKind(params.audioKind)
  audioMood.value = parseAudioMood(params.mood) || (audioKind.value === 'bgm' ? 'pulse' : '')
}, { deep: true })

watch(() => String(props.videoMode || 'reference'), (mode) => {
  videoMode.value = VIDEO_MODES.some(item => item.id === mode) ? mode as VideoModeId : 'reference'
})

watch(() => String(props.model || ''), () => {
  syncModelFromNode()
})

watch(() => props.kind, (kind) => {
  syncModelFromNode(kind)
  closeMenus()
  if (kind !== 'image')
    count.value = 1
  if (kind === 'audio')
    void loadLangs()
})

watch(generationModels, () => {
  const wanted = String(props.model || '').trim()
  if (wanted || !models.value.some(item => item.id === modelId.value))
    syncModelFromNode()
})

onMounted(() => {
  void loadGenerationModels()
  if (isAudio.value)
    void loadLangs()
})


/** 生成参数：透传给 POST /user/task 的 params（API.md 1.4） */
function generatePayload(): GeneratePayload {
  const params: Record<string, unknown> = { count: isImage.value && !isPanorama.value ? count.value : 1 }
  if (isPanorama.value)
    Object.assign(params, { quality: quality.value })
  else if (isImage.value)
    Object.assign(params, { ratio: ratio.value, quality: quality.value, clarity: clarity.value })
  if (isTalkingMode.value) {
    // 口播（API.md 24.9）：有首帧图（连线的图片 / 角色 / 主体）按首帧提交，否则走全能参考；强制带声
    const hasFrame = firstThumb.value?.kind === 'image' || extraThumbs.value.some(item => item.key === 'cast') || subjectIds.value.length > 0
    Object.assign(params, { mode: hasFrame ? 'i2v' : 'reference', ratio: ratio.value, resolution: videoRes.value, duration: videoSeconds.value, audio: true, preset: TALKING_PRESET })
  }
  else if (isVideo.value || isDirector.value) {
    Object.assign(params, { mode: videoMode.value, ratio: ratio.value, resolution: videoRes.value, duration: videoSeconds.value, audio: audioOn.value })
  }
  if (isAudio.value) {
    Object.assign(params, { duration: Number.parseInt(audioDuration.value), audioKind: audioKind.value })
    if (audioKind.value === 'bgm' && audioMood.value)
      params.mood = audioMood.value
    if (audioUsesVoice(audioKind.value)) {
      if (audioLang.value)
        params.lang = audioLang.value
      const voice = audioVoice.value.trim()
      if (voice)
        params.voice = voice
    }
  }
  const payload: GeneratePayload = { model: modelId.value, params }
  if (isTalkingMode.value) {
    payload.prompt = buildTalkingPrompt({
      script: talking.value.script,
      tone: talking.value.tone,
      framing: talking.value.framing,
      subject: subjectChips.value[0]?.name,
      extra: props.prompt,
    })
  }
  if (canUseSubjects.value && subjectIds.value.length) {
    payload.subject_ids = [...subjectIds.value]
    const versions = lockedVersions(subjectIds.value)
    if (Object.keys(versions).length)
      payload.subject_versions = versions
  }
  if (isAudio.value && audioUsesVoice(audioKind.value)) {
    if (audioLang.value)
      payload.lang = audioLang.value
    const voice = audioVoice.value.trim()
    if (voice)
      payload.voice = voice
  }
  return payload
}

const promptInputRef = ref<{
  insertCameraMove: (id: string) => void
  focus: () => void
  replaceRange: (start: number, end: number, text?: string) => Promise<void>
  caretOffset: () => number
} | null>(null)

function insertCameraMove(id: string) {
  promptInputRef.value?.insertCameraMove(id)
}

// ===== Slash 快捷入口（L2）=====
const slashQuery = ref<string | null>(null)
const slashIndex = ref(0)
const slashOpen = computed({
  get: () => slashQuery.value !== null && slashItems.value.length > 0,
  set: (value: boolean) => {
    if (!value)
      slashQuery.value = null
  },
})
const slashItems = computed(() => filterSlashItems(props.kind, slashQuery.value || ''))

function onSlash(query: string | null) {
  slashQuery.value = query
  slashIndex.value = 0
}

function onSlashMove(delta: number) {
  slashIndex.value = moveSlashIndex(slashIndex.value, delta, slashItems.value.length)
}

function onSlashConfirm() {
  const item = slashItems.value[slashIndex.value] || slashItems.value[0]
  if (item)
    void pickSlash(item.key)
}

/** 挑中后先把 "/查询词" 从提示词里删掉，再走 chip 那条通道 */
async function pickSlash(key: string) {
  const input = promptInputRef.value
  slashQuery.value = null
  if (input) {
    const caret = input.caretOffset()
    const hit = slashQueryAt(props.prompt || '', caret)
    if (hit) {
      const next = clearSlashQuery(props.prompt || '', hit.start, caret)
      if (next.prompt !== props.prompt)
        await input.replaceRange(hit.start, caret)
    }
  }
  emit('chip', key)
}

defineExpose({ generatePayload, videoMode, insertCameraMove })

watch(() => props.expanded, () => {
  closeMenus()
})

function closeMenus() {
  modelMenu.value = false
  modeMenu.value = false
  specMenu.value = false
  kindMenu.value = false
}

function toggleExpand() {
  closeMenus()
  emit('update:expanded', !props.expanded)
}

/** 把模型列表里当前选中项滚到中间：留白上下，滚动条不再贴底难看 */
function scrollModelMenuToSelected() {
  const container = modelMenuRef.value
  if (!container)
    return
  const idx = models.value.findIndex(item => item.id === modelId.value)
  const el = idx >= 0 ? modelMenuItems.value[idx] : null
  if (!el)
    return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  // 选中项刚好在可见区里就不动，避免每次打开都跳一下
  if (top >= container.scrollTop && bottom <= container.scrollTop + container.clientHeight)
    return
  // 居中：选中项中心对齐容器中心
  container.scrollTop = top + el.offsetHeight / 2 - container.clientHeight / 2
}

/** 选中模型再拉它的详情：列表里每项的副文案按缓存命中即时展示，没有就先空着，点中后再补 */
function toggleModel() {
  modeMenu.value = false
  specMenu.value = false
  kindMenu.value = false
  modelMenu.value = !modelMenu.value
  if (modelMenu.value)
    nextTick(scrollModelMenuToSelected)
}

watch(modelId, (id) => {
  if (!id)
    return
  // 选中哪个模型才调哪个模型详情，不再把整张列表的详情都拉一遍
  void loadModelDetail(id).then(() => {
    modelDetailTick.value += 1
  })
}, { immediate: true })

function toggleMode() {
  modelMenu.value = false
  specMenu.value = false
  kindMenu.value = false
  modeMenu.value = !modeMenu.value
}

function toggleSpec() {
  modelMenu.value = false
  modeMenu.value = false
  kindMenu.value = false
  specMenu.value = !specMenu.value
}

/** 把面板选中的模型写回节点，生成和估价都跟这一份走，不再只记在 localStorage */
function applyModel(id: string, opts?: { persist?: boolean, remember?: boolean }) {
  if (!id)
    return
  modelId.value = id
  if (opts?.remember !== false)
    rememberModel(props.kind, id)
  if (opts?.persist === false || writeBlocked.value)
    return
  if (id !== String(props.model || '').trim())
    emit('update:model', id)
}

function syncModelFromNode(kind = props.kind) {
  const next = defaultModel(kind)
  if (!next) {
    modelId.value = ''
    return
  }
  applyModel(next, { persist: !writeBlocked.value && next !== String(props.model || '').trim(), remember: false })
}

function pickModel(id: string) {
  if (writeBlocked.value)
    return
  applyModel(id)
  modelMenu.value = false
}

function pickMode(id: VideoModeId) {
  if (writeBlocked.value)
    return
  videoMode.value = id
  modeMenu.value = false
  emit('update:videoMode', id)
}

/** 音频语种 / 音色 / 时长随画布保存：改完立刻写回 data.params，不只在点生成时才记 */
function persistAudioParams() {
  if (writeBlocked.value || !isAudio.value)
    return
  const next: Record<string, unknown> = { ...(props.params || {}) }
  const duration = Number.parseInt(audioDuration.value)
  if (Number.isFinite(duration) && duration > 0)
    next.duration = duration
  next.audioKind = audioKind.value
  if (audioKind.value === 'bgm' && audioMood.value)
    next.mood = audioMood.value
  else
    delete next.mood
  if (audioUsesVoice(audioKind.value)) {
    if (audioLang.value)
      next.lang = audioLang.value
    const voice = audioVoice.value.trim()
    if (voice)
      next.voice = voice
    else
      delete next.voice
  }
  else {
    delete next.lang
    delete next.voice
  }
  emit('update:params', next)
}

function setAudioDuration(item: string) {
  audioDuration.value = item
  persistAudioParams()
}

function setAudioLang(code: string) {
  audioLang.value = code
  persistAudioParams()
}

function toggleKind() {
  modelMenu.value = false
  specMenu.value = false
  kindMenu.value = !kindMenu.value
}

function setAudioKind(kind: AudioKind) {
  const prev = audioKind.value
  if (prev === kind) {
    kindMenu.value = false
    return
  }
  const prevSeconds = AUDIO_KIND_DEFAULT_SECONDS[prev]
  const currentSeconds = Number.parseInt(audioDuration.value)
  audioKind.value = kind
  if (currentSeconds === prevSeconds)
    audioDuration.value = `${AUDIO_KIND_DEFAULT_SECONDS[kind]}s`
  if (kind === 'bgm') {
    if (!audioMood.value)
      audioMood.value = 'pulse'
    const nextPrompt = applyAudioMoodPrompt(props.prompt, audioMood.value)
    if (nextPrompt && nextPrompt !== props.prompt)
      emit('update:prompt', nextPrompt)
  }
  else {
    audioMood.value = ''
  }
  kindMenu.value = false
  persistAudioParams()
}

function setAudioMood(id: (typeof AUDIO_MOODS)[number]['id']) {
  const nextPrompt = applyAudioMoodPrompt(props.prompt, id, audioMood.value)
  audioMood.value = id
  if (nextPrompt !== props.prompt)
    emit('update:prompt', nextPrompt)
  persistAudioParams()
}

function onSend() {
  if (props.submitting || props.locked)
    return
  if (noModels.value) {
    toast.add({ title: t('暂无可用模型，请联系运营开通'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  if (talkingNoModel.value) {
    toast.add({ title: t('暂无原生带声的视频模型，请联系运营'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  if (talkingScriptEmpty.value) {
    toast.add({ title: t('请先填写口播台词'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  emit('generate', generatePayload())
}

function onPanelPointer(event: PointerEvent) {
  const el = event.target as HTMLElement
  if (!el.closest('.canvas-inspector__model'))
    modelMenu.value = false
  if (!el.closest('.canvas-inspector__mode'))
    modeMenu.value = false
  if (!el.closest('.canvas-inspector__spec'))
    specMenu.value = false
}

function onInput(event: Event) {
  emit('update:prompt', (event.target as HTMLTextAreaElement).value)
}

function focusPrompt(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('button') || target.tagName === 'TEXTAREA' || target.closest('[contenteditable="true"]'))
    return
  const el = (event.currentTarget as HTMLElement).querySelector('textarea, [contenteditable="true"]') as HTMLElement | null
  el?.focus()
}

function thumbSrc(url: string) {
  return resolveMediaUrl(url)
}

function onEsc(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!specMenu.value && !modelMenu.value && !modeMenu.value && !kindMenu.value))
    return
  event.stopPropagation()
  closeMenus()
}

/**
 * 节点检查器里除了能自己滚动的区域（提示词输入框、缩略图列表、各级下拉）之外，
 * 滚轮直接平移画布，不在检查器上卡住导致画布滚不动。
 */
const { panBy } = useVueFlow('easytv-canvas')
function onWheel(event: WheelEvent) {
  const el = event.target as HTMLElement | null
  if (!el)
    return
  // 这些元素自己吃滚轮：文本输入、自带滚动条的下拉 / 列表
  if (el.closest('textarea, [contenteditable="true"], .canvas-inspector__models, .canvas-inspector__specs, .canvas-inspector__slash, .canvas-inspector__attach, .canvas-inspector__subjects, .canvas-inspector__talking-script'))
    return
  // 其余区域：阻止默认行为，把滚轮交给画布平移
  event.preventDefault()
  const zoom = 1
  // deltaY 正值是向下滚 → 画布向上（y 减）平移，与 pan-on-scroll 方向一致
  void panBy({ x: -event.deltaX / zoom, y: -event.deltaY / zoom })
}

onMounted(() => {
  window.addEventListener('keydown', onEsc, true)
  const root = inspectorRootRef.value
  if (root)
    root.addEventListener('wheel', onWheel, { passive: false })
})
onUnmounted(() => {
  window.removeEventListener('keydown', onEsc, true)
  const root = inspectorRootRef.value
  if (root)
    root.removeEventListener('wheel', onWheel)
})

const placeholder = computed(() => {
  if (isText.value)
    return t('描述你想要生成或修改的内容')
  if (isTalkingMode.value)
    return t('补充画面描述（可选），如：穿白衬衫，办公室背景')
  if (isVideo.value)
    return t('描述你想要生成的画面内容，{at}引用素材', { at: '@' })
  if (isAudio.value)
    return t(`canvas.audio.placeholder.${audioKind.value}`)
  if (isDirector.value)
    return t('描述镜头、角色走位和场景调度，如：角色从门口走向窗边')
  return t('可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为雪夜')
})
</script>

<template>
  <Teleport to="body" :disabled="!expanded">
  <div
    v-if="expanded"
    class="canvas-inspector-mask"
    @pointerdown="emit('update:expanded', false)"
  />
  <div
    ref="inspectorRootRef"
    class="canvas-inspector nodrag nopan"
    data-guide="inspector"
    :class="{ 'is-open': expanded, 'is-media': isMedia, 'is-roomy': isRoomy, 'is-video': isVideo, 'is-image': isImage, 'is-audio': isAudio, 'is-director': isDirector, 'is-text': isText, 'is-over-mark': overMark, 'is-write-blocked': writeBlocked, 'is-locked': locked }"
    :style="expanded ? undefined : panelStyle ?? undefined"
    @pointerdown.stop="onPanelPointer"
    @dblclick.stop
  >
    <div class="canvas-inspector__tools">
      <button
        type="button"
        class="canvas-inspector__chip"
        :class="{ 'is-on': locked }"
        :disabled="readonly"
        :title="readonlyTitle || t('canvas.lock.hint')"
        @click="emit('toggle-lock')"
      >
        <UIcon :name="locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" class="size-3.5" />
        {{ locked ? t('canvas.lock.unlock') : t('canvas.lock.lock') }}
      </button>
      <!-- 运镜 chip 单独走一条静态锚点分支：跟练的 inspector-cam 要落在它身上（设计 §四 #10） -->
      <template v-for="chip in chips" :key="chip.key">
        <button
          v-if="chip.key === 'cam'"
          type="button"
          class="canvas-inspector__chip"
          data-guide="inspector-cam"
          :class="{ 'is-on': chipOn(chip.key) }"
          :disabled="writeBlocked"
          :title="writeBlockedTitle"
          @click="emit('chip', chip.key)"
        >
          <UIcon :name="chipOn(chip.key) ? 'i-lucide-check' : chip.icon" class="size-3.5" />
          {{ chipOn(chip.key) ? chipOnLabel(chip) : chip.label }}
        </button>
        <button
          v-else
          type="button"
          class="canvas-inspector__chip"
          :class="{ 'is-on': chipOn(chip.key) }"
          :disabled="writeBlocked"
          :title="writeBlockedTitle"
          @click="emit('chip', chip.key)"
        >
          <UIcon :name="chipOn(chip.key) ? 'i-lucide-check' : chip.icon" class="size-3.5" />
          {{ chipOn(chip.key) ? chipOnLabel(chip) : chip.label }}
        </button>
      </template>
      <button
        v-if="canUseSubjects"
        type="button"
        class="canvas-inspector__chip"
        data-guide="inspector-subject"
        :class="{ 'is-on': subjectIds.length > 0 }"
        :disabled="writeBlocked"
        :title="writeBlockedTitle"
        @click="subjectPickerOpen = true"
      >
        <UIcon :name="subjectIds.length ? 'i-lucide-check' : 'i-lucide-users-round'" class="size-3.5" />
        {{ subjectIds.length ? t('已引用 {n} 个主体', { n: subjectIds.length }) : t('主体') }}
      </button>
      <button
        type="button"
        class="canvas-inspector__expand"
        :aria-label="expanded ? t('收起') : t('展开')"
        :disabled="readonly"
        @click="toggleExpand"
      >
        <UIcon :name="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="size-3.5" />
      </button>
    </div>

    <div class="canvas-inspector__body">
      <button
        v-if="!isMedia"
        type="button"
        class="canvas-inspector__expand"
        :aria-label="expanded ? t('收起') : t('展开')"
        :disabled="readonly"
        @click="toggleExpand"
      >
        <UIcon :name="expanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'" class="size-3.5" />
      </button>
      <div v-if="isMedia" class="canvas-inspector__attach">
        <span v-if="isFrameMode" class="canvas-inspector__frame">
          <span v-if="firstThumb" class="canvas-inspector__thumb" :title="t('首帧')">
            <button type="button" class="canvas-inspector__thumb-hit" :aria-label="t('首帧')" @click="emit('chip', 'first')">
              <img :src="thumbSrc(firstThumb.url)" alt="" draggable="false">
            </button>
            <button type="button" class="canvas-inspector__thumb-x" :aria-label="t('移除')" @click.stop="emit('clear-chip', firstThumb.key)">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </span>
          <button v-else type="button" class="canvas-inspector__add" :aria-label="t('选择首帧')" @click="emit('chip', 'first')">
            <UIcon name="i-lucide-plus" class="size-5" />
          </button>
          <em>{{ t('首帧') }}</em>
        </span>
        <span v-if="isFl2vMode" class="canvas-inspector__frame">
          <span v-if="lastThumb" class="canvas-inspector__thumb" :title="t('尾帧')">
            <button type="button" class="canvas-inspector__thumb-hit" :aria-label="t('尾帧')" @click="emit('chip', 'last')">
              <img :src="thumbSrc(lastThumb.url)" alt="" draggable="false">
            </button>
            <button type="button" class="canvas-inspector__thumb-x" :aria-label="t('移除')" @click.stop="emit('clear-chip', lastThumb.key)">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </span>
          <button v-else type="button" class="canvas-inspector__add" :aria-label="t('选择尾帧')" @click="emit('chip', 'last')">
            <UIcon name="i-lucide-plus" class="size-5" />
          </button>
          <em>{{ t('尾帧') }}</em>
        </span>
        <span
          v-for="item in displayThumbs"
          :key="item.key"
          class="canvas-inspector__thumb"
          :title="item.label"
        >
          <button
            type="button"
            class="canvas-inspector__thumb-hit"
            :aria-label="item.label"
            @click="emit('chip', item.key)"
          >
            <img
              v-if="item.kind === 'image'"
              :src="thumbSrc(item.url)"
              alt=""
              draggable="false"
            >
            <video
              v-else-if="item.kind === 'video'"
              :src="thumbSrc(item.url)"
              muted
              playsinline
            />
            <span v-else class="canvas-inspector__thumb-audio">
              <UIcon name="i-lucide-audio-lines" class="size-5" />
            </span>
          </button>
          <button
            type="button"
            class="canvas-inspector__thumb-x"
            :aria-label="t('移除')"
            @click.stop="emit('clear-chip', item.key)"
          >
            <UIcon name="i-lucide-x" class="size-3" />
          </button>
        </span>
        <span
          v-if="!isFrameMode"
          class="canvas-inspector__add-wrap"
        >
          <button
            type="button"
            class="canvas-inspector__add"
            :aria-label="t('添加参考')"
            @click="emit('chip', 'ref-local')"
          >
            <UIcon name="i-lucide-plus" class="size-5" />
          </button>
          <div class="canvas-inspector__add-menu nowheel" @pointerdown.stop>
            <button type="button" @click.stop="emit('chip', 'ref-local')">
              <UIcon name="i-lucide-upload" class="size-3.5" />
              {{ t('从本地上传') }}
            </button>
            <button type="button" @click.stop="emit('chip', 'ref-asset')">
              <UIcon name="i-lucide-folder-input" class="size-3.5" />
              {{ t('从资产选择') }}
            </button>
            <button type="button" @click.stop="emit('chip', 'ref-canvas')">
              <UIcon name="i-lucide-layout-grid" class="size-3.5" />
              {{ t('从画布选择') }}
            </button>
          </div>
        </span>
      </div>
      <div v-if="showTagRow" class="canvas-inspector__subjects">
        <span v-for="item in subjectChips" :key="item.id" class="canvas-inspector__subject" :title="item.name">
          <img v-if="item.url" :src="thumbSrc(item.url)" alt="" draggable="false">
          <UIcon v-else name="i-lucide-users-round" class="size-3.5" />
          <b>{{ item.name }}</b>
          <small v-if="item.locked" class="canvas-inspector__subject-ver">v{{ item.locked }}</small>
          <button v-if="item.outdated" type="button" class="canvas-inspector__subject-up" :title="t('主体已更新到 v{n}，点击改用新版本', { n: item.latest })" @click.stop="upgradeSubject(item.id)">
            {{ t('更新到 v{n}', { n: item.latest }) }}
          </button>
          <button type="button" :aria-label="t('移除')" @click.stop="removeSubject(item.id)">
            <UIcon name="i-lucide-x" class="size-3" />
          </button>
        </span>
        <em v-if="canUseSubjects && subjectChips.length">{{ t('引用主体后会自动带上参考图并补充描述') }}</em>
      </div>
      <div v-if="isTalkingMode" class="canvas-inspector__talking">
        <textarea
          class="canvas-inspector__talking-script nowheel"
          data-guide="inspector-talking"
          :value="talking.script"
          :maxlength="TALKING_SCRIPT_MAX"
          :rows="expanded ? 6 : 3"
          :placeholder="t('输入要说的台词（必填，最多 {n} 字）', { n: TALKING_SCRIPT_MAX })"
          :readonly="writeBlocked"
          @input="onTalkingScript"
        />
        <div class="canvas-inspector__talking-row">
          <label>
            {{ t('语气') }}
            <select :value="talking.tone" :disabled="writeBlocked" @change="patchTalking({ tone: ($event.target as HTMLSelectElement).value as TalkingData['tone'] })">
              <option v-for="item in TALKING_TONES" :key="item.id" :value="item.id">{{ t(item.label) }}</option>
            </select>
          </label>
          <label>
            {{ t('景别') }}
            <select :value="talking.framing" :disabled="writeBlocked" @change="patchTalking({ framing: ($event.target as HTMLSelectElement).value as TalkingData['framing'] })">
              <option v-for="item in TALKING_FRAMINGS" :key="item.id" :value="item.id">{{ t(item.label) }}</option>
            </select>
          </label>
          <button type="button" class="canvas-inspector__talking-dur" :title="writeBlocked ? (writeBlockedTitle || t('点击改时长档')) : t('点击改时长档')" :disabled="writeBlocked" @click="toggleSpec">
            <UIcon name="i-lucide-clock-3" class="size-3.5" />
            {{ talkingManualSeconds ? t('时长 {n} 秒（手动）', { n: talkingManualSeconds }) : t('自动时长 {n} 秒', { n: talkingAutoSeconds }) }}
          </button>
          <em class="canvas-inspector__talking-count">{{ talking.script.length }}/{{ TALKING_SCRIPT_MAX }}</em>
        </div>
        <p v-if="talkingNoModel" class="canvas-inspector__note is-warn">{{ t('暂无原生带声的视频模型，请联系运营') }}</p>
      </div>
      <div class="canvas-inspector__compose" @click="focusPrompt">
        <p v-if="retakeClip" class="canvas-inspector__retake-line">
          {{ t('把') }}
          <span class="canvas-inspector__retake-chip">{{ retakeClip.label }}</span>
          {{ t('中') }}
          <span class="canvas-inspector__retake-chip">
            <UIcon name="i-lucide-clock-3" class="size-3.5" />
            {{ retakeClip.range }}
          </span>
        </p>
        <CanvasPromptInput
          v-if="isVideo || isImage"
          ref="promptInputRef"
          data-guide="inspector-prompt"
          v-model:slash-open="slashOpen"
          :model-value="prompt"
          :placeholder="placeholder"
          :readonly="writeBlocked"
          :camera-move="cameraMove"
          :marks="markElements"
          :refs="refs"
          @update:model-value="emit('update:prompt', $event)"
          @open-cam="emit('chip', 'cam')"
          @remove-mark="emit('remove-mark', $event)"
          @slash="onSlash"
          @slash-move="onSlashMove"
          @slash-confirm="onSlashConfirm"
          @pick-ref="emit('chip', $event === 'canvas' ? 'ref-canvas' : 'ref-asset')"
        />
        <textarea
          v-else
          data-canvas-inspector-input
          data-guide="inspector-prompt"
          :value="prompt"
          :rows="expanded ? 10 : isText || isRoomy ? 5 : 3"
          :placeholder="placeholder"
          :readonly="writeBlocked"
          @input="onInput"
        />
        <!-- Slash 面板（L2）：打 "/" 唤起当前节点能用的能力 -->
        <div v-if="slashOpen" class="canvas-inspector__slash nowheel" @pointerdown.stop @wheel.stop>
          <p>{{ t('快捷能力，↑↓ 选择，回车确认') }}</p>
          <button
            v-for="(item, index) in slashItems"
            :key="item.key"
            type="button"
            :class="{ 'is-on': index === slashIndex }"
            @mouseenter="slashIndex = index"
            @pointerdown.prevent="pickSlash(item.key)"
          >
            <UIcon :name="item.icon" class="size-4" />
            <span>
              <strong>{{ t(item.label) }}</strong>
              <em>{{ t(item.hint) }}</em>
            </span>
          </button>
        </div>
      </div>
    </div>

    <div class="canvas-inspector__bar">
      <div v-if="!noModels" class="canvas-inspector__model">
        <button type="button" class="canvas-inspector__model-btn" data-guide="inspector-model" :disabled="writeBlocked" :title="writeBlockedTitle" @click="toggleModel">
          <UIcon v-if="isText" name="i-lucide-box" class="size-3.5" />
          <span v-else class="canvas-inspector__model-mark" />
          <span class="canvas-inspector__model-name">{{ currentModel.name }}</span>
          <i v-if="currentModel.warn" class="canvas-inspector__model-warn">{{ t('近期失败多') }}</i>
          <UIcon :name="expanded || modelMenu ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
          <!-- 原生 title 一动就消失；换应用统一的悬停提示，模型菜单打开时不显示 -->
          <span v-if="!modelMenu && (currentModel.desc || currentModel.name)" class="canvas-tip canvas-tip--up">
            {{ currentModel.desc || currentModel.name }}
          </span>
        </button>
        <div v-if="modelMenu" ref="modelMenuRef" class="canvas-inspector__models nowheel" @pointerdown.stop @wheel.stop>
          <p v-if="talkingNoModel" class="canvas-inspector__note is-warn">{{ t('暂无原生带声的视频模型，请联系运营') }}</p>
          <button
            v-for="item in models"
            :key="item.id"
            ref="modelMenuItems"
            type="button"
            :class="{ 'is-on': modelId === item.id }"
            @click="pickModel(item.id)"
          >
            <span class="canvas-inspector__model-mark" />
            <span>
              <strong>{{ item.name }}</strong>
              <i v-if="item.warn" class="canvas-inspector__model-warn">{{ t('近期失败多') }}</i>
              <em v-if="item.desc" :title="item.desc">{{ item.desc }}</em>
              <small v-if="item.detail?.gateway_available && item.detail.vendor?.name" class="canvas-inspector__model-vendor">
                {{ item.detail.vendor.name }}
                <template v-if="item.detail.category"> · {{ item.detail.category }}</template>
              </small>
              <small v-if="item.promo" class="canvas-promo">
                <s>{{ item.promo.origin }}</s>
                {{ t('{n} 积分/{unit}', { n: item.promo.price, unit: t(item.promo.unit) }) }}
                <i class="canvas-promo__chip">{{ item.promo.label || t('促销') }}</i>
              </small>
            </span>
          </button>
        </div>
      </div>

      <i v-if="isVideo && !noModels" class="canvas-inspector__split" />
      <div v-if="isVideo" class="canvas-inspector__mode">
        <button type="button" class="canvas-inspector__meta" data-guide="inspector-mode" :disabled="writeBlocked" :title="writeBlockedTitle" @click="toggleMode">
          {{ currentMode.label }}
          <UIcon :name="modeMenu ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
        </button>
        <div v-if="modeMenu" class="canvas-inspector__models nowheel" @pointerdown.stop @wheel.stop>
          <button
            v-for="item in VIDEO_MODES"
            :key="item.id"
            type="button"
            :class="{ 'is-on': videoMode === item.id }"
            @click="pickMode(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
      </div>

      <i v-if="isAudio && !noModels" class="canvas-inspector__split" />
      <div v-if="isAudio" class="canvas-inspector__mode">
        <button type="button" class="canvas-inspector__meta" data-guide="inspector-audio-kind" :disabled="writeBlocked" :title="writeBlockedTitle" @click="toggleKind">
          {{ t(`canvas.audio.kind.${audioKind}`) }}
          <UIcon :name="kindMenu ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
        </button>
        <div v-if="kindMenu" class="canvas-inspector__models nowheel" @pointerdown.stop @wheel.stop>
          <button
            v-for="item in AUDIO_KINDS"
            :key="item"
            type="button"
            :class="{ 'is-on': audioKind === item }"
            @click="setAudioKind(item)"
          >
            {{ t(`canvas.audio.kind.${item}`) }}
          </button>
        </div>
      </div>

      <i v-if="isMedia && (!noModels || isVideo || isAudio)" class="canvas-inspector__split" />
      <div v-if="isMedia" class="canvas-inspector__spec">
        <button type="button" class="canvas-inspector__meta" data-guide="inspector-audio" :class="{ 'is-on': specMenu }" :disabled="writeBlocked" :title="writeBlockedTitle" @click="toggleSpec">
          <i v-if="isVideo || isDirector" class="canvas-inspector__ratio-mini" :style="ratioBox(ratio)" />
          {{ specSummary }}
          <UIcon
            v-if="isVideo"
            :name="audioOn || isTalkingMode ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
            class="size-3.5"
          />
          <UIcon :name="specMenu ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
        </button>
        <div v-if="specMenu" class="canvas-inspector__specs" @pointerdown.stop>
          <template v-if="isImage">
            <section>
              <h4>{{ t('画质') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in QUALITY_ITEMS"
                  :key="item.id"
                  type="button"
                  :class="{ 'is-on': quality === item.id }"
                  @click="quality = item.id"
                >
                  {{ item.label }}
                </button>
              </div>
            </section>
            <section v-if="!isPanorama">
              <h4>{{ t('清晰度') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in CLARITY_ITEMS"
                  :key="item"
                  type="button"
                  :class="{ 'is-on': clarity === item }"
                  @click="clarity = item"
                >
                  {{ item }}
                </button>
              </div>
            </section>
          </template>
          <section v-if="!isAudio && !isPanorama">
            <h4>{{ t('比例') }}</h4>
            <div class="canvas-inspector__ratios">
              <button
                v-for="item in RATIO_ITEMS"
                :key="item"
                type="button"
                :class="{ 'is-on': ratio === item }"
                @click="ratio = item"
              >
                <i :style="ratioBox(item)" />
                {{ item }}
              </button>
            </div>
          </section>
          <template v-if="isVideo || isDirector">
            <section>
              <h4>{{ t('分辨率') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in videoResItems"
                  :key="item"
                  type="button"
                  :class="{ 'is-on': videoRes === item }"
                  @click="videoRes = item"
                >
                  {{ item }}
                </button>
              </div>
            </section>
            <section v-if="isTalkingMode">
              <h4>{{ t('时长') }}</h4>
              <div class="canvas-inspector__picks">
                <button type="button" :class="{ 'is-on': !talkingManualSeconds }" @click="patchTalking({ duration: undefined })">
                  {{ t('自动') }} {{ talkingAutoSeconds }}s
                </button>
                <button
                  v-for="n in videoDurationNumbers"
                  :key="n"
                  type="button"
                  :class="{ 'is-on': talkingManualSeconds === n }"
                  @click="patchTalking({ duration: n })"
                >
                  {{ n }}s
                </button>
              </div>
              <p class="canvas-inspector__note">{{ t('按台词长度自动算档，口播固定带声') }}</p>
            </section>
            <section v-else>
              <h4>{{ t('时长') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in videoDurationItems"
                  :key="item"
                  type="button"
                  :class="{ 'is-on': videoDuration === item }"
                  @click="videoDuration = item"
                >
                  {{ item }}
                </button>
              </div>
            </section>
            <section v-if="isVideo && !isTalkingMode">
              <h4>{{ t('音频') }}</h4>
              <div class="canvas-inspector__picks is-duo">
                <button type="button" :class="{ 'is-on': audioOn }" @click="audioOn = true">
                  {{ t('有声') }}
                </button>
                <button type="button" :class="{ 'is-on': !audioOn }" @click="audioOn = false">
                  {{ t('无声') }}
                </button>
              </div>
            </section>
          </template>
          <template v-else-if="isAudio">
            <section>
              <h4>{{ t('时长') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in audioDurationItems"
                  :key="item"
                  type="button"
                  :class="{ 'is-on': audioDuration === item }"
                  @click="setAudioDuration(item)"
                >
                  {{ item }}
                </button>
              </div>
            </section>
            <section v-if="audioKind === 'bgm'">
              <h4>{{ t('canvas.audio.mood.title') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in AUDIO_MOODS"
                  :key="item.id"
                  type="button"
                  :class="{ 'is-on': audioMood === item.id }"
                  @click="setAudioMood(item.id)"
                >
                  {{ t(`canvas.audio.mood.${item.id}`) }}
                </button>
              </div>
              <p class="canvas-inspector__note">{{ t('canvas.audio.noteBgm') }}</p>
            </section>
            <section v-if="audioUsesVoice(audioKind)">
              <h4>{{ t('语种') }}</h4>
              <div class="canvas-inspector__picks">
                <button
                  v-for="item in langs"
                  :key="item.code"
                  type="button"
                  :class="{ 'is-on': audioLang === item.code }"
                  @click="setAudioLang(item.code)"
                >
                  {{ item.label }}
                </button>
              </div>
              <p class="canvas-inspector__note">{{ t('非中文时服务端会先把台词翻译成该语种再配音') }}</p>
            </section>
            <section v-if="audioUsesVoice(audioKind)">
              <h4>{{ t('音色') }}</h4>
              <input
                v-model="audioVoice"
                class="canvas-inspector__text"
                maxlength="60"
                :placeholder="t('音色名，留空用模型默认音色')"
                @change="persistAudioParams"
                @blur="persistAudioParams"
              >
            </section>
            <p v-if="audioKind === 'sfx'" class="canvas-inspector__note">{{ t('canvas.audio.noteBgm') }}</p>
          </template>
          <section v-if="isImage && !isPanorama">
            <h4>{{ t('生成数量') }}</h4>
            <div class="canvas-inspector__picks">
              <button
                v-for="item in COUNT_ITEMS"
                :key="item"
                type="button"
                :class="{ 'is-on': count === item }"
                @click="count = item"
              >
                {{ item }}{{ countUnit }}
              </button>
            </div>
          </section>
        </div>
      </div>

      <button v-if="isText" type="button" class="canvas-inspector__icon" :disabled="writeBlocked" :title="writeBlockedTitle" @click="emit('chip', 'skill')">
        <UIcon name="i-lucide-zap" class="size-3.5" />
        {{ t('技能') }}
        <UIcon name="i-lucide-chevron-down" class="size-3" />
      </button>
      <button v-if="isText" type="button" class="canvas-inspector__icon" :disabled="writeBlocked" :title="writeBlockedTitle" @click="emit('chip', 'template')">
        <UIcon name="i-lucide-lightbulb" class="size-3.5" />
        {{ t('模板') }}
      </button>
      <button v-if="isText" type="button" class="canvas-inspector__icon" :disabled="writeBlocked" :title="writeBlockedTitle" @click="emit('chip', 'prompt')">
        <UIcon name="i-lucide-quote" class="size-3.5" />
        {{ t('提示词库') }}
      </button>
      <span class="canvas-inspector__grow" />
      <button v-if="!isText && !noModels" type="button" class="canvas-inspector__icon canvas-inspector__cost" :class="{ 'is-promo': zapPromo }" :aria-label="t('额度')" @click="emit('quota')">
        <UIcon name="i-lucide-zap" class="size-4" />
        <span class="canvas-inspector__cost-text">{{ typeof zapCost === 'number' ? t('预计扣 {n} 积分', { n: zapCost }) : zapCost }}</span>
        <i v-if="zapPromo" class="canvas-promo__chip">{{ currentModel.promo?.label || t('促销') }}</i>
        <span class="canvas-tip canvas-tip--up">{{ t('额度') }}</span>
      </button>
      <button
        type="button"
        class="canvas-inspector__send"
        data-guide="inspector-run"
        :aria-label="submitting ? t('生成中…') : t('生成')"
        :disabled="noModels || talkingNoModel || submitting || locked"
        @click="onSend"
      >
        <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'" class="size-4" :class="{ 'animate-spin': submitting }" />
        <span class="canvas-tip canvas-tip--up">{{ submitting ? t('生成中…') : t('生成') }}</span>
      </button>
    </div>
  </div>
  <CanvasSubjectPicker
    :open="subjectPickerOpen"
    :selected="subjectIds"
    :max="MAX_SUBJECTS"
    @close="subjectPickerOpen = false"
    @update:selected="onSubjectPick"
  />
  </Teleport>
</template>
