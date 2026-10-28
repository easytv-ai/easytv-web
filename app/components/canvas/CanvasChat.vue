<script setup lang="ts">
import { useToast } from '#imports'
import { useAuth } from '~/composables/useAuth'
import skillApi from '~/api/skill'
import styleApi from '~/api/style'
import taskApi from '~/api/task'
import canvasApi from '~/api/canvas'
import assetApi from '~/api/asset'
import aiChatApi, { type ChatQuota } from '~/api/ai-chat'
import { agentModeFor, chatQuotaDisabled, chatQuotaExhausted, chatQuotaLabel, isChatQuotaExceeded, pickedPoints, type AgentPlan, type AssistBridge } from '~/utils/canvas-assist'
import type { GenerationModel, Skill, Asset } from '~/types/creative'
import { isVisionTextModel } from '~/utils/image-input'
import { resolveMediaUrl } from '~/utils/media'
import { promptTemplates } from '~/utils/canvas-templates'
import { writeChatEntry, type ChatEntryDraft } from '~/utils/chat-entry'
import { effectiveUnitPrice, modelPromoDisplay } from '~/utils/model-price'
import { shortModelName } from '~/utils/model-name'
import { fetchLobeInlineSvg } from '~/utils/lobe-icon'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import { useGenerationModelDetail } from '~/composables/useGenerationModelDetail'
import { CANVAS_AGENT_SETTINGS_KEY } from '~/composables/useCanvasAgentSettings'
import {
  briefAnchorPrompt,
  briefAskPicks,
  briefAskPrompt,
  briefBoardPrompt,
  briefCharacters,
  briefDraftPrompt,
  briefFrameRatio,
  briefHistoryText,
  briefNodeTitle,
  briefPathOf,
  briefProps,
  briefSceneBody,
  briefScenes,
  briefShots,
  briefSpecChips,
  briefTitle,
  briefGenerateGroups,
  briefVoices,
  briefWantsBoard,
  briefWantsFilm,
  characterImagePrompt,
  propImagePrompt,
  sceneImagePrompt,
  shotImagePrompt,
  parseBriefAsk,
  parseBriefDoc,
  plainChatPrompt,
  shouldOpenBrief,
  looksLikeComposeReport,
  voiceAudioPrompt,
  type BriefAskCard,
  type BriefCard,
  type BriefDocCard,
  type BriefGenerateCard,
  type BriefGenerateCounts,
  type BriefComposeOpts,
  type BriefComposeReport,
  type BriefGenerateProgress,
  type BriefGenerateReport,
  type BriefPath,
  type BriefQuestion,
  type BriefVideoCard,
  type BriefVoiceCard,
} from '~/utils/canvas-chat-brief'
import { fillI18n } from '~/utils/i18n-fill'
const { canvasNodeItems, load: loadAppConfig } = useStudioAppConfig()
const { isMember } = useWallet()
const { gotoPricing } = usePricingModal()
const { settings, save: saveSettings, setPointsRemind, setPointsThreshold, confirmSpend } = useCanvasAgentSettings()

const { t: tRaw } = useI18n()
const localePath = useLocalePath()
const { confirm } = useConfirm()

/** t() 预编译失效时会把 {n} 原样吐出来，再填一遍 */
function t(key: string, vars?: Record<string, string | number>) {
  const raw = vars ? tRaw(key, vars) : tRaw(key)
  return vars ? fillI18n(String(raw), vars) : String(raw)
}

/**
 * 画布右侧「综合助手」：
 * - 发来剧本或长材料时，先出确认卡。成片走创作稿→锚点→分镜→音色→出图→出视频→合成；设定图和只写剧本在对应步停下。
 * - 短句仍走 POST /user/task，带上最近几句上文。
 *   发送前取目录里第一个已定价文本模型随请求带上——通用文本任务接口空 model
 *   会被直接拒（「请选择模型」，controller/task.go），省不掉
 * - 已保存的画布，会话走 /user/canvas/:id/chat，换设备登录同一账号还能看到。没保存的草稿和 Agent 入口仍留在本机。生成仍走现有的文本任务；创作稿落到文本节点，角色和分镜落到图片节点
 * - 顶部 Tab 只是打开中的快捷入口，关掉 Tab 不删记录；删除只在历史里操作
 * - 「添加 / 资产 / 上传」直接操作画布（由页面转发给 CanvasWorkspace）
 */
const props = withDefaults(defineProps<{
  canvasId: number
  /** 画布页提供的桥；只读画布不传，就没有「结合画布」 */
  assist?: AssistBridge | null
  /** 当前选中节点的名字 */
  selection?: string[]
  /** Agent 页只放这一块输入：外观与发送前的选择和画布相同，点发送后把草稿交给画布再发 */
  entry?: boolean
  briefQuote?: (groups?: string[]) => { count: number, points: number }
}>(), {
  assist: null,
  selection: () => [],
  entry: false,
  briefQuote: undefined,
})

const emit = defineEmits<{
  close: []
  insertText: [text: string, label?: string]
  /** 角色或分镜：每张图一个节点。有文本时先落文本，再从图接到这张文本上 */
  insertImages: [items: { label: string, prompt: string, ratio?: string, group?: string, tag?: string }[], fromText?: { text: string, label?: string }]
  /** 对白音色：每条声线一个音频节点，接到最近的分镜文本上 */
  insertAudios: [items: { label: string, prompt: string, group?: string, tag?: string }[]]
  resetBrief: []
  generateBrief: [groups: string[], opts?: { onProgress?: (row: BriefGenerateProgress) => void, onDone?: (report: BriefGenerateReport) => void }]
  placeVideos: [shots?: string[]]
  composeBrief: [opts?: BriefComposeOpts]
  pickAsset: [autoUpload: boolean]
  /** 资产选择器选中的资产转成对话附件（输入框上方缩略图） */
  chatAssets: [assets: Asset[]]
  /** 打开画布风格库，选中后由页面回写 applyStyle */
  openStyle: []
  /** 已提交一条本画布的任务（文本对话 / 结合画布）：画布的运行队列要立刻知道 */
  taskStarted: []
  /** Agent 页里的「创建 Skill」：留在本页打开编辑器，不再跳回自己 */
  createSkill: []
}>()

const toast = useToast()
const { user } = useAuth()

type ChatMsg = {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** 助手回复进行中 */
  pending?: boolean
  /** 失败提示 */
  error?: boolean
  taskId?: number
  /** 结合画布提问时的修改方案（对话式工作流生成，API.md 32） */
  plan?: AgentPlan
  /** 每条修改是否勾选 */
  picked?: boolean[]
  planState?: 'ready' | 'applying' | 'applied' | 'undone'
  /** 撤销凭据只在本次打开页面内有效，不写进历史 */
  undoToken?: number
  applyNote?: string
  /** 制作流水线卡片（设置 / 邀请 / 风格格），由前端画 */
  card?: BriefCard
  /** 用户选风格时带上封面 */
  thumb?: string
}

type ChatSession = {
  id: string
  title: string
  messages: ChatMsg[]
  updatedAt: number
  /** 历史列表先不带正文，条数用服务端的计数 */
  messageCount?: number
}

type ChatSkill = { id: number, title: string, slug: string, cover: string, description: string, hasGuide: boolean, /** 提示词模板（{{prompt}} 为灵感占位）：空画布技能卡用它预填输入框 */ prompt?: string }

// ---- Skill 推荐 ----
const skills = ref<ChatSkill[]>([])

async function loadSkills() {
  const res = await skillApi.list({ page: 1, page_size: 12 })
  if (!res?.success || !res.data)
    return
  skills.value = res.data.items.map(toChatSkill)
}

function toChatSkill(item: Skill): ChatSkill {
  return {
    id: item.id,
    title: item.title,
    slug: item.slug || `/skill/${item.id}`,
    cover: resolveMediaUrl(item.cover_url),
    description: item.description || '',
    prompt: item.prompt || '',
    // 填了执行契约的 Skill 会真正改变 AI 的工作方式，chip 上标出来（API.md 1.6）
    hasGuide: Boolean(item.guide?.trim() || item.output_format?.trim()),
  }
}

// ---- 技能面板：分类导航 + 懒加载缓存（全部 / 我的 / 分类）----
const { names: skillCats, load: loadSkillCats } = useContentCategories('skill')
const MINE_NAV = '__mine'
const skillNav = ref('')
const skillPanel = ref<ChatSkill[]>([])
const skillPanelLoading = ref(false)
const skillPanelFailed = ref(false)
const skillPanelCache = new Map<string, ChatSkill[]>()

const skillTabs = computed(() => [
  { key: '', label: t('canvas.chat.skill.all') },
  ...(user.value ? [{ key: MINE_NAV, label: t('我的') }] : []),
  ...skillCats.value.filter(name => name && name !== '发现').map(name => ({ key: name, label: t(name) })),
])

async function loadSkillPanel(nav: string) {
  const cached = skillPanelCache.get(nav)
  if (cached) {
    skillPanel.value = cached
    skillPanelFailed.value = false
    return
  }
  skillPanelLoading.value = true
  skillPanelFailed.value = false
  try {
    const res = nav === MINE_NAV
      ? await skillApi.mine({ page: 1, page_size: 20 })
      : await skillApi.list({ page: 1, page_size: 20, category: nav || undefined })
    if (skillNav.value !== nav)
      return
    if (!res?.success || !res.data) {
      skillPanel.value = []
      skillPanelFailed.value = true
      notify(res?.message || t('Skill 加载失败'), 'error')
      return
    }
    const items = res.data.items.map(toChatSkill)
    skillPanelCache.set(nav, items)
    skillPanel.value = items
    skillPanelFailed.value = false
  }
  catch {
    if (skillNav.value !== nav)
      return
    skillPanel.value = []
    skillPanelFailed.value = true
    notify(t('Skill 加载失败'), 'error')
  }
  finally {
    skillPanelLoading.value = false
  }
}

function selectSkillNav(nav: string) {
  skillNav.value = nav
  void loadSkillPanel(nav)
}

function skillRowOn(item: ChatSkill) {
  return agentAutoModel.value && activeSkill.value?.id === item.id
}

/** 从面板选中技能：交给 Agent 自动选模型。已选中的不在这里取消，取消走行尾按钮 */
function pickSkillFromPanel(item: ChatSkill) {
  if (skillRowOn(item))
    return
  pickSkill(item)
  agentAutoModel.value = true
  writeStorage(AGENT_AUTO_MODEL_KEY, true)
  popover.value = null
}

/** 技能列表里的「自由创作」：关掉自动，自己选模型。取消走行尾按钮，并打开 Agent 自动 */
function pickFreeCreate() {
  if (!agentAutoModel.value)
    return
  pickSkill(null)
  agentAutoModel.value = false
  writeStorage(AGENT_AUTO_MODEL_KEY, false)
  popover.value = null
}

function createSkill() {
  popover.value = null
  if (props.entry) {
    emit('createSkill')
    return
  }
  void navigateTo(localePath('/agent'))
}

// ---- 对话额度（免费对话的每日次数；对话模型由平台统一配置，不再让用户选）----
const quota = ref<ChatQuota | null>(null)

/** 打开面板与每次发送结束后刷新（两条路径都刷）；请求失败保留上一次的值，不打断对话 */
async function loadQuota() {
  const res = await aiChatApi.quota()
  if (res?.success && res.data)
    quota.value = res.data
}

// ---- 模型能力 ----
const models = ref<GenerationModel[]>([])
const modelsLoading = ref(true)
const chatModel = ref('')
const textModels = computed(() => models.value.filter(item => item.type === 'text'))
const modelGroups = computed(() => {
  const order: { type: GenerationModel['type'], label: string }[] = [
    { type: 'text', label: '文本' },
    { type: 'image', label: '图片' },
    { type: 'video', label: '视频' },
    { type: 'audio', label: '音频' },
  ]
  return order
    .map(group => ({ ...group, items: models.value.filter(item => item.type === group.type) }))
    .filter(group => group.items.length)
})

async function loadModels() {
  modelsLoading.value = true
  try {
    const res = await taskApi.models()
    if (!res?.success || !res.data)
      return
    models.value = res.data
    const saved = readStorage<{ model?: string }>(CANVAS_AGENT_SETTINGS_KEY, {})
    const want = String(saved.model || '')
    if (want && textModels.value.some(item => item.model === want))
      chatModel.value = want
    else if (!chatModel.value && textModels.value.length)
      chatModel.value = textModels.value[0]!.model
    if (!agentAutoModel.value)
      ensureModelIcon(pickedModelId.value || chatModel.value)
  }
  finally {
    modelsLoading.value = false
  }
}

// ---- 模型面板（Agent 弹层）----
const modelTab = ref<GenerationModel['type']>('text')
/**
 * Agent 自动选模型：开着时对话任务不再固定用 chatModel——
 * 带图片附件的消息自动挑能看图的文本模型（pickVisionTextModel 同一套偏好），
 * 纯文字用第一个已定价文本模型；结合画布（askAgent）则不传 model，
 * 由服务端按 AgentModel → 第一个已定价文本模型兜底。
 */
const AGENT_AUTO_MODEL_KEY = 'easytv-chat-agent-auto-model'
const agentAutoModel = ref(false)
/** 关掉自动后，工具栏和列表高亮用的模型；空则沿用当前对话模型 */
const pickedModelId = ref('')
const activeModelGroup = computed(() => modelGroups.value.find(group => group.type === modelTab.value))
const displayModel = computed(() => {
  const id = pickedModelId.value || chatModel.value
  return models.value.find(item => item.model === id) || null
})
/**
 * 关掉 Agent、选了具体模型之后，工具栏出现参数按钮。
 * 文本模型也给这组选项：对话里出图、出视频时按这里的比例、时长、分辨率。
 */
const showRatio = computed(() => {
  const type = displayModel.value?.type
  return !agentAutoModel.value && (type === 'text' || type === 'image' || type === 'video')
})
const showDuration = computed(() => {
  const type = displayModel.value?.type
  return !agentAutoModel.value && (type === 'text' || type === 'video' || type === 'audio')
})
const PARAM_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'] as const
const GEN_PARAMS_KEY = 'easytv-chat-gen-params'
const genRatio = ref<(typeof PARAM_RATIOS)[number]>('16:9')
const genSeconds = ref(15)
const genResolution = ref('')
const durationChoices = computed(() => {
  const list = (displayModel.value?.durations || []).filter(n => n > 0)
  return list.length ? list : [5, 10, 15]
})
const resolutionChoices = computed(() => {
  const model = displayModel.value
  if (!model || agentAutoModel.value)
    return []
  const list = (model.resolutions || []).map(item => item.trim()).filter(Boolean)
  if (list.length)
    return list
  if (model.type === 'video' || model.type === 'text')
    return ['768p', '2k']
  return []
})
const showGenParams = computed(() => showRatio.value || showDuration.value || resolutionChoices.value.length > 0)
/** 发送左边的参数胶囊：比例、时长、分辨率，有哪项写哪项 */
const paramsSummary = computed(() => {
  const bits: string[] = []
  if (showRatio.value)
    bits.push(genRatio.value)
  if (showDuration.value)
    bits.push(`${genSeconds.value}s`)
  if (genResolution.value && resolutionChoices.value.length)
    bits.push(genResolution.value)
  return bits.join(' · ')
})
const durationMin = computed(() => durationChoices.value[0] ?? 5)
const durationMax = computed(() => durationChoices.value[durationChoices.value.length - 1] ?? 15)

function ratioShape(ratio: string) {
  const [aw, ah] = ratio.split(':').map(Number)
  const w = Math.max(1, aw || 1)
  const h = Math.max(1, ah || 1)
  const scale = Math.min(22 / w, 14 / h)
  return {
    width: `${Math.max(8, Math.round(w * scale))}px`,
    height: `${Math.max(8, Math.round(h * scale))}px`,
  }
}

function formatResolutionLabel(item: string) {
  const compact = item.trim().replace(/\s+/g, '')
  if (/^\d+(\.\d+)?k$/i.test(compact))
    return `${compact.slice(0, -1)}K`
  return item.trim()
}

function loadGenParams() {
  const saved = readStorage<{ ratio?: string, seconds?: number, resolution?: string }>(GEN_PARAMS_KEY, {})
  if (PARAM_RATIOS.includes(saved.ratio as (typeof PARAM_RATIOS)[number]))
    genRatio.value = saved.ratio as (typeof PARAM_RATIOS)[number]
  if (typeof saved.seconds === 'number' && saved.seconds > 0)
    genSeconds.value = saved.seconds
  if (saved.resolution)
    genResolution.value = saved.resolution
}

function saveGenParams() {
  writeStorage(GEN_PARAMS_KEY, {
    ratio: genRatio.value,
    seconds: genSeconds.value,
    resolution: genResolution.value,
  })
}

function clampGenParams() {
  if (showDuration.value && !durationChoices.value.includes(genSeconds.value))
    genSeconds.value = durationChoices.value[durationChoices.value.length - 1] ?? 15
  const resolutions = resolutionChoices.value
  if (!resolutions.length)
    return
  const hit = resolutions.find(item => item.toLowerCase() === genResolution.value.trim().toLowerCase())
  genResolution.value = hit || resolutions[0]!
}

/** 选中的风格只跟请求走，不写进对话气泡 */
function styleRequestPrefix() {
  if (!activeStylePrompt.value)
    return ''
  return `${t('风格：{style}', { style: activeStylePrompt.value })}\n`
}

function withoutStylePrefix(text: string) {
  const prefix = styleRequestPrefix()
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text
}

/** 发给助手的生成约束，不写进对话气泡 */
function generationHint() {
  if (!showGenParams.value)
    return ''
  const bits: string[] = []
  const model = displayModel.value
  if (model && (model.type === 'image' || model.type === 'video'))
    bits.push(`${t('模型')} ${model.model}`)
  if (showRatio.value)
    bits.push(`${t('比例')} ${genRatio.value}`)
  if (showDuration.value)
    bits.push(`${t('时长')} ${genSeconds.value}${t('秒')}`)
  if (genResolution.value && resolutionChoices.value.length)
    bits.push(`${t('分辨率')} ${genResolution.value}`)
  return bits.length ? `\n[${t('canvas.chat.attach.genParams')}：${bits.join('，')}]` : ''
}

function stepSeconds(dir: -1 | 1) {
  const list = durationChoices.value
  const index = list.indexOf(genSeconds.value)
  const next = list[Math.min(list.length - 1, Math.max(0, (index < 0 ? 0 : index) + dir))]
  if (next)
    genSeconds.value = next
}
const { prefetch: prefetchModelDetails, peek: peekModelDetail } = useGenerationModelDetail()
const modelIconTick = ref(0)

/** 详情里的 icon / vendor.icon 是 Lobe 图标名（ByteDance.Color），不是图片地址 */
function detailIconName(model: string) {
  const detail = peekModelDetail(model) as any
  return String(detail?.icon || detail?.vendor?.icon || '').trim()
}

function modelIconKey(item: { model: string } | null | undefined) {
  if (!item?.model)
    return ''
  void modelIconTick.value
  return detailIconName(item.model)
}

function modelMark(item: { model: string, label?: string } | null | undefined) {
  if (!item)
    return '?'
  const name = shortModelName(item as GenerationModel).trim()
  return (name[0] || '?').toUpperCase()
}

async function paintModelIcon(model: string) {
  const icon = detailIconName(model)
  if (icon)
    await fetchLobeInlineSvg(icon)
  modelIconTick.value += 1
}

/** 当前展示的模型一确定就拉图标，不必等点开模型列表 */
function ensureModelIcon(model: string) {
  const name = String(model || '').trim()
  if (!name)
    return
  if (detailIconName(name)) {
    paintModelIcon(name)
    return
  }
  void prefetchModelDetails([name]).then(() => paintModelIcon(name))
}

/** 点开模型菜单后再补这一类的图标，已有图标名的不再打详情 */
async function warmModelIcons(type = modelTab.value) {
  const group = modelGroups.value.find(item => item.type === type)
  const ids = (group?.items || []).map(item => item.model)
  if (displayModel.value && !agentAutoModel.value)
    ids.push(displayModel.value.model)
  const missing = ids.filter(id => !detailIconName(id))
  if (missing.length)
    await prefetchModelDetails(missing)
  await Promise.all(ids.map(id => fetchLobeInlineSvg(detailIconName(id))))
  modelIconTick.value += 1
}

watch(displayModel, (model) => {
  if (model?.model && !agentAutoModel.value)
    ensureModelIcon(model.model)
})

/** 取消技能或模型选择：打开 Agent 自动，模型选择收起 */
function enableAgentAuto() {
  pickSkill(null)
  agentAutoModel.value = true
  writeStorage(AGENT_AUTO_MODEL_KEY, true)
  popover.value = null
}

function toggleAgentAutoModel() {
  agentAutoModel.value = !agentAutoModel.value
  if (agentAutoModel.value) {
    popover.value = null
  }
  else {
    pickSkill(null)
  }
  writeStorage(AGENT_AUTO_MODEL_KEY, agentAutoModel.value)
}

/** Agent 开关下的实际对话模型：带图挑看图模型，纯文字挑第一个已定价的 */
function autoChatModel(attachments: ChatAttachment[] = []) {
  const hasImage = attachments.some(item => item.kind === 'image')
  if (hasImage) {
    const vision = pickVisionTextModel(models.value)
    if (vision)
      return vision
  }
  const priced = textModels.value.filter(item => item.priced)
  return priced[0]?.model || textModels.value[0]?.model || chatModel.value
}

// ---- 风格：名字和封面留在底栏按钮上，提示词片段发送时拼在最前面 ----
const styleKey = computed(() => `easytv-chat-style-${props.entry ? 'entry' : (props.canvasId || 'draft')}`)
const activeStyleName = ref('')
const activeStylePrompt = ref('')
const activeStyleCover = ref('')
const styleCoverBroken = ref(false)
const styleCoverSrc = computed(() => activeStyleCover.value ? resolveMediaUrl(activeStyleCover.value) : '')

watch(styleCoverSrc, () => {
  styleCoverBroken.value = false
})

function writeActiveStyle(name: string, prompt: string, cover: string) {
  activeStyleName.value = name
  activeStylePrompt.value = prompt
  activeStyleCover.value = cover
  writeStorage(styleKey.value, { name, prompt, cover })
}

function applyStyle(style: { name?: string, prompt?: string, cover_url?: string } | null) {
  const name = style?.name || ''
  if (!name || activeStyleName.value === name)
    writeActiveStyle('', '', '')
  else
    writeActiveStyle(name, style?.prompt || name, style?.cover_url || '')
}

// ---- 提示词结构模板（与节点模板弹窗共用一份定义）----
const promptTemplateList = computed(() => promptTemplates(t))

function usePromptTemplate(item: { text: string }) {
  prompt.value = prompt.value ? `${prompt.value}\n${item.text}` : item.text
  popover.value = null
  nextTick(() => inputRef.value?.focus())
}

// ---- 附件：+ 菜单按当前模式给出图片 / 视频 / 音频 / 剧本。剧本读 txt 落到文本节点；其余缩略图放在输入框上方，随消息一起发送 ----
type ChatAttachment = {
  key: string
  /** image / video / audio=资产引用 */
  kind: 'image' | 'video' | 'audio'
  name: string
  content?: string
  assetId?: number
  url?: string
  /** 资产上传中 */
  pending?: boolean
}
const attachments = ref<ChatAttachment[]>([])

type AttachKind = 'image' | 'video' | 'audio'
type AttachMenuKind = AttachKind | 'script'
type AttachMenuItem = {
  kind: AttachMenuKind
  icon: string
  label: string
  hint: string
  accept: string
}

const SCRIPT_MAX = 5000

const attachImage: AttachMenuItem = { kind: 'image', icon: 'i-lucide-image', label: '', hint: 'jpeg, jpg, png', accept: 'image/*' }
const attachVideo: AttachMenuItem = { kind: 'video', icon: 'i-lucide-clapperboard', label: '', hint: '', accept: 'video/*' }
const attachAudio: AttachMenuItem = { kind: 'audio', icon: 'i-lucide-audio-lines', label: '', hint: 'mp3, wav, m4a', accept: 'audio/*' }
const attachScript: AttachMenuItem = { kind: 'script', icon: 'i-lucide-pen-line', label: '', hint: '', accept: '.txt,.text,.md,.markdown,text/plain,text/markdown' }

/** 选了技能：图片、视频、剧本。选了模型：图片、视频、音频。Agent 自动再加剧本 */
const attachMenu = computed<AttachMenuItem[]>(() => {
  const image = { ...attachImage, label: t('图片') }
  const video = { ...attachVideo, label: t('视频'), hint: `mp4, mov，${t('canvas.chat.attach.videoLimit')}` }
  const audio = { ...attachAudio, label: t('音频') }
  const script = { ...attachScript, label: t('canvas.chat.attach.script'), hint: `txt，${t('canvas.chat.attach.scriptLimit')}` }
  if (activeSkill.value)
    return [image, video, script]
  if (!agentAutoModel.value)
    return [image, video, audio]
  return [image, video, audio, script]
})

const ATTACH_ICON: Record<ChatAttachment['kind'], string> = {
  image: 'i-lucide-image',
  video: 'i-lucide-clapperboard',
  audio: 'i-lucide-audio-lines',
}

function onAttachMenu(item: AttachMenuItem) {
  pickAttachFile(item.kind)
}

function pickAttachFile(kind: AttachMenuKind) {
  popover.value = null
  nextTick(() => {
    document.querySelector<HTMLInputElement>(`.canvas-chat__attach-file[data-kind="${kind}"]`)?.click()
  })
}

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(video.duration || 0)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    video.src = url
  })
}

function scriptFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, '').trim()
  return base || t('canvas.chat.attach.script')
}

function isScriptFile(file: File) {
  return /\.(txt|text|md|markdown)$/i.test(file.name) || file.type.startsWith('text/')
}

/** 剧本不是单独的节点：txt 读进文本节点，超长只留前 5000 字 */
async function placeScriptFile(file: File) {
  if (!isScriptFile(file)) {
    notify(t('上传失败，请稍后重试'), 'error')
    return
  }
  let text = ''
  try {
    text = (await file.text()).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  }
  catch {
    notify(t('上传失败，请稍后重试'), 'error')
    return
  }
  if (!text) {
    notify(t('上传失败，请稍后重试'), 'error')
    return
  }
  if (text.length > SCRIPT_MAX) {
    text = text.slice(0, SCRIPT_MAX)
    notify(t('canvas.chat.attach.scriptTrimmed'))
  }
  emit('insertText', text, scriptFileName(file.name))
}

async function onAttachFile(event: Event, kind: AttachMenuKind) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  if (kind === 'script') {
    await placeScriptFile(file)
    return
  }
  if (kind === 'video') {
    const duration = await videoDuration(file)
    if (duration > 61) {
      notify(t('canvas.chat.attach.videoTooLong'), 'error')
      return
    }
  }
  // reactive 包装后再入列：后续改 pending / url / assetId 才会触发视图更新
  const item = reactive<ChatAttachment>({
    key: `${kind[0]}${Date.now()}`,
    kind,
    name: file.name,
    pending: true,
  })
  attachments.value.push(item)
  const res = await assetApi.upload(file)
  item.pending = false
  if (!res?.success || !res.data) {
    notify(res?.message || t('上传失败，请稍后重试'), 'error')
    removeAttachment(item.key)
    return
  }
  const asset: Asset = res.data
  item.assetId = asset.id
  item.url = resolveMediaUrl(asset.cover_url || asset.url)
}

function removeAttachment(key: string) {
  attachments.value = attachments.value.filter(item => item.key !== key)
}

/** 资产选择器选中的资产转成附件（与 + 菜单上传同一形态：输入框上方缩略图） */
function addAssetAttachments(assets: Asset[]) {
  for (const asset of assets) {
    const kind = asset.type === 'image' || asset.type === 'video' || asset.type === 'audio' ? asset.type : null
    if (!kind)
      continue
    attachments.value.push({
      key: `a${asset.id}-${Date.now()}`,
      kind,
      name: asset.name,
      assetId: asset.id,
      url: resolveMediaUrl(asset.cover_url || asset.url),
    })
  }
}

function attachmentSummary(list: ChatAttachment[]) {
  if (!list.length)
    return ''
  return `[${t('参考素材')}：${list.map(item => item.name).join('、')}]`
}

// ---- 会话与历史 ----
// 已保存的画布走账号接口；草稿和 Agent 入口没有画布 id，仍写在本机。
const prompt = ref('')
const messages = ref<ChatMsg[]>([])
const briefAuto = ref(false)
const sessions = ref<ChatSession[]>([])
const openTabIds = ref<string[]>([])
const sessionId = ref('')
const batch = ref(0)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
const busy = ref(false)
/** 正在取消当前这一轮，按钮变灰，避免连点 */
const stopping = ref(false)
/** 历史删除 / 清空进行中，避免连点打出两次请求 */
const historyBusy = ref(false)
let seq = 0
let stopChatPoll = () => {}
/** 每一轮发送一个编号。停止或离开对话后编号作废，晚到的回包不再改界面 */
let runId = 0
/** 这一轮已经创建出来的任务。停止时用它取消，不能用消息上可能还留着的上一轮 taskId */
let runTaskId = 0
let runAgent = false
/** 本机临时 id（s…）换成服务端 id 之后，还在排队的保存沿用新 id */
const localToServer = new Map<string, string>()
let chatQueue: Promise<void> = Promise.resolve()
let syncToken = 0

const storageScope = computed(() => props.entry ? 'entry' : (props.canvasId || 'draft'))
const storageKey = computed(() => `easytv-chat-${storageScope.value}`)
const openTabsKey = computed(() => `easytv-chat-open-${storageScope.value}`)
const activeTabKey = computed(() => `easytv-chat-active-${storageScope.value}`)
const skillKey = computed(() => `easytv-chat-skill-${storageScope.value}`)
/**
 * 当前激活的 Skill：激活后整段对话都带 skill_id，服务端据此注入这个 Skill 的
 * 执行规则与输出格式（API.md 1.6），同时给作者记分成（T26）。
 */
const activeSkill = ref<ChatSkill | null>(null)

/** 这张画布能不能用结合画布：需要已保存（有 id）且可编辑 */
const assistAvailable = computed(() => Boolean(props.assist && props.canvasId))
/**
 * 每日免费次数只覆盖「结合画布」的 agent 对话（服务端 IsFreeChatTask 要求带 params.agent）。
 * 普通对话是普通文本任务，仍按积分计费，所以次数文案与用尽禁用都只在这条免费路径上生效，
 * 否则会出现「界面说免费、实际扣积分」或「0 次时连付费的普通对话也发不出去」。
 */
const freeChatActive = computed(() => false)
/** 平台关掉对话（AgentEnabled=false）：这条路径点了必被后端拒（「对话式工作流生成暂未开启」），直接禁用并提示 */
const chatDisabled = computed(() => freeChatActive.value && chatQuotaDisabled(quota.value))
const quotaLabel = computed(() => (freeChatActive.value && !chatDisabled.value ? chatQuotaLabel(quota.value, (key, params) => t(key, params ?? {})) : null))
const quotaExhausted = computed(() => freeChatActive.value && !chatDisabled.value && chatQuotaExhausted(quota.value))

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  }
  catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  }
  catch {
    // 私密模式等情况下忽略
  }
}

/** 已保存画布的会话在账号上；草稿和 Agent 入口没有画布 id */
function useRemoteChat() {
  return !props.entry && Number(props.canvasId) > 0
}

/** 服务端是 Unix 秒，历史时间在界面上按毫秒算 */
function chatStamp(ts: number) {
  const n = Number(ts) || 0
  if (n <= 0)
    return Date.now()
  return n < 1e12 ? n * 1000 : n
}

function serverSessionId(id: string) {
  if (!id || id.startsWith('s'))
    return 0
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : 0
}

function resolvedSessionId(id: string) {
  let current = id
  const seen = new Set<string>()
  while (localToServer.has(current) && !seen.has(current)) {
    seen.add(current)
    current = localToServer.get(current) || current
  }
  return current
}

function enqueueChat(job: () => Promise<void>) {
  const run = chatQueue.then(job, job)
  chatQueue = run.then(() => {}, () => {})
  return run
}

function sessionPayload(session: ChatSession) {
  const messages = session.messages
    .filter(item => !item.pending)
    .slice(-200)
    .map(({ undoToken: _token, ...item }) => {
      const next = { ...item }
      delete next.pending
      return next
    })
  return { title: session.title, messages }
}

function readChatMessages(data: any): ChatMsg[] {
  const raw = data?.messages
  if (Array.isArray(raw))
    return raw as ChatMsg[]
  if (typeof raw !== 'string' || !raw)
    return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as ChatMsg[] : []
  }
  catch {
    return []
  }
}

function remapSessionId(from: string, to: string) {
  if (!from || from === to)
    return
  localToServer.set(from, to)
  sessions.value = sessions.value.map(item => item.id === from ? { ...item, id: to } : item)
  openTabIds.value = openTabIds.value.map(tabId => tabId === from ? to : tabId)
  if (sessionId.value === from)
    sessionId.value = to
  persistOpenTabs()
}

function loadChatPrefs() {
  activeSkill.value = readStorage<ChatSkill | null>(skillKey.value, null)
  const savedStyle = readStorage<{ name?: string, prompt?: string, cover?: string } | string>(styleKey.value, '')
  if (typeof savedStyle === 'string') {
    activeStyleName.value = savedStyle
    activeStylePrompt.value = savedStyle
    activeStyleCover.value = ''
  }
  else {
    activeStyleName.value = savedStyle?.name || ''
    activeStylePrompt.value = savedStyle?.prompt || savedStyle?.name || ''
    activeStyleCover.value = savedStyle?.cover || ''
  }
  agentAutoModel.value = readStorage<boolean>(AGENT_AUTO_MODEL_KEY, false)
  // 选了具体技能就保持自动。没选技能时沿用上次：取消选择后是自动，否则默认自由创作
  if (activeSkill.value)
    agentAutoModel.value = true
}

function loadSessions() {
  loadChatPrefs()
  sessions.value = readStorage<ChatSession[]>(storageKey.value, [])
  const savedOpen = readStorage<string[]>(openTabsKey.value, [])
  openTabIds.value = savedOpen.filter(id => sessions.value.some(session => session.id === id))
}

function applyOpenTabs(preferred: string[]) {
  openTabIds.value = preferred.filter(id => sessions.value.some(session => session.id === id))
  if (!openTabIds.value.length && sessions.value[0])
    openTabIds.value = [sessions.value[0].id]
}

function persistOpenTabs() {
  if (useRemoteChat())
    return
  writeStorage(openTabsKey.value, openTabIds.value.filter(Boolean))
  writeStorage(activeTabKey.value, sessionId.value)
}

/** 已保存画布的打开标签不再留在本机，避免和接口列表各记一份 */
function forgetRemoteTabKeys(canvasId: number) {
  try {
    localStorage.removeItem(`easytv-chat-open-${canvasId}`)
    localStorage.removeItem(`easytv-chat-active-${canvasId}`)
  }
  catch {
    // 私密模式等情况下忽略
  }
}

function readChatList(data: any) {
  if (Array.isArray(data))
    return data as any[]
  if (Array.isArray(data?.items))
    return data.items as any[]
  return []
}

function ensureOpenTab(id: string) {
  if (!id || openTabIds.value.includes(id))
    return
  openTabIds.value = [...openTabIds.value.filter(item => item), id]
  persistOpenTabs()
}

function pickSkill(item: ChatSkill | null) {
  activeSkill.value = item
  writeStorage(skillKey.value, item)
}

/** 这张画布以前存在本机的会话，逐段交给账号接口，成功一段就从本机拿掉 */
async function uploadLocalChats(canvasId: number) {
  const key = `easytv-chat-${canvasId}`
  let local = readStorage<ChatSession[]>(key, [])
  if (!local.length)
    return
  const ordered = [...local]
    .filter(item => sessionPayload(item).messages.length)
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const item of ordered) {
    const res = await canvasApi.chat.create(canvasId, sessionPayload(item))
    if (!res?.success || !res.data?.id) {
      notify(res?.message || t('保存失败'), 'error')
      return
    }
    if (Number(props.canvasId) === canvasId)
      remapSessionId(String(item.id), String(res.data.id))
    local = local.filter(row => row.id !== item.id)
    if (local.length)
      writeStorage(key, local)
    else
      localStorage.removeItem(key)
  }
  const leftover = readStorage<ChatSession[]>(key, []).filter(item => sessionPayload(item).messages.length)
  if (!leftover.length)
    localStorage.removeItem(key)
}

async function fetchRemoteSessions(canvasId: number, token: number) {
  const res = await canvasApi.chat.list(canvasId)
  if (token !== syncToken)
    return
  if (!res?.success) {
    notify(res?.message || t('加载失败'), 'error')
    return
  }
  const items = readChatList(res?.data)
  const prev = new Map(sessions.value.map(item => [item.id, item]))
  const currentId = sessionId.value
  const currentMessages = messages.value.map(item => ({ ...item }))
  sessions.value = items.map((row) => {
    const id = String(row.id)
    const kept = prev.get(id)
    const keptMessages = id === currentId && currentMessages.length ? currentMessages : (kept?.messages || [])
    return {
      id,
      title: String(row.title || t('canvas.chat.history.new')),
      messages: keptMessages,
      updatedAt: chatStamp(row.updated_at),
      messageCount: Number(row.message_count) || keptMessages.length,
    }
  })
  const ids = sessions.value.map(item => item.id)
  const kept = openTabIds.value.filter(id => ids.includes(id))
  openTabIds.value = kept.length ? kept : (ids[0] ? [ids[0]] : [])
  forgetRemoteTabKeys(canvasId)
}

async function syncSessions() {
  const token = ++syncToken
  if (!useRemoteChat()) {
    loadSessions()
    return
  }
  loadChatPrefs()
  const canvasId = Number(props.canvasId)
  forgetRemoteTabKeys(canvasId)
  await enqueueChat(async () => {
    await uploadLocalChats(canvasId)
    if (token !== syncToken || Number(props.canvasId) !== canvasId)
      return
    await fetchRemoteSessions(canvasId, token)
  })
}

async function saveRemoteSession(canvasId: number, requestedId: string, payload: { title: string, messages: unknown[] }) {
  if (!payload.messages.length)
    return
  try {
    await uploadLocalChats(canvasId)
    const id = resolvedSessionId(requestedId)
    const stillHere = Number(props.canvasId) === canvasId
      && sessions.value.some(item => item.id === id || item.id === requestedId)
    if (Number(props.canvasId) === canvasId && !stillHere)
      return
    const sid = serverSessionId(id)
    const res = sid
      ? await canvasApi.chat.update(canvasId, sid, payload)
      : await canvasApi.chat.create(canvasId, payload)
    if (!res?.success || !res.data?.id) {
      notify(res?.message || t('保存失败'), 'error')
      return
    }
    if (Number(props.canvasId) !== canvasId)
      return
    const serverId = String(res.data.id)
    if (serverId !== id)
      remapSessionId(id, serverId)
    const saved = sessions.value.find(item => item.id === serverId)
    if (!saved)
      return
    saved.title = String(res.data.title || saved.title)
    saved.updatedAt = chatStamp(res.data.updated_at)
    saved.messageCount = Number(res.data.message_count) || payload.messages.length
  }
  catch (err) {
    notify(err instanceof Error ? err.message : t('保存失败'), 'error')
  }
}

function persistLocalSessions() {
  writeStorage(storageKey.value, sessions.value)
}

function persistSession() {
  const clean = messages.value
    .filter(item => !item.pending)
    .map(({ undoToken: _token, ...item }) => (item.planState === 'applying' ? { ...item, planState: 'ready' as const } : item))
  if (!clean.length)
    return
  const wasDraft = !sessionId.value
  if (!sessionId.value)
    sessionId.value = `s${Date.now().toString(36)}`
  const title = tabTitle(withoutStylePrefix(clean.find(item => item.role === 'user')?.text || '')).slice(0, 40) || t('canvas.chat.history.new')
  const next: ChatSession = { id: sessionId.value, title, messages: clean, updatedAt: Date.now(), messageCount: clean.length }
  sessions.value = [next, ...sessions.value.filter(item => item.id !== next.id)].slice(0, 30)
  if (wasDraft)
    openTabIds.value = [sessionId.value, ...openTabIds.value.filter(id => id && id !== sessionId.value)]
  else
    ensureOpenTab(sessionId.value)
  persistOpenTabs()
  if (useRemoteChat()) {
    const canvasId = Number(props.canvasId)
    const payload = sessionPayload(next)
    void enqueueChat(() => saveRemoteSession(canvasId, next.id, payload))
    return
  }
  persistLocalSessions()
}

async function openSession(item: ChatSession) {
  dropRun()
  sessionId.value = item.id
  popover.value = null
  ensureOpenTab(item.id)
  persistOpenTabs()
  const sid = serverSessionId(item.id)
  const needBody = useRemoteChat() && sid > 0 && !item.messages.length && (item.messageCount || 0) > 0
  if (!needBody) {
    messages.value = item.messages.map(m => ({ ...m }))
    seq = Math.max(0, ...messages.value.map(m => m.id))
    scrollToEnd()
    return
  }
  messages.value = []
  const canvasId = Number(props.canvasId)
  const res = await canvasApi.chat.detail(canvasId, sid)
  if (sessionId.value !== item.id)
    return
  if (!res?.success) {
    notify(res?.message || t('加载失败'), 'error')
    return
  }
  const list = readChatMessages(res.data)
  item.messages = list
  const found = sessions.value.find(session => session.id === item.id)
  if (found)
    found.messages = list
  messages.value = list.map(m => ({ ...m }))
  seq = Math.max(0, ...messages.value.map(m => m.id))
  scrollToEnd()
}

async function deleteRemoteSession(canvasId: number, id: string) {
  try {
    await enqueueChat(async () => {
      const sid = serverSessionId(resolvedSessionId(id))
      if (!sid)
        return
      const res = await canvasApi.chat.delete(canvasId, sid)
      if (!res?.success)
        throw new Error(res?.message || t('删除失败'))
    })
    return true
  }
  catch (err) {
    notify(err instanceof Error ? err.message : t('删除失败'), 'error')
    return false
  }
}

async function removeSession(item: ChatSession) {
  if (historyBusy.value)
    return
  historyBusy.value = true
  try {
    if (useRemoteChat()) {
      const ok = await deleteRemoteSession(Number(props.canvasId), item.id)
      if (!ok)
        return
    }
    sessions.value = sessions.value.filter(s => s.id !== item.id)
    if (!useRemoteChat())
      persistLocalSessions()
    openTabIds.value = openTabIds.value.filter(id => id !== item.id)
    persistOpenTabs()
    if (sessionId.value === item.id)
      restoreAfterClose()
  }
  finally {
    historyBusy.value = false
  }
}

async function clearSessions() {
  if (historyBusy.value)
    return
  historyBusy.value = true
  try {
    const canvasId = Number(props.canvasId)
    const remote = useRemoteChat()
    sessions.value = []
    openTabIds.value = []
    if (!remote)
      writeStorage(storageKey.value, [])
    persistOpenTabs()
    newChat()
    popover.value = null
    if (remote) {
      await enqueueChat(async () => {
        const res = await canvasApi.chat.clear(canvasId)
        if (!res?.success)
          throw new Error(res?.message || t('删除失败'))
      })
    }
  }
  catch (err) {
    notify(err instanceof Error ? err.message : t('删除失败'), 'error')
    await syncSessions()
    restoreActive()
  }
  finally {
    historyBusy.value = false
  }
}

/** 外面带回的草稿还没发出去：这段时间画布刚拿到 id，也不能把输入框清掉 */
const holdingEntry = ref(false)

watch(() => props.canvasId, (id, prev) => {
  // 新画布第一次存上 id 时，把草稿对话搬过去。发送中不要重载，否则进行中的回复会被清掉
  if (!prev && id)
    adoptDraftChat(id)
  if (holdingEntry.value || (busy.value && !prev && id))
    return
  dropRun()
  void (async () => {
    try {
      await syncSessions()
    }
    catch {
      notify(t('加载失败'), 'error')
    }
    if (!busy.value)
      restoreActive()
  })()
  void loadQuota()
})

/** 画布从「还没 id」变成已保存：草稿键上的对话、技能、风格搬到这张画布 */
function adoptDraftChat(id: number) {
  const prefixes = ['easytv-chat-', 'easytv-chat-open-', 'easytv-chat-active-', 'easytv-chat-skill-', 'easytv-chat-style-']
  for (const prefix of prefixes) {
    const nextKey = `${prefix}${id}`
    const prevKey = `${prefix}draft`
    if (localStorage.getItem(nextKey))
      continue
    const raw = localStorage.getItem(prevKey)
    if (!raw)
      continue
    try {
      localStorage.setItem(nextKey, raw)
      localStorage.removeItem(prevKey)
    }
    catch {
      // 写失败就留在草稿键上，下次打开空白画布还能看到
    }
  }
}

onMounted(() => {
  void (async () => {
    try {
      await syncSessions()
    }
    catch {
      notify(t('加载失败'), 'error')
    }
    if (!busy.value)
      restoreActive()
  })()
  void loadSkills()
  void loadQuota()
  void loadAppConfig()
  void loadModels()
})

onUnmounted(() => {
  dropRun()
})

// ---- 顶部弹层 ----
type Popover = 'history' | 'add' | 'skill' | 'model' | 'template' | 'params'
const popover = ref<Popover | null>(null)
const settingsOpen = ref(false)

function togglePopover(name: Popover) {
  const next = popover.value === name ? null : name
  popover.value = next
  if (next === 'history' && useRemoteChat())
    void fetchRemoteSessions(Number(props.canvasId), syncToken)
  if (next === 'skill') {
    void loadSkillCats()
    void loadSkillPanel(skillNav.value)
  }
  if (next === 'model' && modelGroups.value.length && !modelGroups.value.some(group => group.type === modelTab.value))
    modelTab.value = modelGroups.value[0]!.type
  if (next === 'model')
    void warmModelIcons()
}

function openSettings() {
  popover.value = null
  settingsOpen.value = true
}

function closeSettings() {
  settingsOpen.value = false
}

function onDocumentClick(event: MouseEvent) {
  const path = event.composedPath()
  if (path.some(node => node instanceof Element && node.closest('.canvas-chat__pop, .canvas-chat__pop-trigger')))
    return
  popover.value = null
}

function onSettingsKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && settingsOpen.value) {
    event.stopPropagation()
    closeSettings()
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onSettingsKeydown, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('keydown', onSettingsKeydown, true)
})

// 打招呼语要等挂载后才用昵称：服务端渲染时拿不到登录态，会先出「创作者」再被客户端换掉，
// 触发 hydration text mismatch（与 ThemeToggle 同一个处理方式）
const helloMounted = ref(false)
onMounted(() => {
  helloMounted.value = true
})

const helloName = computed(() => {
  if (!helloMounted.value)
    return t('创作者')
  const raw = user.value?.nickname || user.value?.username || t('创作者')
  return String(raw).split('@')[0] || t('创作者')
})

const shownSkills = computed(() => {
  const list = skills.value
  if (!list.length)
    return []
  const start = (batch.value * 4) % list.length
  return [...list, ...list].slice(start, start + 4)
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function shuffleSkills() {
  batch.value += 1
}

function newChat() {
  dropRun()
  messages.value = []
  prompt.value = ''
  sessionId.value = ''
  persistOpenTabs()
}

function restoreAfterClose() {
  const nextId = openTabIds.value.find(id => id)
  const item = nextId ? sessions.value.find(session => session.id === nextId) : null
  if (item)
    openSession(item)
  else
    newChat()
}

function restoreActive() {
  if (useRemoteChat()) {
    const current = sessionId.value ? sessions.value.find(item => item.id === sessionId.value) : null
    const item = current || sessions.value[0]
    if (item && !(current && messages.value.length))
      void openSession(item)
    else if (!item)
      newChat()
    return
  }
  const active = readStorage<string>(activeTabKey.value, '')
  const openId = openTabIds.value.includes(active) ? active : openTabIds.value[0]
  const item = openId ? sessions.value.find(session => session.id === openId) : null
  if (item)
    openSession(item)
  else
    newChat()
}

function tabTitle(raw: string) {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`~\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const chatTabs = computed(() => {
  const list = openTabIds.value
    .map((id) => {
      const session = sessions.value.find(item => item.id === id)
      return session
        ? { id: session.id, title: tabTitle(session.title) || t('canvas.chat.history.chat') }
        : null
    })
    .filter((item): item is { id: string, title: string } => Boolean(item))
  if (!sessionId.value)
    return [{ id: '', title: t('canvas.chat.history.new') }, ...list.filter(item => item.id)]
  if (!list.some(item => item.id === sessionId.value))
    return [{ id: sessionId.value, title: t('canvas.chat.history.chat') }, ...list]
  return list
})

function openTab(id: string) {
  if (String(id) === String(sessionId.value))
    return
  if (!id) {
    newChat()
    return
  }
  const item = sessions.value.find(session => String(session.id) === String(id))
  if (item) {
    void openSession(item)
    return
  }
  if (useRemoteChat() && Number(id) > 0)
    void openSession({ id: String(id), title: t('canvas.chat.history.chat'), messages: [], updatedAt: Date.now(), messageCount: 1 })
}

function closeTab(id: string) {
  const closingCurrent = id === sessionId.value || (!id && !sessionId.value)
  openTabIds.value = openTabIds.value.filter(tabId => tabId !== id)
  persistOpenTabs()
  if (!closingCurrent)
    return
  restoreAfterClose()
}

function scrollToEnd() {
  nextTick(() => {
    if (bodyRef.value)
      bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  })
}

function stopPolling() {
  stopChatPoll()
  stopChatPoll = () => {}
}

function nextRun() {
  runId += 1
  runTaskId = 0
  return runId
}

function runAlive(id: number) {
  return id === runId
}

/** 离开当前轮：停掉轮询，并把已经创建的任务取消掉，避免切对话后还在扣积分 */
function dropRun() {
  const taskId = runTaskId
  nextRun()
  stopPolling()
  busy.value = false
  stopping.value = false
  if (taskId)
    void taskApi.cancel(taskId)
}

function finishReply(msg: ChatMsg, text: string, error = false, insert = !error) {
  runTaskId = 0
  msg.pending = false
  msg.error = error
  msg.text = text
  busy.value = false
  persistSession()
  scrollToEnd()
  // 每次发送结束都刷新次数：账在服务端，前端不自己减
  void loadQuota()
  if (!error && looksLikeComposeReport(text)) {
    msg.text = t('canvas.chat.brief.composeStarted')
    persistSession()
    void fulfillComposeFromChat(msg)
    return
  }
  if (insert && settings.value.insertReply && text)
    emit('insertText', text, t('canvas.chat.msg.replyLabel'))
}

/** 发送失败：次数用完走 i18n，其它失败写进气泡（配额由 finishReply 统一刷新） */
function failReply(reply: ChatMsg, message: string, data?: { reason?: string } | null) {
  const quota = isChatQuotaExceeded(message, data)
  const text = quota ? t('canvas.chat.msg.quota') : message
  if (quota)
    notify(text, 'error')
  finishReply(reply, text, true)
}

/** 真实对话：创建文本任务并轮询。媒体附件已在上传时拿到 asset_id，直接引用（TaskInput.inputs） */
async function ask(value: string, reply: ChatMsg, attachments: ChatAttachment[] = [], id = runId) {
  runTaskId = 0
  const inputs = attachments
    .filter(item => item.assetId)
    .map(item => ({ asset_id: item.assetId!, role: item.kind }))
  const res = await taskApi.create({
    type: 'text',
    model: agentAutoModel.value ? autoChatModel(attachments) : chatModel.value,
    prompt: value,
    inputs: inputs.length ? inputs : undefined,
    canvas_id: props.canvasId || undefined,
    skill_id: activeSkill.value?.id || undefined,
  })
  if (!runAlive(id)) {
    if (res?.success && res.data?.id)
      void taskApi.cancel(res.data.id)
    return
  }
  if (!res?.success || !res.data) {
    failReply(reply, res?.message || t('canvas.chat.msg.sendFail'), res?.data as { reason?: string } | undefined)
    return
  }
  reply.taskId = res.data.id
  runTaskId = res.data.id
  emit('taskStarted')
  stopPolling()
  stopChatPoll = startHiddenAwarePoll(async () => {
    if (!runAlive(id))
      return
    const poll = await taskApi.get(reply.taskId!)
    if (!runAlive(id) || !poll?.success || !poll.data)
      return
    const task = poll.data
    if (task.status === 'pending' || task.status === 'running')
      return
    stopPolling()
    if (task.status === 'succeeded')
      finishReply(reply, task.result_text || t('canvas.chat.msg.empty'))
    else if (task.status === 'cancelled')
      finishReply(reply, t('canvas.chat.msg.stopped'), false, false)
    else
      failReply(reply, task.error_msg || t('生成失败'))
  }, 2000)
}

function activeReply() {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const item = messages.value[i]
    if (item?.role === 'assistant' && (item.pending || item.planState === 'applying'))
      return item
  }
  return null
}

function markStopped(reply: ChatMsg | null) {
  if (!reply) {
    busy.value = false
    return
  }
  if (reply.pending) {
    finishReply(reply, t('canvas.chat.msg.stopped'), false, false)
    return
  }
  if (reply.planState === 'applying')
    reply.planState = 'ready'
  busy.value = false
  persistSession()
}

/** 生成过程中把发送按钮换成停止：取消这一轮任务，气泡改成「已停止」 */
async function stopReply() {
  if (!busy.value || stopping.value)
    return
  stopping.value = true
  const reply = activeReply()
  const taskId = runTaskId
  const agent = runAgent
  nextRun()
  stopPolling()
  markStopped(reply)
  try {
    if (!taskId || !reply)
      return
    const res = await taskApi.cancel(taskId)
    if (res?.success)
      return
    const poll = await taskApi.get(taskId)
    const task = poll?.success ? poll.data : null
    if (!task)
      return
    if (task.status === 'succeeded') {
      if (agent)
        await presentAgentPlan(reply, taskId)
      else
        finishReply(reply, task.result_text || t('canvas.chat.msg.empty'))
      return
    }
    if (task.status === 'failed') {
      failReply(reply, task.error_msg || t('生成失败'))
      return
    }
    if (task.status !== 'cancelled')
      notify(res?.message || t('取消失败'), 'error')
  }
  finally {
    stopping.value = false
  }
}

function messageHistoryText(item: ChatMsg) {
  if (item.role === 'user')
    return withoutStylePrefix(item.text)
  return item.text || (item.card ? briefHistoryText(item.card, t) : '')
}

function historyTurns() {
  return messages.value
    .filter(item => !item.pending && !item.error)
    .slice(0, -1)
    .map(item => ({ role: item.role, text: messageHistoryText(item) }))
    .filter(item => item.text.trim())
}

function defaultBriefQuestions(title = ''): BriefQuestion[] {
  return [{
    ask: t('canvas.chat.brief.askNext', { title: title || t('未命名') }),
    options: [
      t('canvas.chat.brief.optFull'),
      t('canvas.chat.brief.optTeaser'),
      t('canvas.chat.brief.optStills'),
      t('canvas.chat.brief.optScript'),
    ],
  }]
}

function askQuestionOf(raw: unknown, title = ''): BriefQuestion {
  const fallback = defaultBriefQuestions(title)[0]!
  const row = raw as any
  const ask = String(row?.ask || fallback.ask)
  const fromList = Array.isArray(row?.options)
    ? row.options.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : []
  const pick = String(row?.pick || '').trim()
  const options = fromList.length ? fromList : (pick ? [pick, ...fallback.options.filter(item => item !== pick)].slice(0, 4) : fallback.options)
  return {
    ask,
    options,
    chosen: typeof row?.chosen === 'number' ? row.chosen : undefined,
    note: String(row?.note || ''),
  }
}

function askChoices(question?: BriefQuestion | null) {
  const options = askQuestionOf(question).options
  return [...options, t('canvas.chat.brief.other')]
}

function askChosenText(question?: BriefQuestion | null) {
  const row = askQuestionOf(question)
  const index = row.chosen ?? -1
  if (index < 0)
    return ''
  if (index >= row.options.length)
    return row.note?.trim() || t('canvas.chat.brief.other')
  return row.options[index] || ''
}

function defaultVoiceQuestions(): BriefQuestion[] {
  return [{
    ask: t('canvas.chat.brief.askVoice'),
    options: [
      t('canvas.chat.brief.optVoiceYes'),
      t('canvas.chat.brief.optVoiceNo'),
      t('canvas.chat.brief.optVoiceSome'),
      t('canvas.chat.brief.optVoiceLater'),
    ],
  }]
}

function defaultGenerateQuestions(counts: BriefGenerateCounts): BriefQuestion[] {
  const images = (counts.characters || 0) + (counts.scenes || 0) + (counts.props || 0) + (counts.shots || 0)
  return [{
    ask: counts.points
      ? t('canvas.chat.brief.askGeneratePoints', { n: images, p: counts.points })
      : counts.voices
        ? t('canvas.chat.brief.askGenerateAudio', { n: images, m: counts.voices })
        : t('canvas.chat.brief.askGenerate', { n: images }),
    options: [
      t('canvas.chat.brief.optGenerateYes'),
      t('canvas.chat.brief.optGenerateNo'),
      t('canvas.chat.brief.optGenerateStills'),
      t('canvas.chat.brief.optGenerateLater'),
    ],
  }]
}

function defaultVideoQuestions(shots: number): BriefQuestion[] {
  return [{
    ask: t('canvas.chat.brief.askVideoShot', { n: shots }),
    options: [
      t('canvas.chat.brief.optVideoYes'),
      t('canvas.chat.brief.optVideoNo'),
      t('canvas.chat.brief.optVideoSome'),
      t('canvas.chat.brief.optVideoLaterShot'),
    ],
  }]
}

function defaultComposeQuestions(shots: number): BriefQuestion[] {
  return [{
    ask: t('canvas.chat.brief.askCompose', { n: shots }),
    options: [
      t('canvas.chat.brief.optComposeYes'),
      t('canvas.chat.brief.optComposeNo'),
      t('canvas.chat.brief.optComposePreview'),
      t('canvas.chat.brief.optComposeLater'),
    ],
  }]
}

function asChoiceCard(card: BriefCard | undefined): BriefAskCard | BriefVoiceCard | BriefGenerateCard | BriefVideoCard | null {
  return card?.kind === 'ask' || card?.kind === 'voice' || card?.kind === 'generate' || card?.kind === 'video' || card?.kind === 'compose' ? card : null
}

function currentAsk(card: BriefCard) {
  const ask = asChoiceCard(card)
  if (!ask)
    return askQuestionOf(null)
  const index = ask.step || 0
  const live = ask.questions[index] || ask.questions[0]
  const seed = ask.kind === 'voice'
    ? defaultVoiceQuestions()[0]!
    : ask.kind === 'generate'
      ? defaultGenerateQuestions(ask.counts)[0]!
      : ask.kind === 'video' || ask.kind === 'compose'
        ? (ask.kind === 'video' ? defaultVideoQuestions(ask.shots) : defaultComposeQuestions(ask.shots))[0]!
        : defaultBriefQuestions(ask.title)[0]!
  const next = live && Array.isArray(live.options) && live.options.length
    ? askQuestionOf(live, ask.kind === 'ask' ? ask.title : '')
    : { ...seed, chosen: live?.chosen, note: live?.note || '' }
  if (!live) {
    if (!ask.questions.length)
      ask.questions.push(next)
    return next
  }
  if (!Array.isArray(live.options) || !live.options.length)
    live.options = next.options
  if (!live.ask)
    live.ask = next.ask
  return live
}

function writeAskNote(card: BriefCard, event: Event) {
  const ask = asChoiceCard(card)
  const question = ask?.questions[ask.step || 0] || ask?.questions[0]
  if (question)
    question.note = (event.target as HTMLTextAreaElement).value
}

function showAskNote(card: BriefCard) {
  const question = currentAsk(card)
  if (question.chosen == null)
    return false
  if (question.chosen >= question.options.length)
    return true
  return (card.kind === 'voice' || card.kind === 'video') && question.chosen === 2
}

function canSubmitAsk(card: BriefCard) {
  const question = currentAsk(card)
  if (question.chosen == null)
    return false
  if (question.chosen >= question.options.length || ((card.kind === 'voice' || card.kind === 'video') && question.chosen === 2))
    return Boolean(question.note?.trim())
  return true
}

function parseVoiceNames(note: string) {
  return String(note || '').split(/[,，、;；\s]+/).map(item => item.trim()).filter(Boolean)
}

function waitTextTask(taskId: number, id: number) {
  return new Promise<any>((resolve) => {
    const stop = startHiddenAwarePoll(async () => {
      if (!runAlive(id)) {
        stop()
        resolve(null)
        return
      }
      const poll = await taskApi.get(taskId)
      const task = poll?.success ? poll.data : null
      if (!task || task.status === 'pending' || task.status === 'running')
        return
      stop()
      resolve(task)
    }, 2000)
  })
}

async function runBriefText(prompt: string, id: number) {
  const model = agentAutoModel.value ? autoChatModel() : chatModel.value
  if (!model || !runAlive(id))
    return null
  const res = await taskApi.create({
    type: 'text',
    model,
    prompt,
    canvas_id: props.canvasId || undefined,
    skill_id: activeSkill.value?.id || undefined,
  })
  if (!runAlive(id)) {
    if (res?.success && res.data?.id)
      void taskApi.cancel(res.data.id)
    return null
  }
  if (!res?.success || !res.data)
    return null
  runTaskId = res.data.id
  emit('taskStarted')
  const task = res.data.status === 'succeeded'
    ? res.data
    : await waitTextTask(res.data.id, id)
  if (!runAlive(id) || !task || task.status !== 'succeeded')
    return null
  return String(task.result_text || '')
}

async function startBrief(script: string) {
  emit('resetBrief')
  const id = nextRun()
  busy.value = true
  const reply: ChatMsg = { id: ++seq, role: 'assistant', text: '', pending: true }
  messages.value.push(reply)
  persistSession()
  scrollToEnd()
  const raw = await runBriefText(briefAskPrompt(script), id)
  if (!runAlive(id))
    return
  const parsed = raw ? parseBriefAsk(raw) : null
  const title = parsed?.title || briefTitle(script)
  if (!raw && !parsed) {
    failReply(reply, t('生成失败'))
    return
  }
  reply.pending = false
  reply.text = parsed?.intro || ''
  reply.card = {
    kind: 'ask',
    locked: false,
    title,
    script,
    questions: parsed?.questions?.length ? parsed.questions : defaultBriefQuestions(title),
    step: 0,
  }
  busy.value = false
  runTaskId = 0
  persistSession()
  scrollToEnd()
}

function placeBriefDoc(card: BriefDocCard) {
  if (card.placed || props.entry)
    return
  const people = card.characters || []
  const scenes = card.scenes || []
  const goods = card.props || []
  const shots = card.shots || []
  if (!card.body && !people.length && !scenes.length && !goods.length && !shots.length)
    return
  const images = [
    ...people.map(item => ({
      label: briefNodeTitle(item.name, 'character', t('角色锚点')),
      prompt: characterImagePrompt(item, activeStylePrompt.value),
      ratio: '4:3',
      group: 'character',
    })),
    ...scenes.map(item => ({
      label: briefNodeTitle(item.name, 'scene', t('场景锚点')),
      prompt: sceneImagePrompt(item, activeStylePrompt.value),
      ratio: '16:9',
      group: 'scene',
    })),
    ...goods.map(item => ({
      label: briefNodeTitle(item.name, 'prop', t('道具锚点')),
      prompt: propImagePrompt(item, activeStylePrompt.value),
      ratio: '1:1',
      group: 'prop',
    })),
    ...((people.length || scenes.length || goods.length)
      ? []
      : shots.map(item => ({
          label: briefNodeTitle(`镜${item.no}`, 'shot', t('分镜')),
          prompt: shotImagePrompt(item, activeStylePrompt.value),
          ratio: card.frameRatio || '9:16',
          group: 'shot',
        }))),
  ]
  const text = card.body || (shots.length
    ? shots.map(item => `镜${item.no} · ${item.seconds}秒 · ${item.picture}`).join('\n')
    : '')
  if (images.length) {
    emit('insertImages', images, text ? { text, label: card.label } : undefined)
    card.placed = true
    return
  }
  if (text)
    emit('insertText', text, card.label)
  card.placed = true
}

function placeBriefVoice(card: BriefVoiceCard, names?: string[]) {
  if (card.placed || props.entry)
    return
  const list = names?.length
    ? card.voices.filter(item => names.some(name => item.name.includes(name) || name.includes(item.name)))
    : card.voices
  if (!list.length)
    return
  emit('insertAudios', list.map(item => ({
    label: briefNodeTitle(item.name, 'voice', t('音色锚点')),
    prompt: voiceAudioPrompt(item),
    group: 'voice',
  })))
  card.placed = true
}

function selectAskOption(card: BriefCard, index: number) {
  const ask = asChoiceCard(card)
  const question = currentAsk(card)
  if (!ask || ask.locked || busy.value || !question.options.length)
    return
  question.chosen = index
}

function currentBriefPath(): BriefPath {
  const ask = [...messages.value].reverse().find(row => row.card?.kind === 'ask')
  if (ask?.card?.kind === 'ask')
    return ask.card.path || briefPathOf(ask.card.questions[0]?.chosen)
  return 'full'
}

function skipBriefAsk(item: ChatMsg) {
  const card = item.card
  if (!card || !asChoiceCard(card) || card.locked || busy.value)
    return
  card.locked = true
  persistSession()
  if (card.kind === 'voice') {
    pushGenerateCard(card.title)
    return
  }
  if (card.kind === 'generate')
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.brief.generateSkipped') })
  else if (card.kind === 'video')
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.brief.videoSkipped') })
  else if (card.kind === 'compose')
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.brief.composeSkipped') })
  persistSession()
}

function submitBriefAsk(item: ChatMsg) {
  const card = item.card
  if (!card || !asChoiceCard(card) || card.locked || busy.value)
    return
  const step = card.step || 0
  const question = card.questions[step]
  if (!question || question.chosen == null)
    return
  if ((question.chosen >= question.options.length || ((card.kind === 'voice' || card.kind === 'video') && question.chosen === 2)) && !question.note?.trim())
    return
  if (card.kind === 'voice') {
    confirmBriefVoice(item)
    return
  }
  if (card.kind === 'generate') {
    confirmBriefGenerate(item)
    return
  }
  if (card.kind === 'video') {
    confirmBriefVideo(item)
    return
  }
  if (card.kind === 'compose') {
    confirmBriefCompose(item)
    return
  }
  if (step < card.questions.length - 1) {
    card.step = step + 1
    persistSession()
    return
  }
  void confirmBriefAsk(item)
}

function briefGenerateCounts(): BriefGenerateCounts {
  const anchors = [...messages.value].reverse().find(row => row.card?.kind === 'anchors')
  const board = [...messages.value].reverse().find(row => row.card?.kind === 'board')
  const voice = [...messages.value].reverse().find(row => row.card?.kind === 'voice')
  const counts: BriefGenerateCounts = {
    characters: anchors?.card?.kind === 'anchors' ? (anchors.card.characters?.length || 0) : 0,
    scenes: anchors?.card?.kind === 'anchors' ? (anchors.card.scenes?.length || 0) : 0,
    props: anchors?.card?.kind === 'anchors' ? (anchors.card.props?.length || 0) : 0,
    shots: board?.card?.kind === 'board' ? (board.card.shots?.length || 0) : 0,
    voices: voice?.card?.kind === 'voice' && voice.card.placed ? voice.card.voices.length : 0,
  }
  const quote = props.briefQuote?.()
  if (quote?.points)
    counts.points = quote.points
  return counts
}

function shotCount() {
  return briefGenerateCounts().shots
}

function messagesUpTo(item: ChatMsg) {
  const index = messages.value.findIndex(row => row.id === item.id)
  return index < 0 ? messages.value : messages.value.slice(0, index + 1)
}

function askCardBefore(item: ChatMsg) {
  if (item.card?.kind === 'ask')
    return item.card
  const ask = [...messagesUpTo(item)].reverse().find(row => row.card?.kind === 'ask')
  return ask?.card?.kind === 'ask' ? ask.card : null
}

function specChipsOf(item: ChatMsg) {
  const ask = askCardBefore(item)
  return ask ? briefSpecChips(briefAskPicks(ask, t('canvas.chat.brief.other')), t) : []
}

function briefPromptLinesOf(item: ChatMsg) {
  const before = messagesUpTo(item)
  const anchors = [...before].reverse().find(row => row.card?.kind === 'anchors')
  const board = [...before].reverse().find(row => row.card?.kind === 'board')
  const style = activeStylePrompt.value
  const lines: { name: string, prompt: string }[] = []
  if (anchors?.card?.kind === 'anchors') {
    for (const row of anchors.card.characters || [])
      lines.push({ name: row.name, prompt: characterImagePrompt(row, style) })
    for (const row of anchors.card.scenes || [])
      lines.push({ name: row.name, prompt: sceneImagePrompt(row, style) })
    for (const row of anchors.card.props || [])
      lines.push({ name: row.name, prompt: propImagePrompt(row, style) })
  }
  if (board?.card?.kind === 'board') {
    for (const row of board.card.shots || [])
      lines.push({ name: t('canvas.chat.brief.shotName', { n: row.no }), prompt: shotImagePrompt(row, style) })
  }
  return lines
}

function writeBriefProgress(id: number, text: string) {
  const current = messages.value.find(item => item.id === id)
  if (!current)
    return
  current.text = text
  persistSession()
  scrollToEnd()
}

function runBriefGenerate(groups: string[]) {
  return new Promise<BriefGenerateReport>((resolve) => {
    const row: ChatMsg = {
      id: ++seq,
      role: 'assistant',
      text: t('canvas.chat.brief.generateStarted'),
    }
    messages.value.push(row)
    persistSession()
    scrollToEnd()
    emit('generateBrief', groups, {
      onProgress: (item) => {
        writeBriefProgress(row.id, t('canvas.chat.brief.generatingItem', { i: item.index, n: item.total, name: item.label }))
      },
      onDone: (report) => {
        writeBriefProgress(row.id, !report.total
          ? t('canvas.chat.brief.generateEmpty')
          : report.ok + report.failed === 0
            ? t('canvas.chat.brief.generateSkipped')
            : report.failed
              ? t('canvas.chat.brief.generateDoneSome', { ok: report.ok, fail: report.failed, n: report.total })
              : t('canvas.chat.brief.generateDoneAll', { n: report.ok }))
        persistSession()
        scrollToEnd()
        resolve(report)
      },
    })
  })
}

async function afterStillsReady(title: string, report: BriefGenerateReport, groups: string[]) {
  if (!briefWantsFilm(currentBriefPath()) || shotCount() < 1 || !groups.includes('shot') || report.ok < 1)
    return
  if (briefAuto.value) {
    await runBriefVideos(title)
    return
  }
  pushVideoCard(title)
}

async function runBriefVideos(title: string, shots?: string[]) {
  emit('placeVideos', shots)
  persistSession()
  const report = await runBriefGenerate(['video'])
  if (report.ok >= 2) {
  if (briefAuto.value) {
    await runBriefCompose()
    return
  }
    pushComposeCard(title, report.ok)
    return
  }
  messages.value.push({
    id: ++seq,
    role: 'assistant',
    text: t('canvas.chat.brief.composeNeedVideos', { n: report.ok }),
  })
  persistSession()
  scrollToEnd()
}

function liveComposeAspect() {
  const ask = [...messages.value].reverse().find(row => row.card?.kind === 'ask')
  const picks = ask?.card?.kind === 'ask' ? briefAskPicks(ask.card, t('canvas.chat.brief.other')) : ''
  return briefFrameRatio(picks)
}

function writeComposeLine(row: ChatMsg | undefined, text: string) {
  if (row) {
    row.text = text
  }
  else {
    messages.value.push({ id: ++seq, role: 'assistant', text })
  }
  persistSession()
  scrollToEnd()
}

function requestCompose(preview = false) {
  return new Promise<BriefComposeReport>((resolve) => {
    emit('composeBrief', {
      preview,
      aspect: liveComposeAspect(),
      onDone: report => resolve(report),
    })
  })
}

async function runBriefCompose(row?: ChatMsg, preview = false) {
  writeComposeLine(row, t('canvas.chat.brief.composeStarted'))
  const report = await requestCompose(preview)
  writeComposeLine(row, report.ok
    ? t('canvas.chat.brief.composePlaced')
    : report.error === 'needTwo'
      ? t('canvas.chat.brief.composeNeedVideos', { n: report.count ?? 0 })
      : (report.error || t('canvas.chat.brief.composeFailed')))
}

async function fulfillComposeFromChat(row: ChatMsg) {
  busy.value = true
  await runBriefCompose(row)
  busy.value = false
}

function pushGenerateCard(title: string) {
  if (props.entry)
    return
  if (messages.value.some(row => row.card?.kind === 'generate' && !row.card.locked))
    return
  const counts = briefGenerateCounts()
  if (!counts.characters && !counts.scenes && !counts.props && !counts.shots && !counts.voices)
    return
  if (briefAuto.value) {
    void (async () => {
      busy.value = true
      const groups = ['character', 'scene', 'prop', 'shot', 'voice']
      const report = await runBriefGenerate(groups)
      await afterStillsReady(title, report, groups)
      busy.value = false
    })()
    return
  }
  messages.value.push({
    id: ++seq,
    role: 'assistant',
    text: t('canvas.chat.brief.generateNext'),
    card: {
      kind: 'generate',
      locked: false,
      title,
      questions: defaultGenerateQuestions(counts),
      counts,
      auto: briefAuto.value,
    },
  })
}

function pushVideoCard(title: string) {
  if (props.entry || !briefWantsFilm(currentBriefPath()))
    return
  const shots = shotCount()
  if (shots < 1)
    return
  if (messages.value.some(row => row.card?.kind === 'video' && !row.card.locked))
    return
  messages.value.push({
    id: ++seq,
    role: 'assistant',
    text: t('canvas.chat.brief.videoNext'),
    card: {
      kind: 'video',
      locked: false,
      title,
      questions: defaultVideoQuestions(shots),
      shots,
    },
  })
}

function pushComposeCard(title: string, ready = shotCount()) {
  if (props.entry || !briefWantsFilm(currentBriefPath()))
    return
  if (ready < 2)
    return
  if (messages.value.some(row => row.card?.kind === 'compose' && !row.card.locked))
    return
  messages.value.push({
    id: ++seq,
    role: 'assistant',
    text: t('canvas.chat.brief.composeNext', { n: ready }),
    card: {
      kind: 'compose',
      locked: false,
      title,
      questions: defaultComposeQuestions(ready),
      shots: ready,
    },
  })
}

async function confirmBriefGenerate(item: ChatMsg) {
  const card = item.card
  if (!card || card.kind !== 'generate' || card.locked || busy.value)
    return
  const question = card.questions[0]
  if (!question || question.chosen == null)
    return
  const pick = askChosenText(question)
  card.locked = true
  card.auto = briefAuto.value
  messages.value.push({ id: ++seq, role: 'user', text: pick })
  let groups = briefGenerateGroups(question.chosen)
  if (!groups && question.chosen >= question.options.length && /生成/.test(question.note || ''))
    groups = ['character', 'scene', 'prop', 'shot', 'voice']
  persistSession()
  scrollToEnd()
  if (!groups?.length) {
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.brief.generateSkipped') })
    persistSession()
    return
  }
  busy.value = true
  const report = await runBriefGenerate(groups)
  await afterStillsReady(card.title, report, groups)
  busy.value = false
}

async function confirmBriefVideo(item: ChatMsg) {
  const card = item.card
  if (!card || card.kind !== 'video' || card.locked || busy.value)
    return
  const question = card.questions[0]
  if (!question || question.chosen == null)
    return
  const pick = askChosenText(question)
  card.locked = true
  messages.value.push({ id: ++seq, role: 'user', text: pick })
  const nos = parseVoiceNames(question.note || '').flatMap(item => item.match(/\d+/g) || [])
  const some = question.chosen === 2 || (question.chosen >= question.options.length && nos.length > 0)
  const run = question.chosen === 0 || some || (question.chosen >= question.options.length && /生成|视频/.test(question.note || ''))
  persistSession()
  scrollToEnd()
  if (!run) {
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.brief.videoSkipped') })
    persistSession()
    return
  }
  busy.value = true
  await runBriefVideos(card.title, some ? nos : undefined)
  busy.value = false
}

async function confirmBriefCompose(item: ChatMsg) {
  const card = item.card
  if (!card || card.kind !== 'compose' || card.locked || busy.value)
    return
  const question = card.questions[0]
  if (!question || question.chosen == null)
    return
  const pick = askChosenText(question)
  const preview = question.chosen === 2
  const run = question.chosen === 0 || preview || (question.chosen >= question.options.length && /合成/.test(question.note || ''))
  card.locked = true
  messages.value.push({ id: ++seq, role: 'user', text: pick })
  persistSession()
  scrollToEnd()
  if (!run) {
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.brief.composeSkipped') })
    persistSession()
    return
  }
  busy.value = true
  await runBriefCompose(undefined, preview)
  busy.value = false
}

function confirmBriefVoice(item: ChatMsg) {
  const card = item.card
  if (!card || card.kind !== 'voice' || card.locked || busy.value)
    return
  const question = card.questions[0]
  if (!question || question.chosen == null)
    return
  const pick = askChosenText(question)
  card.locked = true
  messages.value.push({ id: ++seq, role: 'user', text: pick })
  if (question.chosen === 0)
    placeBriefVoice(card)
  else if (question.chosen === 2 || question.chosen >= question.options.length)
    placeBriefVoice(card, parseVoiceNames(question.note || ''))
  messages.value.push({
    id: ++seq,
    role: 'assistant',
    text: card.placed ? t('canvas.chat.brief.placedVoices') : t('canvas.chat.brief.voiceSkipped'),
  })
  pushGenerateCard(card.title)
  persistSession()
  scrollToEnd()
}

async function confirmBriefAsk(item: ChatMsg) {
  const card = item.card
  if (!card || card.kind !== 'ask' || card.locked || busy.value)
    return
  const picks = briefAskPicks(card, t('canvas.chat.brief.other'))
  if (!picks)
    return
  const path = briefPathOf(card.questions[0]?.chosen)
  card.path = path
  card.locked = true
  const decision = t(
    path === 'stills' ? 'canvas.chat.brief.decisionStills' : path === 'script' ? 'canvas.chat.brief.decisionScript' : 'canvas.chat.brief.decision',
    { picks },
  )
  messages.value.push({ id: ++seq, role: 'user', text: picks })
  const reply: ChatMsg = { id: ++seq, role: 'assistant', text: decision, pending: true }
  messages.value.push(reply)
  busy.value = true
  persistSession()
  scrollToEnd()
  const id = nextRun()
  if (path === 'stills') {
    const raw = await runBriefText(briefAnchorPrompt({
      title: card.title,
      script: card.script,
      picks,
      draft: card.script,
    }), id)
    if (!runAlive(id))
      return
    const characters = briefCharacters(raw || '')
    const scenes = briefScenes(raw || '')
    const propItems = briefProps(raw || '')
    const body = briefSceneBody(raw || '', characters, scenes, propItems)
    if (!characters.length && !scenes.length && !propItems.length && !body) {
      failReply(reply, t('生成失败'))
      return
    }
    const next: BriefDocCard = {
      kind: 'anchors',
      locked: true,
      title: card.title,
      thinking: parseBriefDoc(raw || '').thinking,
      label: parseBriefDoc(raw || '').label || t('canvas.chat.brief.anchorsLabel', { title: card.title }),
      body,
      characters,
      scenes,
      props: propItems,
      placed: false,
    }
    placeBriefDoc(next)
    reply.pending = false
    reply.text = decision
    reply.card = next
    pushGenerateCard(card.title)
    busy.value = false
    runTaskId = 0
    persistSession()
    scrollToEnd()
    return
  }
  const raw = await runBriefText(briefDraftPrompt({
    title: card.title,
    script: card.script,
    picks,
    extra: path === 'teaser' ? t('canvas.chat.brief.teaserExtra') : '',
  }), id)
  if (!runAlive(id))
    return
  const doc = parseBriefDoc(raw || '')
  if (!doc.body) {
    failReply(reply, t('生成失败'))
    return
  }
  const next: BriefDocCard = {
    kind: 'draft',
    locked: path === 'script',
    title: card.title,
    thinking: doc.thinking,
    label: doc.label || t('canvas.chat.brief.draftLabel', { title: card.title }),
    body: doc.body,
    placed: false,
  }
  placeBriefDoc(next)
  reply.pending = false
  reply.text = decision
  reply.card = next
  busy.value = false
  runTaskId = 0
  persistSession()
  scrollToEnd()
}

async function confirmBriefDoc(item: ChatMsg) {
  const card = item.card
  if (!card || card.kind === 'ask' || card.kind === 'voice' || card.kind === 'generate' || card.kind === 'video' || card.kind === 'compose' || card.kind === 'board' || card.locked || busy.value)
    return
  card.locked = true
  const ask = [...messages.value].reverse().find(row => row.card?.kind === 'ask')
  const draft = [...messages.value].reverse().find(row => row.card?.kind === 'draft')
  const script = ask?.card?.kind === 'ask' ? ask.card.script : ''
  const picks = ask?.card?.kind === 'ask' ? briefAskPicks(ask.card, t('canvas.chat.brief.other')) : ''
  const draftBody = draft?.card?.kind === 'draft' ? draft.card.body : card.body
  const nextKind = card.kind === 'draft' ? 'anchors' : 'board'
  const lead = t(nextKind === 'anchors' ? 'canvas.chat.brief.anchorsNext' : 'canvas.chat.brief.boardDone')
  messages.value.push({ id: ++seq, role: 'user', text: t('canvas.chat.brief.next') })
  const reply: ChatMsg = { id: ++seq, role: 'assistant', text: lead, pending: true }
  messages.value.push(reply)
  busy.value = true
  persistSession()
  scrollToEnd()
  const id = nextRun()
  const path = currentBriefPath()
  const anchorCast = card.kind === 'anchors' ? (card.characters || []) : []
  const anchorScenes = card.kind === 'anchors' ? (card.scenes || []) : []
  const anchorProps = card.kind === 'anchors' ? (card.props || []) : []
  const anchorText = [
    anchorCast.length ? `角色\n${anchorCast.map(row => `${row.name}，${row.look}`).join('\n')}` : '',
    anchorScenes.length ? `场景\n${anchorScenes.map(row => `${row.name}，${row.look}`).join('\n')}` : '',
    anchorProps.length ? `道具\n${anchorProps.map(row => `${row.name}，${row.look}`).join('\n')}` : '',
    card.body,
  ].filter(Boolean).join('\n')
  const raw = await runBriefText(nextKind === 'anchors'
    ? briefAnchorPrompt({ title: card.title, script, picks, draft: draftBody })
    : briefBoardPrompt({ title: card.title, picks, draft: draftBody, anchors: anchorText }), id)
  if (!runAlive(id))
    return
  const doc = parseBriefDoc(raw || '')
  const characters = nextKind === 'anchors' ? briefCharacters(raw || '') : []
  const scenes = nextKind === 'anchors' ? briefScenes(raw || '') : []
  const propItems = nextKind === 'anchors' ? briefProps(raw || '') : []
  const shots = nextKind === 'board' ? briefShots(raw || '') : []
  const body = nextKind === 'anchors'
    ? briefSceneBody(raw || '', characters, scenes, propItems)
    : (shots.length ? '' : doc.body)
  if (!body && !characters.length && !scenes.length && !propItems.length && !shots.length) {
    failReply(reply, t('生成失败'))
    return
  }
  const stopAtAnchors = nextKind === 'anchors' && !briefWantsBoard(path)
  const next: BriefDocCard = {
    kind: nextKind,
    locked: nextKind === 'board' || stopAtAnchors,
    title: card.title,
    thinking: doc.thinking,
    label: doc.label || t(nextKind === 'anchors' ? 'canvas.chat.brief.anchorsLabel' : 'canvas.chat.brief.boardLabel', { title: card.title }),
    body,
    characters,
    scenes,
    props: propItems,
    shots,
    frameRatio: nextKind === 'board' ? briefFrameRatio(picks) : undefined,
    placed: false,
  }
  placeBriefDoc(next)
  reply.pending = false
  reply.text = nextKind === 'board' ? t('canvas.chat.brief.boardDone') : lead
  reply.card = next
  if (nextKind === 'board') {
    const voices = briefVoices(shots)
    if (voices.length) {
      messages.value.push({
        id: ++seq,
        role: 'assistant',
        text: t('canvas.chat.brief.voiceNext'),
        card: {
          kind: 'voice',
          locked: false,
          title: card.title,
          questions: defaultVoiceQuestions(),
          voices,
          placed: false,
        },
      })
    }
    else {
      pushGenerateCard(card.title)
    }
  }
  else if (stopAtAnchors) {
    pushGenerateCard(card.title)
  }
  busy.value = false
  runTaskId = 0
  persistSession()
  scrollToEnd()
}

/** 短句带上文走普通文本任务。长剧本不走这里 */
function dispatchChat(value: string, reply: ChatMsg, attachments: ChatAttachment[] = [], id = runId) {
  const hinted = styleRequestPrefix() + value + generationHint()
  runAgent = false
  busy.value = true
  stopping.value = false
  void ask(plainChatPrompt({
    current: hinted,
    turns: historyTurns(),
  }), reply, attachments, id)
}

function send(text?: string) {
  const raw = (text ?? prompt.value).trim()
  if (props.entry) {
    if (!raw && !attachments.value.length)
      return
    if (attachments.value.some(item => item.pending)) {
      notify(t('上传中…'))
      return
    }
    writeChatEntry({
      prompt: raw,
      skill: activeSkill.value,
      agentAuto: agentAutoModel.value,
      model: pickedModelId.value || chatModel.value,
      styleName: activeStyleName.value,
      stylePrompt: activeStylePrompt.value,
      styleCover: activeStyleCover.value,
      attachments: attachments.value
        .filter(item => item.assetId)
        .map(item => ({
          key: item.key,
          kind: item.kind,
          name: item.name,
          assetId: item.assetId,
          url: item.url,
        })),
    })
    void navigateTo(localePath({ path: '/canvas', query: { from: 'agent' } }))
    return
  }
  if ((!raw && !attachments.value.length) || busy.value)
    return
  const openBrief = [...messages.value].reverse().find(row => row.card?.kind === 'ask' && !row.card.locked)
  const startBriefNow = shouldOpenBrief(raw)
  if (chatDisabled.value && !startBriefNow && !openBrief) {
    notify(t('canvas.chat.msg.disabled'))
    return
  }
  if (quotaExhausted.value && !startBriefNow && !openBrief) {
    notify(t('canvas.chat.msg.quota'))
    return
  }
  const attachText = attachmentSummary(attachments.value)
  const value = (attachText ? `${attachText}\n` : '') + raw
  messages.value.push({ id: ++seq, role: 'user', text: value })
  prompt.value = ''
  const pendingAttachments = attachments.value
  attachments.value = []
  scrollToEnd()
  if (openBrief) {
    void confirmBriefAsk(openBrief, raw)
    return
  }
  if (startBriefNow) {
    void startBrief(value)
    return
  }
  if (/^(合成|成片|导出成片|放到画布)/.test(raw) || looksLikeComposeReport(raw)) {
    busy.value = true
    void runBriefCompose().finally(() => { busy.value = false })
    return
  }
  const reply: ChatMsg = { id: ++seq, role: 'assistant', text: '', pending: true }
  messages.value.push(reply)
  dispatchChat(value, messages.value[messages.value.length - 1]!, pendingAttachments, nextRun())
}

function questionBefore(item: ChatMsg) {
  const index = messages.value.findIndex(message => message.id === item.id)
  if (index < 0)
    return ''
  for (let i = index - 1; i >= 0; i--) {
    const message = messages.value[i]
    if (message?.role === 'user' && message.text.trim())
      return message.text
  }
  return ''
}

/** 刷新：提问重发这句，回复则用它对应的上一条问题再跑一轮 */
async function rerunReply(item: ChatMsg) {
  if (busy.value || item.pending)
    return
  if (chatDisabled.value) {
    notify(t('canvas.chat.msg.disabled'))
    return
  }
  if (quotaExhausted.value) {
    notify(t('canvas.chat.msg.quota'))
    return
  }
  if (item.card)
    return
  const question = item.role === 'user' ? item.text.trim() : questionBefore(item)
  if (!question) {
    notify(t('canvas.chat.msg.nothingToResend'))
    return
  }
  const index = messages.value.findIndex(message => message.id === item.id)
  const cut = item.role === 'user' ? index + 1 : index
  const hasLater = item.role === 'user' ? messages.value.length > index + 2 : messages.value.length > index + 1
  if (hasLater) {
    const ok = await confirm({
      message: t('canvas.chat.msg.regenerateConfirm'),
      confirmText: t('重新生成'),
      danger: true,
    })
    if (!ok || busy.value)
      return
  }
  messages.value = messages.value.slice(0, cut)
  const replay = withoutStylePrefix(question)
  if (shouldOpenBrief(replay)) {
    void startBrief(replay)
    return
  }
  const reply: ChatMsg = { id: ++seq, role: 'assistant', text: '', pending: true }
  messages.value.push(reply)
  scrollToEnd()
  dispatchChat(replay, reply, [], nextRun())
}

async function copyReply(item: ChatMsg) {
  const text = messageHistoryText(item).trim()
  if (!text)
    return
  try {
    await navigator.clipboard.writeText(text)
    notify(t('已复制'), 'success')
  }
  catch {
    notify(t('复制失败'), 'error')
  }
}

async function deleteReply(item: ChatMsg) {
  if (item.pending || busy.value)
    return
  const index = messages.value.findIndex(message => message.id === item.id)
  const next = item.role === 'user' ? messages.value[index + 1] : null
  const answer = next?.role === 'assistant' && !next.pending ? next : null
  const ok = await confirm({
    message: item.role === 'user'
      ? (answer ? t('canvas.chat.msg.deletePair') : t('canvas.chat.msg.deleteQuestion'))
      : t('canvas.chat.msg.deleteReply'),
    confirmText: t('删除'),
    danger: true,
  })
  if (!ok)
    return
  const drop = new Set([item.id])
  if (answer)
    drop.add(answer.id)
  const previous = messages.value
  messages.value = messages.value.filter(message => !drop.has(message.id))
  if (!messages.value.length) {
    const id = sessionId.value
    if (useRemoteChat()) {
      const ok = await deleteRemoteSession(Number(props.canvasId), id)
      if (!ok) {
        messages.value = previous
        return
      }
    }
    sessions.value = sessions.value.filter(session => session.id !== id)
    if (!useRemoteChat())
      persistLocalSessions()
    openTabIds.value = openTabIds.value.filter(tabId => tabId !== id)
    sessionId.value = ''
    persistOpenTabs()
    return
  }
  persistSession()
}

/** 空画布技能起步卡 / 欢迎区技能：激活该技能，并把模板提示词填进输入框 */
function startSkillDraft(skill: ChatSkill) {
  pickSkill(skill)
  agentAutoModel.value = true
  writeStorage(AGENT_AUTO_MODEL_KEY, true)
  const draft = (skill.prompt || '').replaceAll('{{prompt}}', '').trim()
  if (draft)
    prompt.value = draft
  popover.value = null
  nextTick(() => inputRef.value?.focus())
}

function applyEntryDraft(draft: ChatEntryDraft) {
  prompt.value = draft.prompt || ''
  pickSkill(draft.skill)
  agentAutoModel.value = draft.skill ? true : Boolean(draft.agentAuto)
  writeStorage(AGENT_AUTO_MODEL_KEY, agentAutoModel.value)
  if (draft.model) {
    pickedModelId.value = draft.agentAuto ? '' : draft.model
    chatModel.value = draft.model
    ensureModelIcon(draft.model)
  }
  activeStyleName.value = draft.styleName || ''
  activeStylePrompt.value = draft.stylePrompt || ''
  activeStyleCover.value = draft.styleCover || ''
  writeStorage(styleKey.value, {
    name: activeStyleName.value,
    prompt: activeStylePrompt.value,
    cover: activeStyleCover.value,
  })
  attachments.value = (draft.attachments || []).map(item => ({
    key: item.key,
    kind: item.kind,
    name: item.name,
    assetId: item.assetId,
    url: item.url,
  }))
}

/** Agent 页带过来的草稿：技能、模型、风格、附件和原文先对上，再按画布自己的发送走 */
async function acceptEntry(draft: ChatEntryDraft) {
  holdingEntry.value = true
  applyEntryDraft(draft)
  try {
    const waitUntil = Date.now() + 4000
    while (modelsLoading.value && Date.now() < waitUntil)
      await new Promise(resolve => window.setTimeout(resolve, 40))
    // 等模型时画布可能刚存上 id 并重载会话，发出去之前再写回一次
    applyEntryDraft(draft)
    send(draft.prompt || '')
  }
  finally {
    holdingEntry.value = false
  }
}

// ---- 结合画布（API.md 16 / 32）----
function assistHistory() {
  return messages.value
    .filter(item => !item.pending && !item.error && messageHistoryText(item).trim())
    .slice(0, -1) // 末尾是刚发出的这句（占位回复是 pending，已被滤掉）
    .map(item => ({ role: item.role, content: messageHistoryText(item) }))
}

/**
 * 结合画布：走对话式工作流生成接口（API.md 32）。服务端在一个文本任务里跑多轮，
 * changes 里除四个旧动作外还可能带 apply_graph（整张图），落图 / 撤销复用同一条方案卡链路。
 * 空画布、或用户在对话栏打开了「从零搭图」→ generate；否则 patch（在现有图上小改）。
 */
async function askAgent(value: string, reply: ChatMsg, attachments: ChatAttachment[] = [], id = runId) {
  runTaskId = 0
  const nodes = props.assist!.context()
  const mode = agentModeFor(nodes.length, settings.value.buildFromScratch)
  // 结合画布的 agent 接口没有 inputs 字段，媒体附件以「参考素材」清单写进问题文本
  const mediaNote = attachments.length
    ? `\n[${t('参考素材')}：${attachments.map(item => item.name).join('、')}]`
    : ''
  const res = await canvasApi.agent(props.canvasId, {
    question: value + mediaNote,
    mode,
    // Agent 自动选模型开着时不指定，服务端按 AgentModel → 第一个已定价文本模型兜底
    model: agentAutoModel.value ? undefined : (chatModel.value || undefined),
    nodes,
    history: assistHistory(),
  })
  if (!runAlive(id)) {
    if (res?.success && res.data?.id)
      void taskApi.cancel(res.data.id)
    return
  }
  if (!res?.success || !res.data) {
    failReply(reply, res?.message || t('canvas.chat.msg.sendFail'), res?.data as { reason?: string } | undefined)
    return
  }
  reply.taskId = res.data.id
  runTaskId = res.data.id
  emit('taskStarted')
  pollAgentPlan(reply, id)
}

/** 任务已经成功时补上方案卡。guard 有值时，这一轮已被停止就不再改气泡 */
async function presentAgentPlan(reply: ChatMsg, taskId: number, guard?: number) {
  const plan = await canvasApi.agentPlan(props.canvasId, taskId)
  if (guard != null && !runAlive(guard))
    return
  if (!plan?.success || !plan.data) {
    failReply(reply, plan?.message || t('canvas.chat.plan.loadFail'))
    return
  }
  const data = plan.data
  const noChanges = !data.changes.length
  // 纯问答：changes 为空、校验通过（后端 allowNoChange 豁免，reply 非空）→ 不挂方案卡，按普通消息渲染。
  // 旧版同样只在 changes 非空 / 校验失败时才挂卡，本次的差异只是把这条分支写显式、给空 reply 补兜底文案
  const plainReply = noChanges && (!data.validate || data.validate.ok)
  if (!noChanges) {
    reply.plan = data
    reply.picked = data.changes.map(() => true)
    reply.planState = 'ready'
  }
  else if (!plainReply) {
    // 本轮没有可用产出：把校验报告留在卡片上，用户可以带着补充说明再跑一轮
    reply.plan = data
    reply.picked = []
    reply.planState = 'ready'
  }
  // 方案卡片自己展示修改，回复里只放说明；不自动写进文本节点
  const fallback = plainReply ? t('canvas.chat.plan.noChanges') : noChanges ? t('canvas.chat.msg.empty') : t('canvas.chat.plan.suggest')
  msgFinish(reply, data.reply || fallback)
  if (settings.value.autoGenerate && !noChanges)
    void applyPlan(reply, true)
}

/** 轮询 agent 任务（2 秒一次，与服务端轮询口径一致），完成后取计划 */
function pollAgentPlan(reply: ChatMsg, id = runId) {
  stopPolling()
  const poll = async () => {
    if (!runAlive(id))
      return
    const task = await taskApi.get(reply.taskId!)
    if (!runAlive(id) || !task?.success || !task.data || task.data.status === 'pending' || task.data.status === 'running')
      return
    stopPolling()
    if (task.data.status === 'cancelled') {
      finishReply(reply, t('canvas.chat.msg.stopped'), false, false)
      return
    }
    if (task.data.status !== 'succeeded') {
      failReply(reply, task.data.error_msg || t('生成失败'))
      return
    }
    await presentAgentPlan(reply, reply.taskId!, id)
  }
  stopChatPoll = startHiddenAwarePoll(() => poll(), 2000)
}

function msgFinish(msg: ChatMsg, text: string) {
  runTaskId = 0
  msg.pending = false
  msg.error = false
  msg.text = text
  busy.value = false
  persistSession()
  scrollToEnd()
}

async function applyPlan(msg: ChatMsg, generate: boolean) {
  if (!msg.plan || !props.assist || msg.planState === 'applying')
    return
  const changes = msg.plan.changes.filter((_, i) => msg.picked?.[i] !== false)
  if (!changes.length) {
    notify(t('canvas.chat.plan.pickOne'))
    return
  }
  if (generate && !(await confirmSpend(planPoints(msg))))
    return
  msg.planState = 'applying'
  const result = await props.assist.apply(changes, generate)
  if (!result.applied && !result.generated) {
    msg.planState = 'ready'
    notify(result.skipped ? t('canvas.chat.plan.nodesGone') : t('canvas.chat.plan.nothing'), 'error')
    return
  }
  msg.planState = 'applied'
  msg.undoToken = result.undoToken || undefined
  const parts = [t('canvas.chat.plan.applied', { n: result.applied })]
  if (result.generated)
    parts.push(t('canvas.chat.plan.generated', { n: result.generated }))
  if (result.skipped)
    parts.push(t('canvas.chat.plan.skipped', { n: result.skipped }))
  msg.applyNote = parts.join(' · ')
  persistSession()
}

function planPoints(msg: ChatMsg) {
  return msg.plan ? pickedPoints(msg.plan.changes, msg.picked ?? []) : 0
}

/** 节点右键「问助手」：打开对话并聚焦输入框 */
function focusAssist() {
  nextTick(() => inputRef.value?.focus())
}

defineExpose({ focusAssist, addAssetAttachments, startSkillDraft, applyStyle, acceptEntry })

function useSkill(item: ChatSkill) {
  startSkillDraft(item)
}

function onEnter(event: KeyboardEvent) {
  if (event.shiftKey)
    return
  event.preventDefault()
  send()
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function saveChatModel() {
  try {
    const raw = localStorage.getItem(CANVAS_AGENT_SETTINGS_KEY)
    const prev = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    localStorage.setItem(CANVAS_AGENT_SETTINGS_KEY, JSON.stringify({ ...prev, model: chatModel.value }))
  }
  catch {
    // 私密模式等情况下忽略
  }
}

function pickChatModel(model: string) {
  if (!model || model === chatModel.value)
    return
  chatModel.value = model
  saveChatModel()
  const found = textModels.value.find(item => item.model === model)
  if (found)
    notify(t('canvas.chat.model.switched', { name: shortModelName(found) }))
}

loadGenParams()

watch(showGenParams, (on) => {
  if (!on && popover.value === 'params')
    popover.value = null
  clampGenParams()
})
watch([genRatio, genSeconds, genResolution], saveGenParams)

function pickModel(item: GenerationModel) {
  const current = pickedModelId.value || chatModel.value
  if (!agentAutoModel.value && item.model === current) {
    enableAgentAuto()
    return
  }
  agentAutoModel.value = false
  writeStorage(AGENT_AUTO_MODEL_KEY, false)
  pickedModelId.value = item.model
  ensureModelIcon(item.model)
  if (item.type === 'text')
    pickChatModel(item.model)
  popover.value = null
}

/** 单位文案：积分单价按 second/image/call 三种口径展示 */
const UNIT_LABEL: Record<string, string> = { second: '秒', image: '张', call: '次' }

function priceHint(item: GenerationModel) {
  if (!item.priced)
    return t('未定价')
  return t('{n} 积分/{unit}', { n: effectiveUnitPrice(item, isMember.value), unit: t(UNIT_LABEL[item.unit] || '次') })
}

function promoOf(item: GenerationModel) {
  return item.priced ? modelPromoDisplay(item, isMember.value) : null
}

</script>

<template>
  <aside class="canvas-chat" :class="{ 'is-entry': entry }" @chat-assets="addAssetAttachments">
    <header v-if="!entry" class="canvas-chat__bar">
      <div class="canvas-chat__tabs">
        <div class="canvas-chat__tab-list">
          <button
            v-for="tab in chatTabs"
            :key="tab.id || 'draft'"
            type="button"
            class="canvas-chat__tab"
            :class="{ 'is-on': String(tab.id) === String(sessionId) }"
            :title="tab.title"
            @click="openTab(tab.id)"
          >
            <span>{{ tab.title }}</span>
            <i
              class="canvas-chat__tab-x"
              :aria-label="t('关闭')"
              @click.stop="closeTab(tab.id)"
            >
              <UIcon name="i-lucide-x" class="size-3" />
            </i>
          </button>
        </div>
        <button type="button" class="canvas-chat__tab-add" :aria-label="t('canvas.chat.history.new')" @click="newChat">
          <UIcon name="i-lucide-plus" class="size-3.5" />
          <span class="canvas-tip canvas-tip--down">{{ t('canvas.chat.history.new') }}</span>
        </button>
      </div>
      <div class="canvas-chat__actions">
        <button type="button" class="canvas-chat__pop-trigger" :class="{ 'is-on': popover === 'history' }" :aria-label="t('历史')" @click.stop="togglePopover('history')">
          <UIcon name="i-lucide-history" class="size-4" />
          <span class="canvas-tip canvas-tip--down">{{ t('历史') }}</span>
        </button>
        <button type="button" :class="{ 'is-on': settingsOpen }" :aria-label="t('canvas.chat.settings.title')" @click="openSettings">
          <UIcon name="i-lucide-sliders-horizontal" class="size-4" />
          <span class="canvas-tip canvas-tip--down">{{ t('canvas.chat.settings.title') }}</span>
        </button>
        <button type="button" :aria-label="t('canvas.chat.history.collapse')" @click="emit('close')">
          <UIcon name="i-lucide-panel-right-close" class="size-4" />
          <span class="canvas-tip canvas-tip--down">{{ t('canvas.chat.history.collapse') }}</span>
        </button>
      </div>

      <div v-if="popover === 'history'" class="canvas-chat__pop canvas-chat__pop--top">
        <div class="canvas-chat__pop-head">
          <strong>{{ t('canvas.chat.history.title') }}</strong>
          <button v-if="sessions.length" type="button" :disabled="historyBusy" @click="clearSessions">{{ t('清空') }}</button>
        </div>
        <p v-if="!sessions.length" class="canvas-chat__pop-empty">{{ t('canvas.chat.history.empty') }}</p>
        <ul v-else class="canvas-chat__pop-list">
          <li v-for="item in sessions" :key="item.id" :class="{ 'is-on': String(item.id) === String(sessionId) }">
            <button type="button" class="canvas-chat__pop-main" @click.stop="openSession(item)">
              <span>{{ tabTitle(item.title) || item.title }}</span>
              <small>{{ formatTime(item.updatedAt) }} · {{ t('canvas.chat.history.count', { n: item.messageCount ?? item.messages.length }) }}</small>
            </button>
            <button type="button" class="canvas-chat__pop-del" :disabled="historyBusy" :aria-label="t('删除')" @click.stop="removeSession(item)">
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </li>
        </ul>
      </div>

    </header>

    <div ref="bodyRef" class="canvas-chat__body">
      <div v-if="!entry && !messages.length" class="canvas-chat__hello">
        <h2>{{ t('Hi, {name}', { name: helloName }) }}</h2>
        <p>{{ t('canvas.chat.msg.welcome') }}</p>
      </div>
      <div v-else-if="!entry" class="canvas-chat__msgs">
        <div
          v-for="item in messages"
          :key="item.id"
          class="canvas-chat__turn"
          :class="[item.role, { 'is-crew': !!item.card }]"
        >
          <div
            class="canvas-chat__msg"
            :class="[item.role, { 'is-pending': item.pending, 'is-error': item.error, 'is-crew': !!item.card }]"
          >
            <template v-if="item.pending">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              {{ t('canvas.chat.msg.thinking') }}
            </template>
            <template v-else>
              <div v-if="item.thumb && item.role === 'user'" class="canvas-chat__pick">
                <img :src="resolveMediaUrl(item.thumb)" alt="">
                <span>{{ withoutStylePrefix(item.text) }}</span>
              </div>
              <p v-else-if="item.card && item.text && !item.error" class="canvas-crew__lead">{{ item.text }}</p>
              <ClientOnly v-else-if="!item.error && item.text">
                <v-md-preview
                  class="canvas-chat__md"
                  :text="item.role === 'user' ? withoutStylePrefix(item.text) : item.text"
                />
                <template #fallback>
                  <div class="canvas-chat__plain">{{ item.role === 'user' ? withoutStylePrefix(item.text) : item.text }}</div>
                </template>
              </ClientOnly>
              <div v-else-if="item.error" class="canvas-chat__plain">{{ item.text }}</div>
            </template>
            <div v-if="item.card?.kind === 'ask' || item.card?.kind === 'voice' || item.card?.kind === 'generate' || item.card?.kind === 'video' || item.card?.kind === 'compose'" class="canvas-brief">
              <div class="canvas-brief__ask-head">
                <p class="canvas-brief__ask">{{ currentAsk(item.card).ask }}</p>
                <span v-if="item.card.questions.length > 1" class="canvas-brief__page">
                  {{ (item.card.step || 0) + 1 }}/{{ item.card.questions.length }}
                </span>
              </div>
              <ul v-if="item.card.kind === 'voice' && item.card.voices.length" class="canvas-brief__cast">
                <li v-for="voice in item.card.voices" :key="voice.name">
                  <strong>{{ voice.name }}</strong> {{ t('canvas.chat.brief.voiceShots', { shots: voice.shots.join('、') }) }}
                </li>
              </ul>
              <div v-if="specChipsOf(item).length" class="canvas-brief__chips">
                <span v-for="chip in specChipsOf(item)" :key="chip" class="canvas-brief__chip">{{ chip }}</span>
              </div>
              <ul v-if="item.card.kind === 'generate'" class="canvas-brief__cast">
                <li v-if="item.card.counts.characters">{{ t('canvas.chat.brief.countCharacters', { n: item.card.counts.characters }) }}</li>
                <li v-if="item.card.counts.scenes">{{ t('canvas.chat.brief.countScenes', { n: item.card.counts.scenes }) }}</li>
                <li v-if="item.card.counts.props">{{ t('canvas.chat.brief.countProps', { n: item.card.counts.props }) }}</li>
                <li v-if="item.card.counts.shots">{{ t('canvas.chat.brief.countShots', { n: item.card.counts.shots }) }}</li>
                <li v-if="item.card.counts.voices">{{ t('canvas.chat.brief.countVoices', { n: item.card.counts.voices }) }}</li>
                <li v-if="item.card.counts.points">{{ t('canvas.chat.brief.countPoints', { n: item.card.counts.points }) }}</li>
              </ul>
              <details v-if="item.card.kind === 'generate' && briefPromptLinesOf(item).length" class="canvas-brief__prompts">
                <summary>{{ t('canvas.chat.brief.viewPrompts') }}</summary>
                <ul>
                  <li v-for="row in briefPromptLinesOf(item)" :key="row.name">
                    <strong>{{ row.name }}</strong> {{ row.prompt }}
                  </li>
                </ul>
              </details>
              <label v-if="item.card.kind === 'generate' && !item.card.locked" class="canvas-brief__auto">
                <input v-model="briefAuto" type="checkbox">
                <span>{{ t('canvas.chat.brief.autoGenerate') }}</span>
              </label>
              <template v-if="item.card.locked">
                <p
                  v-for="(question, qi) in item.card.questions"
                  :key="qi"
                  class="canvas-brief__pick"
                >
                  {{ askChosenText(question) }}
                </p>
                <p v-if="item.card.kind === 'voice' && item.card.placed" class="canvas-brief__note">{{ t('canvas.chat.brief.placedVoices') }}</p>
              </template>
              <template v-else>
                <div class="canvas-brief__choices">
                  <button
                    v-for="(choice, ci) in askChoices(currentAsk(item.card))"
                    :key="ci"
                    type="button"
                    class="canvas-brief__choice"
                    :class="{ 'is-on': currentAsk(item.card).chosen === ci }"
                    :disabled="busy"
                    @click="selectAskOption(item.card, ci)"
                  >
                    <i>{{ ci + 1 }}</i>
                    <span>{{ choice }}</span>
                  </button>
                </div>
                <textarea
                  v-if="showAskNote(item.card)"
                  :value="currentAsk(item.card).note || ''"
                  class="canvas-brief__note-box"
                  :placeholder="(item.card.kind === 'voice' || item.card.kind === 'video') && currentAsk(item.card).chosen === 2 ? t(item.card.kind === 'video' ? 'canvas.chat.brief.optVideoSome' : 'canvas.chat.brief.voiceSomeHint') : t('canvas.chat.brief.otherHint')"
                  rows="2"
                  @input="writeAskNote(item.card, $event)"
                />
                <div class="canvas-brief__ops">
                  <button type="button" class="canvas-brief__skip" :disabled="busy" @click="skipBriefAsk(item)">
                    {{ t('canvas.chat.brief.skip') }}
                  </button>
                  <button
                    type="button"
                    class="canvas-crew__go"
                    :disabled="busy || !canSubmitAsk(item.card)"
                    @click="submitBriefAsk(item)"
                  >
                    {{ t((item.card.step || 0) < item.card.questions.length - 1 ? 'canvas.chat.brief.keep' : 'canvas.chat.brief.submit') }}
                  </button>
                </div>
              </template>
            </div>
            <div v-else-if="item.card && item.card.kind !== 'ask' && item.card.kind !== 'voice' && item.card.kind !== 'generate' && item.card.kind !== 'video' && item.card.kind !== 'compose'" class="canvas-brief">
              <details v-if="item.card.thinking" class="canvas-brief__think">
                <summary>{{ t('canvas.chat.brief.thinking') }}</summary>
                <p>{{ item.card.thinking }}</p>
              </details>
              <ul v-if="item.card.characters?.length" class="canvas-brief__cast">
                <li v-for="person in item.card.characters" :key="person.name">
                  <strong>{{ person.name }}</strong> {{ person.look }}
                </li>
              </ul>
              <ul v-if="item.card.scenes?.length" class="canvas-brief__cast">
                <li v-for="scene in item.card.scenes" :key="scene.name">
                  <strong>{{ scene.name }}</strong> {{ scene.look }}
                </li>
              </ul>
              <ul v-if="item.card.props?.length" class="canvas-brief__cast">
                <li v-for="itemProp in item.card.props" :key="itemProp.name">
                  <strong>{{ itemProp.name }}</strong> {{ itemProp.look }}
                </li>
              </ul>
              <ul v-if="item.card.shots?.length" class="canvas-brief__cast">
                <li v-for="shot in item.card.shots" :key="shot.no">
                  <strong>{{ t('canvas.chat.brief.shotName', { n: shot.no }) }}</strong> {{ t('canvas.chat.brief.shotSeconds', { n: shot.seconds }) }} {{ shot.picture }}
                </li>
              </ul>
              <pre v-if="item.card.body" class="canvas-brief__doc">{{ item.card.body }}</pre>
              <p v-if="item.card.placed && item.card.characters?.length" class="canvas-brief__note">{{ t('canvas.chat.brief.placedCharacters') }}</p>
              <p v-if="item.card.placed && item.card.scenes?.length" class="canvas-brief__note">{{ t('canvas.chat.brief.placedScenes') }}</p>
              <p v-if="item.card.placed && item.card.props?.length" class="canvas-brief__note">{{ t('canvas.chat.brief.placedProps') }}</p>
              <p v-if="item.card.placed && item.card.shots?.length" class="canvas-brief__note">{{ t('canvas.chat.brief.placedShots') }}</p>
              <p v-if="item.card.placed && item.card.body" class="canvas-brief__note">{{ t('canvas.chat.brief.placed') }}</p>
              <button
                v-if="!item.card.locked && item.card.kind !== 'board'"
                type="button"
                class="canvas-crew__go"
                :disabled="busy"
                @click="confirmBriefDoc(item)"
              >
                {{ t('canvas.chat.brief.next') }}
              </button>
            </div>
          </div>
          <div v-if="!item.pending && item.card?.kind !== 'invite'" class="canvas-chat__msg-actions">
            <button v-if="!item.card" type="button" :disabled="busy" :aria-label="t('刷新')" @click="rerunReply(item)">
              <UIcon name="i-lucide-refresh-cw" class="size-3.5" />
              <span class="canvas-tip canvas-tip--up">{{ t('刷新') }}</span>
            </button>
            <button type="button" :disabled="!messageHistoryText(item).trim()" :aria-label="t('复制')" @click="copyReply(item)">
              <UIcon name="i-lucide-copy" class="size-3.5" />
              <span class="canvas-tip canvas-tip--up">{{ t('复制') }}</span>
            </button>
            <button type="button" :disabled="busy" :aria-label="t('删除')" @click="deleteReply(item)">
              <UIcon name="i-lucide-trash-2" class="size-3.5" />
              <span class="canvas-tip canvas-tip--up">{{ t('删除') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

      <div class="canvas-chat__dock">
        <input
          v-for="item in attachMenu"
          :key="item.kind"
          type="file"
          class="canvas-chat__attach-file"
          :data-kind="item.kind"
          :accept="item.accept"
          hidden
          @change="onAttachFile($event, item.kind)"
        >
        <div v-if="!entry && !messages.length" class="canvas-chat__skills">
        <div class="canvas-chat__skills-head">
          <p>{{ t('canvas.chat.skill.ready') }}<em>{{ t('canvas.chat.skill.readyEm') }}</em></p>
          <button type="button" @click="shuffleSkills">
            <UIcon name="i-lucide-refresh-cw" class="size-3.5" />
            {{ t('canvas.chat.skill.shuffle') }}
          </button>
        </div>
        <div class="canvas-chat__skill-grid">
          <button
            v-for="item in shownSkills"
            :key="item.id"
            type="button"
            :class="{ 'is-on': skillRowOn(item) }"
            :title="item.slug"
            @click="useSkill(item)"
          >
            <img :src="item.cover" :alt="item.title">
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.description || item.slug }}</small>
            </span>
          </button>
        </div>
      </div>

      <div v-if="chatDisabled" class="canvas-chat__context">
        <span>{{ t('canvas.chat.msg.disabled') }}</span>
      </div>
      <div v-else-if="quotaLabel" class="canvas-chat__context">
        <span>{{ quotaLabel }}</span>
        <template v-if="quotaExhausted">
          <span>{{ t('canvas.chat.msg.quota') }}</span>
          <button type="button" @click="gotoPricing('membership')">
            <UIcon name="i-lucide-crown" class="size-3.5" />
            {{ t('开通会员') }}
          </button>
        </template>
      </div>
      <div class="canvas-chat__input">
        <div v-if="attachments.length" class="canvas-chat__attach-thumbs">
          <span
            v-for="item in attachments"
            :key="item.key"
            class="canvas-chat__attach-thumb"
            :class="{ 'is-pending': item.pending }"
          >
            <span class="canvas-chat__attach-thumb-hit">
              <img v-if="item.url" :src="item.url" :alt="item.name">
              <UIcon v-else :name="ATTACH_ICON[item.kind]" class="size-4" />
            </span>
            <UIcon v-if="item.pending" name="i-lucide-loader-circle" class="size-3.5 animate-spin canvas-chat__attach-spin" />
            <button type="button" class="canvas-chat__attach-x" :aria-label="t('移除')" @click="removeAttachment(item.key)">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </span>
        </div>
        <textarea
          ref="inputRef"
          v-model="prompt"
          rows="3"
          :placeholder="!agentAutoModel && displayModel ? t('canvas.chat.skill.freeHint') : t('canvas.chat.skill.agentHint')"
          @keydown.enter.exact="onEnter"
        />
        <div class="canvas-chat__input-bar">
          <div class="canvas-chat__tools">
            <div class="canvas-chat__pop-wrap">
            <button type="button" class="canvas-chat__pop-trigger" :class="{ 'is-on': popover === 'add' }" :aria-label="t('添加')" @click="togglePopover('add')">
              <UIcon name="i-lucide-plus" class="size-5" />
              <span :class="entry ? 'canvas-tip canvas-tip--down' : 'canvas-tip canvas-tip--up'">{{ t('添加') }}</span>
            </button>
            <div v-if="popover === 'add'" class="canvas-chat__pop canvas-chat__pop--bottom">
              <div class="canvas-chat__add-list">
                <button v-for="item in attachMenu" :key="item.kind" type="button" @click="onAttachMenu(item)">
                  <UIcon :name="item.icon" class="size-4" />
                  <span>
                    <strong>{{ item.label }}</strong>
                    <small>{{ item.hint }}</small>
                  </span>
                </button>
              </div>
            </div>
            </div>
            <span class="canvas-chat__bar-split" aria-hidden="true" />
            <div class="canvas-chat__pop-wrap">
            <button type="button" class="canvas-chat__pop-trigger canvas-chat__tool" :class="{ 'is-on': popover === 'skill', 'is-picked': !!activeSkill }" :aria-label="agentAutoModel ? (activeSkill?.title || t('技能')) : t('canvas.chat.skill.free')" @click="togglePopover('skill')">
              <UIcon name="i-lucide-zap" class="size-5" />
              <span class="canvas-chat__model-name">{{ agentAutoModel ? (activeSkill?.title || t('技能')) : t('canvas.chat.skill.free') }}</span>
              <UIcon name="i-lucide-chevron-down" class="size-4 canvas-chat__tool-caret" />
            </button>
            <div v-if="popover === 'skill'" class="canvas-chat__pop canvas-chat__pop--bottom canvas-chat__pop--wide">
              <div class="canvas-chat__chips">
                <button
                  v-for="tab in skillTabs"
                  :key="tab.key || 'all'"
                  type="button"
                  :class="{ 'is-on': skillNav === tab.key }"
                  @click="selectSkillNav(tab.key)"
                >
                  {{ tab.label }}
                </button>
              </div>
              <div class="canvas-chat__skill-list">
                <div
                  v-if="!skillNav && !agentAutoModel"
                  class="canvas-chat__skill-row"
                  :class="{ 'is-on': !agentAutoModel }"
                  role="button"
                  tabindex="0"
                  @click="pickFreeCreate"
                  @keydown.enter.prevent="pickFreeCreate"
                >
                  <i class="canvas-chat__skill-mark" aria-hidden="true">
                    <UIcon name="i-lucide-zap" class="size-4" />
                  </i>
                  <span class="canvas-chat__skill-copy">
                    <strong>{{ t('canvas.chat.skill.free') }}</strong>
                    <small>{{ t('canvas.chat.skill.freeLead') }}</small>
                  </span>
                  <i v-if="!agentAutoModel" class="canvas-chat__skill-check" aria-hidden="true">
                    <UIcon name="i-lucide-check" class="size-4" />
                  </i>
                  <button
                    type="button"
                    class="canvas-chat__skill-act"
                    :class="{ 'is-cancel': !agentAutoModel }"
                    @click.stop="!agentAutoModel ? enableAgentAuto() : pickFreeCreate()"
                  >
                    {{ !agentAutoModel ? t('canvas.chat.skill.clear') : t('使用') }}
                  </button>
                </div>
                <div v-if="skillPanelLoading" class="canvas-chat__skill-skel" aria-busy="true" :aria-label="t('加载中…')">
                  <div v-for="n in 4" :key="n" class="canvas-chat__skill-skel-row">
                    <i />
                    <span>
                      <b />
                      <em />
                    </span>
                  </div>
                </div>
                <p v-else-if="skillPanelFailed" class="canvas-chat__pop-empty">{{ t('Skill 加载失败') }}</p>
                <p v-else-if="!skillPanel.length && skillNav" class="canvas-chat__pop-empty">{{ t('canvas.chat.skill.emptyCategory') }}</p>
                <template v-else>
                  <div
                    v-for="item in skillPanel"
                    :key="item.id"
                    class="canvas-chat__skill-row"
                    :class="{ 'is-on': skillRowOn(item) }"
                    role="button"
                    tabindex="0"
                    :title="item.title"
                    @click="pickSkillFromPanel(item)"
                    @keydown.enter.prevent="pickSkillFromPanel(item)"
                  >
                    <img :src="item.cover" :alt="item.title" loading="lazy">
                    <span class="canvas-chat__skill-copy">
                      <strong>{{ item.title }}</strong>
                      <small v-if="item.description">{{ item.description }}</small>
                    </span>
                    <i v-if="skillRowOn(item)" class="canvas-chat__skill-check" aria-hidden="true">
                      <UIcon name="i-lucide-check" class="size-4" />
                    </i>
                    <button
                      type="button"
                      class="canvas-chat__skill-act"
                      :class="{ 'is-cancel': skillRowOn(item) }"
                      @click.stop="skillRowOn(item) ? enableAgentAuto() : pickSkillFromPanel(item)"
                    >
                      {{ skillRowOn(item) ? t('canvas.chat.skill.clear') : t('使用') }}
                    </button>
                  </div>
                </template>
              </div>
              <div class="canvas-chat__pop-foot">
                <button type="button" @click="createSkill">
                  <UIcon name="i-lucide-plus" class="size-3.5" />
                  {{ t('创建 Skill') }}
                </button>
              </div>
            </div>
            </div>
            <div class="canvas-chat__pop-wrap">
            <button v-if="!agentAutoModel && displayModel" type="button" class="canvas-chat__pop-trigger" :class="{ 'canvas-chat__tool': entry, 'is-on': popover === 'model' }" :aria-label="shortModelName(displayModel)" @click="togglePopover('model')">
              <CanvasModelIcon :icon="modelIconKey(displayModel)" :fallback="modelMark(displayModel)" />
              <span v-if="entry" class="canvas-chat__model-name">{{ shortModelName(displayModel) }}</span>
              <UIcon v-if="entry" name="i-lucide-chevron-down" class="size-4 canvas-chat__tool-caret" />
              <span v-else class="canvas-tip canvas-tip--up">{{ shortModelName(displayModel) }}</span>
            </button>
            <button v-else-if="agentAutoModel && !activeSkill" type="button" class="canvas-chat__pop-trigger canvas-chat__tool" :class="{ 'is-on': popover === 'model' }" :aria-label="t('canvas.chat.skill.agentModel')" @click="togglePopover('model')">
              <UIcon name="i-lucide-bot" class="size-5" />
              <span>Agent</span>
              <UIcon name="i-lucide-chevron-down" class="size-4 canvas-chat__tool-caret" />
            </button>
            <div v-if="popover === 'model'" class="canvas-chat__pop canvas-chat__pop--bottom canvas-chat__pop--wide">
              <div class="canvas-chat__pop-head">
                <strong>{{ t('模型') }}</strong>
                <span class="canvas-chat__switch">
                  <span>Agent</span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="agentAutoModel"
                    :class="{ 'is-on': agentAutoModel }"
                    :aria-label="t('canvas.chat.skill.agentModel')"
                    :title="t('canvas.chat.skill.agentModel')"
                    @click="toggleAgentAutoModel"
                  >
                    <i />
                  </button>
                </span>
              </div>
              <div v-if="modelGroups.length" class="canvas-chat__chips">
                <button
                  v-for="group in modelGroups"
                  :key="group.type"
                  type="button"
                  :class="{ 'is-on': modelTab === group.type }"
                  @click="modelTab = group.type; void warmModelIcons(group.type)"
                >
                  {{ t(group.label) }}
                </button>
              </div>
              <div v-if="modelsLoading" class="canvas-chat__skill-skel" aria-busy="true" :aria-label="t('加载中…')">
                <div v-for="n in 4" :key="n" class="canvas-chat__skill-skel-row">
                  <i />
                  <span>
                    <b />
                    <em />
                  </span>
                </div>
              </div>
              <p v-else-if="!modelGroups.length" class="canvas-chat__pop-empty">{{ t('canvas.chat.model.none') }}</p>
              <div v-else-if="activeModelGroup" class="canvas-chat__model-list">
                <button
                  v-for="item in activeModelGroup.items"
                  :key="`${item.type}-${item.model}`"
                  type="button"
                  class="canvas-chat__model-row"
                  :class="{ 'is-on': !agentAutoModel && item.model === (pickedModelId || chatModel) }"
                  :title="item.label || item.model"
                  @click="pickModel(item)"
                >
                  <CanvasModelIcon :icon="modelIconKey(item)" :fallback="modelMark(item)" />
                  <span>
                    <strong>{{ shortModelName(item) }}</strong>
                    <small class="canvas-chat__model-price" :class="{ 'canvas-promo': promoOf(item) }">
                      <s v-if="promoOf(item)">{{ promoOf(item)!.origin }}</s>
                      {{ priceHint(item) }}
                      <i v-if="promoOf(item)" class="canvas-promo__chip">{{ promoOf(item)!.label || t('促销') }}</i>
                    </small>
                  </span>
                  <UIcon v-if="!agentAutoModel && item.model === (pickedModelId || chatModel)" name="i-lucide-check" class="size-4" />
                </button>
              </div>
              <p v-else class="canvas-chat__pop-empty">{{ t('canvas.chat.model.emptyCategory') }}</p>
            </div>
            </div>
            <button type="button" class="canvas-chat__pop-trigger" :class="{ 'canvas-chat__tool': entry, 'is-picked': !!activeStyleName }" :aria-label="activeStyleName || t('风格')" @click="emit('openStyle')">
              <img v-if="styleCoverSrc && !styleCoverBroken" :src="styleCoverSrc" alt="" class="canvas-chat__style-cover" @error="styleCoverBroken = true">
              <UIcon v-else name="i-lucide-palette" class="size-5" />
              <span v-if="entry" class="canvas-chat__model-name">{{ activeStyleName || t('风格') }}</span>
              <UIcon v-if="entry" name="i-lucide-chevron-down" class="size-4 canvas-chat__tool-caret" />
              <span v-else class="canvas-tip canvas-tip--up">{{ activeStyleName || t('风格') }}</span>
            </button>
            <button type="button" :class="{ 'canvas-chat__tool': entry }" :aria-label="t('资产')" @click="emit('pickAsset', false)">
              <UIcon name="i-lucide-images" class="size-5" />
              <span v-if="entry">{{ t('资产') }}</span>
              <UIcon v-if="entry" name="i-lucide-chevron-down" class="size-4 canvas-chat__tool-caret" />
              <span v-else class="canvas-tip canvas-tip--up">{{ t('资产') }}</span>
            </button>
            <div class="canvas-chat__pop-wrap">
            <button type="button" class="canvas-chat__pop-trigger" :class="{ 'canvas-chat__tool': entry, 'is-on': popover === 'template' }" :aria-label="t('canvas.chat.skill.template')" @click="togglePopover('template')">
              <UIcon name="i-lucide-lightbulb" class="size-5" />
              <span v-if="entry">{{ t('canvas.chat.skill.template') }}</span>
              <UIcon v-if="entry" name="i-lucide-chevron-down" class="size-4 canvas-chat__tool-caret" />
              <span v-else class="canvas-tip canvas-tip--up">{{ t('canvas.chat.skill.template') }}</span>
            </button>
            <div v-if="popover === 'template'" class="canvas-chat__pop canvas-chat__pop--bottom canvas-chat__pop--tpl">
              <div class="canvas-chat__pop-head">
                <strong>{{ t('提示词模板') }}</strong>
              </div>
              <div class="canvas-chat__tpl-list">
                <button v-for="item in promptTemplateList" :key="item.id" type="button" @click="usePromptTemplate(item)">
                  <UIcon :name="item.icon" class="size-4" />
                  <span>{{ item.title }}</span>
                </button>
              </div>
            </div>
            </div>
          </div>
          <div class="canvas-chat__input-end">
            <div v-if="showGenParams" class="canvas-chat__pop-wrap">
            <button
              type="button"
              class="canvas-chat__pop-trigger"
              :class="{ 'is-on': popover === 'params' }"
              :aria-label="paramsSummary || t('canvas.chat.skill.params')"
              @click="togglePopover('params')"
            >
              <UIcon name="i-lucide-sliders-horizontal" class="size-5" />
              <span v-if="paramsSummary" :class="entry ? 'canvas-tip canvas-tip--down' : 'canvas-tip canvas-tip--up'">{{ paramsSummary }}</span>
            </button>
            <div v-if="popover === 'params'" class="canvas-chat__pop canvas-chat__pop--bottom canvas-chat__params">
              <section v-if="resolutionChoices.length">
                <h4>{{ t('分辨率') }}</h4>
                <div class="canvas-chat__res">
                  <button
                    v-for="item in resolutionChoices"
                    :key="item"
                    type="button"
                    :class="{ 'is-on': genResolution === item }"
                    @click="genResolution = item"
                  >
                    {{ formatResolutionLabel(item) }}
                  </button>
                </div>
              </section>
              <section v-if="showRatio">
                <h4>{{ t('比例') }}</h4>
                <div class="canvas-chat__ratios">
                  <button
                    v-for="item in PARAM_RATIOS"
                    :key="item"
                    type="button"
                    :class="{ 'is-on': genRatio === item }"
                    @click="genRatio = item"
                  >
                    <i :style="ratioShape(item)" />
                    <span>{{ item }}</span>
                  </button>
                </div>
              </section>
              <section v-if="showDuration">
                <h4>{{ t('时长') }}</h4>
                <div v-if="durationChoices.length <= 6" class="canvas-chat__res">
                  <button
                    v-for="item in durationChoices"
                    :key="item"
                    type="button"
                    :class="{ 'is-on': genSeconds === item }"
                    @click="genSeconds = item"
                  >
                    {{ item }}s
                  </button>
                </div>
                <div v-else class="canvas-chat__stepper is-bar">
                  <button type="button" :aria-label="t('减少')" :disabled="genSeconds <= durationMin" @click="stepSeconds(-1)">−</button>
                  <strong>{{ genSeconds }}s</strong>
                  <button type="button" :aria-label="t('增加')" :disabled="genSeconds >= durationMax" @click="stepSeconds(1)">+</button>
                </div>
                <small>{{ t('canvas.chat.model.secondsOptional', { min: durationMin, max: durationMax }) }}</small>
              </section>
              <p v-if="paramsSummary" class="canvas-chat__params-summary">{{ paramsSummary }}</p>
            </div>
            </div>
            <button
              type="button"
              class="canvas-chat__send"
              :class="{ 'is-on': stopping || busy || (prompt.trim() && !quotaExhausted && !chatDisabled), 'is-stop': busy || stopping }"
              :disabled="stopping || (!busy && (quotaExhausted || chatDisabled))"
              :aria-label="stopping ? t('canvas.chat.msg.stopping') : busy ? t('停止') : t('发送')"
              @click="busy ? stopReply() : send()"
            >
              <i v-if="busy && !stopping" class="canvas-chat__stop-mark" />
              <UIcon v-else :name="stopping ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'" class="size-5" :class="{ 'animate-spin': stopping }" />
              <span :class="entry ? 'canvas-tip canvas-tip--end' : 'canvas-tip canvas-tip--up'">{{ stopping ? t('canvas.chat.msg.stopping') : busy ? t('停止') : t('发送') }}</span>
            </button>
          </div>
        </div>


      </div>
      <p v-if="agentAutoModel" class="canvas-chat__note">{{ t('canvas.chat.settings.modelManaged') }}</p>
      <p class="canvas-chat__note">{{ t('canvas.chat.msg.disclaimer') }}</p>
    </div>
  </aside>

  <Teleport to="body">
    <div v-if="settingsOpen" class="studio-modal-mask" @click.self="closeSettings" @pointerdown.stop @keydown.stop>
      <div class="studio-modal canvas-agent" role="dialog" aria-modal="true" aria-labelledby="canvas-agent-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="canvas-agent-title">{{ t('canvas.chat.settings.title') }}</h2>
            <p>{{ t('canvas.chat.settings.lead') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="closeSettings">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-agent__body">
          <p class="canvas-agent__label">{{ t('canvas.chat.settings.collab') }}</p>
          <label class="canvas-agent__row" :class="{ 'is-off': !assistAvailable }">
            <span>
              <strong>{{ t('canvas.chat.settings.autoGenerate') }}</strong>
              <span>{{ t('canvas.chat.settings.autoGenerateHint') }}</span>
            </span>
            <span class="pref-switch" :class="{ 'is-off': !assistAvailable }">
              <input v-model="settings.autoGenerate" type="checkbox" :disabled="!assistAvailable" @change="saveSettings">
              <i />
            </span>
          </label>
          <label class="canvas-agent__row">
            <span>
              <strong>{{ t('canvas.chat.settings.insertReply') }}</strong>
              <span>{{ t('canvas.chat.settings.insertReplyHint') }}</span>
            </span>
            <span class="pref-switch">
              <input v-model="settings.insertReply" type="checkbox" @change="saveSettings">
              <i />
            </span>
          </label>

          <p class="canvas-agent__label">{{ t('对话模型') }}</p>
          <p class="canvas-agent__hint">{{ t('canvas.chat.settings.modelManagedHint') }}</p>

          <p class="canvas-agent__label">{{ t('canvas.chat.settings.pointsPolicy') }}</p>
          <p class="canvas-agent__hint">{{ t('canvas.chat.settings.pointsPolicyHint') }}</p>
          <div
            class="canvas-agent__choice"
            :class="{ 'is-on': settings.pointsRemind === 'threshold' }"
            role="radio"
            :aria-checked="settings.pointsRemind === 'threshold'"
            tabindex="0"
            @click="setPointsRemind('threshold')"
            @keydown.enter.prevent="setPointsRemind('threshold')"
            @keydown.space.prevent="setPointsRemind('threshold')"
          >
            <span class="canvas-agent__choice-head">
              <i class="canvas-agent__radio" aria-hidden="true" />
              <span>
                <strong>{{ t('canvas.chat.settings.thresholdRemind') }}</strong>
                <em>{{ t('canvas.chat.settings.recommended') }}</em>
                <span>{{ t('canvas.chat.settings.thresholdHint') }}</span>
              </span>
            </span>
            <label class="canvas-agent__threshold" @click.stop>
              <span>
                <strong>{{ t('canvas.chat.settings.threshold') }}</strong>
                <span>{{ t('canvas.chat.settings.thresholdShort') }}</span>
              </span>
              <span class="canvas-agent__threshold-field">
                <input
                  type="number"
                  min="1"
                  step="10"
                  :value="settings.pointsThreshold"
                  @change="setPointsThreshold(($event.target as HTMLInputElement).value)"
                >
                <em>{{ t('积分') }}</em>
              </span>
            </label>
          </div>
          <div
            class="canvas-agent__choice"
            :class="{ 'is-on': settings.pointsRemind === 'never' }"
            role="radio"
            :aria-checked="settings.pointsRemind === 'never'"
            tabindex="0"
            @click="setPointsRemind('never')"
            @keydown.enter.prevent="setPointsRemind('never')"
            @keydown.space.prevent="setPointsRemind('never')"
          >
            <span class="canvas-agent__choice-head">
              <i class="canvas-agent__radio" aria-hidden="true" />
              <span>
                <strong>{{ t('canvas.chat.settings.neverRemind') }}</strong>
                <span>{{ t('canvas.chat.settings.neverRemindHint') }}</span>
              </span>
            </span>
          </div>
        </div>

        <footer class="canvas-agent__foot">
          <p>{{ t('canvas.chat.settings.localOnly') }}</p>
          <button type="button" class="plan-btn plan-btn--solid" @click="closeSettings">{{ t('canvas.chat.settings.done') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
