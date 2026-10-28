/** 图片浮条：AI 编辑动作对应的提示词与参数（提交 POST /user/task） */

export type ImageTransformOp = 'rotate-left' | 'rotate-right' | 'flip-h' | 'flip-v'

export type ImageEditAction =
  | 'smart-edit'
  | 'upscale'
  | 'outpaint'
  | 'multiview'
  | 'view-char'
  | 'view-face'
  | 'view-prop'
  | 'light'
  | 'depth'
  | 'bg-object'
  | 'bg-person'
  | 'inpaint'

export const IMAGE_EDIT_PROMPTS: Record<ImageEditAction, string> = {
  'smart-edit': '按提示编辑这张图，保持主体、构图和风格一致，只改需要改的部分。',
  upscale: '将这张图超分辨率放大，提升清晰度、纹理和细节，不改变构图与主体。',
  outpaint: '向外扩展画面，合理补全场景，风格、光影与原图保持一致。',
  multiview: '基于这张图生成主体的多视角：正面、侧面、背面，同一物体/角色，统一造型。',
  'view-char': '生成一张角色三视图设定图：同一画面从左到右排列全身正面、侧面、背面，同一角色、同一服装与比例，干净浅灰背景，不要场景和其他物体。',
  'view-face': '生成一张脸部三视图设定图：同一画面从左到右排列正面、左侧、右侧头部特写，五官与发型保持一致，干净浅灰背景。',
  'view-prop': '生成一张道具三视图设定图：同一画面从左到右排列正面、侧面、背面，比例准确、细节统一，干净浅灰背景。',
  light: '重新打光，电影感光影与体积光，保留主体、构图和原有风格。',
  depth: '提取这张图的深度图，近处亮、远处暗，轮廓清晰，用于后续三维或景深。',
  'bg-object': '去除背景，只保留主体物品，边缘干净，透明或纯色背景。',
  'bg-person': '去除背景，只保留人物，发丝和边缘干净，透明或纯色背景。',
  inpaint: '移除涂抹标记的物体，按周围纹理和场景自然补全，不改变其余构图与风格。',
}

export function isImageEditAction(name: string): name is ImageEditAction {
  return name in IMAGE_EDIT_PROMPTS
}

export const UPSCALE_SCALES = [2, 4] as const
export type UpscaleScale = (typeof UPSCALE_SCALES)[number]

export function parseUpscaleAction(name: string): UpscaleScale | 0 {
  if (name === 'upscale-2x')
    return 2
  if (name === 'upscale-4x')
    return 4
  return 0
}

export function upscalePrompt(scale: UpscaleScale) {
  const tier = scale === 4 ? '4K' : '2K'
  return `这是同一张照片的高清版本，输出 ${tier}。只提高清晰度和分辨率。人物、五官、服装、姿态、背景、文字、颜色和构图必须与原图一致，禁止换人，禁止重新创作。`
}

/** 2x 出 2K，4x 出 4K。方图 2x 为 2048×2048，横竖跟原图走。 */
export function upscaleTierSize(width: number, height: number, scale: UpscaleScale) {
  const square = width <= 0 || height <= 0 || Math.abs(width - height) / Math.max(width, height) <= 0.08
  const landscape = width >= height
  if (scale === 4) {
    if (square)
      return '4096x4096'
    return landscape ? '3840x2160' : '2160x3840'
  }
  if (square)
    return '2048x2048'
  return landscape ? '2560x1440' : '1440x2560'
}

export function upscaleClarity(scale: UpscaleScale) {
  return scale === 4 ? '4K' : '2K'
}

export function upscaleRatio(width: number, height: number) {
  if (width <= 0 || height <= 0 || Math.abs(width - height) / Math.max(width, height) <= 0.08)
    return '1:1'
  return width > height ? '16:9' : '9:16'
}

const REVERSE_LANG: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  fr: 'French',
  ru: 'Russian',
  vi: 'Vietnamese',
}

/** 反推提示词的指令：中文界面（含繁体）出中文，其他语言按界面语言出 */
export function promptReverseInstruction(locale?: string) {
  const base = '仔细观察这张图片，写一段能直接用于 AI 图片生成、尽量还原这张图的提示词：依次写主体与外观细节、动作姿态、场景环境、构图景别与机位、光线、色调和画面风格。只输出提示词本身，不要标题、解释、编号或引号。'
  const code = (locale || '').toLowerCase()
  if (code === 'zh-tw')
    return `${base}用繁体中文输出。`
  const lang = REVERSE_LANG[code.split('-')[0] || '']
  return lang ? `${base}Write the prompt in ${lang}.` : base
}

export type PromptReverseFrameHint = {
  index: number
  timeSec: number
  startSec: number
  endSec: number
}

/**
 * 视频反推（OiiOii 风格 Timestamped prompts）：
 * 多张按时间抽取的帧 + 时间轴说明 → 按镜头切段的提示词列表。
 */
export function promptReverseVideoInstruction(locale: string | undefined, frames: PromptReverseFrameHint[], durationSec: number) {
  const lines = frames.map((f) => {
    const clock = `${f.timeSec.toFixed(1)}s`
    return `图${f.index}：约 ${clock}（建议覆盖 ${f.startSec}-${f.endSec}s）`
  })
  const base = [
    '你在做视频拉片复刻反推。下面按时间顺序给出同一段视频的关键帧截图。',
    `视频总时长约 ${Math.max(0, Math.round(durationSec * 10) / 10)} 秒。`,
    '关键帧对应关系：',
    ...lines,
    '请根据相邻帧之间的画面变化，把整段视频拆成若干连续时间段，输出可直接用于 AI 视频生成的时间轴提示词。',
    '硬性格式要求：',
    '1. 第一行必须是：_Timestamped prompts_',
    '2. 空一行后用无序列表，每条以「秒数区间」开头，例如：- 0-3s：…… / - 3-4s：……',
    '3. 区间首尾相接、覆盖整段视频，可按镜头切换合并或拆细，不要机械照搬建议区间。',
    '4. 每段写清：主体与外观、动作与运镜、场景环境、构图景别、光线色调与风格；细节要具体，便于复刻。',
    '5. 只输出上述标题与列表，不要前言、后记或其它标题。',
  ].join('\n')
  const code = (locale || '').toLowerCase()
  if (code === 'zh-tw')
    return `${base}\n列表正文用繁体中文。`
  const lang = REVERSE_LANG[code.split('-')[0] || '']
  if (lang && code.split('-')[0] !== 'zh')
    return `${base}\nWrite the bullet descriptions in ${lang}. Keep the title "_Timestamped prompts_" and the time labels like 0-3s unchanged.`
  return `${base}\n列表正文用简体中文。`
}

function isBlobOrDataUrl(src: string) {
  return /^(blob:|data:)/i.test(src)
}

/** 画布读像素才走 CORS；同源 / blob 不能设 crossOrigin，否则没 ACAO 头也会失败 */
export function isSameOriginMediaUrl(src: string, origin = typeof location === 'undefined' ? '' : location.origin) {
  if (!src)
    return false
  if (isBlobOrDataUrl(src))
    return true
  if (!origin)
    return false
  try {
    return new URL(src, origin).origin === new URL(origin).origin
  }
  catch {
    return false
  }
}

function decodeHtmlImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cors)
      img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

async function fetchImageBlob(src: string, sameOrigin: boolean) {
  const res = await fetch(src, {
    mode: sameOrigin ? 'same-origin' : 'cors',
    credentials: sameOrigin ? 'include' : 'omit',
    // 不能用缓存：<img> 先以非 CORS 方式加载过的图，缓存里那份响应没有 ACAO 头，直接复用会被 CORS 拦掉
    cache: 'reload',
  })
  if (!res.ok)
    throw new Error('image')
  return res.blob()
}

async function loadEditBitmap(src: string): Promise<ImageBitmap> {
  if (isBlobOrDataUrl(src))
    return createImageBitmap(await decodeHtmlImage(src, false))

  const sameOrigin = isSameOriginMediaUrl(src)
  try {
    return await createImageBitmap(await fetchImageBlob(src, sameOrigin))
  }
  catch {
    return createImageBitmap(await decodeHtmlImage(src, !sameOrigin))
  }
}

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return decodeHtmlImage(src, !isBlobOrDataUrl(src) && !isSameOriginMediaUrl(src))
}

export function imageOpCss(ops: ImageTransformOp[]) {
  const parts: string[] = []
  for (const op of ops) {
    if (op === 'rotate-left')
      parts.push('rotate(-90deg)')
    else if (op === 'rotate-right')
      parts.push('rotate(90deg)')
    else if (op === 'flip-h')
      parts.push('scaleX(-1)')
    else
      parts.push('scaleY(-1)')
  }
  return parts.reverse().join(' ')
}

export function imageOpsSwapped(ops: ImageTransformOp[]) {
  let turns = 0
  for (const op of ops) {
    if (op === 'rotate-right')
      turns++
    else if (op === 'rotate-left')
      turns--
  }
  return Math.abs(turns) % 2 === 1
}

export function canvasToJpeg(source: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      source.toBlob((blob) => {
        if (blob)
          resolve(blob)
        else
          reject(new Error('blob'))
      }, 'image/jpeg', quality)
    }
    catch (error) {
      reject(error)
    }
  })
}

function drawTransformOp(
  source: CanvasImageSource & { width: number, height: number },
  op: ImageTransformOp,
) {
  const rot = op === 'rotate-left' || op === 'rotate-right'
  const w = rot ? source.height : source.width
  const h = rot ? source.width : source.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('ctx')
  ctx.translate(w / 2, h / 2)
  if (op === 'rotate-left')
    ctx.rotate(-Math.PI / 2)
  else if (op === 'rotate-right')
    ctx.rotate(Math.PI / 2)
  else if (op === 'flip-h')
    ctx.scale(-1, 1)
  else
    ctx.scale(1, -1)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

export async function transformImage(
  src: string,
  ops: ImageTransformOp[],
): Promise<Blob> {
  const img = await loadEditBitmap(src)
  try {
    let current: ImageBitmap | HTMLCanvasElement = img
    for (const op of ops)
      current = drawTransformOp(current, op)
    if (current instanceof ImageBitmap)
      throw new Error('noop')
    return await canvasToJpeg(current)
  }
  finally {
    img.close()
  }
}

export async function cropImage(
  src: string,
  box: { x: number, y: number, w: number, h: number },
): Promise<Blob> {
  const img = await loadEditBitmap(src)
  try {
    const x = Math.max(0, Math.round(box.x))
    const y = Math.max(0, Math.round(box.y))
    const w = Math.max(1, Math.round(box.w))
    const h = Math.max(1, Math.round(box.h))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx)
      throw new Error('ctx')
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
    return await canvasToJpeg(canvas)
  }
  finally {
    img.close()
  }
}

/** 把原图完整放进目标比例画布：宽了左右留空，高了上下留空 */
export function outpaintFrameSize(srcW: number, srcH: number, ratio: string): { w: number, h: number } {
  const [aw, ah] = ratio.split(':').map(Number)
  if (!aw || !ah || srcW <= 0 || srcH <= 0)
    return { w: srcW, h: srcH }
  const target = aw / ah
  const current = srcW / srcH
  if (target >= current)
    return { w: srcH * target, h: srcH }
  return { w: srcW, h: srcW / target }
}

export function outpaintPrompt(ratio: string) {
  return `向外扩展画面至 ${ratio}，合理补全场景，风格、光影与原图保持一致。`
}
