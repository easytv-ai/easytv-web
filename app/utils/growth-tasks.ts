import type { GrowthTask, GrowthTasks } from '~/types/creative'

/** 产品已不做微信绑定，新手任务列表不再展示这条（接口仍可能下发）。 */
const HIDDEN_GROWTH_TASK_KEYS = new Set(['bind_wechat'])

export function isHiddenGrowthTask(key: string) {
  return HIDDEN_GROWTH_TASK_KEYS.has(key)
}

/** 去掉隐藏任务，并按剩余任务重算 done / 积分合计。 */
export function withoutHiddenGrowthTasks(data: GrowthTasks): GrowthTasks {
  const tasks = data.tasks.filter(item => !isHiddenGrowthTask(item.key))
  return {
    ...data,
    tasks,
    done: countDone(tasks),
    total_points: sumPoints(tasks),
    earned_points: sumPoints(tasks.filter(item => item.status === 1)),
  }
}

function countDone(tasks: GrowthTask[]) {
  return tasks.filter(item => item.status === 1).length
}

function sumPoints(tasks: GrowthTask[]) {
  return tasks.reduce((sum, item) => sum + (Number(item.points) || 0), 0)
}
