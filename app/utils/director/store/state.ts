/**
 * 导演台状态的形状与快照工具（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 架构上有一个关键取舍：**状态保持不可变**。
 *
 * 上游用 zustand，每个动作都是 `set(state => ({ ...state, project: ... }))`，
 * 撤销栈直接存旧对象的引用，判断"这次操作有没有真的改动"靠整体比较。
 * 搬到 Vue 时可以改成 reactive 直接改属性，但那样撤销、批量合并、去重这几百行
 * 逻辑都得重写，而它们恰好是 785 行上游测试覆盖得最密的部分。
 *
 * 所以这里用 `ref<DirectorState>` 整体替换：Vue 对 ref 的整体替换照样触发更新，
 * 场景数据也就几十个对象，整体替换的开销可以忽略。换来的是撤销语义和上游完全一致，
 * 测试能原样搬过来当安全网。
 */
import type { DirectorCameraShot, DirectorObject, DirectorProject, ViewMode, ViewportAspectRatio } from '../schema'
import { createDefaultDirectorProject } from '../default-project'

/** 变换 gizmo 的三种模式 */
export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface DirectorUiState {
  viewMode: ViewMode
  selectedObjectId: string | null
  selectedObjectIds: string[]
  /** 选中的是整个群众组时记在这里，此时 selectedObjectIds 是组内全部成员 */
  selectedCrowdId: string | null
  /** auto 跟着选中对象走，scene 强制停在场景面板 */
  directorInspectorMode: 'auto' | 'scene'
  transformMode: TransformMode
  viewportAspectRatio: ViewportAspectRatio
  viewportRuleOfThirdsEnabled: boolean
  viewportPanelsCollapsed: boolean
}

/** 会进撤销栈、也会被序列化保存的那部分 */
export interface DirectorState extends DirectorUiState {
  project: DirectorProject
}

export interface DirectorClipboardEntry {
  object: DirectorObject
  camera?: DirectorCameraShot
}

/** 撤销栈上限：再多也没人会一路撤回去，还白占内存 */
export const UNDO_STACK_LIMIT = 80

export const DEFAULT_UI_STATE: DirectorUiState = {
  viewMode: 'director',
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedCrowdId: null,
  directorInspectorMode: 'auto',
  transformMode: 'translate',
  viewportAspectRatio: 'auto',
  viewportRuleOfThirdsEnabled: false,
  viewportPanelsCollapsed: false,
}

export function createInitialDirectorState(): DirectorState {
  return {
    ...DEFAULT_UI_STATE,
    project: createDefaultDirectorProject(),
  }
}

/**
 * 深拷贝一份纯数据快照。
 *
 * 必须走 JSON 往返，不能用 structuredClone：状态放在 Vue 的 ref 里，
 * 读出来是响应式 Proxy，structuredClone 遇到 Proxy 直接抛 DataCloneError。
 * JSON 往返顺带把 Proxy 剥成纯对象，正是快照需要的东西。
 *
 * 代价是 undefined 字段会被抹掉 —— 对这里的数据没影响，schema 里的可选字段
 * 缺失和 undefined 是同一个意思。
 */
export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function cloneDirectorState(state: DirectorState): DirectorState {
  return cloneJsonValue(state)
}

/**
 * 两个状态是否等价。
 *
 * 上游直接比 JSON 字符串，这里沿用：字段顺序在整个流程里是固定的
 * （都由同一批构造函数产出），所以字符串比较是可靠的，而且比逐字段递归快得多。
 * 它决定了一次操作要不要进撤销栈 —— 拖拽时大量"没真的动"的更新就是靠它挡掉的。
 */
export function isSameDirectorState(a: DirectorState, b: DirectorState) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function trimUndoStack(stack: DirectorState[]) {
  return stack.length > UNDO_STACK_LIMIT ? stack.slice(stack.length - UNDO_STACK_LIMIT) : stack
}
