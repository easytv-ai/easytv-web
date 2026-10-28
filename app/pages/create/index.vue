<script setup lang="ts">
import projectApi from '~/api/project'
import taskApi from '~/api/task'
import { composeApi, screenplayApi } from '~/api/screenplay'
import type { ComposeJob, DialogueShotsRequest, GenerationModel, Project, Screenplay, ScreenplayEstimate, ScreenplayPlan, Timeline, Work } from '~/types/creative'
import { CREATE_MAX_INPUT, CREATE_SECONDS } from '~/components/create/CreateStepInput.vue'
import { hasPackageFiles, packageEntries } from '~/utils/production-report'
import { effectiveUnitPrice } from '~/utils/model-price'
import { shortModelName } from '~/utils/model-name'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import { normalizeDialogue, normalizeLangLines, normalizeStates, planForSave } from '~/utils/plan-dialogue'

const { t } = useI18n()

/**
 * 一句话成片向导（API.md 8.2）：输入 → 策划案 → 分层生成 → 合成 → 完成。
 * 匿名可看第 1 步，点「生成策划案」时 requireLogin；向导状态按策划案 id 存 sessionStorage，刷新 / ?screenplay= 深链可恢复。
 */
definePageMeta({
  layout: 'studio',
  keepalive: false,
})

useHead({ title: () => t('一句话成片') })

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const toast = useToast()
const { confirm } = useConfirm()
const { isLoggedIn, requireLogin } = useRequireLogin()
const { track } = useTrack()
const { balance, isMember, refresh: refreshWallet } = useWallet()
const { openPricing } = usePricingModal()
// growth.compose_*_model：运营配的向导默认模型
const { growth, load: loadAppConfig } = useStudioAppConfig()

type Step = 1 | 2 | 3 | 4 | 5
const STEPS: { step: Step, label: string }[] = [
  { step: 1, label: '输入' },
  { step: 2, label: '策划案' },
  { step: 3, label: '生成' },
  { step: 4, label: '合成' },
  { step: 5, label: '完成' },
]
const MODELS_KEY = 'easytv-create-models'
const CURRENT_KEY = 'easytv-create-current'
const POLL_MS = 3000

const step = ref<Step>(1)
const error = ref('')

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

// ---- 第 1 步：输入 ----
const input = ref('')
const targetSeconds = ref<number>(30)
const style = ref('')
const inputProjectId = ref(0)
const projects = ref<Project[]>([])
const creating = ref(false)
/** 沿用项目的剧集设定（API.md 27.3）：URL 带 use_bible=1（剧集设定页「新建一集」）时默认勾上 */
const useBible = ref(false)
/** 集号，空 = 自动排到项目下一集 */
const episodeNo = ref('')
const queryProjectId = Number(Array.isArray(route.query.project) ? route.query.project[0] : route.query.project) || 0

const DRAFT_KEY = 'easytv-create-draft'

/** 匿名用户点「生成策划案」会跳登录，先把输入存起来，回来后恢复 */
function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      input: input.value,
      targetSeconds: targetSeconds.value,
      style: style.value,
      projectId: inputProjectId.value || undefined,
      useBible: useBible.value || undefined,
      episodeNo: episodeNo.value || undefined,
    }))
  }
  catch {
    // 忽略
  }
}

function restoreDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw)
      return
    const draft = JSON.parse(raw) as {
      input?: string
      targetSeconds?: number
      style?: string
      projectId?: number
      useBible?: boolean
      episodeNo?: string
    }
    input.value = String(draft.input ?? '')
    if (CREATE_SECONDS.includes(Number(draft.targetSeconds) as (typeof CREATE_SECONDS)[number]))
      targetSeconds.value = Number(draft.targetSeconds)
    style.value = String(draft.style ?? '')
    const projectId = Math.round(Number(draft.projectId))
    if (Number.isInteger(projectId) && projectId > 0)
      inputProjectId.value = projectId
    if (draft.useBible)
      useBible.value = true
    if (draft.episodeNo)
      episodeNo.value = String(draft.episodeNo)
    sessionStorage.removeItem(DRAFT_KEY)
  }
  catch {
    // 忽略
  }
}

async function loadProjects() {
  if (!isLoggedIn.value)
    return
  const res = await projectApi.list({ page: 1, page_size: 50 })
  if (res?.success && res.data)
    projects.value = res.data.items
  // 从剧集设定页带 ?project= 进来：预选该项目（不在前 50 条里也照选，创建时按 id 挂）
  if (queryProjectId && !inputProjectId.value)
    inputProjectId.value = queryProjectId
}

const episodeNoValue = computed(() => {
  const n = Math.round(Number(episodeNo.value))
  return Number.isFinite(n) && n > 0 ? Math.min(999, n) : 0
})

async function createPlan() {
  const text = input.value.trim()
  if (!text) {
    error.value = t('请先输入一句话或粘贴剧本')
    return
  }
  if (text.length > CREATE_MAX_INPUT) {
    error.value = t('最多 {n} 字', { n: CREATE_MAX_INPUT })
    return
  }
  track('create_start', { target_seconds: targetSeconds.value, style: style.value.trim() || undefined })
  if (!requireLogin()) {
    saveDraft()
    return
  }
  creating.value = true
  error.value = ''
  try {
    const res = await screenplayApi.create({
      input: text,
      target_seconds: targetSeconds.value,
      style: style.value.trim() || undefined,
      project_id: inputProjectId.value || undefined,
      ...(inputProjectId.value && useBible.value ? { use_bible: true } : {}),
      ...(inputProjectId.value && episodeNoValue.value ? { episode_no: episodeNoValue.value } : {}),
    })
    if (!res?.success || !res.data) {
      error.value = res?.message || t('生成失败')
      return
    }
    adoptScreenplay(res.data)
    void refreshWallet()
    await goStep(2)
    await router.replace({ query: { ...route.query, screenplay: String(res.data.id) } })
  }
  finally {
    creating.value = false
  }
}

// ---- 第 2 步：策划案 ----
const screenplay = ref<Screenplay | null>(null)
const plan = ref<ScreenplayPlan | null>(null)
const planDirty = ref(false)
const saving = ref(false)
const building = ref(false)
const estimate = ref<ScreenplayEstimate | null>(null)
const estimating = ref(false)
const models = reactive({ image: '', video: '', audio: '' })

const generationModels = useState<GenerationModel[]>('generation-models', () => [])

/**
 * 所选模型支持的时长（秒，API.md 6.1）；没声明就返回空数组，由 CreateLayers 用通用档位。
 * 不按模型限制会直接撞网关的 400 unsupported duration。
 */
function modelDurations(type: 'video' | 'audio'): number[] {
  const id = type === 'video' ? models.video : models.audio
  return generationModels.value.find(m => m.model === id)?.durations ?? []
}

/** 所选模型支持的分辨率；空数组表示没声明，按 720P 走 */
function modelResolutions(type: 'video'): string[] {
  const id = type === 'video' ? models.video : ''
  return generationModels.value.find(m => m.model === id)?.resolutions ?? []
}
const generationModelsLoaded = useState('generation-models-loaded', () => false)

function normalizePlan(raw: unknown): ScreenplayPlan {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScreenplayPlan>
  return {
    title: String(p.title ?? ''),
    style: String(p.style ?? ''),
    aspect: String(p.aspect ?? '16:9') || '16:9',
    // voice / voice_style（API.md 25.1）：空串保留为字段，保存时后端去空白
    characters: Array.isArray(p.characters)
      ? p.characters.map((c, i) => ({ key: String(c?.key || `c${i + 1}`), name: String(c?.name ?? ''), look: String(c?.look ?? ''), voice: String(c?.voice ?? ''), voice_style: String(c?.voice_style ?? '') }))
      : [],
    // 场次表三栏（API.md 27.1）：老数据没有时为空串，保存时后端去空白
    scenes: Array.isArray(p.scenes)
      ? p.scenes.map((s, i) => ({ key: String(s?.key || `s${i + 1}`), name: String(s?.name ?? ''), look: String(s?.look ?? ''), objective: String(s?.objective ?? ''), conflict: String(s?.conflict ?? ''), turn: String(s?.turn ?? '') }))
      : [],
    shots: Array.isArray(p.shots)
      ? p.shots.map((s, i) => ({
          id: String(s?.id || ''),
          no: Number(s?.no) || i + 1,
          scene: String(s?.scene ?? ''),
          characters: Array.isArray(s?.characters) ? s.characters.map(String) : [],
          prompt: String(s?.prompt ?? ''),
          motion: String(s?.motion ?? ''),
          line: String(s?.line ?? ''),
          lines: normalizeLangLines(s?.lines),
          // 对白条目与本镜人物状态（API.md 25.1 / 25.2）：老数据没有 dialogue 时为 []，编辑器把 line 显示成一条旁白
          dialogue: normalizeDialogue(s?.dialogue),
          states: normalizeStates(s?.states),
          seconds: Number(s?.seconds) > 0 ? Number(s?.seconds) : 5,
        }))
      : [],
  }
}

function adoptScreenplay(row: Screenplay) {
  screenplay.value = row
  plan.value = normalizePlan(row.plan)
  planDirty.value = false
  if (row.canvas_id && !canvasId.value)
    canvasId.value = row.canvas_id
  if (row.project_id && !projectId.value)
    projectId.value = row.project_id
}

async function loadGenerationModels() {
  // 默认模型来自 /app/config，先确保它已到手再算默认值
  await loadAppConfig()
  if (!generationModelsLoaded.value) {
    generationModelsLoaded.value = true
    const res = await taskApi.models()
    if (res?.success && Array.isArray(res.data))
      generationModels.value = res.data
  }
  applyDefaultModels()
}

function modelsOf(type: 'image' | 'video' | 'audio') {
  return generationModels.value.filter(m => m.type === type && m.priced)
}

/** 运营配的向导默认模型（GET /app/config → growth.compose_*_model），空串表示没配 */
function configuredModel(type: 'image' | 'video' | 'audio') {
  const g = growth.value
  if (!g)
    return ''
  return type === 'image' ? g.compose_image_model : type === 'video' ? g.compose_video_model : g.compose_audio_model
}

function applyDefaultModels() {
  let saved: Partial<typeof models> = {}
  try {
    saved = JSON.parse(localStorage.getItem(MODELS_KEY) || '{}') as Partial<typeof models>
  }
  catch {
    saved = {}
  }
  // 优先级：本次已选 → 上次记住的 → 运营配的默认 → 清单第一个。
  // 运营配的默认排在清单第一个之前：定价行顺序只是 id 先后，
  // 某个模型在网关侧不可用时（如 seedance 图生视频回 500）运营要能换掉默认。
  for (const type of ['image', 'video', 'audio'] as const) {
    const list = modelsOf(type)
    const inList = (id: string) => Boolean(id) && list.some(m => m.model === id)
    const wanted = models[type] || String(saved[type] || '')
    if (inList(wanted)) {
      models[type] = wanted
      continue
    }
    const configured = configuredModel(type)
    models[type] = inList(configured) ? configured : (list[0]?.model ?? '')
  }
}

function rememberModels() {
  try {
    localStorage.setItem(MODELS_KEY, JSON.stringify({ image: models.image, video: models.video, audio: models.audio }))
  }
  catch {
    // 忽略
  }
}

function modelLabel(m: GenerationModel) {
  const price = effectiveUnitPrice(m, isMember.value)
  const unit = m.unit === 'second' ? t('积分/秒') : t('积分/次')
  return `${shortModelName(m)} · ${price} ${unit}`
}

const projectOptions = computed(() => [
  { value: 0, label: t('新建同名项目') },
  ...projects.value.map(item => ({ value: item.id, label: item.name })),
])

function modelSelectOptions(type: 'image' | 'video' | 'audio') {
  return modelsOf(type).map(item => ({ value: item.model, label: modelLabel(item) }))
}

function onLayerModel(payload: { type: 'image' | 'video' | 'audio', model: string }) {
  if (!payload?.model)
    return
  models[payload.type] = payload.model
}

let estimateTimer: ReturnType<typeof setTimeout> | null = null

async function loadEstimate() {
  if (!screenplay.value)
    return
  estimating.value = true
  try {
    const res = await screenplayApi.estimate(screenplay.value.id, { image_model: models.image, video_model: models.video, audio_model: models.audio })
    if (res?.success && res.data)
      estimate.value = res.data
  }
  finally {
    estimating.value = false
  }
}

function scheduleEstimate() {
  if (estimateTimer)
    clearTimeout(estimateTimer)
  estimateTimer = setTimeout(() => void loadEstimate(), 300)
}

watch(() => [models.image, models.video, models.audio], () => {
  rememberModels()
  if (step.value === 2)
    scheduleEstimate()
  persistState()
})

async function savePlan(): Promise<boolean> {
  if (!screenplay.value || !plan.value || saving.value)
    return false
  saving.value = true
  error.value = ''
  try {
    const res = await screenplayApi.update(screenplay.value.id, planForSave(plan.value))
    if (!res?.success) {
      // 超限 / 引用不存在等原因原样给用户（API.md 24.2），本地修改保留
      error.value = res?.message || t('保存失败')
      notify(error.value, 'error')
      return false
    }
    if (res.data)
      adoptScreenplay(res.data)
    else
      planDirty.value = false
    notify(t('策划案已保存'), 'success')
    scheduleEstimate()
    return true
  }
  finally {
    saving.value = false
  }
}

const canvasId = ref(0)
const projectId = ref(0)

// ---- 改稿后同步到画布（API.md 24.1）----
const syncing = ref(false)
const planStale = computed(() => Boolean(screenplay.value?.stale && canvasId.value))

function shotList(nos: number[]) {
  return nos.join('、')
}

async function syncCanvas() {
  if (!screenplay.value || syncing.value)
    return
  if (planDirty.value && !(await savePlan()))
    return
  syncing.value = true
  try {
    const res = await screenplayApi.sync(screenplay.value.id, { image_model: models.image, video_model: models.video, audio_model: models.audio })
    if (!res?.success || !res.data) {
      notify(res?.message || t('同步失败'), 'error')
      return
    }
    const parts: string[] = []
    if (res.data.synced_shots.length)
      parts.push(t('已同步镜头 {list}', { list: shotList(res.data.synced_shots) }))
    if (res.data.added_shots.length)
      parts.push(t('新增镜头 {list}', { list: shotList(res.data.added_shots) }))
    if (res.data.removed_shots.length)
      parts.push(t('剧本已删除镜头 {list}（画布节点保留）', { list: shotList(res.data.removed_shots) }))
    notify(parts.length ? parts.join('；') : t('画布已是最新'), 'success')
    const fresh = await screenplayApi.get(screenplay.value.id)
    if (fresh?.success && fresh.data)
      adoptScreenplay(fresh.data)
    else
      screenplay.value = { ...screenplay.value, built_revision: res.data.revision, stale: false }
    layersRef.value?.reload()
    timelineRef.value?.reload()
  }
  finally {
    syncing.value = false
  }
}

async function buildCanvas() {
  if (!screenplay.value || !plan.value || building.value)
    return
  if (!plan.value.shots.length) {
    error.value = t('至少保留一个镜头')
    return
  }
  if (planDirty.value && !(await savePlan()))
    return
  building.value = true
  error.value = ''
  try {
    const res = await screenplayApi.build(screenplay.value.id, { image_model: models.image, video_model: models.video, audio_model: models.audio })
    if (!res?.success || !res.data) {
      error.value = res?.message || t('操作失败')
      return
    }
    canvasId.value = res.data.canvas_id
    projectId.value = res.data.project_id
    track('create_plan_ok', { screenplay_id: screenplay.value.id, canvas_id: res.data.canvas_id, estimate_points: res.data.estimate_points })
    await goStep(3)
  }
  finally {
    building.value = false
  }
}

// ---- 第 3 步：分层生成 ----
const videoOrder = ref<string[]>([])
const layersRef = ref<{ reload: () => Promise<void> } | null>(null)
const layersRunning = ref(false)

function onVideos(ids: string[]) {
  videoOrder.value = ids
}

// ---- 多语言（API.md 10.4）：策划案翻译与成片字幕共用同一个语种 ----
const DEFAULT_LANG = 'zh'
const lang = ref(DEFAULT_LANG)
const { load: loadLangs } = useLangs()

// ---- 正反打模板（API.md 25.3）：弹窗收集两人台词，后端生成一组镜头插进策划案 ----
const dialogueOpen = ref(false)
const dialogueSubmitting = ref(false)
const dialogueError = ref('')

function openDialogue() {
  dialogueError.value = ''
  dialogueOpen.value = true
}

async function insertDialogueShots(body: DialogueShotsRequest) {
  if (!screenplay.value || dialogueSubmitting.value)
    return
  dialogueSubmitting.value = true
  dialogueError.value = ''
  try {
    // 本地有未保存改动先落库，否则服务端会基于旧稿插镜头、把本地改动冲掉
    if (planDirty.value && !(await savePlan())) {
      dialogueError.value = error.value || t('保存失败')
      return
    }
    const res = await screenplayApi.dialogueShots(screenplay.value.id, body)
    if (!res?.success || !res.data?.screenplay) {
      // 超过 12 镜 / 说话人不对等原因原样给用户，策划案不动
      dialogueError.value = res?.message || t('插入失败')
      notify(dialogueError.value, 'error')
      return
    }
    adoptScreenplay(res.data.screenplay)
    dialogueOpen.value = false
    notify(t('已插入 {n} 个镜头', { n: res.data.added }), 'success')
    scheduleEstimate()
  }
  finally {
    dialogueSubmitting.value = false
  }
}

function onLocalized(row: Screenplay) {
  adoptScreenplay(row)
}

watch(lang, () => persistState())

// ---- 第 4 步：合成 ----
/** 成片时间线（API.md 12.2）：镜头顺序 / 候选 / 裁切 / 音量 / 字幕 / 画幅都在组件里编辑并存服务端 */
const timelineRef = ref<{ flush: () => Promise<Timeline | null>, enabledCount: number, reload: () => Promise<void> } | null>(null)
const composeJob = ref<ComposeJob | null>(null)
const composing = ref(false)
/** 正式合成时同时导出交付包（API.md 26.2）：母版 / SRT / 对白轨 / 素材清单；预览不带 */
const composePackage = ref(false)
let stopComposePoll: (() => void) | null = null

const composeActive = computed(() => composeJob.value ? composeJob.value.status === 0 || composeJob.value.status === 1 : false)
const composeFailed = computed(() => composeJob.value?.status === -1)
const composeProgress = computed(() => Math.min(100, Math.max(composeJob.value?.status === 2 ? 100 : 2, Number(composeJob.value?.progress) || 0)))

async function startCompose() {
  if (!canvasId.value || composing.value || composeActive.value)
    return
  if (!videoOrder.value.length) {
    error.value = t('还没有生成成功的镜头视频')
    return
  }
  composing.value = true
  error.value = ''
  try {
    const timeline = await timelineRef.value?.flush()
    if (!timeline) {
      error.value = t('时间线保存失败，请稍后重试')
      return
    }
    if (!timeline.clips.some(clip => clip.enabled)) {
      error.value = t('时间线里没有启用的镜头')
      return
    }
    const res = await composeApi.create(canvasId.value, {
      timeline,
      screenplay_id: screenplay.value?.id || undefined,
      ...(composePackage.value ? { package: true } : {}),
    })
    if (!res?.success || !res.data) {
      error.value = res?.message || t('提交失败')
      return
    }
    composeJob.value = res.data
    if (res.message)
      notify(res.message)
    persistState()
    watchCompose()
  }
  finally {
    composing.value = false
  }
}

function stopComposePolling() {
  stopComposePoll?.()
  stopComposePoll = null
}

function watchCompose() {
  stopComposePolling()
  if (!composeJob.value || !composeActive.value)
    return
  stopComposePoll = startHiddenAwarePoll(() => { void pollCompose() }, POLL_MS)
}

async function pollCompose() {
  const job = composeJob.value
  if (!job)
    return
  const res = await composeApi.get(job.id)
  if (!res?.success || !res.data)
    return
  composeJob.value = res.data
  if (res.data.status === 2) {
    stopComposePolling()
    track('create_compose_ok', { screenplay_id: screenplay.value?.id, canvas_id: canvasId.value, compose_id: res.data.id, duration: res.data.duration })
    await goStep(5)
  }
  else if (res.data.status === -1) {
    stopComposePolling()
    error.value = res.data.error || t('合成失败')
  }
}

// ---- 第 5 步：完成 ----
const publishOpen = ref(false)
/** 交付包卡片（API.md 26.2）：勾了交付包或后端给了任一文件就显示；缺的项显示「未生成」，原因在 warning */
const packageItems = computed(() => packageEntries(composeJob.value?.package_files, t))
const showPackage = computed(() => !!composeJob.value && composeJob.value.status === 2 && (!!composeJob.value.package || hasPackageFiles(composeJob.value.package_files)))
const outputAsset = computed(() => {
  const job = composeJob.value
  if (!job || job.status !== 2 || !job.output_asset_id)
    return null
  return { id: job.output_asset_id, name: plan.value?.title || t('一句话成片'), url: job.output_url }
})

function openPublish() {
  if (!outputAsset.value)
    return
  publishOpen.value = true
}

async function onPublished(work: Work) {
  track('create_publish', { screenplay_id: screenplay.value?.id, work_id: work.id })
  await navigateTo(localePath(`/watch/${work.id}`))
}

const canvasHref = computed(() => canvasId.value ? localePath(`/canvas?id=${canvasId.value}`) : '')
/** 策划案挂在项目下时，第 2 步顶部给剧集设定页入口（API.md 27） */
const bibleHref = computed(() => screenplay.value?.project_id ? localePath(`/bible?project=${screenplay.value.project_id}`) : '')

function restart() {
  stopComposePolling()
  step.value = 1
  screenplay.value = null
  plan.value = null
  planDirty.value = false
  estimate.value = null
  canvasId.value = 0
  projectId.value = 0
  videoOrder.value = []
  composeJob.value = null
  error.value = ''
  input.value = ''
  style.value = ''
  useBible.value = false
  episodeNo.value = ''
  lang.value = DEFAULT_LANG
  try {
    sessionStorage.removeItem(CURRENT_KEY)
  }
  catch {
    // 忽略
  }
  void router.replace({ query: { ...route.query, screenplay: undefined } })
}

// ---- 步骤与状态持久化 ----
type WizardState = {
  step: Step
  canvasId: number
  projectId: number
  composeId: number
  models: { image: string, video: string, audio: string }
  lang: string
}

function stateKey(id: number) {
  return `easytv-create-${id}`
}

function persistState() {
  if (!import.meta.client || !screenplay.value)
    return
  const state: WizardState = {
    step: step.value,
    canvasId: canvasId.value,
    projectId: projectId.value,
    composeId: composeJob.value?.id ?? 0,
    models: { image: models.image, video: models.video, audio: models.audio },
    lang: lang.value,
  }
  try {
    sessionStorage.setItem(stateKey(screenplay.value.id), JSON.stringify(state))
    sessionStorage.setItem(CURRENT_KEY, String(screenplay.value.id))
  }
  catch {
    // 忽略
  }
}

function readState(id: number): Partial<WizardState> | null {
  try {
    const raw = sessionStorage.getItem(stateKey(id))
    return raw ? JSON.parse(raw) as Partial<WizardState> : null
  }
  catch {
    return null
  }
}

async function goStep(next: Step) {
  error.value = ''
  step.value = next
  persistState()
  if (next === 2) {
    await loadGenerationModels()
    void loadLangs()
    scheduleEstimate()
  }
  if (next === 4)
    void loadLangs()
  if (import.meta.client)
    window.scrollTo({ top: 0 })
}

function canGoTo(target: Step) {
  if (target === 1)
    return true
  if (!screenplay.value)
    return false
  if (target === 2)
    return true
  if (target === 3 || target === 4)
    return canvasId.value > 0 && (target === 3 || videoOrder.value.length > 0 || step.value >= 4)
  return composeJob.value?.status === 2
}

const resuming = ref(false)

async function resume(id: number) {
  resuming.value = true
  try {
    const res = await screenplayApi.get(id)
    if (!res?.success || !res.data) {
      notify(res?.message || t('策划案不存在'), 'error')
      return
    }
    adoptScreenplay(res.data)
    const saved = readState(id)
    if (saved?.models) {
      models.image = saved.models.image || ''
      models.video = saved.models.video || ''
      models.audio = saved.models.audio || ''
    }
    if (saved?.canvasId)
      canvasId.value = saved.canvasId
    if (saved?.projectId)
      projectId.value = saved.projectId
    lang.value = String(saved?.lang || DEFAULT_LANG)
    await loadGenerationModels()
    if (saved?.composeId) {
      const job = await composeApi.get(saved.composeId)
      if (job?.success && job.data)
        composeJob.value = job.data
    }
    let target: Step = saved?.step ?? (res.data.status === 2 && canvasId.value ? 3 : 2)
    if (target >= 3 && !canvasId.value)
      target = 2
    if (target === 5 && composeJob.value?.status !== 2)
      target = 4
    await goStep(target)
    if (target === 4 && composeActive.value)
      watchCompose()
  }
  finally {
    resuming.value = false
  }
}

const generatingInFlight = computed(() =>
  creating.value || building.value || composing.value || composeActive.value || layersRunning.value,
)

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!generatingInFlight.value)
    return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave(async () => {
  if (!generatingInFlight.value)
    return true
  return confirm({
    title: t('create.leave.title'),
    message: t('create.leave.message'),
    confirmText: t('create.leave.confirm'),
    cancelText: t('create.leave.stay'),
  })
})

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload)
  restoreDraft()
  // 首页等入口带过来的需求（?prompt=）：草稿优先，没有草稿才用它
  const fromPrompt = String(Array.isArray(route.query.prompt) ? route.query.prompt[0] : route.query.prompt ?? '').trim()
  if (fromPrompt && !input.value.trim())
    input.value = fromPrompt.slice(0, CREATE_MAX_INPUT)
  // 深链（剧集设定「新建一集」）覆盖草稿里的项目 / 沿用剧集设定
  if (String(Array.isArray(route.query.use_bible) ? route.query.use_bible[0] : route.query.use_bible ?? '') === '1')
    useBible.value = true
  if (queryProjectId)
    inputProjectId.value = queryProjectId
  void loadProjects()
  if (!isLoggedIn.value)
    return
  const fromQuery = Number(Array.isArray(route.query.screenplay) ? route.query.screenplay[0] : route.query.screenplay) || 0
  let id = fromQuery
  // 带 ?project= 是来新建一集的，不要把上次的策划案从 sessionStorage 恢复出来跳到第 2 步
  if (!id && !queryProjectId) {
    try {
      id = Number(sessionStorage.getItem(CURRENT_KEY)) || 0
    }
    catch {
      id = 0
    }
  }
  if (id) {
    await resume(id)
    if (!fromQuery && screenplay.value)
      await router.replace({ query: { ...route.query, screenplay: String(id) } })
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  stopComposePolling()
  if (estimateTimer)
    clearTimeout(estimateTimer)
})

const primaryLabel = computed(() => {
  switch (step.value) {
    case 1: return creating.value ? t('生成中…') : t('生成策划案')
    case 2: return building.value ? t('创建中…') : t('开始生成')
    case 3: return t('下一步：合成')
    case 4: return composing.value || composeActive.value ? t('合成中…') : composeFailed.value ? t('重试') : t('开始合成')
    default: return t('发布为作品')
  }
})

const primaryDisabled = computed(() => {
  switch (step.value) {
    case 1: return creating.value || !input.value.trim()
    case 2: return building.value || saving.value || !plan.value
    case 3: return !videoOrder.value.length
    case 4: return composing.value || composeActive.value || !videoOrder.value.length
    default: return !outputAsset.value
  }
})

function onPrimary() {
  switch (step.value) {
    case 1: return void createPlan()
    case 2: return void buildCanvas()
    case 3: return void goStep(4)
    case 4: return void startCompose()
    default: return openPublish()
  }
}
</script>

<template>
  <section class="projects-page create-page">
    <header class="create-head">
      <div>
        <h1>{{ t('一句话成片') }}</h1>
        <p>{{ t('输入一句话或剧本，自动生成策划案、分镜、镜头视频与配音，一键合成短片。') }}</p>
      </div>
      <NuxtLink v-if="canvasHref" :to="canvasHref" class="studio-chip">
        <UIcon name="i-lucide-layout-grid" class="size-4" />
        {{ t('在画布中打开') }}
      </NuxtLink>
    </header>

    <ol class="create-stepper" :aria-label="t('步骤')">
      <li
        v-for="s in STEPS"
        :key="s.step"
        :class="{ 'is-on': step === s.step, 'is-done': step > s.step }"
      >
        <button type="button" :disabled="!canGoTo(s.step) || s.step > step" @click="goStep(s.step)">
          <i>{{ s.step }}</i>
          <span>{{ t(s.label) }}</span>
        </button>
      </li>
    </ol>

    <!-- 剧本改过但画布还是旧稿（API.md 24.1） -->
    <div v-if="!resuming && planStale" class="create-stale" role="status">
      <UIcon name="i-lucide-refresh-cw" class="size-4" />
      <span>{{ t('剧本已修改，画布仍是第 {n} 稿', { n: screenplay?.built_revision ?? 0 }) }}</span>
      <button type="button" class="studio-chip" :disabled="syncing || building" @click="syncCanvas">
        {{ syncing ? t('同步中…') : t('同步到画布') }}
      </button>
    </div>

    <StudioLoading v-if="resuming" />

    <CreateStepInput
      v-else-if="step === 1"
      v-model:input="input"
      v-model:target-seconds="targetSeconds"
      v-model:style="style"
      v-model:project-id="inputProjectId"
      v-model:use-bible="useBible"
      v-model:episode-no="episodeNo"
      :logged-in="isLoggedIn"
      :project-options="projectOptions"
      :error="error"
    />

    <!-- 2 策划案 -->
    <div v-else-if="step === 2 && plan" class="create-plan">
      <div class="create-card create-plan__main">
        <!-- 挂在项目下的策划案：去剧集设定页看人物 / 关系 / 线索，改完可查影响 -->
        <div v-if="bibleHref" class="create-plan__bible">
          <NuxtLink :to="bibleHref" class="studio-chip">
            <UIcon name="i-lucide-book-open" class="size-4" />
            {{ t('剧集设定') }}
          </NuxtLink>
          <span v-if="screenplay?.episode_no">{{ t('第 {n} 集', { n: screenplay.episode_no }) }}</span>
        </div>
        <CreatePlanEditor
          :plan="plan"
          :disabled="building"
          :screenplay-id="screenplay?.id"
          :lang="lang"
          @change="planDirty = true"
          @update:lang="lang = $event"
          @localized="onLocalized"
          @insert-dialogue="openDialogue"
        />
        <CreateDialogueModal
          :open="dialogueOpen"
          :plan="plan"
          :submitting="dialogueSubmitting"
          :error="dialogueError"
          @close="dialogueOpen = false"
          @submit="insertDialogueShots"
        />
        <p v-if="error" class="publish-error">{{ error }}</p>
        <div class="create-plan__save">
          <button type="button" class="studio-chip" :disabled="saving || !planDirty" @click="savePlan">
            <UIcon name="i-lucide-save" class="size-4" />
            {{ saving ? t('保存中…') : t('保存') }}
          </button>
          <small v-if="planDirty">{{ t('有未保存的修改，开始生成前会自动保存') }}</small>
        </div>
      </div>
      <CreatePlanSide
        v-model:image="models.image"
        v-model:video="models.video"
        v-model:audio="models.audio"
        :image-options="modelSelectOptions('image')"
        :video-options="modelSelectOptions('video')"
        :audio-options="modelSelectOptions('audio')"
        :estimate="estimate"
        :estimating="estimating"
        :balance="balance"
        @recharge="openPricing('points')"
      />
    </div>

    <!-- 3 生成 -->
    <div v-else-if="step === 3" class="create-card">
      <p class="create-hint create-gen-lead">{{ t('按层生成：上一层至少一个成功后才能生成下一层；镜头视频会用对应分镜图作为首帧。') }}</p>
      <CreateLayers
        ref="layersRef"
        :canvas-id="canvasId"
        :project-id="projectId"
        :models="models"
        :model-options="{ image: modelSelectOptions('image'), video: modelSelectOptions('video'), audio: modelSelectOptions('audio') }"
        :catalog="generationModels"
        :image-input="generationModels.find(m => m.model === models.image)?.image_input ?? ''"
        :video-durations="modelDurations('video')"
        :audio-durations="modelDurations('audio')"
        :video-resolutions="modelResolutions('video')"
        :plan="plan"
        @videos="onVideos"
        @running="layersRunning = $event"
        @update:model="onLayerModel"
      />
    </div>

    <!-- 4 合成 -->
    <div v-else-if="step === 4" class="create-card create-compose">
      <CreateTimeline
        ref="timelineRef"
        :canvas-id="canvasId"
        :lang="lang"
        :disabled="composeActive"
        @update:lang="lang = $event"
      />
      <div v-if="composeJob" class="create-progress" :class="{ 'is-failed': composeFailed }">
        <div class="create-progress__bar"><i :style="{ width: `${composeProgress}%` }" /></div>
        <span>
          <template v-if="composeJob.status === 0">{{ t('排队中') }}</template>
          <template v-else-if="composeJob.status === 1">{{ t('合成中 {n}%', { n: composeProgress }) }}</template>
          <template v-else-if="composeJob.status === 2">{{ t('已完成') }}</template>
          <template v-else>{{ t('合成失败') }}</template>
        </span>
      </div>
      <p v-if="error" class="publish-error">{{ error }}</p>
    </div>

    <!-- 5 完成 -->
    <template v-else-if="step === 5 && composeJob">
      <CreateDone
        :job="composeJob"
        :title="plan?.title || ''"
        :canvas-href="canvasHref"
        :package-items="packageItems"
        :show-package="showPackage"
        :can-publish="Boolean(outputAsset)"
        @publish="openPublish"
        @restart="restart"
      />
      <!-- 制片报表（API.md 26.3） -->
      <div v-if="canvasId" class="create-card create-report">
        <CreateProductionReport :canvas-id="canvasId" />
      </div>
    </template>

    <footer v-if="!resuming && step !== 5" class="create-foot">
      <button v-if="step > 1 && step < 5" type="button" class="plan-btn plan-btn--ghost create-foot__back" :disabled="creating || building" @click="goStep((step - 1) as Step)">
        {{ t('上一步') }}
      </button>
      <label v-if="step === 4" class="create-foot__opt" :title="t('成片之外再生成无字幕母版、独立字幕 SRT、对白轨与素材清单 JSON，一起存进资产库')">
        <input v-model="composePackage" type="checkbox" :disabled="composing || composeActive">
        <span>{{ t('同时导出交付包（母版 / SRT / 对白轨 / 素材清单）') }}</span>
      </label>
      <button type="button" class="plan-btn plan-btn--solid create-foot__primary" :disabled="primaryDisabled" @click="onPrimary">
        {{ primaryLabel }}
      </button>
    </footer>

    <StudioPublishModal
      :open="publishOpen"
      :asset="outputAsset"
      :project-id="projectId || undefined"
      :canvas-id="canvasId || undefined"
      @close="publishOpen = false"
      @published="onPublished"
    />
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio.css';
</style>
