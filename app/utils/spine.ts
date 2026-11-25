import type { BibleThread, ScreenplayPlan } from '~/types/creative'

/** 季轴色，按人物首次出现的顺序取，同一名字始终同色。 */
export const SPINE_COLORS = ['#3ec6ff', '#e2b15a', '#c084fc', '#f472b6', '#34d399', '#fb7185', '#fbbf24', '#94a3b8']

export const FILM_COLORS = ['#1e3a5f', '#7c4a1e', '#4c1d6e', '#9a3412', '#3f6212', '#115e59', '#9f1239', '#0f766e']

export type SpineSource = {
  id: number
  episode_no: number
  canvas_id: number
  status: number
  plan: ScreenplayPlan | null
}

export type SpineEpisode = {
  no: number
  id: number
  canvasId: number
  status: number
  title: string
  shots: number
}

export type SpineLane = {
  name: string
  look: string
  color: string
  /** 每一集里这个人出现的镜头数，0 表示这一集没有他 */
  weights: number[]
  /** 线在这一集结束（后面不再出场）；一直到最后一集则为 null */
  exitAt: number | null
}

export type SpineClue = {
  title: string
  from: number
  to: number
  open: boolean
}

export type SpineModel = {
  episodes: SpineEpisode[]
  lanes: SpineLane[]
  clues: SpineClue[]
}

/** 用每集策划案的人物和镜头出场，加上剧集设定里的线索，拼出季轴。关系说明不参与画线。 */
export function buildSpine(sources: SpineSource[], threads: BibleThread[] = []): SpineModel {
  const rows = sources
    .filter(row => row.episode_no > 0 && row.status !== -1 && row.status !== 0)
    .sort((a, b) => a.episode_no - b.episode_no || a.id - b.id)

  const episodes: SpineEpisode[] = rows.map(row => ({
    no: row.episode_no,
    id: row.id,
    canvasId: row.canvas_id || 0,
    status: row.status,
    title: row.plan?.title?.trim() || '',
    shots: row.plan?.shots?.length ?? 0,
  }))

  const byName = new Map<string, { name: string, look: string, weights: number[], order: number }>()
  rows.forEach((row, index) => {
    const plan = row.plan
    if (!plan)
      return
    const characters = plan.characters ?? []
    const named = new Map(characters.map(character => [character.key, character]))
    for (const character of characters) {
      const name = character.name.trim()
      if (!name)
        continue
      const lane = byName.get(name)
      if (!lane)
        byName.set(name, { name, look: character.look || '', weights: Array(rows.length).fill(0), order: byName.size })
      else if (!lane.look && character.look)
        lane.look = character.look
    }
    for (const shot of plan.shots ?? []) {
      const seen = new Set<string>()
      for (const key of shot.characters || []) {
        const name = named.get(key)?.name?.trim()
        if (!name || seen.has(name))
          continue
        seen.add(name)
        const lane = byName.get(name)
        if (lane)
          lane.weights[index] += 1
      }
    }
  })

  const lanes: SpineLane[] = [...byName.values()].map((lane) => {
    let last = -1
    lane.weights.forEach((weight, index) => {
      if (weight > 0)
        last = index
    })
    return {
      name: lane.name,
      look: lane.look,
      color: SPINE_COLORS[lane.order % SPINE_COLORS.length]!,
      weights: lane.weights,
      exitAt: last >= 0 && last < rows.length - 1 ? last : null,
    }
  })

  const indexOfNo = new Map(episodes.map((episode, index) => [episode.no, index]))
  const clues: SpineClue[] = threads
    .filter(thread => thread.title.trim() && thread.opened_in > 0)
    .map((thread) => {
      const from = indexOfNo.get(thread.opened_in) ?? 0
      const resolvedNo = thread.resolved_in ?? 0
      const resolved = thread.status === 'resolved' && resolvedNo > 0
      const toIndex = resolved ? indexOfNo.get(resolvedNo) : undefined
      const to = toIndex == null ? episodes.length - 1 : toIndex
      return {
        title: thread.title.trim(),
        from: Math.min(from, Math.max(episodes.length - 1, 0)),
        to: Math.max(from, Math.min(to, Math.max(episodes.length - 1, 0))),
        open: !resolved,
      }
    })
    .filter(() => episodes.length > 0)

  return { episodes, lanes, clues }
}

/** 一条线拆成连续出场的几段，中间缺席就断开。 */
export function laneRuns(weights: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start = -1
  weights.forEach((weight, index) => {
    if (weight > 0 && start < 0)
      start = index
    if (weight <= 0 && start >= 0) {
      runs.push([start, index - 1])
      start = -1
    }
  })
  if (start >= 0)
    runs.push([start, weights.length - 1])
  return runs
}
