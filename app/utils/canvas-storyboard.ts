/**
 * 分镜节点：一张卡片里写多条镜头提示词，再拆成一镜一条视频。
 * 模型仍然只收一条提示词，所以不把多段提示词塞进同一次视频任务。
 */
import type { InjectionKey } from 'vue'

/** 工作区提供：把当前分镜拆成右侧的视频节点。返回是否拆成了至少一条。 */
export const CANVAS_STORYBOARD_KEY: InjectionKey<(nodeId: string) => boolean> = Symbol('canvas-storyboard')

export type StoryboardShot = {
  id: string
  prompt: string
  seconds: number
}

export const STORYBOARD_MIN = 1
export const STORYBOARD_MAX = 8

export function defaultStoryboardShots(): StoryboardShot[] {
  return [
    { id: 's1', prompt: '', seconds: 5 },
    { id: 's2', prompt: '', seconds: 5 },
  ]
}

function clampSeconds(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0)
    return 5
  return Math.min(15, Math.max(1, Math.round(n)))
}

/** 读节点上的分镜；没有或全空时给两条空白，方便直接写 */
export function storyboardShotsOf(data?: { storyboardShots?: StoryboardShot[] | null } | null): StoryboardShot[] {
  const raw = Array.isArray(data?.storyboardShots) ? data.storyboardShots : []
  const shots = raw.slice(0, STORYBOARD_MAX).map((item, index) => ({
    id: String(item?.id || `s${index + 1}`),
    prompt: String(item?.prompt || ''),
    seconds: clampSeconds(item?.seconds),
  }))
  return shots.length ? shots : defaultStoryboardShots()
}

export type StoryboardExpandItem = {
  prompt: string
  seconds: number
  x: number
  y: number
  label: string
}

/** 有提示词的镜头，按顺序排到分镜节点右侧 */
export function storyboardExpandPlan(
  shots: StoryboardShot[],
  origin: { x: number, y: number, w: number, h: number },
): StoryboardExpandItem[] {
  const ready = shots
    .map(item => ({ prompt: item.prompt.trim(), seconds: clampSeconds(item.seconds) }))
    .filter(item => item.prompt)
    .slice(0, STORYBOARD_MAX)
  return ready.map((item, index) => ({
    prompt: item.prompt,
    seconds: item.seconds,
    x: origin.x + origin.w + 80,
    y: origin.y + index * (origin.h + 28),
    label: `镜头 ${index + 1}`,
  }))
}
