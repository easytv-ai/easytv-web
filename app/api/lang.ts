import http from '~/api/http'
import type { ApiResponse, LangOption } from '~/types/creative'

/** 支持的字幕 / 配音语种：API.md 10.4（zh/en/ja/ko/es/fr，可由后台配） */
export const langApi = {
  list(): Promise<ApiResponse<LangOption[]>> {
    return http.get('/langs')
  },
}

export default langApi
