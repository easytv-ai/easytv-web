import http from '~/api/http'
import type { ApiResponse, Notification, NotificationPrefs, PageQuery } from '~/types/creative'

/** 站内通知（API.md 1.9） */
export const notificationApi = {
  list(query: PageQuery & { unread?: 1 } = {}): Promise<ApiResponse<{ items: Notification[], total: number, unread_count: number }>> {
    return http.get('/user/notification', query)
  },

  /** 不传 ids 表示全部已读 */
  read(ids?: number[]): Promise<ApiResponse<{ unread_count: number }>> {
    return http.post('/user/notification/read', ids?.length ? { ids } : {})
  },

  /** 通知偏好（设置 · 通知） */
  prefs(): Promise<ApiResponse<NotificationPrefs>> {
    return http.get('/user/notification/prefs')
  },

  updatePrefs(data: { disabled_types: string[], email_enabled: boolean }): Promise<ApiResponse<NotificationPrefs>> {
    return http.put('/user/notification/prefs', data)
  },
}

export default notificationApi
