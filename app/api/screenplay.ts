import http from '~/api/http'
import type { ApiResponse, ComposeJob, DialogueShotsRequest, DialogueShotsResult, LocalizeResult, ProductionReport, ReviewGate, Screenplay, ScreenplayBuildResult, ScreenplayEstimate, ScreenplayPlan, ScreenplaySyncResult, Shot, ShotReview, ShotReviewReason, ShotReviewStatus, Timeline, TimelineDetail, TimelineLockResult, TranslateResult } from '~/types/creative'
import { timelineSaveOutcome, type TimelineSaveOutcome } from '~/utils/timeline'

export type ScreenplayModels = { image_model?: string, video_model?: string, audio_model?: string }

/** 成片工作室 · 策划案：API.md 8.2 */
export const screenplayApi = {
  /**
   * 一句话 / 剧本 → 策划案（同步调用文本模型并扣分，限流 10 次/分钟）。
   * use_bible（API.md 27.3）：把项目的剧集设定附在输入前，沿用人物 key、不让不知情角色泄密；episode_no 0 / 不传 = 项目下一集
   */
  create(data: { input: string, target_seconds: number, style?: string, project_id?: number, use_bible?: boolean, episode_no?: number }): Promise<ApiResponse<Screenplay>> {
    return http.post('/user/screenplay', data)
  },

  get(id: number): Promise<ApiResponse<Screenplay>> {
    return http.get(`/user/screenplay/${id}`)
  },

  /** 保存用户修改的 plan（镜头 ≤ 12、角色 ≤ 4、场景 ≤ 4，超限或引用不存在时 message 里说明原因，API.md 24.2） */
  update(id: number, plan: ScreenplayPlan): Promise<ApiResponse<Screenplay>> {
    return http.put(`/user/screenplay/${id}`, { plan })
  },

  /** 预估建画布后各层积分；模型选择与 build 同形，后端未按模型区分时忽略即可 */
  estimate(id: number, models: ScreenplayModels = {}): Promise<ApiResponse<ScreenplayEstimate>> {
    return http.post(`/user/screenplay/${id}/estimate`, models)
  },

  /** 按策划案建画布（只建节点，不下任务）；已建过直接返回已有画布（existing=true） */
  build(id: number, models: ScreenplayModels = {}): Promise<ApiResponse<ScreenplayBuildResult>> {
    return http.post(`/user/screenplay/${id}/build`, models)
  },

  /** 改稿后按镜号同步到既有画布（API.md 24.1）：不重新生成素材、不删节点 */
  sync(id: number, models: ScreenplayModels = {}): Promise<ApiResponse<ScreenplaySyncResult>> {
    return http.post(`/user/screenplay/${id}/build`, { ...models, sync: true })
  },

  /** 整份台词翻译（API.md 10.4）：写入 plan.shots[].lines[lang]，响应新 plan */
  localize(id: number, targetLang: string): Promise<ApiResponse<LocalizeResult>> {
    return http.post(`/user/screenplay/${id}/localize`, { target_lang: targetLang })
  },

  /** 正反打模板（API.md 25.3）：按两人台词生成一组镜头插进策划案；超过 12 镜时 success=false 且策划案不动 */
  dialogueShots(id: number, body: DialogueShotsRequest): Promise<ApiResponse<DialogueShotsResult>> {
    return http.post(`/user/screenplay/${id}/dialogue-shots`, body)
  },
}

/** 字幕翻译（API.md 10.4）：走文本模型，限流 30 次/分钟 */
export const subtitleApi = {
  translate(text: string, targetLang: string): Promise<ApiResponse<TranslateResult>> {
    return http.post('/user/subtitle/translate', { text, target_lang: targetLang })
  },
}

/** 成片工作室 · 合成：API.md 8.2 */
export const composeApi = {
  /** 给了 timeline 就按时间线合成（API.md 12.3），其余旧字段不再生效；preview=true 出 480p 低清试听（API.md 25.4）；package=true 同时出交付包（API.md 26.2，预览时忽略） */
  create(canvasId: number, body: { clip_order?: string[], subtitles?: boolean, voice?: boolean, bgm_asset_id?: number, screenplay_id?: number, lang?: string, subtitle_text?: string, timeline?: Timeline, preview?: boolean, package?: boolean }): Promise<ApiResponse<ComposeJob>> {
    return http.post(`/user/canvas/${canvasId}/compose`, body)
  },

  /** 轮询：status / progress / output_asset_id / output_url / error */
  get(id: number): Promise<ApiResponse<ComposeJob>> {
    return http.get(`/user/compose/${id}`)
  },

  /** 该画布最近 10 次合成 */
  list(canvasId: number): Promise<ApiResponse<ComposeJob[]>> {
    return http.get('/user/compose', { canvas_id: canvasId })
  },
}

export default screenplayApi

/** 镜头视图与成片时间线：API.md 12.1 / 12.2 */
export const timelineApi = {
  shots(canvasId: number): Promise<ApiResponse<{ shots: Shot[] }>> {
    return http.get(`/user/canvas/${canvasId}/shots`)
  },

  /** 没保存过返回缺省时间线（version=0） */
  get(canvasId: number): Promise<ApiResponse<TimelineDetail>> {
    return http.get(`/user/canvas/${canvasId}/timeline`)
  },

  /** 乐观锁：首次保存 version=0，冲突时 success=false */
  save(canvasId: number, version: number, timeline: Timeline): Promise<ApiResponse<{ version: number, timeline: Timeline }>> {
    return http.put(`/user/canvas/${canvasId}/timeline`, { version, timeline })
  },

  /** 定版锁（API.md 25.6）：没保存过时间线时 success=false，message 原样提示 */
  lock(canvasId: number, locked: boolean): Promise<ApiResponse<TimelineLockResult>> {
    return http.post(`/user/canvas/${canvasId}/timeline/lock`, { locked })
  },

  /** 候选通过 / 退回 / 撤销（API.md 25.5）；clear 时 review 为 null */
  review(canvasId: number, body: { node_id: string, asset_id: number, status: ShotReviewStatus, reason?: ShotReviewReason | '', note?: string }): Promise<ApiResponse<{ asset_id: number, review: ShotReview | null }>> {
    return http.post(`/user/canvas/${canvasId}/review`, body)
  },

  /**
   * 改审批门禁（API.md 26.1）：门禁随时间线保存，所以先 GET 拿最新版本与整份时间线，只改 review_gate 再 PUT；
   * 乐观锁冲突（别处刚存过）重新 GET 再存一次；时间线已定版返回 locked，由调用方禁用选择器。
   */
  async saveReviewGate(canvasId: number, gate: ReviewGate): Promise<{ outcome: TimelineSaveOutcome, message: string, version: number, timeline: Timeline | null }> {
    let lastMessage = ''
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await this.get(canvasId)
      if (!current?.success || !current.data)
        return { outcome: 'error', message: current?.message || '', version: 0, timeline: null }
      if (current.data.locked)
        return { outcome: 'locked', message: '', version: current.data.version, timeline: current.data.timeline }
      const res = await this.save(canvasId, current.data.version, { ...current.data.timeline, review_gate: gate })
      const outcome = timelineSaveOutcome(res)
      if (outcome === 'ok' && res?.data)
        return { outcome, message: '', version: res.data.version, timeline: res.data.timeline }
      lastMessage = res?.message || ''
      if (outcome !== 'conflict')
        return { outcome, message: lastMessage, version: current.data.version, timeline: current.data.timeline }
    }
    return { outcome: 'conflict', message: lastMessage, version: 0, timeline: null }
  },
}

/** 制片报表（API.md 26.3）：镜头候选 / 审片 / 成本 / 合成统计与「距离定版还缺」 */
export const reportApi = {
  production(canvasId: number): Promise<ApiResponse<ProductionReport>> {
    return http.get(`/user/canvas/${canvasId}/production-report`)
  },
}
