import { onMounted, onUnmounted } from 'vue'

export const VISUAL_VIEWPORT_NARROW_PX = 860

export type VisualViewportBox = {
  offsetTop: number
  offsetLeft: number
  width: number
  height: number
}

/**
 * 小屏上把页面高度收到当前可视区域。
 * 创作台用 100dvh 锁死，手机键盘弹起时底栏和输入框会被盖住；可视区域变矮时跟着收。
 * transform 让生成条这类 position:fixed 相对编辑器，而不是整页视口。
 */
export function applyVisualViewportFit(
  el: HTMLElement | null,
  opts: { innerWidth: number, visualViewport: VisualViewportBox | null | undefined },
) {
  if (!el)
    return
  const vv = opts.visualViewport
  const narrow = opts.innerWidth <= VISUAL_VIEWPORT_NARROW_PX
  if (!vv || !narrow) {
    el.style.position = ''
    el.style.top = ''
    el.style.left = ''
    el.style.width = ''
    el.style.height = ''
    el.style.transform = ''
    return
  }
  el.style.position = 'fixed'
  el.style.top = `${vv.offsetTop}px`
  el.style.left = `${vv.offsetLeft}px`
  el.style.width = `${vv.width}px`
  el.style.height = `${vv.height}px`
  el.style.transform = 'translateZ(0)'
}

/**
 * 模板 ref 经 vue-tsc 推断后和 DOM lib 对不上，这里只认 .value，进函数再当元素用。
 */
export function useVisualViewportFit(root: { value: unknown }) {
  function apply() {
    const vv = window.visualViewport
    applyVisualViewportFit(root.value as HTMLElement | null, {
      innerWidth: window.innerWidth,
      visualViewport: vv
        ? { offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft, width: vv.width, height: vv.height }
        : null,
    })
  }

  onMounted(() => {
    apply()
    window.visualViewport?.addEventListener('resize', apply)
    window.visualViewport?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
  })

  onUnmounted(() => {
    window.visualViewport?.removeEventListener('resize', apply)
    window.visualViewport?.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
  })
}
