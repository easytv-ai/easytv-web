<script setup lang="ts">
import CanvasWorkspace from '~/components/canvas/CanvasWorkspace.vue'
import CanvasChat from '~/components/canvas/CanvasChat.vue'
import CanvasGuideTour from '~/components/canvas/CanvasGuideTour.vue'
import type { AssistBridge } from '~/utils/canvas-assist'
import type { CanvasStartSkill } from '~/utils/canvas-node-kinds'
import type { Asset, CanvasDetail } from '~/types/creative'
import skillApi from '~/api/skill'
import assetApi from '~/api/asset'
import canvasApi from '~/api/canvas'
import projectApi from '~/api/project'
import type { CanvasGraph } from '~/types/creative'
import { takeChatEntry } from '~/utils/chat-entry'
import { beginSave,
  createSaveMachine,
  createSerialRunner,
  finishSave,
  hasPendingChanges,
  hasUnsavedChanges,
  isCanvasVersionConflictMessage,
  isSuspiciousWipe,
  markChanged,
  needsFollowUp,
  resolveConflict,
  saveStatus,
  autosaveDelayMs,
  gateCanvasSave,
  type SaveMachine,
  type SaveOutcome,
} from '~/utils/canvas-save-machine'
import { graphHeavyNames, isGraphNearLimit, isGraphOverLimit } from '~/utils/director/persist'
import type { PracticeSession } from '~/composables/useCanvasPractice'
import { practiceSessionDefault } from '~/composables/useCanvasPractice'

const { t } = useI18n()
const { load: loadAppConfig } = useStudioAppConfig()
void loadAppConfig()

definePageMeta({
  layout: false,
  middleware: 'auth',
})

useHead({ title: t('自由画布') })

const localePath = useLocalePath()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()
const { hydrate } = useAuth()
const { refresh: refreshWallet } = useWallet()

const chatOpen = ref(true)
const editorRoot = ref<HTMLElement | null>(null)
useVisualViewportFit(editorRoot)
const chatMinPct = 32
const chatMaxPct = 42
const chatPct = ref(chatMinPct)
const resizing = ref(false)
const guideOpen = useState('canvas-guide-open', () => false)

// ---- 新手跟练：沙盒语义。跟练期间不保存、不落库；退出把持久化状态还原回去 ----
const practiceSession = useState<PracticeSession>('canvas-practice', practiceSessionDefault)
/** 进跟练前钉住的持久化状态（画布 id / version / 名字 / 保存机），退出时整体还原 */
let persistedBeforePractice: {
  canvasId: number
  version: number
  draftName: string
  savedName: string
  machine: SaveMachine
  projectId: number
} | null = null

watch(() => practiceSession.value.seq, () => {
  if (practiceSession.value.active) {
    persistedBeforePractice = {
      canvasId: canvasId.value,
      version: version.value,
      draftName: draftName.value,
      savedName: savedName.value,
      machine: saveMachine.value,
      projectId: boundProjectId.value,
    }
    clearAutosave()
    return
  }
  const snap = persistedBeforePractice
  persistedBeforePractice = null
  if (!snap)
    return
  canvasId.value = snap.canvasId
  version.value = snap.version
  draftName.value = snap.draftName
  savedName.value = snap.savedName
  boundProjectId.value = snap.projectId
  // 退出只有「还原」一条路（结束卡不再有真跑 / 留画布 / 存模板三条走法）：
  // 保存机也还原——跟练前是"有未保存改动"就继续保持脏，跟练本身不算改动
  saveMachine.value = snap.machine
})

/** 跟练期间这些入口一并让路：跟练数据不进分享/版本/导演台 */
function blockedByPractice() {
  if (!practiceSession.value.active)
    return false
  notify(t('跟练中：先退出跟练（画布会还原）再做这个操作'))
  return true
}

watch(guideOpen, (on) => {
  if (on)
    chatOpen.value = true
}, { immediate: true })

function closeGuide() {
  guideOpen.value = false
}
const nameHint = String(route.query.name ?? '').trim()
const draftName = ref(nameHint || t('未命名草稿'))
/** 最近一次成功保存到服务端的名称，改名判脏用 */
const savedName = ref(nameHint)

// ===== 持久化状态 =====

const canvasId = ref(Number(route.query.id) || 0)
const projectIdHint = Number(route.query.project_id) || 0
const boundProjectId = ref(projectIdHint)
const rawPrompt = String(route.query.prompt ?? '').trim()
const skillIdHint = canvasId.value ? 0 : Number(route.query.skill) || 0
const assetIdHint = canvasId.value ? 0 : Number(route.query.asset) || 0
/** 带 skill 时由 applyEntryHints 用模板生成文本节点，这里不重复建 */
const initialPrompt = canvasId.value || skillIdHint ? '' : rawPrompt
const version = ref(1)
/** 恢复后钉住被恢复的版本记录 id，避免「当前」标到备份那条 */
const historyVersionId = ref(0)
/** 队友的画布（API.md 15）：查看者只读（不保存、不开对话）；编辑者可编辑；都不能分享。owner 昵称用于顶栏提示 */
const readonly = ref(false)
const readonlyOwner = ref('')
const teamShared = ref(false)
const canvasOwnerId = ref(0)

/** 空画布点了技能起步卡：不落节点，把技能带进右侧对话（激活 + 预填提示词），描述好内容再发送 */
function onSkillStart(skill: CanvasStartSkill) {
  chatOpen.value = true
  void nextTick(() => chat.value?.startSkillDraft(skill))
}

// ---- 画布批注（项目评论，API.md 10.10 / 15）：顶栏看整张画布，节点右键定位到节点 ----
const commentOpen = ref(false)
const commentNodeId = ref('')
/** 未解决的节点批注数量，卡片右上角的批注钉读这份 */
const canvasCommentMarks = useState<Record<string, number>>('canvas-comment-marks', () => ({}))
const canvasCommentFocus = useState('canvas-comment-focus', () => '')
const canvasCommentOpen = useState('canvas-comment-open', () => ({ seq: 0, nodeId: '' }))
const commentProject = computed(() => (boundProjectId.value
  ? ({ id: boundProjectId.value, user_id: canvasOwnerId.value, name: draftName.value } as unknown as import('~/types/creative').Project)
  : null))

function commentNodeHint(nodeId: string) {
  return workspace.value?.commentNodeHint(nodeId) ?? null
}

async function refreshCommentMarks() {
  const projectId = boundProjectId.value
  const id = canvasId.value
  if (!projectId || !id) {
    canvasCommentMarks.value = {}
    return
  }
  const res = await projectApi.comments(projectId, {
    page: 1,
    page_size: 100,
    canvas_id: id,
    only_open: 1,
  })
  const marks: Record<string, number> = {}
  for (const item of res?.success && res.data ? res.data.items : []) {
    if (!item.node_id)
      continue
    marks[item.node_id] = (marks[item.node_id] || 0) + 1
  }
  canvasCommentMarks.value = marks
}

function openComments(nodeId = '') {
  if (!canvasId.value || !boundProjectId.value) {
    notify(t('请先保存画布再批注'))
    return
  }
  commentNodeId.value = nodeId
  canvasCommentFocus.value = nodeId
  commentOpen.value = true
  if (nodeId)
    workspace.value?.locateNode(nodeId)
}

function closeComments() {
  commentOpen.value = false
  canvasCommentFocus.value = ''
  void refreshCommentMarks()
}

function onLocateComment(nodeId: string) {
  canvasCommentFocus.value = nodeId
  workspace.value?.locateNode(nodeId)
}

watch(canvasCommentOpen, (payload) => {
  if (payload.seq)
    openComments(payload.nodeId)
})
/** 保存状态机：修改计数 + 独立的进行中标志，见 utils/canvas-save-machine */
const saveMachine = ref<SaveMachine>(createSaveMachine())
const saveState = computed(() => saveStatus(saveMachine.value))
const savedAt = ref(0)
const loading = ref(canvasId.value > 0)
const workspace = ref<InstanceType<typeof CanvasWorkspace> | null>(null)
const chat = ref<InstanceType<typeof CanvasChat> | null>(null)
let pendingGraph: CanvasGraph | null = null
let autosaveTimer: ReturnType<typeof setTimeout> | null = null
let autosaveFirstAt = 0
/** 恢复历史版本后的那次保存要保留「当前」版本钉 */
let keepHistoryPinOnce = false
/** 版本冲突弹窗 */
const conflictOpen = ref(false)
const conflictBusy = ref(false)

const saveLabel = computed(() => {
  switch (saveState.value) {
    case 'dirty': return t('未保存')
    case 'saving': return t('保存中…')
    case 'error': return t('保存失败')
    case 'conflict': return t('版本冲突')
    case 'saved': return `${t('已保存')} ${formatTime(savedAt.value)}`
    default: return canvasId.value ? t('已保存') : t('新草稿')
  }
})

function formatTime(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function notify(title: string, color: 'neutral' | 'error' | 'warning' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function isPlaceholderName(name: string) {
  const n = name.trim()
  return !n || n === '未命名草稿' || n === t('未命名草稿')
}

function pickName(...candidates: unknown[]) {
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim())
      return item.trim()
  }
  return ''
}

function nameFromCanvas(data: CanvasDetail & { title?: string, project_name?: string, project?: { name?: string } }) {
  return pickName(data.name, data.title, data.project_name, data.project?.name)
}

async function fetchProjectName(projectId: number) {
  if (!projectId)
    return ''
  const res = await projectApi.get(projectId)
  if (!res?.success || !res.data)
    return ''
  return pickName(res.data.project?.name, (res.data as { name?: string }).name)
}

async function syncProjectName(name: string) {
  const pid = boundProjectId.value
  if (!pid || isPlaceholderName(name))
    return
  try {
    await projectApi.update(pid, { name })
  }
  catch {
    // 画布已保存，项目名同步失败不阻断
  }
}

async function dropTransientQuery() {
  if (route.query.name == null && route.query.project_id == null)
    return
  await router.replace({ query: { ...route.query, name: undefined, project_id: canvasId.value ? undefined : route.query.project_id } })
}

async function resolveDisplayName(canvasName: string, projectId: number) {
  if (!isPlaceholderName(canvasName))
    return canvasName
  if (nameHint)
    return nameHint
  const projectName = await fetchProjectName(projectId)
  return projectName || canvasName || t('未命名草稿')
}

async function load() {
  readonly.value = false
  teamShared.value = false
  if (!canvasId.value) {
    if (projectIdHint) {
      const projectName = nameHint || await fetchProjectName(projectIdHint)
      if (projectName) {
        draftName.value = projectName
        savedName.value = projectName
      }
    }
    await dropTransientQuery()
    return
  }
  loading.value = true
  const res = await canvasApi.get(canvasId.value)
  if (!res?.success || !res.data) {
    loading.value = false
    notify(res?.message || t('画布不存在或已删除'), 'error')
    canvasId.value = 0
    await router.replace({ query: {} })
    return
  }
  readonly.value = Boolean(res.data.readonly)
  readonlyOwner.value = res.data.owner_nickname || ''
  teamShared.value = Boolean(res.data.team_shared)
  canvasOwnerId.value = Number(res.data.user_id) || 0
  if (readonly.value)
    chatOpen.value = false
  boundProjectId.value = res.data.project_id || boundProjectId.value
  const canvasName = nameFromCanvas(res.data)
  const nextName = await resolveDisplayName(canvasName, boundProjectId.value)
  draftName.value = nextName
  savedName.value = canvasName && !isPlaceholderName(canvasName) ? canvasName : nextName
  version.value = res.data.version
  historyVersionId.value = 0
  savedAt.value = res.data.updated_at
  saveMachine.value = createSaveMachine({ persisted: true })
  pendingGraph = res.data.graph
  rememberNodeCount(res.data.graph)
  flushPendingGraph()
  loading.value = false
  void refreshCommentMarks()
  await dropTransientQuery()
  if (nextName !== canvasName && !isPlaceholderName(nextName))
    markDirty()
}

/** ClientOnly 内的 workspace 可能晚于数据到达，两边就绪后再灌入 */
function flushPendingGraph() {
  if (!pendingGraph || !workspace.value)
    return
  workspace.value.loadGraph(pendingGraph)
  pendingGraph = null
}

watch(workspace, () => flushPendingGraph())

/** Agent 页带 skill / asset 进入：Skill 提示词模板包住灵感生成文本节点，素材放成节点 */
let entryHintsApplied = false
async function applyEntryHints() {
  if (entryHintsApplied || !workspace.value || (!skillIdHint && !assetIdHint))
    return
  entryHintsApplied = true
  if (skillIdHint) {
    // 私有 Skill 只能通过 /user/skill/:id 读；官方的两个接口都可以
    const res = await skillApi.mineDetail(skillIdHint).then(r => (r?.success ? r : skillApi.get(skillIdHint)))
    const skill = res?.success ? res.data : null
    if (skill?.graph && skill.graph_nodes > 0) {
      // 画布模板：整块载入，并把节点里的 {{prompt}} 换成灵感
      const hasPlaceholder = JSON.stringify(skill.graph).includes('{{prompt}}')
      workspace.value?.loadGraph(fillGraphPrompt(skill.graph, rawPrompt))
      if (!hasPlaceholder && rawPrompt)
        workspace.value?.insertTextNode(rawPrompt, t('灵感'))
      markDirty()
    }
    else {
      const template = skill?.prompt || ''
      const text = template
        ? (template.includes('{{prompt}}') ? template.replaceAll('{{prompt}}', rawPrompt) : `${template}\n${rawPrompt}`.trim())
        : rawPrompt
      if (text)
        workspace.value?.insertTextNode(text, skill ? skill.title : undefined)
    }
    if (skill && draftName.value === t('未命名草稿')) {
      draftName.value = skill.title
      markDirty()
    }
  }
  if (assetIdHint) {
    const res = await assetApi.get(assetIdHint)
    if (res?.success && res.data)
      workspace.value?.addAssetNodeAtCenter(res.data)
  }
  await router.replace({ query: { ...route.query, skill: undefined, asset: undefined, prompt: undefined } })
}
watch(workspace, () => void applyEntryHints())

function markDirty() {
  if (loading.value || readonly.value)
    return
  // 跟练期间画布上的改动全是练习数据：不标脏、不自动保存（退出时整张还原）
  if (practiceSession.value.active)
    return
  saveMachine.value = markChanged(saveMachine.value)
  // 冲突期间不自动存：拿旧 version 只会一直失败，等用户在弹窗里选
  if (!saveMachine.value.conflict)
    scheduleAutosave()
}

function clearAutosave() {
  if (autosaveTimer)
    clearTimeout(autosaveTimer)
  autosaveTimer = null
}

/** 空画布保护：服务端上这张画布最近一次载入 / 保存有多少节点；变成 0 个时自动保存只暂停不覆盖 */
let savedNodeCount = 0
let wipeWarned = false
let graphSizeWarned = false
let graphNearWarned = false
function rememberNodeCount(graph?: { nodes?: unknown[] } | null) {
  savedNodeCount = Array.isArray(graph?.nodes) ? graph!.nodes!.length : 0
  wipeWarned = false
}

/** 防抖 AUTOSAVE_DELAY_MS，但连续改动时从第一次改动算起最多等 AUTOSAVE_MAX_WAIT_MS */
function scheduleAutosave() {
  const now = Date.now()
  if (autosaveTimer)
    clearTimeout(autosaveTimer)
  else
    autosaveFirstAt = now
  const delay = autosaveDelayMs(now, autosaveFirstAt)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    void save()
  }, delay)
}

/** 保存串行化：同一时刻只有一个请求在飞，途中再触发的合并成完成后的下一次（新建画布也不会建出两张） */
const saver = createSerialRunner(runSave)

function save(manual = false, keepHistoryPin = false): Promise<void> {
  const gate = gateCanvasSave({
    loading: loading.value,
    readonly: readonly.value,
    practice: practiceSession.value.active,
    conflict: saveMachine.value.conflict,
  })
  if (gate.action === 'skip')
    return Promise.resolve()
  // 跟练期间不落库：手点保存只提示一句，跟练数据不进画布版本
  if (gate.action === 'practice') {
    if (manual)
      notify(t('跟练中不会保存：退出会把画布还原到跟练前的样子'))
    return Promise.resolve()
  }
  if (gate.action === 'conflict') {
    if (manual)
      conflictOpen.value = true
    return Promise.resolve()
  }
  if (keepHistoryPin)
    keepHistoryPinOnce = true
  return saver.request(manual)
}

/** 保存失败时判断是否乐观锁冲突：后端只给文案，文案对不上时再比一次服务端 version */
async function detectVersionConflict(message?: string) {
  if (isCanvasVersionConflictMessage(message))
    return true
  if (!canvasId.value)
    return false
  const latest = await canvasApi.get(canvasId.value)
  return Boolean(latest?.success && latest.data && latest.data.version !== version.value)
}

async function runSave(manual: boolean) {
  if (loading.value || saveMachine.value.conflict)
    return
  // 自动保存只在确有改动时发；手动保存没改动也发（新建画布 / 记一条版本快照）
  if (!manual && !hasPendingChanges(saveMachine.value))
    return
  const graph = workspace.value?.getGraph()
  if (!graph)
    return
  // graph 2MB 硬上限（API.md 1.2）：超了后端会拒，这里先拦并说明原因
  if (isGraphOverLimit(graph)) {
    if (manual || !graphSizeWarned) {
      graphSizeWarned = true
      const names = graphHeavyNames(graph)
      notify(names ? t('canvas.graph.tooLargeDetail', { names }) : t('canvas.graph.tooLarge'), 'error')
    }
    return
  }
  graphSizeWarned = false
  if (isGraphNearLimit(graph)) {
    if (manual || !graphNearWarned) {
      graphNearWarned = true
      const names = graphHeavyNames(graph)
      notify(names ? t('canvas.graph.nearLimitDetail', { names }) : t('canvas.graph.nearLimit'), 'warning')
    }
  }
  else {
    graphNearWarned = false
  }
  // 空画布保护：曾有内容的画布现在一个节点都没有——自动保存只暂停并提示，手动保存要确认
  if (canvasId.value && isSuspiciousWipe(savedNodeCount, graph.nodes?.length ?? 0)) {
    if (!manual) {
      if (!wipeWarned) {
        wipeWarned = true
        notify(t('画布几乎空了，已暂停自动保存；确定要清空请手动保存'), 'error')
      }
      return
    }
    const ok = await confirm({
      message: t('画布几乎空了，保存会覆盖服务端上的 {n} 个节点，确定要清空吗？', { n: savedNodeCount }),
      confirmText: t('清空并保存'),
      danger: true,
    })
    if (!ok)
      return
  }
  clearAutosave()
  const snapshot = manual
  const keepHistoryPin = keepHistoryPinOnce
  keepHistoryPinOnce = false
  saveMachine.value = beginSave(saveMachine.value)
  const name = draftName.value.trim() || t('未命名草稿')
  let outcome: SaveOutcome = 'ok'
  try {
    if (!canvasId.value) {
      const res = await canvasApi.create({
        name,
        graph,
        ...(projectIdHint ? { project_id: projectIdHint } : {}),
      })
      if (!res?.success || !res.data)
        throw new Error(res?.message || t('创建画布失败'))
      canvasId.value = res.data.id
      version.value = res.data.version
      historyVersionId.value = 0
      savedAt.value = res.data.updated_at
      savedName.value = name
      boundProjectId.value = res.data.project_id || boundProjectId.value
      await router.replace({ query: { ...route.query, id: String(res.data.id), project_id: undefined, name: undefined } })
    }
    else {
      const res = await canvasApi.save(canvasId.value, { name, graph, version: version.value, ...(snapshot ? { snapshot: true } : {}) })
      if (!res?.success || !res.data) {
        if (!await detectVersionConflict(res?.message))
          throw new Error(res?.message || t('保存失败'))
        outcome = 'conflict'
      }
      else {
        version.value = res.data.version
        if (!keepHistoryPin)
          historyVersionId.value = 0
        savedAt.value = res.data.updated_at
        savedName.value = name
      }
    }
    rememberNodeCount(graph)
  }
  catch (error) {
    outcome = 'error'
    notify((error as Error).message || t('保存失败'), 'error')
  }
  saveMachine.value = finishSave(saveMachine.value, outcome)
  if (outcome === 'conflict') {
    clearAutosave()
    conflictOpen.value = true
    return
  }
  if (outcome === 'ok')
    await syncProjectName(name)
  // 保存途中又有改动、而对应的定时器已经在途中触发过（被合并掉了）时，补排一次
  if (needsFollowUp(saveMachine.value) && !autosaveTimer)
    scheduleAutosave()
}

/** 冲突：放弃本地改动，载入服务端最新版本 */
async function reloadLatestVersion() {
  if (conflictBusy.value || !canvasId.value)
    return
  conflictBusy.value = true
  try {
    const res = await canvasApi.get(canvasId.value)
    if (!res?.success || !res.data) {
      notify(res?.message || t('加载最新版本失败'), 'error')
      return
    }
    clearAutosave()
    version.value = res.data.version
    historyVersionId.value = 0
    savedAt.value = res.data.updated_at
    const canvasName = nameFromCanvas(res.data)
    if (!isPlaceholderName(canvasName)) {
      draftName.value = canvasName
      savedName.value = canvasName
    }
    workspace.value?.loadGraph(res.data.graph)
    rememberNodeCount(res.data.graph)
    saveMachine.value = resolveConflict(saveMachine.value, 'reload')
    conflictOpen.value = false
    notify(t('已载入最新版本'))
  }
  finally {
    conflictBusy.value = false
  }
}

/** 冲突：拉最新 version，用本地画布覆盖保存（记一条手动版本，对方的版本仍可在历史里找回） */
async function overwriteWithMine() {
  if (conflictBusy.value || !canvasId.value)
    return
  conflictBusy.value = true
  try {
    const res = await canvasApi.get(canvasId.value)
    if (!res?.success || !res.data) {
      notify(res?.message || t('获取最新版本失败'), 'error')
      return
    }
    version.value = res.data.version
    saveMachine.value = resolveConflict(saveMachine.value, 'overwrite')
    conflictOpen.value = false
    await save(true)
    if (saveState.value === 'saved')
      notify(t('已用你的版本覆盖'))
  }
  finally {
    conflictBusy.value = false
  }
}

function commitDraftName() {
  const value = draftName.value.trim()
  const next = value || t('未命名草稿')
  draftName.value = next
  if (next !== savedName.value)
    markDirty()
}

function onTitleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== 'Escape')
    return
  event.preventDefault()
  if (event.key === 'Enter')
    commitDraftName()
  ;(event.target as HTMLInputElement).blur()
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && conflictOpen.value && !conflictBusy.value) {
    conflictOpen.value = false
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save(true)
  }
}

/** 把模板 graph 里所有 {{prompt}} 占位换成灵感文本（先经 JSON 转义，避免破坏结构） */
function fillGraphPrompt(graph: CanvasGraph, prompt: string): CanvasGraph {
  const escaped = JSON.stringify(prompt).slice(1, -1)
  try {
    return JSON.parse(JSON.stringify(graph).replaceAll('{{prompt}}', escaped)) as CanvasGraph
  }
  catch {
    return graph
  }
}

// ---- 更多：导出 / 导入 / 存为 Skill ----
const moreOpen = ref(false)
const importInput = ref<HTMLInputElement | null>(null)
const skillEditorOpen = ref(false)
const skillPreset = ref<{ title: string, prompt: string, cover_url: string, description: string } | null>(null)
const skillNodeCount = ref(0)

function onDocumentClick(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.canvas-more'))
    moreOpen.value = false
}

function exportCanvas() {
  moreOpen.value = false
  const graph = workspace.value?.getGraph()
  if (!graph)
    return
  const payload = { format: 'easytv-canvas', version: 1, name: draftName.value, exported_at: new Date().toISOString(), graph }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(draftName.value || 'canvas').replace(/[\\/:*?"<>|]/g, '_')}.easytv.json`
  a.click()
  URL.revokeObjectURL(url)
  notify(t('已导出画布文件'))
}

function pickImport() {
  moreOpen.value = false
  importInput.value?.click()
}

async function onImportFile(event: Event) {
  // 导入会整张替换画布，跟练的沙盒快照（进跟练那一刻的图）会被一起丢掉：跟练中不许导入
  if (blockedByPractice())
    return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  let graph: CanvasGraph | null = null
  try {
    const parsed = JSON.parse(await file.text()) as { format?: string, graph?: CanvasGraph, nodes?: unknown[] }
    const candidate = parsed.format === 'easytv-canvas' ? parsed.graph : (Array.isArray(parsed.nodes) ? parsed as unknown as CanvasGraph : null)
    if (candidate && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges))
      graph = candidate
  }
  catch {
    graph = null
  }
  if (!graph) {
    notify(t('不是有效的画布文件'), 'error')
    return
  }
  const current = workspace.value?.getGraph()
  if (current && current.nodes.length) {
    const ok = await confirm({ message: t('导入会替换当前画布的全部内容，继续？'), confirmText: t('替换'), danger: true })
    if (!ok)
      return
  }
  // 去掉别人账号里的任务状态与资产 ID，只保留内容、提示词与媒体地址
  for (const node of graph.nodes as Array<{ data?: Record<string, unknown> }>) {
    if (node.data) {
      for (const k of ['taskId', 'taskStatus', 'taskProgress', 'taskError', 'assetId', 'refAssetId', 'styleAssetId', 'markAssetId', 'voiceAssetId', 'castAssetId', 'setAssetId'])
        delete node.data[k]
    }
  }
  workspace.value?.loadGraph(graph)
  markDirty()
  notify(t('已导入 {n} 个节点', { n: graph.nodes.length }))
}

async function saveAsSkill() {
  moreOpen.value = false
  if (!canvasId.value || hasPendingChanges(saveMachine.value))
    await save(true)
  if (!canvasId.value)
    return
  const graph = workspace.value?.getGraph()
  const nodes = (graph?.nodes ?? []) as Array<{ data?: { kind?: string, content?: string, prompt?: string, label?: string } }>
  const lines = nodes
    .filter(n => n.data && n.data.kind !== 'group')
    .map(n => (n.data!.kind === 'text' ? n.data!.content : n.data!.prompt) || '')
    .filter(Boolean)
  const firstImage = nodes.find(n => n.data?.kind === 'image' && n.data.content && /^(https?:)?\/|^\//.test(n.data.content))
  skillPreset.value = {
    title: draftName.value,
    prompt: lines.length ? `${lines.join('\n')}\n{{prompt}}` : '{{prompt}}',
    cover_url: firstImage?.data?.content || '',
    description: t('由画布「{name}」生成的模板', { name: draftName.value }),
  }
  skillNodeCount.value = nodes.filter(n => n.data && n.data.kind !== 'group').length
  skillEditorOpen.value = true
}

// ---- 只读分享 ----
const shareOpen = ref(false)

async function openShare() {
  if (blockedByPractice())
    return
  if (!canvasId.value) {
    await save(true)
    if (!canvasId.value)
      return
  }
  shareOpen.value = true
}

// ---- 版本历史 ----
const historyOpen = ref(false)

function openHistory() {
  if (blockedByPractice())
    return
  if (!canvasId.value) {
    notify(t('画布保存后才会有版本记录'))
    return
  }
  historyOpen.value = true
}

function onRestored(detail: CanvasDetail, from?: { id: number }) {
  historyVersionId.value = from?.id ?? 0
  const restoredName = nameFromCanvas(detail)
  draftName.value = isPlaceholderName(restoredName)
    ? (draftName.value || restoredName || t('未命名草稿'))
    : restoredName
  workspace.value?.loadGraph(detail.graph)
  clearAutosave()
  // 恢复出来的内容还没落库：记一次改动，保存失败时离开页面也会被拦住
  saveMachine.value = markChanged(saveMachine.value)
  void nextTick(() => save(false, true))
}

// ---- 对话栏与画布联动 ----
function onChatInsertText(text: string, label?: string) {
  workspace.value?.insertTextNode(text, label)
}

function onChatInsertImages(items: { label: string, prompt: string, ratio?: string, group?: string }[], fromText?: { text: string, label?: string }) {
  const fromId = fromText?.text
    ? workspace.value?.insertTextNode(fromText.text, fromText.label) || undefined
    : undefined
  workspace.value?.insertImageNodes(items, fromId)
}

function onChatInsertAudios(items: { label: string, prompt: string, group?: string }[]) {
  workspace.value?.insertAudioNodes(items)
}

function onChatResetBrief() {
  workspace.value?.resetBriefPlaced()
}

async function onChatGenerateBrief(groups: string[], opts?: { onProgress?: (row: { index: number, total: number, label: string, status: 'start' | 'ok' | 'fail' }) => void, onDone?: (report: { ok: number, failed: number, total: number }) => void }) {
  try {
    const result = await workspace.value?.generateBriefPlaced(groups, { onProgress: opts?.onProgress })
    opts?.onDone?.(result || { ok: 0, failed: 0, total: 0 })
  }
  catch {
    opts?.onDone?.({ ok: 0, failed: 1, total: 1 })
  }
}

function onChatPlaceVideos(shots?: string[]) {
  workspace.value?.placeBriefVideos(shots)
}

function onChatComposeBrief(opts?: { preview?: boolean, aspect?: string, onStart?: (nodeId: string) => void, onDone?: (report: { ok: boolean, nodeId?: string, error?: string, count?: number }) => void }) {
  if (!workspace.value) {
    opts?.onDone?.({ ok: false, error: 'needTwo' })
    return
  }
  void workspace.value.composeBrief(opts)
}

function briefQuote(groups?: string[]) {
  return workspace.value?.estimateBriefPlaced(groups) || { count: 0, points: 0 }
}

function onChatPickAsset(autoUpload: boolean) {
  workspace.value?.pickAssetFromChat(autoUpload)
}

/** 资产选择器（对话附件模式）选中的资产转成对话输入框上方缩略图 */
function onChatAssets(assets: Asset[]) {
  chat.value?.addAssetAttachments(assets)
}

function onChatStyle(style: { name?: string, prompt?: string } | null) {
  chat.value?.applyStyle(style)
}

// 画布助手（API.md 16）：对话栏读选中节点、把方案应用到画布
const assistSelection = computed(() => workspace.value?.selectionLabels ?? [])
const assistBridge: AssistBridge = {
  context: () => workspace.value?.assistContext() ?? [],
  apply: async (changes, generate) => workspace.value
    ? await workspace.value.applyAssistChanges(changes, generate)
    : { undoToken: 0, applied: 0, skipped: 0, generated: 0 },
  undo: token => workspace.value?.undoAssistChanges(token) ?? 'missing',
}

function onWorkspaceAssist() {
  chatOpen.value = true
  void nextTick(() => chat.value?.focusAssist())
}

async function onOpenDirector(nodeId: string) {
  if (!nodeId)
    return
  if (!readonly.value) {
    // 已存过的画布只在有改动时存（不再每次进导演台都记一条手动版本快照）；新草稿要先建出来
    await save(!canvasId.value)
    if (saveMachine.value.conflict || saveState.value === 'error')
      return
  }
  if (!canvasId.value) {
    notify(t('请先保存画布再打开导演台'), 'error')
    return
  }
  await navigateTo(localePath({
    path: '/canvas/director',
    query: { id: String(canvasId.value), node: nodeId },
  }))
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (hasUnsavedChanges(saveMachine.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}

/** Agent 页发来的草稿：打开对话栏，把原文、技能、风格、附件对上，再按这里的发送走一遍 */
function consumeChatEntry() {
  if (String(route.query.from || '') !== 'agent')
    return
  const draft = takeChatEntry()
  const query = { ...route.query }
  delete query.from
  void router.replace({ query })
  if (!draft)
    return
  chatOpen.value = true
  let stop = () => {}
  stop = watch(chat, (instance) => {
    if (!instance)
      return
    stop()
    void instance.acceptEntry(draft)
  }, { immediate: true, flush: 'post' })
}

onMounted(() => {
  if (window.matchMedia('(max-width: 860px)').matches)
    chatOpen.value = false
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  if (String(route.query.guide) === '1')
    guideOpen.value = true
  hydrate()
  void refreshWallet()
  void load()
  consumeChatEntry()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  clearAutosave()
})

onBeforeRouteLeave(async (to) => {
  const toDirector = String(to.path).includes('/canvas/director')
    && Number(to.query.id) === canvasId.value
  if (toDirector)
    return true
  const m = saveMachine.value
  if (hasUnsavedChanges(m)) {
    return await confirm({
      title: t('离开画布'),
      message: m.conflict
        ? t('画布与其他地方的修改冲突，本地修改尚未保存，确定离开？')
        : t('画布还有未保存的修改，确定离开？'),
      confirmText: t('离开'),
      danger: true,
    })
  }
  return true
})

function onResizeStart(event: PointerEvent) {
  event.preventDefault()
  const el = event.currentTarget as HTMLElement
  const editor = el.closest('.canvas-editor') as HTMLElement | null
  const total = editor?.clientWidth || window.innerWidth
  const startX = event.clientX
  const startPct = chatPct.value
  resizing.value = true
  el.setPointerCapture(event.pointerId)

  function onMove(move: PointerEvent) {
    const next = startPct - ((move.clientX - startX) / total) * 100
    chatPct.value = Math.min(chatMaxPct, Math.max(chatMinPct, next))
  }

  function onUp() {
    resizing.value = false
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
  }

  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
}
</script>

<template>
  <div
    ref="editorRoot"
    class="canvas-editor"
    :class="{ 'is-resizing': resizing }"
    :style="{ '--canvas-chat-pct': `${chatPct}%` }"
  >
    <div class="canvas-editor__main">
      <header class="canvas-editor__bar">
        <NuxtLink :to="localePath('/studio')" class="canvas-editor__brand">
          <img src="/images/logo.svg" alt="EasyTV" width="22" height="22">
          EasyTV
        </NuxtLink>
        <span class="canvas-editor__sep" />
        <input
          v-model="draftName"
          class="canvas-editor__title"
          maxlength="40"
          :aria-label="t('草稿名称')"
          :readonly="readonly"
          @keydown.stop="onTitleKeydown"
          @blur="commitDraftName"
        >
        <span v-if="readonly" class="canvas-editor__save" data-state="readonly">
          {{ readonlyOwner ? t('只读 · {name} 的画布', { name: readonlyOwner }) : t('只读 · 队友的画布') }}
        </span>
        <template v-else>
          <span class="canvas-editor__sep" />
          <span v-if="teamShared" class="canvas-editor__save" data-state="team">
            {{ readonlyOwner ? t('{name} 的画布 · 可编辑', { name: readonlyOwner }) : t('队友的画布 · 可编辑') }}
          </span>
          <span class="canvas-editor__save" :data-state="saveState">{{ saveLabel }}</span>
          <button
            type="button"
            class="canvas-editor__save-btn"
            :disabled="saveState === 'saving' || loading"
            :aria-label="t('保存（Ctrl+S）')"
            @click="save(true)"
          >
            <UIcon name="i-lucide-save" class="size-3.5" />
            <span class="canvas-tip canvas-tip--down">{{ t('保存') }} <kbd>Ctrl+S</kbd></span>
          </button>
        </template>
      </header>
      <div class="canvas-editor__end">
        <button
          v-if="!chatOpen && !readonly"
          type="button"
          class="canvas-editor__agent"
          :aria-label="t('打开对话')"
          @click="chatOpen = true"
        >
          <UIcon name="i-lucide-message-circle" class="size-4" />
          Agent
          <span class="canvas-tip canvas-tip--down">{{ t('打开对话') }}</span>
        </button>
        <div class="canvas-editor__tools">
          <template v-if="!readonly">
            <button
              v-if="!teamShared"
              type="button"
              class="canvas-editor__save-btn"
              :disabled="loading"
              :aria-label="t('分享画布')"
              @click="openShare"
            >
              <UIcon name="i-lucide-share-2" class="size-4" />
              <span class="canvas-tip canvas-tip--down">{{ t('分享画布') }}</span>
            </button>
            <div class="canvas-more">
              <button type="button" class="canvas-editor__save-btn" :aria-label="t('更多')" :disabled="loading" @click="moreOpen = !moreOpen">
                <UIcon name="i-lucide-ellipsis" class="size-4" />
                <span class="canvas-tip canvas-tip--down">{{ t('更多') }}</span>
              </button>
              <div v-if="moreOpen" class="canvas-more__menu">
                <button type="button" @click="saveAsSkill"><UIcon name="i-lucide-sparkles" class="size-4" />{{ t('存为 Skill') }}</button>
                <button type="button" @click="exportCanvas"><UIcon name="i-lucide-download" class="size-4" />{{ t('导出画布文件') }}</button>
                <button type="button" @click="pickImport"><UIcon name="i-lucide-upload" class="size-4" />{{ t('导入画布文件') }}</button>
              </div>
              <input ref="importInput" type="file" accept="application/json,.json" hidden @change="onImportFile">
            </div>
          </template>
          <button
            v-if="canvasId"
            type="button"
            class="canvas-editor__save-btn"
            :aria-label="t('批注')"
            @click="openComments()"
          >
            <UIcon name="i-lucide-message-square-text" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('查看和发表这张画布的批注') }}</span>
          </button>
          <span class="canvas-editor__sep" />
          <ClientOnly>
            <StudioUserMenu />
            <template #fallback>
              <span class="user-menu__trigger"><span class="user-menu__avatar user-menu__avatar--letter" /></span>
            </template>
          </ClientOnly>
        </div>
      </div>
      <ClientOnly>
        <CanvasWorkspace ref="workspace" :canvas-id="canvasId" :initial-prompt="initialPrompt" :readonly="readonly" :request-save="save" @change="markDirty" @history="openHistory" @comment="openComments" @assist="onWorkspaceAssist" @open-director="onOpenDirector" @chat-assets="onChatAssets" @chat-style="onChatStyle" @skill-start="onSkillStart" />
        <template #fallback>
          <div class="canvas-editor__stage" />
        </template>
      </ClientOnly>
    </div>
    <div
      v-if="chatOpen && !practiceSession.active"
      class="canvas-splitter"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('调整对话栏宽度')"
      @pointerdown="onResizeStart"
    />
    <Transition name="chat-panel">
      <div v-if="chatOpen && !practiceSession.active" class="canvas-editor__chat-panel">
        <div class="canvas-editor__chat" data-guide="chat">
          <CanvasChat
            ref="chat"
            :canvas-id="canvasId"
            :assist="readonly ? null : assistBridge"
            :selection="assistSelection"
            :brief-quote="briefQuote"
            @close="chatOpen = false"
            @insert-text="onChatInsertText"
            @insert-images="onChatInsertImages"
            @insert-audios="onChatInsertAudios"
            @reset-brief="onChatResetBrief"
            @generate-brief="onChatGenerateBrief"
            @place-videos="onChatPlaceVideos"
            @compose-brief="onChatComposeBrief"
            @pick-asset="onChatPickAsset"
            @open-style="workspace?.openStyleLibrary('chat')"
            @task-started="workspace?.refreshRunQueue()"
          />
        </div>
      </div>
    </Transition>
    <ClientOnly>
      <CanvasShareModal :open="shareOpen" :canvas-id="canvasId" @close="shareOpen = false" />
      <StudioSkillEditor :open="skillEditorOpen" :skill="null" :preset="skillPreset" :canvas-id="canvasId" :canvas-nodes="skillNodeCount" @close="skillEditorOpen = false" />
      <CanvasHistoryPanel
        :open="historyOpen"
        :canvas-id="canvasId"
        :current-version="version"
        :current-version-id="historyVersionId"
        @close="historyOpen = false"
        @restored="onRestored"
      />
      <Teleport to="body">
        <div
          v-if="conflictOpen"
          class="studio-modal-mask studio-confirm-mask"
          @click.self="conflictOpen = false"
          @pointerdown.stop
        >
          <div class="studio-confirm" role="alertdialog" aria-modal="true" aria-labelledby="canvas-conflict-title">
            <header class="studio-confirm__head">
              <span class="studio-confirm__icon is-danger" aria-hidden="true">
                <UIcon name="i-lucide-alert-circle" class="size-4" />
              </span>
              <h2 id="canvas-conflict-title">{{ t('画布已在其他地方修改') }}</h2>
              <button type="button" class="studio-confirm__close" :aria-label="t('关闭')" :disabled="conflictBusy" @click="conflictOpen = false">
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </header>
            <p>{{ t('这张画布在别的窗口或设备上保存过，自动保存已暂停。你可以载入最新版本（放弃本页未保存的修改），或用本页的内容覆盖（对方的版本仍可在版本历史里找回）。') }}</p>
            <div class="studio-confirm__actions is-wrap">
              <button type="button" class="studio-confirm__btn" :disabled="conflictBusy" @click="reloadLatestVersion">
                {{ t('重新加载最新版本') }}
              </button>
              <button type="button" class="studio-confirm__btn is-danger" :disabled="conflictBusy" @click="overwriteWithMine">
                {{ t('用我的版本覆盖') }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </ClientOnly>
    <ClientOnly>
      <CanvasGuideTour :open="guideOpen && !readonly" @close="closeGuide" />
    </ClientOnly>
    <ProjectCommentPanel
      :open="commentOpen"
      :project="commentProject"
      :canvas-id="canvasId"
      :node-id="commentNodeId"
      :node-hint="commentNodeHint"
      @close="closeComments"
      @open-count-change="refreshCommentMarks"
      @locate="onLocateComment"
    />
    <StudioWalletPanel />
    <StudioPricingModal />
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/shell.css';
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio.css';
</style>
