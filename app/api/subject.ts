import http from '~/api/http'
import type { ApiResponse, PageQuery, Paged, Subject, SubjectBody, SubjectGenerateResult, SubjectKind, SubjectSyncResult } from '~/types/creative'

/** 主体库（角色 / 场景 / 道具）：API.md 10.2 */
export const subjectApi = {
  /** 我的 + 团队共享的主体 */
  list(query: PageQuery & { kind?: SubjectKind, keyword?: string } = {}): Promise<ApiResponse<Paged<Subject>>> {
    return http.get('/user/subject', query)
  },

  create(body: SubjectBody): Promise<ApiResponse<Subject>> {
    return http.post('/user/subject', body)
  },

  update(id: number, body: Partial<SubjectBody>): Promise<ApiResponse<Subject>> {
    return http.put(`/user/subject/${id}`, body)
  },

  /** 软删 */
  remove(id: number): Promise<ApiResponse<null>> {
    return http.delete(`/user/subject/${id}`)
  },

  /** 按 look 生成三视图：一次建 3 个图片任务，node_id 形如 subject-<id>-<label>，不是画布节点，按 id 轮询即可 */
  generate(id: number, model?: string): Promise<ApiResponse<SubjectGenerateResult>> {
    return http.post(`/user/subject/${id}/generate`, model ? { model } : {})
  },

  /** 三视图任务全部结束后调用，把结果写回主体 refs */
  sync(id: number): Promise<ApiResponse<SubjectSyncResult>> {
    return http.post(`/user/subject/${id}/sync`)
  },

  /** 版本快照（新的在前，API.md 14.2） */
  versions(id: number): Promise<ApiResponse<{ version: number, versions: Array<Subject & { subject_id: number }> }>> {
    return http.get(`/user/subject/${id}/versions`)
  },

  /** 用已有图片资产直接建主体 */
  fromAsset(body: { asset_id: number, kind: SubjectKind, name?: string, look?: string }): Promise<ApiResponse<Subject>> {
    return http.post('/user/subject/from-asset', body)
  },
}

export default subjectApi
