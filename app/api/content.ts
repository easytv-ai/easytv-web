import http from '~/api/http'
import type { ApiResponse, PageQuery, Paged } from '~/types/creative'

export type Banner = {
  id: number
  title: string
  subtitle: string
  tag: string
  cover_url: string
  video_url: string
  link_url: string
  cta: string
  sort_order: number
}

export type Notice = {
  id: number
  title: string
  content: string
  type: 'system' | 'activity'
  pinned: boolean
  published_at: number
  created_at: number
}

export type ContentCategory = {
  id: number
  name: string
  scope: 'work' | 'skill'
  sort_order: number
}

/** 内容运营（公开）：首页轮播、公告、分类 */
export const contentApi = {
  /** 前台筛选标签（仅启用，按 sort_order 升序） */
  categories(scope: 'work' | 'skill'): Promise<ApiResponse<ContentCategory[]>> {
    return http.get('/category', { scope })
  },

  banners(): Promise<ApiResponse<Banner[]>> {
    return http.get('/banner')
  },

  notices(query: PageQuery = {}): Promise<ApiResponse<Paged<Notice>>> {
    return http.get('/notice', query)
  },

  notice(id: number): Promise<ApiResponse<Notice>> {
    return http.get(`/notice/${id}`)
  },
}

export default contentApi
