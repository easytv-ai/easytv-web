/**
 * 把一镜的运镜写成视频提示词。文案只来自运镜词表（CAMERA_MOVE_ITEMS），
 * 经 cameraMovesPrompt / expandCameraTokens 展开。不建节点，也不提交生成。
 *
 * hold / stop 不是词表 id，这里当成「固定镜头」（停）。
 */
import { CAMERA_FOCALS } from '~/utils/canvas-camera'
import { cameraIdsInPrompt, cameraMovesPrompt, expandCameraTokens } from '~/utils/canvas-node-kinds'

export interface PreviewShotMove {
  /** 词表 id、别名（push），或带 {{cam:id}} 的片段。hold / stop 当成固定镜头 */
  moves?: string | string[]
  /** 这一镜里主体在做什么。运镜文案接在后面；已经写过同样的话就不重复 */
  action?: string
  /** 景别（特写 / 近景 / 中景 / 全景 / 远景），接在运镜前面 */
  framing?: string
  /** 全画幅等效焦段（24mm / 35mm / 50mm…），接在景别后面 */
  focal?: string
}

/** 导演台垂直 fov → 景别。默认 50° 是中景。 */
export function previewShotSizeFromFov(fov: number) {
  if (!Number.isFinite(fov))
    return ''
  if (fov <= 28)
    return '特写'
  if (fov <= 40)
    return '近景'
  if (fov <= 55)
    return '中景'
  if (fov <= 75)
    return '全景'
  return '远景'
}

/**
 * 垂直 fov → 全画幅等效焦段。传感器按 24mm 高，再就近落到摄影库那几档
 * （14 / 24 / 35 / 50 / 85 / 135 / 200），文案写成 35mm。
 */
export function previewFocalFromFov(fov: number) {
  if (!Number.isFinite(fov) || fov <= 0)
    return ''
  const safe = Math.min(179, Math.max(1, fov))
  const mm = 12 / Math.tan((safe * Math.PI / 180) / 2)
  const steps = CAMERA_FOCALS.map(item => item.value)
  let best = steps[0] ?? 35
  for (const step of steps) {
    if (Math.abs(step - mm) < Math.abs(best - mm))
      best = step
  }
  return `${best}mm`
}

function moveIdsOf(moves: string | string[] | undefined) {
  const list = Array.isArray(moves) ? moves : moves ? [moves] : []
  const ids: string[] = []
  for (const item of list) {
    const text = String(item || '').trim()
    if (!text)
      continue
    if (text === 'hold' || text === 'stop') {
      ids.push('static')
      continue
    }
    if (text.includes('{{cam:')) {
      ids.push(...cameraIdsInPrompt(text))
      continue
    }
    ids.push(text)
  }
  return ids
}

/** 一镜一句。没有运镜、景别也没有动作时是空串 */
export function previewShotPrompt(shot: PreviewShotMove = {}) {
  const moveLine = cameraMovesPrompt(moveIdsOf(shot.moves))
  const framing = String(shot.framing || '').trim()
  const focal = String(shot.focal || '').trim()
  const action = expandCameraTokens(shot.action).trim()
  const shotLine = [framing, focal, moveLine].filter(Boolean).join('，')
  if (!shotLine)
    return action
  if (!action || action.includes(shotLine) || (moveLine && action.includes(moveLine)))
    return action || shotLine
  return `${action}\n\n${shotLine}`
}

/** 按镜头顺序各写一句，和 planPreviewFrames 的镜头下标对齐 */
export function planPreviewShotPrompts(shots: PreviewShotMove[]) {
  return shots.map(shot => previewShotPrompt(shot))
}
