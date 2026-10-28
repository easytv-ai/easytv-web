/**
 * 服务端时钟偏移：倒计时一律用 now() 而不是 Date.now()，这样校准后所有倒计时同时受益。
 * offsetMs = 服务端时间 - 本机时间。calibrate(dateHeader) 可拿任意 API 响应的 Date 头来校准；
 * 跨域时浏览器默认不暴露 Date 头（需要服务端 Access-Control-Expose-Headers: Date），拿不到就保持 0。
 */
export function useServerClock() {
  const offsetMs = useState('server-clock-offset-ms', () => 0)

  function now(): number {
    return Date.now() + offsetMs.value
  }

  function calibrate(dateHeader: string | null | undefined, requestStartedAt = Date.now()) {
    const server = Date.parse(String(dateHeader ?? ''))
    if (!Number.isFinite(server))
      return false
    // Date 头只有秒级精度，取请求发起与返回的中点粗略抵消网络延迟
    const local = Math.round((requestStartedAt + Date.now()) / 2)
    offsetMs.value = server - local
    return true
  }

  /** 用接口返回的服务器 Unix 秒校准（GET /app/config 的 server_time） */
  function calibrateFromUnix(serverSeconds: number | null | undefined, requestStartedAt = Date.now()) {
    const seconds = Number(serverSeconds)
    if (!Number.isFinite(seconds) || seconds <= 0)
      return false
    const local = Math.round((requestStartedAt + Date.now()) / 2)
    offsetMs.value = seconds * 1000 - local
    return true
  }

  return { offsetMs, now, calibrate, calibrateFromUnix }
}
