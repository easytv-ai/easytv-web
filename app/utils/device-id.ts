/**
 * 匿名标识与设备指纹：都存 localStorage，首次访问时在客户端随机生成（32 位 hex）。
 * - anon_id：注册前的事件归到同一个匿名人，注册时随 attr.anon_id 带给后端做关联
 * - device_id：随每个请求走 `EasyTV-Device` 头，后端用来防刷（同设备重复注册不绑邀请等）
 * 服务端渲染时没有 localStorage，统一返回空串。
 */
export const ANON_ID_STORAGE_KEY = 'easytv_anon_id'
export const DEVICE_ID_STORAGE_KEY = 'easytv_device_id'

function randomHex32(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  }
  else {
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function readOrCreate(key: string): string {
  if (!import.meta.client)
    return ''
  try {
    const existing = String(localStorage.getItem(key) ?? '').trim()
    if (/^[0-9a-f]{32}$/.test(existing))
      return existing
    const created = randomHex32()
    localStorage.setItem(key, created)
    return created
  }
  catch {
    // 隐私模式等场景 localStorage 不可用：退化为本次会话内的临时值
    return randomHex32()
  }
}

export function getAnonId(): string {
  return readOrCreate(ANON_ID_STORAGE_KEY)
}

export function getDeviceId(): string {
  return readOrCreate(DEVICE_ID_STORAGE_KEY)
}
