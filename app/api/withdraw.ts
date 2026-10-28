import http from '~/api/http'

/** 渠道返佣提现：POST /user/withdraw，记录 GET /user/withdraw/self */
export const withdrawApi = {
  apply(body: { amount: number, way: string, account_info: string }): Promise<any> {
    return http.post('/user/withdraw', body)
  },

  list(page: number, pageSize: number): Promise<any> {
    return http.get('/user/withdraw/self', { page, page_size: pageSize })
  },
}

export default withdrawApi
