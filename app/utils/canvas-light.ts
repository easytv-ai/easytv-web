export type LightPreset = {
  id: string
  label: string
  cover: string
  kelvin: number
  brightness: number
  lx: string
  ly: string
  /** 点选后填进输入框的打光描述 */
  note: string
}

// 封面放在 /images/canvas-light：public 下不能有 canvas 目录，否则静态服务把 /canvas 301 到 /canvas/，
// 和 trailing-slash 中间件互相重定向，画布页打不开
export const LIGHT_PRESETS: LightPreset[] = [
  { id: 'sun', label: '自然阳光', cover: '/images/canvas-light/light-sun.webp', kelvin: 5500, brightness: 16, lx: '72%', ly: '14%', note: '面部暖色阳光，阴影清晰自然，整体晴朗明亮' },
  { id: 'rim', label: '背光轮廓', cover: '/images/canvas-light/light-rim.webp', kelvin: 6500, brightness: 6, lx: '88%', ly: '40%', note: '强烈轮廓光勾边，正面稍暗，发丝边缘发亮' },
  { id: 'candle', label: '烛光暖意', cover: '/images/canvas-light/light-candle.webp', kelvin: 2200, brightness: 8, lx: '28%', ly: '70%', note: '暖橙色点光源，近处亮四周暗，氛围亲密' },
  { id: 'window', label: '窗户侧光', cover: '/images/canvas-light/light-window.webp', kelvin: 4800, brightness: 12, lx: '8%', ly: '36%', note: '一侧窗户柔光，明暗分界自然' },
  { id: 'spot', label: '强聚光', cover: '/images/canvas-light/light-spot.webp', kelvin: 4000, brightness: 24, lx: '50%', ly: '8%', note: '一束聚光打亮主体，背景压暗' },
  { id: 'top', label: '环境顶光', cover: '/images/canvas-light/light-top.webp', kelvin: 5600, brightness: 10, lx: '50%', ly: '0%', note: '均匀顶光，阴影短而柔，整体提亮' },
  { id: 'golden', label: '黄金时刻', cover: '/images/canvas-light/light-golden.webp', kelvin: 3000, brightness: 18, lx: '18%', ly: '58%', note: '低角度金色暖光，皮肤与边缘偏金' },
  { id: 'blue', label: '蓝调时刻', cover: '/images/canvas-light/light-blue.webp', kelvin: 9000, brightness: 8, lx: '60%', ly: '20%', note: '面部冷色光，环境冷色背景，整体蓝色氛围' },
  { id: 'overcast', label: '阴天柔光', cover: '/images/canvas-light/light-overcast.webp', kelvin: 6200, brightness: 4, lx: '50%', ly: '10%', note: '阴天漫射柔光，阴影很轻，层次均匀' },
  { id: 'moon', label: '月光', cover: '/images/canvas-light/light-moon.webp', kelvin: 7800, brightness: -8, lx: '64%', ly: '10%', note: '清冷月光，对比柔和，整体偏青蓝' },
]

export const LIGHT_KELVIN_MIN = 2000
export const LIGHT_KELVIN_MAX = 12000
export const LIGHT_BRIGHTNESS_MIN = -40
export const LIGHT_BRIGHTNESS_MAX = 80

/** 粗略把色温映射成灯光颜色，2000K 暖橙，6500K 接近白，更高偏蓝 */
export function kelvinTint(kelvin: number) {
  const k = Math.min(LIGHT_KELVIN_MAX, Math.max(LIGHT_KELVIN_MIN, kelvin))
  const t = (k - LIGHT_KELVIN_MIN) / (LIGHT_KELVIN_MAX - LIGHT_KELVIN_MIN)
  const r = Math.round(255 - t * 40)
  const g = Math.round(160 + t * 50)
  const b = Math.round(70 + t * 185)
  return { r, g, b, css: `rgb(${r}, ${g}, ${b})` }
}

export function lightOverlay(kelvin: number, brightness: number, lx = '30%', ly = '18%') {
  const tint = kelvinTint(kelvin)
  const alpha = 0.22 + Math.max(0, brightness) / 260
  return {
    '--lx': lx,
    '--ly': ly,
    '--tint': `rgba(${tint.r}, ${tint.g}, ${tint.b}, ${alpha})`,
    filter: `brightness(${1 + brightness / 140})`,
  } as Record<string, string>
}

export function buildLightPrompt(opts: {
  preset?: LightPreset | null
  brightness: number
  kelvin: number
  note: string
}) {
  const parts = ['重新打光，保留主体、构图和原有风格']
  const note = opts.note.trim() || opts.preset?.note || ''
  if (note)
    parts.push(note)
  const sign = opts.brightness > 0 ? `+${opts.brightness}` : `${opts.brightness}`
  parts.push(`亮度 ${sign}，色温 ${opts.kelvin}K`)
  return `${parts.join('。')}。`
}
