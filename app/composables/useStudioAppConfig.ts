import appApi from '~/api/app'
import { CANVAS_NODE_ITEMS } from '~/utils/canvas-node-kinds'

/** GET /app/config → growth：增长域展示值（礼包、任务、签到、邀请、促销条），见 API.md 7.2 */
export interface GrowthConfig {
  signup_points: number
  signup_valid_days: number
  task_points: Record<string, number>
  task_valid_days: number
  checkin_points: number
  checkin_valid_days: number
  checkin_streak_bonus: number
  checkin_month_bonus: number
  checkin_member_multiplier: number
  invite_invitee_points: number
  invite_inviter_points: number
  invite_valid_days: number
  invite_recharge_rate: number
  invite_recharge_cap: number
  promo_banner_enabled: boolean
  promo_banner_link: string
  /** 技能被调用时作者分成比例 0~1（API.md 8.3） */
  skill_author_share: number
  /** 开源作品被做同款一次给作者的积分；0 表示关闭 */
  work_clone_points: number
  /** 站外投稿档位积分 / 翻倍点赞数 / 月上限（API.md 8.5） */
  ugc_points_30: number
  ugc_points_60: number
  ugc_points_120: number
  ugc_viral_likes: number
  ugc_monthly_cap: number
  ugc_monthly_entries: number
  /**
   * 成片向导默认选中的模型（API.md 8.2）；空串表示运营没配，前端回落到清单第一个。
   * 有这三项是因为某个模型的某条通路在网关坏掉时（如 seedance 图生视频），
   * 运营要能立刻换默认，而不是等发版。
   */
  compose_image_model: string
  compose_video_model: string
  compose_audio_model: string
  /** 运营配的看图文本模型（反推提示词 / 智能识别），空串表示按偏好自动挑 */
  vision_text_model: string
}

export function normalizeGrowth(raw: unknown): GrowthConfig | null {
  if (!raw || typeof raw !== 'object')
    return null
  const g = raw as Record<string, unknown>
  const num = (v: unknown) => Number(v) || 0
  const taskPoints: Record<string, number> = {}
  if (g.task_points && typeof g.task_points === 'object') {
    for (const [k, v] of Object.entries(g.task_points as Record<string, unknown>))
      taskPoints[k] = num(v)
  }
  return {
    signup_points: num(g.signup_points),
    signup_valid_days: num(g.signup_valid_days),
    task_points: taskPoints,
    task_valid_days: num(g.task_valid_days),
    checkin_points: num(g.checkin_points),
    checkin_valid_days: num(g.checkin_valid_days),
    checkin_streak_bonus: num(g.checkin_streak_bonus),
    checkin_month_bonus: num(g.checkin_month_bonus),
    checkin_member_multiplier: num(g.checkin_member_multiplier),
    invite_invitee_points: num(g.invite_invitee_points),
    invite_inviter_points: num(g.invite_inviter_points),
    invite_valid_days: num(g.invite_valid_days),
    invite_recharge_rate: Number(g.invite_recharge_rate) || 0,
    invite_recharge_cap: num(g.invite_recharge_cap),
    promo_banner_enabled: g.promo_banner_enabled === true || g.promo_banner_enabled === 1,
    promo_banner_link: String(g.promo_banner_link ?? ''),
    skill_author_share: Number(g.skill_author_share) || 0,
    work_clone_points: num(g.work_clone_points),
    ugc_points_30: num(g.ugc_points_30),
    ugc_points_60: num(g.ugc_points_60),
    ugc_points_120: num(g.ugc_points_120),
    ugc_viral_likes: num(g.ugc_viral_likes),
    ugc_monthly_cap: num(g.ugc_monthly_cap),
    ugc_monthly_entries: num(g.ugc_monthly_entries),
    compose_image_model: String(g.compose_image_model ?? ''),
    compose_video_model: String(g.compose_video_model ?? ''),
    compose_audio_model: String(g.compose_audio_model ?? ''),
    vision_text_model: String(g.vision_text_model ?? '').trim(),
  }
}

/**
 * GET /app/config：功能入口开关。
 * director_3d_enabled 缺省为 true，与后台 Director3DEnabled 未配置时默认显示一致。
 * 不叫 useAppConfig：会和 Nuxt 内置同名函数冲突。
 */
export function useStudioAppConfig() {
  const director3dEnabled = useState('app-director-3d-enabled', () => true)
  /** 发票入口（设置 · 发票）；后台未开通开票时为 false */
  const invoiceEnabled = useState('app-invoice-enabled', () => false)
  const growth = useState<GrowthConfig | null>('app-growth-config', () => null)
  const loaded = useState('app-config-loaded', () => false)
  const loading = useState('app-config-loading', () => false)

  const canvasNodeItems = computed(() =>
    CANVAS_NODE_ITEMS.filter(item =>
      !('hidden' in item && item.hidden)
      && (item.kind !== 'director' || director3dEnabled.value),
    ),
  )

  async function load(force = false) {
    if (!import.meta.client || loading.value || (loaded.value && !force))
      return
    loading.value = true
    const startedAt = Date.now()
    try {
      const raw = await appApi.config()
      const data = raw?.data ?? raw ?? {}
      director3dEnabled.value = data?.director_3d_enabled !== false
      invoiceEnabled.value = data?.invoice_enabled === true
      growth.value = normalizeGrowth(data?.growth)
      // 服务器时间校准本机时钟偏差，倒计时条 / 促销到期判断都用 useServerClock().now()
      useServerClock().calibrateFromUnix(data?.server_time, startedAt)
      loaded.value = true
    }
    catch {
      director3dEnabled.value = true
    }
    finally {
      loading.value = false
    }
  }

  return { director3dEnabled, invoiceEnabled, growth, canvasNodeItems, loaded, loading, load }
}
