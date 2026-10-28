import http from '~/api/http'
import type { ApiResponse } from '~/types/creative'

/** 账号自助操作（API.md 2.1） */
export const accountApi = {
  /** 注销账号：有密码的账号必须带密码；成功后令牌失效 */
  deactivate(password: string): Promise<ApiResponse<null>> {
    return http.post('/user/self/deactivate', { password })
  },
}

export default accountApi
