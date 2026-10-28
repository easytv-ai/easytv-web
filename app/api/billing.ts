import http from '~/api/http'
import type {
  ApiResponse,
  BillingCatalog,
  BillingQuote,
  BillingQuoteRequest,
  ModelPrice,
  Order,
  OrderCreateResult,
  PageQuery,
  Paged,
  PayIntent,
  PointsLog,
  PointsLot,
  Wallet,
} from '~/types/creative'

/** 付费域：API.md 6.2 */
export const billingApi = {
  /** 定价页数据（计划、积分包、促销、可用支付方式） */
  catalog(): Promise<ApiResponse<BillingCatalog>> {
    return http.get('/billing/plans')
  },

  modelPrices(): Promise<ApiResponse<ModelPrice[]>> {
    return http.get('/billing/model-prices')
  },

  /** 服务端报价；带登录态时积分包按会员价 */
  quote(req: BillingQuoteRequest): Promise<ApiResponse<BillingQuote>> {
    return http.post('/billing/quote', req)
  },

  wallet(): Promise<ApiResponse<Wallet>> {
    return http.get('/user/wallet')
  },

  pointsLog(query: PageQuery & { type?: string } = {}): Promise<ApiResponse<Paged<PointsLog>>> {
    return http.get('/user/points/log', query)
  },

  pointsLots(): Promise<ApiResponse<PointsLot[]>> {
    return http.get('/user/points/lots')
  },

  /** 下单并发起支付 */
  createOrder(req: BillingQuoteRequest & { payment_method: string }): Promise<ApiResponse<OrderCreateResult>> {
    return http.post('/user/order', req)
  },

  /** 对待支付订单重新发起支付（换渠道） */
  payOrder(id: number, paymentMethod: string): Promise<ApiResponse<{ order: Order, pay: PayIntent }>> {
    return http.post(`/user/order/${id}/pay`, { payment_method: paymentMethod })
  },

  orders(query: PageQuery & { status?: string } = {}): Promise<ApiResponse<Paged<Order>>> {
    return http.get('/user/order', query)
  },

  /** 支付页轮询 */
  order(id: number): Promise<ApiResponse<Order>> {
    return http.get(`/user/order/${id}`)
  },

  closeOrder(id: number): Promise<ApiResponse<null>> {
    return http.post(`/user/order/${id}/close`)
  },
}

export default billingApi
