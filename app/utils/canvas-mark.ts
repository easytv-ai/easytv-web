import { expandRefTokens } from '~/utils/canvas-autolink'
import { expandCameraTokens } from '~/utils/canvas-node-kinds'

/** 画布「标记」：把已有图片资产和点击坐标交给看图模型，认出该点上的物体并落框。 */

export type CanvasMarkBox = {
  x: number
  y: number
  w: number
  h: number
}

export type CanvasMarkElement = {
  id: string
  name: string
  sourceNodeId: string
  box: CanvasMarkBox
}

export type CanvasMarkPick = {
  open: boolean
  ownerId: string
  analyzingId: string
  /** 进入本轮标记前已有的元素 id，画面上不画这些旧框 */
  baselineIds: string[]
}

export function emptyMarkPick(): CanvasMarkPick {
  return {
    open: false,
    ownerId: '',
    analyzingId: '',
    baselineIds: [],
  }
}

export function newMarkId() {
  return `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const MARK_NAME_MAX = 16

/** 点选识别只看点击周围这一块，避免整图里更显眼的人被认成点击对象 */
export const MARK_HIT_CROP = 0.42

/**
 * 以点击为中心裁一块正方形，贴边时往画幅里收。
 * 返回的是原图上的归一化范围。
 */
export function markHitCrop(x = 0.5, y = 0.5, size = MARK_HIT_CROP): CanvasMarkBox {
  const w = Math.min(1, Math.max(0.08, size))
  const h = w
  return {
    x: Math.min(1 - w, Math.max(0, clamp01(x) - w / 2)),
    y: Math.min(1 - h, Math.max(0, clamp01(y) - h / 2)),
    w,
    h,
  }
}

/** 原图上的点击点，换成裁图里的归一化坐标 */
export function markHitLocalPoint(crop: CanvasMarkBox, x: number, y: number) {
  return {
    x: clamp01((clamp01(x) - crop.x) / Math.max(crop.w, 0.0001)),
    y: clamp01((clamp01(y) - crop.y) / Math.max(crop.h, 0.0001)),
  }
}

/** 裁图里的框换回原图坐标 */
export function mapMarkBox(crop: CanvasMarkBox, local: CanvasMarkBox): CanvasMarkBox {
  const x = clamp01(crop.x + local.x * crop.w)
  const y = clamp01(crop.y + local.y * crop.h)
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0.02, local.w * crop.w)),
    h: Math.min(1 - y, Math.max(0.02, local.h * crop.h)),
  }
}

/**
 * 节点画面是 object-fit: cover，点击落在显示框上，要换算成原图像素坐标。
 * 宽高对不上时，点在被裁掉的一侧会收进画面里。
 */
export function displayedClickToImage(x: number, y: number, viewW: number, viewH: number, imgW: number, imgH: number) {
  if (!(viewW > 0 && viewH > 0 && imgW > 0 && imgH > 0))
    return { x: clamp01(x), y: clamp01(y) }
  const scale = Math.max(viewW / imgW, viewH / imgH)
  const dispW = imgW * scale
  const dispH = imgH * scale
  return {
    x: clamp01((x * viewW - (viewW - dispW) / 2) / dispW),
    y: clamp01((y * viewH - (viewH - dispH) / 2) / dispH),
  }
}

/**
 * 点选识别指令：整张原图直接交给看图模型，只报点击坐标，不在浏览器里读像素。
 * 中文界面出中文，其他语言按界面语言起名。
 */
export function markHitInstruction(x = 0.5, y = 0.5, locale?: string) {
  const px = clamp01(x).toFixed(3)
  const py = clamp01(y).toFixed(3)
  const lines = [
    '这是一张完整图片。用户点击了上面的一个点。',
    `点击位置的归一化坐标 x=${px}、y=${py}（左上角 0,0，右下角 1,1）。`,
    '请只识别这个点压住的那一个物体。旁边更显眼的人、车、景物都不要认。',
    '只返回一行 JSON，不要代码块、不要解释：',
    '{"name":"2到8个字的名称","box":{"x":0.1,"y":0.2,"w":0.3,"h":0.4}}',
    'box 是该物体在整张图上的外接矩形，x、y 是左上角，w、h 是宽高，都是 0 到 1，必须包住点击点，并尽量贴着物体边缘。',
  ]
  const code = (locale || '').toLowerCase()
  const lang = MARK_HIT_LANG[code.split('-')[0] || '']
  if (code === 'zh-tw')
    lines.push('名称用繁体中文。')
  else if (lang)
    lines.push(`Name the object under the click in ${lang}, 2–6 words. Keep the JSON shape.`)
  return lines.join('\n')
}

/**
 * 解析裁图上的识别结果。名称和框必须是同一处：框包不住点击点就整条丢掉，
 * 不能把旁边物体的名字配到点击位置上。
 */
export function parseMarkHit(raw: string, x = 0.5, y = 0.5): { name: string, box: CanvasMarkBox } | null {
  const data = readMarkHitJson(raw)
  if (!data)
    return null
  const name = cleanMarkName(data.name)
  const box = readMarkHitBox(data.box)
  const px = clamp01(x)
  const py = clamp01(y)
  if (!name || !box || !markBoxNearPoint(box, px, py))
    return null
  return { name, box: coverMarkPoint(box, px, py) }
}

const MARK_HIT_LANG: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  fr: 'French',
  ru: 'Russian',
  vi: 'Vietnamese',
}

function clamp01(value: number) {
  if (!Number.isFinite(value))
    return 0
  return Math.min(1, Math.max(0, value))
}

function cleanMarkName(value: unknown) {
  const line = String(value ?? '').split(/\n/)[0] || ''
  return Array.from(line
    .replace(/^[\s"'“”‘’「」『』《》【】（）()[\]：:.。!！?？,，、]+/, '')
    .replace(/[\s"'“”‘’「」『』《》【】（）()[\]：:.。!！?？,，、]+$/, '')
    .trim())
    .slice(0, MARK_NAME_MAX)
    .join('')
    .trim()
}

function readMarkHitJson(raw: string): { name?: unknown, box?: unknown } | null {
  const text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start)
    return null
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { name?: unknown, box?: unknown }
    return data && typeof data === 'object' ? data : null
  }
  catch {
    return null
  }
}

function readMarkHitBox(value: unknown): CanvasMarkBox | null {
  if (!value || typeof value !== 'object')
    return null
  const row = value as Record<string, unknown>
  let x = Number(row.x)
  let y = Number(row.y)
  let w = Number(row.w)
  let h = Number(row.h)
  if (![x, y, w, h].every(Number.isFinite))
    return null
  if (Math.max(x, y, w, h) > 1.5) {
    x /= 100
    y /= 100
    w /= 100
    h /= 100
  }
  w = Math.min(1, Math.max(0.04, w))
  h = Math.min(1, Math.max(0.04, h))
  if (w > 0.92 && h > 0.92)
    return null
  x = Math.min(1 - w, Math.max(0, x))
  y = Math.min(1 - h, Math.max(0, y))
  return { x, y, w, h }
}

function markBoxNearPoint(box: CanvasMarkBox, x: number, y: number) {
  const pad = 0.08
  return x >= box.x - pad && y >= box.y - pad && x <= box.x + box.w + pad && y <= box.y + box.h + pad
}

function coverMarkPoint(box: CanvasMarkBox, x: number, y: number): CanvasMarkBox {
  if (x >= box.x && y >= box.y && x <= box.x + box.w && y <= box.y + box.h)
    return box
  let left = box.x
  let top = box.y
  let right = box.x + box.w
  let bottom = box.y + box.h
  left = Math.min(left, x)
  top = Math.min(top, y)
  right = Math.max(right, x)
  bottom = Math.max(bottom, y)
  left = clamp01(left)
  top = clamp01(top)
  right = clamp01(Math.max(right, left + 0.04))
  bottom = clamp01(Math.max(bottom, top + 0.04))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** 识别失败时的兜底：在点击处落一个固定大小的框，超出画幅时往里收 */
export function placeMarkBox(x = 0.5, y = 0.5): CanvasMarkBox {
  const w = 0.26
  const h = 0.26
  return {
    x: Math.min(1 - w, Math.max(0, x - w / 2)),
    y: Math.min(1 - h, Math.max(0, y - h / 2)),
    w,
    h,
  }
}

export const MARK_TOKEN_RE = /\{\{mark:([a-zA-Z0-9_-]+)\}\}/g

export function markToken(id?: string) {
  const value = String(id || '').trim()
  return value ? `{{mark:${value}}}` : ''
}

export function markIdsInPrompt(prompt?: string) {
  const ids: string[] = []
  const re = new RegExp(MARK_TOKEN_RE.source, 'g')
  const src = String(prompt || '')
  let match: RegExpExecArray | null
  while ((match = re.exec(src))) {
    if (match[1])
      ids.push(match[1])
  }
  return ids
}

/** 标签一律追加到当前文案末尾 */
export function insertMarkToken(prompt: string, id: string) {
  const token = markToken(id)
  const src = String(prompt || '')
  if (!token || src.includes(token))
    return { prompt: src, caret: src.length }
  return {
    prompt: src + token,
    caret: src.length + token.length,
  }
}

export function stripMarkToken(prompt: string, id: string) {
  const token = markToken(id)
  if (!token)
    return String(prompt || '')
  return String(prompt || '').split(token).join('')
}

export function expandMarkTokens(prompt?: string, items?: CanvasMarkElement[] | null) {
  const names = new Map((items || []).map(item => [item.id, item.name]))
  return String(prompt || '').replace(new RegExp(MARK_TOKEN_RE.source, 'g'), (_all, id: string) => names.get(id) || '')
}

/**
 * 标记画布 → 局部修改蒙版（纯函数，按网格处理）。
 * 标记工具现在画的是细线 / 矩形边框 / 箭头 / 文字，直接把画过的像素当蒙版只会重绘一圈线。
 * 这里把「圈起来的区域」填满（从边缘泛洪，走不到的未标记格子就是被圈住的），
 * 再把线条向外膨胀 radius 格，让箭头 / 涂抹指到的地方也带上周边。
 * marked: 网格上是否画过（1 画过），返回同尺寸的蒙版（1 要改）。
 */
export function markGridToMask(marked: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const n = w * h
  const outside = new Uint8Array(n)
  const stack: number[] = []
  const visit = (i: number) => {
    if (!marked[i] && !outside[i]) {
      outside[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) {
    visit(x)
    visit((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    visit(y * w)
    visit(y * w + w - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    if (x > 0)
      visit(i - 1)
    if (x < w - 1)
      visit(i + 1)
    if (i >= w)
      visit(i - w)
    if (i < n - w)
      visit(i + w)
  }
  const mask = new Uint8Array(n)
  const r = Math.max(0, Math.round(radius))
  for (let i = 0; i < n; i++) {
    if (!outside[i] && !marked[i]) {
      mask[i] = 1
      continue
    }
    if (!marked[i])
      continue
    const cx = i % w
    const cy = (i - cx) / w
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy
      if (y < 0 || y >= h)
        continue
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx
        if (x < 0 || x >= w || dx * dx + dy * dy > r * r)
          continue
        mask[y * w + x] = 1
      }
    }
  }
  return mask
}

/** 涂抹擦除：只膨胀画过的像素，不把封闭区域整块填满 */
export function dilateMarked(marked: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const n = w * h
  const out = new Uint8Array(n)
  const r = Math.max(0, Math.round(radius))
  for (let i = 0; i < n; i++) {
    if (!marked[i])
      continue
    if (!r) {
      out[i] = 1
      continue
    }
    const cx = i % w
    const cy = (i - cx) / w
    for (let dy = -r; dy <= r; dy++) {
      const y = cy + dy
      if (y < 0 || y >= h)
        continue
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx
        if (x < 0 || x >= w || dx * dx + dy * dy > r * r)
          continue
        out[y * w + x] = 1
      }
    }
  }
  return out
}

/**
 * 发给模型前把提示词里的占位符都展开：{{cam:id}} → 运镜描述，{{mark:id}} → 元素名，
 * {{ref:素材名}} → @素材名（API.md 31.2）。所有提交提示词的地方都走这里，避免占位符原样发给模型。
 */
export function expandPromptTokens(prompt?: string, marks?: CanvasMarkElement[] | null) {
  return expandRefTokens(expandMarkTokens(expandCameraTokens(prompt || ''), marks))
}
