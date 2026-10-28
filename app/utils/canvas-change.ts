import type { InjectionKey } from 'vue'

/**
 * 画布节点组件（CanvasNode / CanvasGroupNode）通知工作区「数据变了」。
 *
 * 节点是 vue-flow 渲染的，拿不到工作区的 emit；工作区 provide 这组回调：
 * - change：只通知父页触发自动保存，不压撤销历史（打字这类高频改动用）；
 * - commit：一次完整操作结束（比如拖完尺寸），压一条撤销历史并通知保存。
 */
export type CanvasChangeNotifier = {
  change: () => void
  commit: () => void
}

export const CANVAS_CHANGE_KEY: InjectionKey<CanvasChangeNotifier> = Symbol('canvas-change')
