import http from '~/api/http'

/** 前端应用配置：GET /app/config（匿名） */
export const appApi = {
  config() {
    return http.get('/app/config')
  },
}

export default appApi
