import http from '~/api/http'
import type { ApiResponse, Bible, BibleDoc, Episode, EpisodeRecordResult, ImpactQuery, ImpactResult } from '~/types/creative'

/** 剧集圣经与集目录：API.md 27 */
export const bibleApi = {
  /** 没建过返回空结构、revision=0、title 取项目名 */
  get(projectId: number): Promise<ApiResponse<BibleDoc>> {
    return http.get(`/user/project/${projectId}/bible`)
  },

  /** 乐观锁保存（首次 revision 传 0）；冲突 / 引用不存在等原因在 message 里 */
  save(projectId: number, revision: number, bible: Bible): Promise<ApiResponse<{ project_id: number, revision: number, bible: Bible }>> {
    return http.put(`/user/project/${projectId}/bible`, { revision, bible })
  },

  /** 改设定前查影响：人物 / 道具 / 事实 key 或任意文本 → 受影响的集 / 场 / 镜 */
  impact(projectId: number, query: ImpactQuery): Promise<ApiResponse<ImpactResult>> {
    return http.post(`/user/project/${projectId}/bible/impact`, query)
  },

  /** 集目录：项目下的策划案按集号排 */
  episodes(projectId: number): Promise<ApiResponse<{ project_id: number, episodes: Episode[] }>> {
    return http.get(`/user/project/${projectId}/episodes`)
  },

  /** 改集号（0 = 未编号，≤ 999） */
  setEpisode(screenplayId: number, episodeNo: number): Promise<ApiResponse<{ id: number, episode_no: number }>> {
    return http.put(`/user/screenplay/${screenplayId}/episode`, { episode_no: episodeNo })
  },

  /** 用文本模型把本集策划案总结成连续性记录并并入圣经（按文本模型单价扣一次分） */
  record(screenplayId: number): Promise<ApiResponse<EpisodeRecordResult>> {
    return http.post(`/user/screenplay/${screenplayId}/record`)
  },
}

export default bibleApi
