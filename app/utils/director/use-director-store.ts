/**
 * 把 store 实例沿组件树往下传。
 *
 * 导演台是画布上的节点，同一张画布可能开着好几个，各自一套场景，所以不能用
 * 模块级单例。顶层组件 createDirectorStore() 之后 provide 下去，
 * 视口、面板、时间轴各自 inject。
 */
import { inject, provide, type InjectionKey } from 'vue'
import type { DirectorStore } from './store'

const DIRECTOR_STORE_KEY: InjectionKey<DirectorStore> = Symbol('director-store')

export function provideDirectorStore(store: DirectorStore) {
  provide(DIRECTOR_STORE_KEY, store)
}

export function useDirectorStore(): DirectorStore {
  const store = inject(DIRECTOR_STORE_KEY, null)
  if (!store)
    throw new Error('[director] 组件不在导演台里：外层要先 provideDirectorStore')
  return store
}
