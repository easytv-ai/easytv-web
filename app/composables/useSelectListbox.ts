/**
 * 自制下拉（StudioSelect / DirectorSelectField）的键盘与读屏行为，对齐原生 select：
 * - 关着时焦点在触发器上按 ↑ / ↓ / Enter / 空格打开；
 * - 开着时 ↑ / ↓ / Home / End 只移动高亮，Enter / 空格才提交（避免每按一下就触发一次保存或接口调用）；
 * - Esc 关闭、Tab 关闭并放行焦点；选中或 Esc 后焦点回到触发器；
 * - 触发器带 aria-activedescendant 指向高亮项，读屏能读出当前项。
 */
import { computed, nextTick, ref, useId, watch, type Ref } from 'vue'

type Option = { value: string | number, disabled?: boolean }

/** 只认会用到的方法，避免 Vue 模板 ref 推断出的按钮类型和 HTMLElement 对不上 */
type Focusable = { focus: (options?: FocusOptions) => void }
type QueryRoot = {
  querySelector: (selectors: string) => { scrollIntoView: (arg?: ScrollIntoViewOptions) => void } | null
}

export function useSelectListbox<T extends Option>(options: {
  items: () => T[]
  modelValue: () => T['value'] | null | undefined
  open: Ref<boolean>
  disabled?: () => boolean
  trigger: { readonly value: Focusable | null }
  list: { readonly value: QueryRoot | null }
  commit: (value: T['value']) => void
}) {
  const baseId = `select-${useId()}`
  const activeIndex = ref(-1)

  const activeId = computed(() =>
    options.open.value && activeIndex.value >= 0 ? `${baseId}-opt-${activeIndex.value}` : undefined,
  )

  function optionId(index: number) {
    return `${baseId}-opt-${index}`
  }

  function step(from: number, delta: number) {
    const list = options.items()
    if (!list.length)
      return -1
    let i = from
    for (let n = 0; n < list.length; n++) {
      i = (i + delta + list.length) % list.length
      if (!list[i]?.disabled)
        return i
    }
    return -1
  }

  function edge(last: boolean) {
    const list = options.items()
    const order = last ? [...list.keys()].reverse() : [...list.keys()]
    return order.find(i => !list[i]?.disabled) ?? -1
  }

  watch(options.open, async (isOpen) => {
    if (!isOpen) {
      activeIndex.value = -1
      return
    }
    const current = options.items().findIndex(item => item.value === options.modelValue())
    activeIndex.value = current >= 0 && !options.items()[current]?.disabled ? current : edge(false)
    await nextTick()
    scrollActive()
  })

  function scrollActive() {
    if (activeIndex.value < 0)
      return
    options.list.value?.querySelector(`#${CSS.escape(optionId(activeIndex.value))}`)?.scrollIntoView({ block: 'nearest' })
  }

  function close(refocus: boolean) {
    options.open.value = false
    if (refocus)
      nextTick(() => options.trigger.value?.focus())
  }

  function pickActive() {
    const item = options.items()[activeIndex.value]
    if (item && !item.disabled)
      options.commit(item.value)
    close(true)
  }

  /** 挂在触发器按钮的 keydown 上 */
  function onTriggerKeydown(event: KeyboardEvent) {
    if (options.disabled?.())
      return
    if (!options.open.value) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        options.open.value = true
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        activeIndex.value = step(activeIndex.value < 0 ? -1 : activeIndex.value, event.key === 'ArrowDown' ? 1 : -1)
        nextTick(scrollActive)
        break
      case 'Home':
      case 'End':
        event.preventDefault()
        activeIndex.value = edge(event.key === 'End')
        nextTick(scrollActive)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        pickActive()
        break
      case 'Escape':
        // 阻止默认并让外层（导演台 / 智能编辑的 Esc 退出）知道这次 Esc 已被下拉消费
        event.preventDefault()
        event.stopPropagation()
        close(true)
        break
      case 'Tab':
        close(false)
        break
    }
  }

  /** 点选项（鼠标）后焦点回触发器 */
  function onPick(value: T['value'], disabled?: boolean) {
    if (disabled || options.disabled?.())
      return
    options.commit(value)
    close(true)
  }

  return { activeIndex, activeId, optionId, onTriggerKeydown, onPick }
}
