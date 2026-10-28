import { useConfirm } from '~/composables/useConfirm'

export type PointsRemindMode = 'threshold' | 'never'

export type CanvasAgentSettings = {
  insertReply: boolean
  assistOn: boolean
  autoGenerate: boolean
  /** 结合画布时从零搭一整张工作流（API.md 32 的 generate 模式），关掉则在现有节点上小改 */
  buildFromScratch: boolean
  pointsRemind: PointsRemindMode
  pointsThreshold: number
}

export const CANVAS_AGENT_SETTINGS_KEY = 'easytv-chat-settings'
export const DEFAULT_POINTS_THRESHOLD = 450

const MIN_THRESHOLD = 1
const MAX_THRESHOLD = 999999

function clampThreshold(value: unknown) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n))
    return DEFAULT_POINTS_THRESHOLD
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, n))
}

function readStored(): Record<string, unknown> {
  if (!import.meta.client)
    return {}
  try {
    const raw = localStorage.getItem(CANVAS_AGENT_SETTINGS_KEY)
    return raw ? JSON.parse(raw) as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

/**
 * 画布 Agent 设置：结合画布、回复写入、自动提交生成、积分提醒阈值。
 * 存在 localStorage，对话栏与生成入口共用。
 */
export function useCanvasAgentSettings() {
  const { t } = useI18n()
  const { confirm } = useConfirm()

  const settings = useState<CanvasAgentSettings>('canvas-agent-settings', () => ({
    insertReply: false,
    assistOn: true,
    autoGenerate: false,
    buildFromScratch: false,
    pointsRemind: 'threshold',
    pointsThreshold: DEFAULT_POINTS_THRESHOLD,
  }))
  const loaded = useState('canvas-agent-settings-loaded', () => false)

  function persist() {
    if (!import.meta.client)
      return
    try {
      // 只写类型里的字段：旧版本在同一个 key 里存过对话模型（model），
      // 对话模型已改为平台统一配置，这里不再回写，顺手把遗留键清掉。
      localStorage.setItem(CANVAS_AGENT_SETTINGS_KEY, JSON.stringify({
        insertReply: settings.value.insertReply,
        assistOn: settings.value.assistOn,
        autoGenerate: settings.value.autoGenerate,
        buildFromScratch: settings.value.buildFromScratch,
        pointsRemind: settings.value.pointsRemind,
        pointsThreshold: settings.value.pointsThreshold,
      }))
    }
    catch {
      // 私密模式等情况下忽略
    }
  }

  function load() {
    if (!import.meta.client || loaded.value)
      return
    loaded.value = true
    const saved = readStored() as Partial<CanvasAgentSettings>
    settings.value = {
      insertReply: Boolean(saved.insertReply),
      assistOn: saved.assistOn !== false,
      autoGenerate: Boolean(saved.autoGenerate),
      buildFromScratch: Boolean(saved.buildFromScratch),
      pointsRemind: saved.pointsRemind === 'never' ? 'never' : 'threshold',
      pointsThreshold: clampThreshold(saved.pointsThreshold ?? DEFAULT_POINTS_THRESHOLD),
    }
  }

  function save() {
    persist()
  }

  function setPointsRemind(mode: PointsRemindMode) {
    settings.value.pointsRemind = mode
    persist()
  }

  function setPointsThreshold(value: unknown) {
    settings.value.pointsThreshold = clampThreshold(value)
    settings.value.pointsRemind = 'threshold'
    persist()
  }

  async function confirmSpend(points: number): Promise<boolean> {
    if (settings.value.pointsRemind !== 'threshold')
      return true
    const n = Math.max(0, Math.floor(Number(points) || 0))
    if (!n || n <= settings.value.pointsThreshold)
      return true
    return await confirm({
      title: t('canvas.chat.settings.spendTitle'),
      message: t('canvas.chat.settings.spendMessage', {
        n,
        m: settings.value.pointsThreshold,
      }),
      confirmText: t('继续'),
    })
  }

  if (import.meta.client)
    load()

  return {
    settings,
    load,
    save,
    setPointsRemind,
    setPointsThreshold,
    confirmSpend,
  }
}
