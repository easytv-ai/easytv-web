/**
 * 剧集设定页「用 AI 生成本集记录」按钮的显示状态。
 * 这个按钮按文本模型单价扣一次积分：扣分说明必须在点击之前就看得到，
 * 所以它不跟「有没有记录」「是不是生成中」挂钩，只要按钮在，说明就在。
 */
export type RecordGenerateState = {
  /** 当前选中的集（0 = 没有可记录的集） */
  target: number
  recording: boolean
  saving: boolean
  /** 已有的每集记录条数 */
  episodeCount: number
}

export function recordGenerateView(state: RecordGenerateState) {
  return {
    disabled: !state.target || state.recording || state.saving,
    /** 扣分说明（bible.recordsCost）：常驻，生成中、已有记录时也不收起 */
    showCost: true,
    /** 空状态说明只在还没有记录时出现，它不能顶替扣分说明 */
    showEmpty: state.episodeCount <= 0,
  }
}
