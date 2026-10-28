/**
 * 主题：未手动设置时默认深色；手动切换写入 localStorage（easytv-theme）。
 */
export type ThemeExplicit = 'light' | 'dark'
export type ThemeMode = 'system' | ThemeExplicit

const STORAGE_KEY = 'easytv-theme'
export const THEME_TRANSITION_DISABLE_CLASS = 'theme-transition-disable'

let themeViewTransition = false

export function resolveThemeIsDark(explicit: ThemeExplicit | null, _systemDark: boolean): boolean {
  if (explicit === 'light')
    return false
  // 未手动选择时默认深色，与 head 内联脚本一致
  return true
}

/** 同步 html.dark，避免 useHead 注水与 inline script 互相覆盖 */
export function syncDocumentTheme(isDark: boolean) {
  if (!import.meta.client)
    return
  const html = document.documentElement
  if (!themeViewTransition) {
    html.classList.add(THEME_TRANSITION_DISABLE_CLASS)
  }
  html.classList.toggle('dark', isDark)
  html.style.colorScheme = isDark ? 'dark' : 'light'
  if (!themeViewTransition) {
    // 强制重排，确保过渡禁用生效后再切换主题
    void html.offsetWidth
    html.classList.remove(THEME_TRANSITION_DISABLE_CLASS)
  }
}

export function readStoredThemeExplicit(): ThemeExplicit | null {
  if (!import.meta.client)
    return null
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s === 'light' || s === 'dark')
      return s
  }
  catch {
    /* ignore */
  }
  return null
}

export function useTheme() {
  const explicit = useState<ThemeExplicit | null>('ea-theme-explicit', () => null)
  const systemDark = useState<boolean>('ea-theme-system', () => false)

  const themeMode = computed<ThemeMode>(() => {
    if (explicit.value === 'light')
      return 'light'
    if (explicit.value === 'dark')
      return 'dark'
    return 'system'
  })

  const isDark = computed(() => resolveThemeIsDark(explicit.value, systemDark.value))

  function applyThemeToDocument() {
    syncDocumentTheme(isDark.value)
  }

  function commitTheme(mode: ThemeMode) {
    if (mode === 'system') {
      explicit.value = null
      if (import.meta.client) {
        try {
          localStorage.removeItem(STORAGE_KEY)
        }
        catch {
          /* ignore */
        }
      }
    }
    else {
      explicit.value = mode
      if (import.meta.client) {
        try {
          localStorage.setItem(STORAGE_KEY, mode)
        }
        catch {
          /* ignore */
        }
      }
    }

    applyThemeToDocument()
  }

  function setTheme(mode: ThemeMode, event?: Event) {
    const nextExplicit = mode === 'system' ? null : mode
    const nextDark = resolveThemeIsDark(nextExplicit, systemDark.value)
    if (nextDark === isDark.value && explicit.value === nextExplicit) {
      return
    }
    runThemeWipe(nextDark, event, () => commitTheme(mode))
  }

  function originFromEvent(event?: Event) {
    const target = event?.currentTarget
    const el = target instanceof HTMLElement
      ? (target.closest('button') ?? target)
      : event?.target instanceof Element
        ? event.target.closest('button')
        : null
    if (el) {
      const originEl = el.querySelector('[data-theme-origin]') ?? el
      const rect = originEl.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    if (event instanceof MouseEvent)
      return { x: event.clientX, y: event.clientY }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }

  function writeThemeWipeKeyframes(x: number, y: number) {
    const w = window.innerWidth
    const h = window.innerHeight
    const endRadius = Math.hypot(Math.max(x, w - x), Math.max(y, h - y))
    const xPct = `${(100 * x) / w}%`
    const yPct = `${(100 * y) / h}%`
    const referR = Math.hypot(w, h) / Math.SQRT2
    const rPct = `${(100 * endRadius) / referR}%`
    let style = document.getElementById('ea-theme-wipe-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'ea-theme-wipe-style'
      document.head.appendChild(style)
    }
    style.textContent = `@keyframes ea-theme-wipe{from{clip-path:circle(${rPct} at ${xPct} ${yPct})}to{clip-path:circle(0% at ${xPct} ${yPct})}}`
  }

  function runThemeWipe(nextDark: boolean, event: Event | undefined, apply: () => void) {
    if (!import.meta.client) {
      apply()
      return
    }

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> }
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof doc.startViewTransition !== 'function' || reduced || !event) {
      apply()
      return
    }

    const { x, y } = originFromEvent(event)
    writeThemeWipeKeyframes(x, y)
    const html = document.documentElement
    html.dataset.themeTransition = nextDark ? 'to-dark' : 'to-light'

    themeViewTransition = true
    const transition = doc.startViewTransition(async () => {
      apply()
      await nextTick()
    })

    const cleanup = () => {
      themeViewTransition = false
      delete html.dataset.themeTransition
    }

    const finished = 'finished' in transition
      ? (transition as { finished: Promise<void> }).finished
      : (transition as { ready?: Promise<void> }).ready
    void Promise.resolve(finished).catch(() => {}).finally(cleanup)
  }

  function toggleTheme(event?: Event) {
    const nextDark = !isDark.value
    runThemeWipe(nextDark, event, () => commitTheme(nextDark ? 'dark' : 'light'))
  }

  return {
    isDark,
    themeMode,
    setTheme,
    toggleTheme,
    applyThemeToDocument,
    explicit,
    systemDark,
    STORAGE_KEY,
  }
}
