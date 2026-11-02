import http from '~/api/http'
import type { ApiResponse, Asset, AssetType, PageQuery, Paged, AssetRef } from '~/types/creative'

/** 资产：API.md 2.1 */
export const assetApi = {
  list(query: PageQuery & { type?: AssetType, project_id?: number, source?: string, keyword?: string } = {}): Promise<ApiResponse<Paged<Asset>>> {
    return http.get('/user/asset', query)
  },

  /** multipart 上传，字段 file；可选 project_id */
  get(id: number): Promise<ApiResponse<Asset>> {
    return http.get(`/user/asset/${id}`)
  },

  upload(file: File, projectId?: number): Promise<ApiResponse<Asset>> {
    const form = new FormData()
    form.append('file', file, file.name)
    if (projectId)
      form.append('project_id', String(projectId))
    return http.post('/user/asset/upload', form)
  },

  /** 仍被画布 / 主体 / 作品 / 时间线引用时不删，返回 success=false 且 data={ reason:'in_use', refs }；确认后 force=true 再删（API.md 14.1） */
  remove(id: number, force = false): Promise<ApiResponse<null | { reason?: string, refs?: AssetRef[] }>> {
    return http.delete(`/user/asset/${id}${force ? '?force=1' : ''}`)
  },

  refs(id: number): Promise<ApiResponse<{ refs: AssetRef[] }>> {
    return http.get(`/user/asset/${id}/refs`)
  },

  trash(query: PageQuery = {}): Promise<ApiResponse<Paged<Asset & { deleted_at: string }>>> {
    return http.get('/user/asset/trash', query)
  },

  restore(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/asset/${id}/restore`)
  },

  /** 跨画布粘贴时把别的空间的素材引入当前空间（API.md 36.1）：same 原样可用、copied 改指 to、missing 去掉 id 只留地址 */
  importAssets(ids: number[]): Promise<ApiResponse<AssetImportResult>> {
    return http.post('/user/asset/import', { asset_ids: ids })
  },
}

export type AssetImportItem = { from: number, to: number, status: 'same' | 'copied' | 'missing' }
export type AssetImportResult = { items: AssetImportItem[], copied: number, missing: number }

export default assetApi
