/**
 * 把一次连续的输入合成一步撤销（复刻自 open-director 的 useUndoBatchInteraction，MIT）。
 *
 * 面板里的滑块和数字框改一下就提交一次，不做处理的话拖一次滑块会在撤销栈里
 * 压进几十步，撤销键要按到手酸。这里在交互开始时开一个批次、结束时关掉，
 * 中间所有提交合成一步。
 *
 * 组件卸载时补一次 end：拖着滑块的时候面板被关掉（切换选中对象就会发生），
 * 批次不收尾的话后面所有改动都会被吞进这个没关上的批次里。
 */
import { onBeforeUnmount } from 'vue'
import { useDirectorStore } from './use-director-store'

export function useUndoBatch() {
  const store = useDirectorStore()
  let active = false

  /** 重复调用无副作用：数字框和滑块在同一个字段里可能各自触发一次 */
  function begin() {
    if (active)
      return
    active = true
    store.beginBatch()
  }

  function end() {
    if (!active)
      return
    active = false
    store.endBatch()
  }

  onBeforeUnmount(end)

  return { begin, end }
}
