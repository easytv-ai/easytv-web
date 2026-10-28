/**
 * 前端事件上报：track(name, props) 先进缓冲，攒到 10 条或 2 秒后批量 POST /track（单次最多 20 条）。
 * 页面隐藏 / 卸载时用 navigator.sendBeacon 把剩余事件送出去（不能带自定义头，所以 body 里带 anon_id 与 device）。
 * 事件名见 API.md 7.4：page_view、landing_cta、register_start、watch_clone_click、share_click、checkin_click。
 */
import trackApi, { type TrackBody, type TrackEvent } from '~/api/track'
import { getAnonId, getDeviceId } from '~/utils/device-id'
import { authUserHeaders } from '~/utils/auth-user'

const MAX_BUFFER = 10
const FLUSH_DELAY = 2000
const MAX_PER_REQUEST = 20
const MAX_NAME_LEN = 40

const buffer: TrackEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let listenersBound = false
let resolvedTrackUrl = ''

/** 在有 Nuxt 上下文时解析一次，之后 sendBeacon 在事件回调里直接用 */
function resolveTrackUrl(): string {
  if (resolvedTrackUrl)
    return resolvedTrackUrl
  try {
    const base = String(useRuntimeConfig().public.apiBaseUrl ?? '').trim().replace(/\/$/, '')
    const origin = !base || /^https?:\/\//i.test(base) ? base : `http://${base}`
    resolvedTrackUrl = `${origin}/track`
  }
  catch {
    resolvedTrackUrl = '/track'
  }
  return resolvedTrackUrl
}

function buildBody(events: TrackEvent[]): TrackBody {
  return { anon_id: getAnonId(), device: getDeviceId(), events }
}

function takeBatch(): TrackEvent[] {
  return buffer.splice(0, MAX_PER_REQUEST)
}

async function flushAsync() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  while (buffer.length) {
    const events = takeBatch()
    try {
      await trackApi.send(buildBody(events))
    }
    catch {
      // 上报失败直接丢弃，不影响业务
    }
  }
}

/** 页面即将不可见：同步用 sendBeacon 送出，浏览器不支持时退回 fetch keepalive */
function flushBeacon() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!buffer.length)
    return
  const url = resolveTrackUrl()
  while (buffer.length) {
    const body = JSON.stringify(buildBody(takeBatch()))
    let sent = false
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        sent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      }
      catch {
        sent = false
      }
    }
    if (!sent) {
      try {
        void fetch(url, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', ...authUserHeaders() },
          body,
        })
      }
      catch {
        // 忽略
      }
    }
  }
}

function bindListeners() {
  if (listenersBound || !import.meta.client)
    return
  listenersBound = true
  window.addEventListener('pagehide', flushBeacon)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      flushBeacon()
  })
}

function push(name: string, props?: Record<string, unknown>) {
  if (!import.meta.client)
    return
  const cleanName = String(name ?? '').trim().slice(0, MAX_NAME_LEN)
  if (!cleanName)
    return
  bindListeners()
  buffer.push({ name: cleanName, props: props ?? undefined, ts: Math.floor(Date.now() / 1000) })
  if (buffer.length >= MAX_BUFFER) {
    void flushAsync()
    return
  }
  if (!timer)
    timer = setTimeout(() => void flushAsync(), FLUSH_DELAY)
}

export function useTrack() {
  if (import.meta.client)
    resolveTrackUrl()
  return {
    track: push,
    flush: flushAsync,
  }
}
