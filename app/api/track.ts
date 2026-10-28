import http from '~/api/http'

export interface TrackEvent {
  /** 事件名，≤ 40 字符（API.md 7.2） */
  name: string
  props?: Record<string, unknown>
  /** Unix 秒 */
  ts?: number
}

export interface TrackBody {
  anon_id: string
  /** 设备指纹；正常路径走请求头 EasyTV-Device，sendBeacon 无法带自定义头时靠它 */
  device?: string
  events: TrackEvent[]
}

/** POST /track：匿名可调，单次最多 20 条 */
export const trackApi = {
  send(body: TrackBody): Promise<any> {
    return http.post('/track', body)
  },
}

export default trackApi
