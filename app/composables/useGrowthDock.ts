/** 右下角新手任务 / 签到面板是否展开：悬浮球和钱包面板「新手任务」入口共用 */
export function useGrowthDock() {
  return useState('growth-dock-open', () => false)
}
