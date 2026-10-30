/** 创作域实体类型，与后端接口一一对应。 */

export type ApiResponse<T = unknown> = {
  success: boolean
  message?: string
  data?: T
}

export type Paged<T> = {
  items: T[]
  total: number
}

export type PageQuery = {
  page?: number
  page_size?: number
}

export type Project = {
  id: number
  user_id: number
  name: string
  description: string
  cover_url: string
  status: number
  /** 列表附带：最近更新的画布 id，0 表示还没有画布 */
  canvas_id: number
  /** 未解决批注数（API.md 10.10），用于卡片角标 */
  open_comments: number
  /** 所在空间（API.md 20）：0 个人空间，>0 团队 id */
  team_id?: number
  owner_id?: number
  /** 团队空间列表：作者昵称 */
  owner_nickname?: string
  /** 不是自己的项目（团队空间里队友的） */
  team_shared?: boolean
  /** 当前用户对项目的权限：owner 作者 / admin / editor / viewer */
  permission?: 'owner' | 'admin' | 'editor' | 'viewer'
  can_edit?: boolean
  can_delete?: boolean
  /** 只有作者能在个人 / 团队空间之间移动 */
  can_move?: boolean
  created_at: number
  updated_at: number
  deleted_at: string | null
}

/**
 * 项目评论批注（API.md 10.10）。
 * node_id 为空是项目级留言，非空是画布节点批注；resolved 走后端的 0/1 而非布尔。
 */
export type ProjectComment = {
  id: number
  project_id: number
  user_id: number
  canvas_id: number
  node_id: string
  content: string
  resolved: number
  resolved_by: number
  resolved_at: number
  created_at: number
  updated_at: number
  author_nickname?: string
  resolved_by_nickname?: string
}

export type CanvasViewport = { x: number, y: number, zoom: number }

export type CanvasGraph = {
  nodes: any[]
  edges: any[]
  viewport?: CanvasViewport
}

export type CanvasSummary = {
  id: number
  user_id: number
  project_id: number
  name: string
  version: number
  thumbnail_url: string
  created_at: number
  updated_at: number
}

/** 画布版本快照（API.md 1.2.1） */
export type CanvasVersion = {
  id: number
  canvas_id: number
  version: number
  name: string
  node_count: number
  source: 'auto' | 'manual' | 'restore'
  note: string
  created_at: number
}

/** 画布只读分享状态（GET/PUT /user/canvas/:id/share）；path 为 /share/:token */
export type CanvasShare = { enabled: boolean, token: string, path: string }

/** 分享页数据（GET /share/canvas/:token） */
export type SharedCanvas = {
  name: string
  node_count: number
  updated_at: number
  owner: { id: number, nickname: string }
  graph: CanvasGraph
  mine: boolean
}

export type CanvasDetail = CanvasSummary & {
  graph: CanvasGraph
  /** 队友的画布（同团队成员只读查看，API.md 11.6）：不能保存、生成、分享 */
  readonly?: boolean
  team_shared?: boolean
  owner_nickname?: string
}

export type AssetType = 'image' | 'video' | 'audio' | 'text' | 'other'

/** 素材被引用的地方（API.md 14.1） */
export type AssetRef = { type: 'canvas' | 'subject' | 'work' | 'timeline', id: number, name: string, node_ids?: string[] }

/** 做同款预览（GET /work/:id/clone-preview，API.md 14.3） */
export type ClonePreview = {
  work_id: number
  has_snapshot: boolean
  captured_at: number
  node_count: number
  generative_nodes: number
  estimate_points: number
  unpriced_nodes: number
  models: Array<{ model: string, type: TaskType, label: string, nodes: number, unit: string, points_per_unit: number, available: boolean, priced: boolean, changes: string[] }>
  missing_refs: Array<{ node_id: string, label: string, fields: string[] }>
  subject_nodes: number
}

export type Asset = {
  id: number
  user_id: number
  project_id: number
  type: AssetType
  name: string
  url: string
  /** 视频资产自动抽帧的封面，可能为空 */
  cover_url?: string
  storage_key: string
  mime: string
  size: number
  width: number
  height: number
  duration: number
  source: 'upload' | 'generated'
  task_id: number
  created_at: number
}

export type TaskType = 'text' | 'image' | 'video' | 'audio'
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/**
 * 模型促销价（API.md 7.1 T18）：GET /generation/models 与 /billing/model-prices 都附带。
 * 有效期内实际单价取 effective_*，划线价用 points_per_unit / member_points_per_unit；老版本接口没有这些字段时按标准价处理。
 */
export type ModelPromoFields = {
  promo_points_per_unit?: number
  promo_label?: string
  promo_starts_at?: number
  promo_ends_at?: number
  promo_active?: boolean
  /** 非会员实际单价 */
  effective_points_per_unit?: number
  /** 会员实际单价 */
  effective_member_points_per_unit?: number
  /** 当前生效的是活动价时，服务端带的标签 */
  campaign_promo_label?: string
}

export type GenerationModel = {
  provider: string
  model: string
  type: TaskType
  label: string
  /** 积分定价（GET /generation/models 附带；priced=false 表示运营未定价，不能下任务） */
  unit: 'second' | 'image' | 'call' | ''
  points_per_unit: number
  member_points_per_unit: number
  priced: boolean
  /**
   * 该模型支持的时长（秒，API.md 6.1）。空数组表示不限。
   * 各家模型允许的秒数不一样（sora-2 是 4/8/12，seedance 是 5/10/15），
   * 不按它限制选项就只能等网关回 400。
   */
  durations?: number[]
  /** 该模型支持的分辨率（如 ["512P","768P","1080P"]）；空数组表示不限 */
  resolutions?: string[]
  /** 近 7 天健康（API.md 37）：任务数 / 失败率（百分比 0–100）/ 是否失败偏多 */
  recent_total?: number
  recent_fail_rate?: number
  recent_warn?: boolean
  /**
   * 图片模型接收参考图 / 原图的方式（API.md 11.4）：none 不支持；edits 支持原图 + 蒙版局部修改；
   * url 支持参考图但不支持蒙版。非图片模型为空串。
   */
  image_input?: ImageInputMode
  /**
   * 能力标签（API.md 23.1 model_price.abilities）：upscale / matting / native_audio 等。
   * native_audio = 视频模型能按提示词里的台词原生出声，口播预设只列这类模型（API.md 24.9）。
   */
  abilities?: string[]
} & ModelPromoFields

/**
 * GET /generation/models/detail（API.md 28）：列表定价字段 + 网关展示元数据。
 * gateway_available=false 时说明 / 供应商等为空，定价字段仍可用。
 */
export type GenerationModelVendor = {
  id: number
  name: string
  description?: string
  icon?: string
}

export type GenerationModelEndpoint = {
  path: string
  method: string
}

/** params.<分类>：input/output 模态 + properties 参数表（尺寸 / 质量 / 音色等） */
export type GenerationModelParamGroup = {
  input?: string[]
  output?: string[]
  properties?: Record<string, unknown>
}

export type GenerationModelDetail = GenerationModel & {
  category?: string
  description?: string
  icon?: string
  tags?: string
  vendor?: GenerationModelVendor | null
  /** 网关 model.endpoints 原样：数组或对象，形态不固定 */
  endpoints?: unknown
  supported_endpoint?: Record<string, GenerationModelEndpoint>
  supported_endpoint_types?: string[]
  params?: Record<string, GenerationModelParamGroup>
  gateway_available?: boolean
  pricing_version?: string
}

export type ImageInputMode = 'none' | 'edits' | 'url' | ''


export type TaskInput = { asset_id: number, role?: string }

/** 媒体工具（API.md 23）：动作引擎，local 本地 ffmpeg / model 走生成任务 / pipeline 复合作业 / existing 既有接口 */
export type MediaEngine = 'local' | 'model' | 'pipeline' | 'existing'

/** 媒体工具作业状态：0 排队 / 1 处理中 / 2 成功 / -1 失败 */
export type MediaJobStatus = -1 | 0 | 1 | 2

export type MediaParamSpec = {
  key: string
  label: string
  type: 'string' | 'int' | 'float' | 'bool' | 'enum' | 'rect' | string
  default?: unknown
  min?: unknown
  max?: unknown
  options?: string[]
  help?: string
}

/** GET /user/media/actions 的元素（API.md 23.4） */
export type MediaAction = {
  action: string
  label: string
  engine: MediaEngine
  /** 允许的源素材类型 */
  source: string[]
  /** 产物类型；"same" 表示与源同类 */
  outputs: string[]
  /** 模型动作按能力位挑模型（model_price.abilities） */
  ability?: string
  /** existing 引擎指向的既有接口写法 */
  endpoint?: string
  params?: MediaParamSpec[]
  available: boolean
  /** available=false 时的原因（后端已是人话，直接展示） */
  reason?: string
  /** 模型动作：已定价、已接入且具备该能力的模型 */
  models?: string[]
  /** 本地动作不计积分 */
  free: boolean
}

/** 作业产物；逐帧拉片的解读文本带 task_id，前端再去轮询 /user/task/:id */
export type MediaOutput = {
  asset_id: number
  url: string
  type: 'image' | 'video' | 'audio' | 'text' | string
  name: string
  label?: string
  task_id?: number
  /** 抽帧产物在源视频里的秒数（extract_frames interval / spread 模式；scene 模式与第一帧的 0 秒不下发） */
  time?: number
  /** 图片 / 视频产物的像素尺寸（宫格切分按它定切片比例） */
  width?: number
  height?: number
  /** 语音转字幕：整份 SRT 文本（≤ 20000 字），直接写进字幕文本节点 */
  text?: string
  /** 语音转字幕：逐句时间轴（秒） */
  cues?: Array<{ start: number, end: number, text: string }>
  /** 处理成功但有保留的提示（给人看的中文） */
  warning?: string
  /** 机器可读原因：transcribe_truncated / transcribe_no_timestamps / no_silence */
  warning_code?: string
  /** 给前端拼文案的数字（如 minutes） */
  warning_params?: Record<string, string | number>
}

/** 媒体工具作业（API.md 23.2） */
export type MediaJob = {
  id: number
  engine: MediaEngine
  action: string
  status: MediaJobStatus
  progress: number
  source_asset_id: number
  /** 模型 / pipeline 动作对应的生成任务，取消走 POST /user/task/:id/cancel */
  task_id: number
  node_id: string
  canvas_id: number
  project_id: number
  params: Record<string, unknown>
  outputs: MediaOutput[]
  output_asset_id: number
  output_url: string
  error: string
  /** 模型引擎的文本产物 */
  result_text?: string
  created_at: number
  started_at: number
  finished_at: number
}

/** 任务中心概览（GET /user/task/summary） */
export type TaskSummary = {
  total: number
  active: number
  succeeded: number
  failed: number
  cancelled: number
  points_today: number
  points_30d: number
  points_frozen: number
}

export type GenerationTask = {
  id: number
  task_no: string
  user_id: number
  project_id: number
  canvas_id: number
  node_id: string
  type: TaskType
  provider: string
  model: string
  prompt: string
  params: Record<string, unknown>
  inputs: TaskInput[]
  status: TaskStatus
  progress: number
  result_asset_id: number
  result_url: string
  /** 文本任务的结果 */
  result_text: string
  error_msg: string
  points_frozen: number
  cost_points: number
  created_at: number
  started_at: number
  finished_at: number
}

export type WorkStatus = -1 | 0 | 1 | 2

export type Work = {
  id: number
  user_id: number
  project_id: number
  asset_id: number
  title: string
  description: string
  category: string
  cover_url: string
  video_url: string
  duration: number
  /** 发布时所在画布（制作过程） */
  canvas_id: number
  show_process: boolean
  status: WorkStatus
  remark: string
  view_count: number
  like_count: number
  /** 可见评论数（含回复） */
  comment_count: number
  published_at: number
  created_at: number
  updated_at: number
  author?: { id: number, nickname: string }
  /** 带登录态时返回：当前用户是否已点赞 */
  liked?: boolean
  /** 做同款（API.md 7.1）：来源画布 / Skill、是否开源、被做同款次数 */
  source_canvas_id?: number
  source_skill_id?: number
  open_source?: 0 | 1
  clone_count?: number
  /** GET /work/:id 且 open_source=1 时附带 */
  source?: { canvas_id: number, skill_id: number, clone_count: number }
}

/** 新手任务（GET /user/growth/tasks，API.md 7.3） */
export type GrowthTask = {
  key: string
  title: string
  points: number
  status: 0 | 1
  done_at: number
}

export type GrowthTasks = {
  tasks: GrowthTask[]
  total_points: number
  earned_points: number
  done: number
  valid_days: number
}

/** 签到结果（POST /user/checkin） */
export type CheckinResult = {
  points: number
  streak: number
  bonus_points: number
  already: boolean
}

/** 签到状态（GET /user/checkin/status） */
export type CheckinStatus = {
  today_done: boolean
  streak: number
  month_days: number[]
  next_bonus_in: number
  points_today: number
  streak_bonus: number
  month_bonus: number
  valid_days: number
  is_member: boolean
}

/** 提示词库条目（API.md 1.11）；列表不返回 content，详情才有 */
export type Prompt = {
  id: number
  title: string
  content?: string
  cover_url: string
  result_url: string
  tags: string[]
  category: string
  /** 0 表示后台手工录入 */
  source_id: number
  source_name: string
  source_url: string
  uses: number
  sort_order: number
  status: 1 | 2
  created_at: number
  updated_at: number
}

/** 风格库条目（API.md 34）：生成时把 prompt 片段拼到节点提示词末尾；kinds 为空表示图片 / 视频都适用 */
export type Style = {
  id: number
  name: string
  cover_url: string
  prompt: string
  negative: string
  tags: string[]
  category: string
  kinds: Array<'image' | 'video'>
  uses: number
  /** 我的风格视图（API.md 34.5）才有：1 可用 / 私有、2 下架、3 待审核、4 已收录 */
  status?: 1 | 2 | 3 | 4
  user_id?: number
  /** 「从当前图定风格」的来源图资产 id，只留痕 */
  source_asset_id?: number
  created_at?: number
  updated_at?: number
}

/** GET /prompt/sources 的筛选项 */
export type PromptSourceBrief = {
  id: number
  name: string
  tag: string
}

export type Skill = {
  id: number
  title: string
  slug: string
  description: string
  author_name: string
  category: string
  cover_url: string
  video_url: string
  scene: string
  howto: string
  output: string
  prompt: string
  /** 执行契约（API.md 1.6）：只对文本任务注入，拼在提示词最前面 */
  guide: string
  output_format: string
  uses: number
  stars: number
  sort_order: number
  status: 1 | 2
  /** 0 官方；>0 用户私有 Skill */
  user_id: number
  /** 带登录态时返回 */
  favorited?: boolean
  /** 画布模板节点数，0 表示只有提示词 */
  graph_nodes: number
  /** 详情接口附带的画布模板 */
  graph?: CanvasGraph
  /** 上架审核（API.md 8.3）：0 私有 1 待审 2 已上架 3 驳回；官方技能不带 */
  review_status?: SkillReviewStatus
  review_remark?: string
  submitted_at?: number
  published_at?: number
  /** 共享时作者所在团队 id，0 表示没共享（API.md 10.10） */
  team_id: number
  /** 1 表示已共享给团队；作者退团后共享自动失效 */
  shared: number
  /** 同团队成员共享过来的行：只能使用，改 / 删 / 上架后端都会拒绝 */
  team_shared?: boolean
  /** team_shared 时后端附带的共享者昵称 */
  author_nickname?: string
  /** 作者分成比例，0 表示用全局 growth.skill_author_share */
  revenue_share?: number
  calls_total?: number
  revenue_total?: number
  created_at: number
  updated_at: number
}

/** 技能上架状态（API.md 8.1 skill.review_status） */
export type SkillReviewStatus = 0 | 1 | 2 | 3

/** GET /user/creator/summary（API.md 8.3） */
export type CreatorSkillRow = {
  id: number
  title: string
  review_status: SkillReviewStatus
  calls: number
  stars: number
  uses: number
  revenue: number
}

/** 技能分成提现单（owner_type=3） */
export type CreatorWithdraw = {
  id: number
  withdraw_no: string
  amount: number
  way: string
  status: number
  created_at: number
  failure_msg?: string
}

/** 收益流水：biz_type 7 分成（正）、8 兑换（负）、10 提现冻结、11 提现退回 */
export type CreatorRecord = {
  id: number
  skill_id: number
  skill_title: string
  /** 调用者昵称（脱敏） */
  from_user: string
  points: number
  biz_type: number
  created_at: number
}

export type CreatorSummary = {
  skills: CreatorSkillRow[]
  calls_total: number
  revenue_total: number
  withdrawable: number
  /** 可提现人民币（积分 ÷ 汇率，截到分） */
  cash_available: number
  /** 积分/元 */
  points_per_yuan: number
  /** 全局分成比例 0~1 */
  share_rate: number
  records: CreatorRecord[]
}

/** GET /creator/leaderboard */
export type CreatorLeaderboardItem = {
  user_id: number
  nickname: string
  calls: number
  revenue: number
  skills: number
}

export type CreatorLeaderboard = {
  period: 'week' | 'month'
  items: CreatorLeaderboardItem[]
}

/** 站外投稿（API.md 8.5） */
export type UgcPlatform = 'douyin' | 'xiaohongshu' | 'bilibili' | 'other'

/** 0 待审 1 通过 2 驳回 */
export type UgcStatus = 0 | 1 | 2

export type UgcSubmission = {
  id: number
  platform: UgcPlatform
  url: string
  work_id: number
  work_title: string
  duration_tier: number
  likes: number
  status: UgcStatus
  points: number
  viral: 0 | 1 | boolean
  remark: string
  created_at: number
  reviewed_at: number
}

export type UgcList = {
  items: UgcSubmission[]
  month_points: number
  month_cap: number
  month_entries?: number
  month_entries_cap?: number
}

/** 活动状态：0 草稿 1 进行中 2 已结束 3 已发奖（草稿不会出现在公开接口） */
export type CampaignStatus = 0 | 1 | 2 | 3

/** 奖项档位：rank_from~rank_to 名各得 points 积分 + member_days 天会员 */
export type CampaignPrize = {
  rank_from: number
  rank_to: number
  points: number
  member_days: number
}

/** 投稿状态：0 待审 1 通过 2 驳回 */
export type CampaignEntryStatus = 0 | 1 | 2

/** 投稿（GET /campaign/:slug/entries 与 my_entry，API.md 8.6） */
export type CampaignEntry = {
  id: number
  campaign_id: number
  work_id: number
  user_id: number
  status: CampaignEntryStatus
  /** 排序用的点赞快照，进行中时按作品当前点赞刷新 */
  likes_snapshot: number
  /** 发奖后才有，0 表示未上榜 */
  rank: number
  prize_points: number
  prize_days: number
  created_at: number
  /** 投稿墙列表附带 */
  work?: Work
  user?: { id: number, nickname: string }
}

/** 活动（API.md 8.6） */
export type Campaign = {
  id: number
  title: string
  slug: string
  banner_url: string
  /** 纯文本规则，换行保留，不要当 HTML 渲染 */
  rules: string
  tag: string
  starts_at: number
  ends_at: number
  status: CampaignStatus
  prizes: CampaignPrize[]
  entries_count: number
  created_at?: number
  updated_at?: number
  /** 后台原始 JSON，优先读 model_promo_items */
  model_promo?: string
  /** 解析后的活动价：进行中时生成按折后积分扣费 */
  model_promo_items?: CampaignPromoItem[]
  /** GET /campaign/:slug 带登录态时返回，没投过是 null */
  my_entry?: CampaignEntry | null
}

export type CampaignPromoItem = {
  model: string
  rate?: number
  points?: number
  label?: string
}

/** 作者主页（GET /author/:id） */
export type AuthorProfile = {
  id: number
  nickname: string
  joined_at: number
  work_count: number
  like_total: number
  view_total: number
  mine: boolean
  /** M11（API.md 9.2）：粉丝数 / 关注数 / 我是否已关注（匿名恒为 false） */
  followers?: number
  following_count?: number
  is_following?: boolean
}

/** 作品评论（API.md 1.10） */
export type WorkComment = {
  id: number
  work_id: number
  user_id: number
  parent_id: number
  reply_to_id: number
  content: string
  status: 1 | 2
  reply_count: number
  created_at: number
  author?: { id: number, nickname: string }
  reply_to?: { id: number, nickname: string }
  /** 列表接口附带的前几条回复 */
  replies?: WorkComment[]
  /** 带登录态时返回：是否本人发表 */
  mine?: boolean
}

/** 作品制作过程（GET /work/:id/process） */
export type WorkProcess = {
  work: { id: number, title: string, user_id: number }
  canvas: { id: number, name: string, updated_at: number }
  nodes: { id: string, kind: string, label: string, prompt: string, content: string, model: string, ref_url: string, x: number, y: number }[]
  edges: { source: string, target: string }[]
}

/** 通知偏好（API.md 1.9.1） */
export type NotificationPrefs = {
  types: { type: string, label: string, desc: string, enabled: boolean, globally_off: boolean }[]
  email_enabled: boolean
}

/** 站内通知（API.md 1.9） */
export type Notification = {
  id: number
  type: 'work' | 'task' | 'system' | 'comment' | 'like'
  title: string
  content: string
  link: string
  read_at: number
  created_at: number
}

/** 画布 Inspector「生成」按钮的参数，见 CanvasInspector.vue */
export type GeneratePayload = {
  model: string
  params: Record<string, unknown>
  /** 面板按预设拼好的提示词（口播模式）；不填用节点上的提示词 */
  prompt?: string
  /** 引用的主体（API.md 10.2），服务端会并入参考图并补充提示词，最多 4 个 */
  subject_ids?: number[]
  /** 锁定的主体版本 { 主体 id: 版本 }（API.md 14.2） */
  subject_versions?: Record<string, number>
  /** 配音语种（API.md 10.4），服务端按语种先翻译再 TTS */
  lang?: string
  /** 配音音色 */
  voice?: string
}

// ===== 付费域（API.md 6）=====

export type MembershipPlanApi = {
  id: number
  code: string
  name: string
  featured: boolean
  monthly_origin: number
  monthly_price: number
  monthly_points: number
  add_on_points: number
  add_on_price: number
  concurrent: number
  storage_gb: number
  sort_order: number
  status: 1 | 2
}

export type PointsPackApi = {
  id: number
  code: string
  points: number
  valid_days: number
  origin: number
  member_price: number
  featured: boolean
  sort_order: number
  status: 1 | 2
}

/** 会员日（API.md 9.5）：每月固定一天积分包打折，`day=0` 视为未开启 */
export type MemberDay = {
  /** 每月第几天，0 表示未开启 */
  day: number
  /** 积分包折扣系数，0.8 即 8 折 */
  pack_discount: number
  /** 今天是否会员日 */
  active: boolean
  /** 下一个会员日的秒级时间戳 */
  next_at: number
  /** 后台配置的整句文案，如「每月 11 日会员日，积分包 8 折」 */
  label: string
}

export type BillingPromo = {
  enabled: boolean
  title: string
  subtitle: string
  ends_at: number
  cycle_rate: Record<string, number>
  cycle_off_label: Record<string, string>
  team_seat_min: number
  team_seat_max: number
  team_seat_rate: number
  /** 顶部倒计时条开关与按钮链接（API.md 7.2），与 /app/config.growth.promo_banner_* 同源 */
  banner_enabled?: boolean
  banner_link?: string
  /** 会员日（API.md 9.5），后端未配置时可能缺省 */
  member_day?: MemberDay
}

export type BillingCatalog = {
  plans: MembershipPlanApi[]
  packs: PointsPackApi[]
  promo: BillingPromo
  pay_methods: { wechat_native: boolean, alipay_f2f: boolean }
}

export type ModelPrice = {
  id: number
  model: string
  type: TaskType
  label: string
  unit: 'second' | 'image' | 'call'
  points_per_unit: number
  member_points_per_unit: number
  status: 1 | 2
} & ModelPromoFields

export type BillingQuoteRequest = {
  kind: 'membership' | 'points'
  plan_code?: string
  pack_code?: string
  edition?: 'creator' | 'team'
  cycle?: 'month' | 'quarter' | 'year'
  seats?: number
  add_on?: boolean
}

export type BillingQuote = {
  kind: 'membership' | 'points'
  title: string
  origin: number
  price: number
  points: number
  months: number
  seats: number
  valid_days: number
  add_on_points: number
  add_on_price: number
  off_label: string
  is_member: boolean
  /** 会员日等自动优惠的说明，如「会员日 8 折」（API.md 9.5），没有优惠时为空 */
  discount_label?: string
}

export type OrderStatus = 'pending' | 'paid' | 'closed' | 'refunded'

export type Order = {
  id: number
  order_no: string
  user_id: number
  kind: 'membership' | 'points'
  plan_id: number
  pack_id: number
  edition: string
  cycle: string
  months: number
  seats: number
  add_on: boolean
  title: string
  origin: number
  price: number
  points: number
  valid_days: number
  status: OrderStatus
  payment_method: string
  paid_at: number
  closed_at: number
  refunded_at: number
  created_at: number
}

export type PayIntent = {
  payment_method: string
  /** 微信 / 订单支付二维码内容 */
  code_url?: string
  /** 支付宝当面付二维码内容 */
  qr_code?: string
  /** 支付宝电脑网站支付跳转链接 */
  payment_url?: string
  trade_no: string
  expires_at: number
}

export type OrderCreateResult = {
  order: Order
  quote: BillingQuote
  pay: PayIntent | null
  pay_error?: string
}

export type Membership = {
  id: number
  user_id: number
  plan_code: string
  plan_name: string
  edition: string
  seats: number
  monthly_points: number
  started_at: number
  expires_at: number
  next_grant_at: number
  status: 'active' | 'expired'
}

export type Wallet = {
  balance: number
  frozen: number
  expiring_in_7d: number
  membership: Membership | null
  is_member: boolean
  membership_days: number
  promo_enabled: boolean
  server_time: number
  /** 团队空间（API.md 20）：余额为团队积分池；member_* 是当前用户的月度额度，member_left 为 null 表示不限 */
  team?: {
    id: number
    name: string
    permission: 'admin' | 'editor' | 'viewer'
    member_limit: number | null
    member_used: number
    member_left: number | null
  } | null
}

export type PointsLog = {
  id: number
  user_id: number
  type: 'grant' | 'freeze' | 'settle' | 'unfreeze' | 'expire' | 'adjust'
  amount: number
  balance_after: number
  biz_type: string
  biz_no: string
  reason: string
  created_at: number
}

export type PointsLot = {
  id: number
  source: string
  points: number
  remaining: number
  expires_at: number
  created_at: number
}

/** 旧充值通道支付方式：微信 Native / 支付宝当面付 / 支付宝电脑网站支付 */
export type RechargePayMethod = 'wechat_native' | 'alipay_f2f' | 'alipay_pc'

export type RechargePayMethodOption = {
  name: string
  type: RechargePayMethod
  color: string
  min_recharge: number
}

/** GET /user/recharge/info */
export type RechargeInfo = {
  enable_wechat_native_recharge: boolean
  enable_alipay_f2f_recharge: boolean
  enable_alipay_pc_recharge: boolean
  min_recharge: number
  amount_options: number[]
  pay_methods: RechargePayMethodOption[]
}

/** POST /user/pay */
export type RechargePayRequest = {
  amount: number
  payment_method: RechargePayMethod
  /** >0 即团队充值，须为该团队 owner，入账计入团队钱包 */
  team_id?: number
}

export type RechargePayResult = {
  trade_no: string
  /** 微信 Native 二维码内容 */
  code_url?: string
  /** 支付宝当面付二维码内容 */
  qr_code?: string
  /** 支付宝电脑网站支付跳转链接 */
  payment_url?: string
}

export type RechargeStatusCode = 'pending' | 'success' | 'failed' | 'expired' | 'refunded'

/** GET /user/recharge/self */
export type RechargeRecord = {
  id: number
  user_id: number
  team_id: number
  amount: number
  money: number
  trade_no: string
  payment_method: string
  payment_provider: string
  create_time: number
  complete_time: number
  status: RechargeStatusCode
}

/** GET /invite/:code（匿名）：邀请码解析（API.md 7.2） */
export type InviteInfo = {
  user_id: number
  nickname: string
  aff_code: string
}

export type InviteRecordStatus = 'registered' | 'effective' | 'paid'

export type InviteRecord = {
  user_id: number
  /** 脱敏昵称 */
  nickname: string
  status: InviteRecordStatus
  points: number
  created_at: number
}

/** GET /user/invite/summary：邀请总览（API.md 7.3） */
export type InviteSummary = {
  aff_code: string
  invite_url: string
  invited: number
  effective: number
  points_total: number
  rebate_points: number
  rebate_cap: number
  /** 首充返利比例，0.1 = 10% */
  rebate_rate: number
  inviter_points: number
  invitee_points: number
  records: InviteRecord[]
}

export type InviteBill = {
  id: number
  biz_type: number
  amount: number
  from_user_id: number
  from_nickname?: string
  source_no?: string
  source_amount?: number
  rate?: number
  status: number
  created_at: number
  remark?: string
}

// ===== 成片工作室（API.md 8.2）=====

export type ScreenplayCharacter = {
  key: string
  name: string
  look: string
  /** 角色声音（API.md 25.1）：TTS 音色名（如 nova），空 = 模型默认 */
  voice?: string
  /** 说话风格（如「沉稳」），拼进配音提示 */
  voice_style?: string
}
/** 场次表（API.md 27.1）：objective 谁想得到什么 / conflict 阻碍 / turn 结束时发生了什么，各 ≤ 200 字 */
export type ScreenplayScene = { key: string, name: string, look: string, objective?: string, conflict?: string, turn?: string }
/** 对白条目（API.md 25.1）：speaker 为人物 key，空串 / narrator 为旁白 */
export type ScreenplayLine = {
  speaker: string
  text: string
  emotion?: string
  /** 多语言译文（localize 按条写回） */
  lines?: Record<string, string>
}
export type ScreenplayShot = {
  /** 稳定镜头 id（sh_xxxxxxxx，API.md 24.8）：服务端归一化时发放，保存时原样带回；新加的镜头留空由服务端发 */
  id?: string
  no: number
  scene: string
  characters: string[]
  prompt: string
  motion: string
  line: string
  /** 多语言台词（API.md 10.4 localize 写回），取不到时回落 line */
  lines?: Record<string, string>
  /** 对白条目（API.md 25.1）：非空时 line 由后端按条正文拼出；每镜 ≤ 12 条 */
  dialogue?: ScreenplayLine[]
  /** 本镜人物状态（API.md 25.2）：人物 key → 随剧情变化的描述，只影响这一镜 */
  states?: Record<string, string>
  seconds: number
}

export type ScreenplayPlan = {
  title: string
  style: string
  aspect: string
  characters: ScreenplayCharacter[]
  scenes: ScreenplayScene[]
  shots: ScreenplayShot[]
}

/** 策划案状态：0 生成中 1 待确认 2 已建画布 -1 失败 */
export type ScreenplayStatus = -1 | 0 | 1 | 2

export type Screenplay = {
  id: number
  user_id: number
  project_id: number
  canvas_id: number
  input: string
  target_seconds: number
  plan: ScreenplayPlan
  status: ScreenplayStatus
  error: string
  task_no: string
  points_used: number
  /** 剧本修订号（API.md 24.1）：每次保存 / 翻译 +1 */
  revision: number
  /** 画布基于哪一稿 */
  built_revision: number
  /** 已建画布且剧本又改过：提示「同步到画布」 */
  stale: boolean
  /** 集号（API.md 27）：0 = 未编号 */
  episode_no?: number
  created_at: number
  updated_at: number
}

// ---- 剧集圣经与集目录（API.md 27，复审 G01）----

export type BibleRelationship = { to: string, relation: string }

/** 人物：身份固定的部分 + 关系 + 知道哪些事实（key） */
export type BibleCharacter = {
  key: string
  name: string
  look: string
  voice?: string
  voice_style?: string
  traits?: string
  relationships: BibleRelationship[]
  knows: string[]
}

/** 关键道具：现在在谁手里（人物 key，空 = 无人持有）、什么状态 */
export type BibleProp = { key: string, name: string, holder: string, state: string, note?: string }

export type BibleThreadStatus = 'open' | 'resolved'

/** 伏笔 / 未解决的问题 */
export type BibleThread = { key: string, title: string, status: BibleThreadStatus, opened_in: number, resolved_in?: number }

/** 已揭示的信息：观众是否知道（audience_knows）与哪些角色知道（known_by）分开记 */
export type BibleFact = { key: string, text: string, revealed_in: number, audience_knows: boolean, known_by: string[] }

export type BiblePropChange = { prop: string, holder: string, state: string }

/** 一集的连续性记录（只读，由 record 接口生成） */
export type BibleEpisode = {
  no: number
  screenplay_id: number
  title: string
  summary: string
  revealed: string[]
  open: string[]
  relationships: string[]
  prop_changes: BiblePropChange[]
  characters: string[]
  updated_at: number
}

export type Bible = {
  title: string
  logline: string
  characters: BibleCharacter[]
  props: BibleProp[]
  threads: BibleThread[]
  facts: BibleFact[]
  episodes: BibleEpisode[]
}

/** GET /user/project/:id/bible：没建过 revision=0、title 取项目名 */
export type BibleDoc = { project_id: number, revision: number, bible: Bible, updated_at: number }

/** GET /user/project/:id/episodes 集目录项（按集号排） */
export type Episode = {
  id: number
  episode_no: number
  title: string
  status: ScreenplayStatus
  canvas_id: number
  scenes: number
  shots: number
  revision: number
  stale: boolean
  created_at: number
  updated_at: number
}

/** POST /user/project/:id/bible/impact 入参：四选一 */
export type ImpactQuery = { character?: string, prop?: string, fact?: string, text?: string }

/** 受影响的一集：场次名与镜号 */
export type ImpactEpisode = { episode_no: number, screenplay_id: number, title: string, scenes: string[], shots: number[], why: string }

export type ImpactResult = { affected: ImpactEpisode[], episodes: number }

/** POST /user/screenplay/:id/record：并入后的整份圣经与本次扣分 */
export type EpisodeRecordResult = { bible: Bible, revision: number, record: unknown, points: number, episode_no: number }

/** POST /user/screenplay/:id/estimate */
export type ScreenplayEstimate = {
  characters: number
  shots_image: number
  shots_video: number
  voice: number
  total: number
  image_model: string
  video_model: string
  audio_model: string
}

/** POST /user/screenplay/:id/build */
export type ScreenplayBuildResult = {
  canvas_id: number
  project_id: number
  estimate_points: number
  /** 已建过画布，直接返回已有画布 */
  existing?: boolean
  revision?: number
  built_revision?: number
  stale?: boolean
}

/** POST /user/screenplay/:id/build { sync: true }（API.md 24.1）：改稿同步到既有画布 */
export type ScreenplaySyncResult = {
  canvas_id: number
  project_id: number
  synced_shots: number[]
  added_shots: number[]
  removed_shots: number[]
  revision: number
}

export type ComposeClip = { node_id: string, asset_id: number, url: string, duration: number, text: string, in?: number, out?: number, voice_asset_id?: number }

/** 退回原因白名单（API.md 25.5） */
export type ShotReviewReason = 'identity' | 'performance' | 'lipsync' | 'composition' | 'continuity' | 'duration' | 'technical'

/** 候选审片结论（API.md 25.5）：status 1 通过 / -1 退回；候选没有结论时为 null（待审） */
export type ShotReview = {
  id: number
  user_id: number
  canvas_id: number
  node_id: string
  asset_id: number
  task_id: number
  status: 1 | -1
  reason: ShotReviewReason | ''
  note: string
  created_at: number
  updated_at: number
}

export type ShotReviewStatus = 'approved' | 'rejected' | 'clear'

/** 某节点生成成功过的产物（镜头候选，API.md 12.1） */
export type NodeCandidate = {
  task_id: number
  node_id: string
  asset_id: number
  url: string
  cover_url: string
  duration: number
  model: string
  prompt: string
  created_at: number
  /** 审片结论（API.md 25.5），缺失 / null 为待审 */
  review?: ShotReview | null
}

export type ShotMedia = {
  node_id: string
  asset_id: number
  url: string
  cover_url: string
  duration: number
  task_status: string
  candidates: NodeCandidate[]
}

/** 镜头视图（GET /user/canvas/:id/shots） */
export type Shot = {
  no: number
  line: string
  seconds: number
  video: ShotMedia
  image: ShotMedia | null
  voice: ShotMedia | null
  character_node_ids: string[]
}

export type TimelineVoiceMode = 'mix' | 'replace' | 'off'

export type TimelineClip = {
  /** 片段 id（API.md 24.3）：同一 node 可多次出现，各自独立；服务端为空时生成 `c_xxxxxxxx` */
  id: string
  node_id: string
  enabled: boolean
  /** 0 表示用画布节点当前的视频，否则是换上的候选 */
  asset_id: number
  in: number
  /** 0 表示到结尾 */
  out: number
  voice_mode: TimelineVoiceMode
  orig_volume: number
  voice_volume: number
  /** null 用台词；空串表示这一镜不要字幕 */
  subtitle: string | null
}

/** 成片时间线（API.md 12.2） */
export type Timeline = {
  aspect: '16:9' | '9:16' | '1:1'
  resolution: '720p' | '1080p'
  subtitles: boolean
  voice: boolean
  lang: string
  bgm_asset_id: number
  /** 0 表示静音（不混 BGM）；字段缺失服务端才回落 0.2（API.md 24.6） */
  bgm_volume: number
  clips: TimelineClip[]
  /** 审批门禁（API.md 26.1）：'' 关闭 / rejected 退回即拦 / approved 分镜图通过才放行视频；老时间线可能缺失 */
  review_gate?: ReviewGate
  /** 字幕来源（API.md 35.4）：画布上装着 SRT 的文本节点 id（语音转字幕产物）；空 = 策划案台词 */
  subtitle_node_id?: string
}

/** 审批门禁档位（API.md 26.1） */
export type ReviewGate = '' | 'rejected' | 'approved'

/** 时间线预计时长（API.md 25.4）：按入出点与配音延长算，和合成同一套规则 */
export type TimelineClipEstimate = {
  id: string
  node_id: string
  duration: number
  /** 配音比画面长、被自动延长的秒数 */
  voice_extended: number
}

export type TimelineEstimate = { total: number, clips: TimelineClipEstimate[] }

export type TimelineDetail = {
  version: number
  timeline: Timeline
  shots: Shot[]
  /** 角色图节点及其候选与审片结论（API.md 26.1） */
  characters?: ShotMedia[]
  updated_at?: number
  estimate?: TimelineEstimate
  /** 定版锁（API.md 25.6） */
  locked?: boolean
  locked_at?: number
  locked_by?: number
}

/** POST /user/canvas/:id/timeline/lock 的返回 */
export type TimelineLockResult = { locked: boolean, locked_at: number, locked_by: number, version: number }

export type BatchStatus = 'running' | 'paused' | 'done' | 'cancelled'
/** blocked：被审批门禁拦下（API.md 26.1），error 写原因；retry-failed 会一并重置 */
export type BatchItemStatus = 'waiting' | 'submitted' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'blocked'
export type BatchAction = 'pause' | 'resume' | 'cancel' | 'retry-failed'

export type BatchItemRequest = {
  node_id: string
  layer: string
  type: TaskType
  model: string
  prompt: string
  params: Record<string, unknown>
  inputs: TaskInput[]
  /** 依赖节点的产物作为输入（本批次节点或画布里已有产物的节点） */
  depends: Array<{ node_id: string, role: string }>
}

export type GenerationBatchItem = {
  id: number
  batch_id: number
  node_id: string
  layer: string
  type: TaskType
  model: string
  status: BatchItemStatus
  estimate: number
  task_id: number
  asset_id: number
  attempts: number
  error: string
  seq: number
}

/** 服务端批量生成（API.md 13） */
export type GenerationBatch = {
  id: number
  canvas_id: number
  status: BatchStatus
  budget_points: number
  estimate_points: number
  spent_points: number
  total: number
  succeeded: number
  failed: number
  pause_reason: string
  created_at: number
  finished_at: number
  items?: GenerationBatchItem[]
}

/** 合成后质检（API.md 12.3） */
export type ComposeQC = {
  expected_duration: number
  duration: number
  width: number
  height: number
  has_audio: boolean
  issues: string[]
}

/** 合成任务状态：0 排队 1 合成中 2 成功 -1 失败 */
export type ComposeStatus = -1 | 0 | 1 | 2

export type ComposeJob = {
  id: number
  user_id: number
  canvas_id: number
  screenplay_id: number
  clips: ComposeClip[]
  subtitles: unknown
  bgm_asset_id: number
  watermark: number
  status: ComposeStatus
  progress: number
  output_asset_id: number
  output_url: string
  duration: number
  error: string
  /** 降级说明：字幕 / 水印未生效、配音语种不一致未混入等 */
  warning?: string
  resolution?: string
  qc?: ComposeQC | null
  /** 低清试听（API.md 25.4）：480p 快速编码，不是正式成片 */
  preview?: boolean
  /** 交付包（API.md 26.2）：成片之外再出母版 / SRT / 对白轨 / 素材清单；预览时忽略 */
  package?: boolean
  /** 交付包各文件；任一文件失败对应字段为空，原因在 warning */
  package_files?: ComposePackageFiles | null
  created_at: number
  started_at: number
  finished_at: number
}

/** 交付包各文件的资产 id 与地址（API.md 26.2） */
export type ComposePackageFiles = {
  master_asset_id?: number
  master_url?: string
  srt_asset_id?: number
  srt_url?: string
  voice_asset_id?: number
  voice_url?: string
  manifest_asset_id?: number
  manifest_url?: string
}

/** ===== 制片报表（API.md 26.3） ===== */

/** 候选 / 分镜图的审片状态：approved 通过、rejected 退回、pending 待审、none 没有素材 */
export type ProductionReviewStatus = 'approved' | 'rejected' | 'pending' | 'none'

export type ProductionShot = {
  no: number
  node_id: string
  line: string
  candidates: number
  approved: number
  rejected: number
  pending: number
  reworks: number
  selected_asset_id: number
  selected_status: ProductionReviewStatus
  enabled: boolean
  image_status: ProductionReviewStatus
  /** 只算成功任务的净结算积分 */
  cost_points: number
  tasks: number
  /** 时间线上的预计秒数 */
  effective_seconds: number
  reject_reasons: ShotReviewReason[] | null
}

export type ProductionTotals = {
  shots: number
  shots_enabled: number
  shots_approved: number
  candidates: number
  reworks: number
  cost_points: number
  failed_tasks: number
  effective_seconds: number
  cost_per_second: number
}

export type ProductionComposes = { total: number, done: number, previews: number, packages: number }

export type ProductionMissing = { no: number, node_id: string, what: string }

export type ProductionReport = {
  canvas_id: number
  title: string
  review_gate: ReviewGate
  locked: boolean
  shots: ProductionShot[] | null
  totals: ProductionTotals
  composes: ProductionComposes
  missing: ProductionMissing[] | null
}

/** ===== 主体库（API.md 10.2，F2） ===== */

/** 主体类型：角色 / 场景 / 道具 */
export type SubjectKind = 'character' | 'scene' | 'prop'

/** 主体参考图：三视图 / 表情表等，label 是视图名 */
export type SubjectRef = { asset_id: number, url: string, label: string }

export type Subject = {
  id: number
  user_id: number
  team_id: number
  kind: SubjectKind
  name: string
  /** 外貌 / 场景描述，用于文生图与任务提示词补充 */
  look: string
  prompt: string
  cover_asset_id: number
  cover_url: string
  refs: SubjectRef[]
  /** 1 团队内共享 */
  shared: 0 | 1
  /** 被引用次数 */
  uses: number
  /** 内容版本（API.md 14.2）：描述 / 参考图等变化时 +1 */
  version?: number
  /** 是否本人创建（团队共享的主体可能不是自己的） */
  mine: boolean
  created_at: number
}

/** POST /user/subject 与 PUT /user/subject/:id 的请求体 */
export type SubjectBody = {
  kind: SubjectKind
  name: string
  look?: string
  prompt?: string
  cover_asset_id?: number
  refs?: SubjectRef[]
  shared?: 0 | 1
}

/** POST /user/subject/:id/generate：一次建 3 个图片任务（node_id 形如 subject-<id>-<label>） */
export type SubjectGenerateResult = { tasks: GenerationTask[] }

/** POST /user/subject/:id/sync：参考图任务完成后写回 refs */
export type SubjectSyncResult = { subject: Subject, refs: SubjectRef[] }

/** ===== 字幕与多语言（API.md 10.4，F5） ===== */

/** GET /langs 的一项 */
export type LangOption = { code: string, label: string }

/** POST /user/subtitle/translate */
export type TranslateResult = { text: string, lang: string }

/** POST /user/screenplay/:id/localize */
export type LocalizeResult = { screenplay: Screenplay, plan: ScreenplayPlan }

/** POST /user/screenplay/:id/dialogue-shots（API.md 25.3）：两人正反打模板 */
export type DialogueShotsRequest = {
  scene: string
  a: string
  b: string
  /** 每镜秒数 3–10 */
  seconds: number
  /** 插到第几镜之前（1 起）；0 = 追加到末尾 */
  insert_at: number
  lines: { speaker: string, text: string, emotion?: string }[]
}
export type DialogueShotsResult = { screenplay: Screenplay, added: number }

/** ===== 关注与榜单（API.md 9.2，M11） ===== */

/** POST /user/author/:id/follow 的响应 */
export type FollowToggleResult = {
  following: boolean
  followers: number
}

/** GET /user/follow/authors 的一行 */
export type FollowedAuthor = {
  id: number
  nickname: string
  works: number
  followers: number
  is_following: boolean
  created_at: number
}

/** 榜单窗口：近 7 天 / 近 30 天 */
export type RankPeriod = 'week' | 'month'

export type RankWorkItem = {
  work: Work
  /** 窗口内被赞数 */
  likes_in_period: number
  views: number
}

export type RankWorks = {
  period: RankPeriod
  items: RankWorkItem[]
}

export type RankAuthorItem = {
  user_id: number
  nickname: string
  works: number
  /** 窗口内被赞数 */
  likes: number
  followers: number
  is_following?: boolean
}

export type RankAuthors = {
  period: RankPeriod
  items: RankAuthorItem[]
}

export type RankSkillItem = {
  skill: Skill
  calls: number
  stars: number
}

export type RankSkills = {
  period: RankPeriod
  items: RankSkillItem[]
}

/** ===== 渠道伙伴计划（API.md 9.3，M12） ===== */

/** mcn 机构 / school 培训机构 / kol 达人 / dev 开发者 / other 其它 */
export type PartnerKind = 'mcn' | 'school' | 'kol' | 'dev' | 'other'

/** 0 待审 1 已通过 2 已驳回 3 已停用 */
export type PartnerStatus = 0 | 1 | 2 | 3

export type Partner = {
  id: number
  name: string
  kind: PartnerKind
  contact: string
  intro: string
  /** 审核通过时生成的 6 位大写专属码 */
  code: string
  /** 返佣比例，0 表示取全局默认 */
  rebate_rate: number
  status: PartnerStatus
  /** 驳回 / 停用原因 */
  remark: string
  customers: number
  paid_users: number
  amount_total: number
  rebate_total: number
  applied_at: number
}

/** 归属客户最近记录（昵称已脱敏） */
export type PartnerCustomerRow = {
  nickname?: string
  /** 部分环境字段名为 user（API.md 9.3），两者都兼容 */
  user?: string
  amount: number
  rebate: number
  created_at: number
}

/** GET /user/partner/me：未申请返回 null */
export type PartnerDashboard = {
  partner: Partner
  /** 推广链接（/partner/:code） */
  link: string
  poster_link?: string
  customers: number
  paid_users: number
  amount_total: number
  rebate_total: number
  /** 可提现金额（人民币元），复用现有提现流程 */
  withdrawable: number
  rebate_rate: number
  recent: PartnerCustomerRow[]
}

/** GET /partner/:code（公开）落地页数据 */
export type PartnerLanding = {
  name: string
  intro: string
  kind?: PartnerKind
  code?: string
  valid: boolean
}

export type PartnerApplyBody = {
  name: string
  kind: PartnerKind
  contact: string
  intro: string
}
