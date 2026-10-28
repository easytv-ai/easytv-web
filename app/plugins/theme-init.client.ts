/**
 * 在 Vue 注水前同步读取 localStorage 与系统主题，并持续同步 html.dark。
 */
import { readStoredThemeExplicit, syncDocumentTheme, useTheme } from '~/composables/useTheme'

export default defineNuxtPlugin({
  name: 'ea-theme-init',
  enforce: 'pre',
  setup() {
    const { explicit, systemDark, isDark } = useTheme()

    explicit.value = readStoredThemeExplicit()

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mq.matches

    const onSystemChange = (e: MediaQueryListEvent) => {
      systemDark.value = e.matches
      syncDocumentTheme(isDark.value)
    }
    mq.addEventListener('change', onSystemChange)

    watch(isDark, dark => syncDocumentTheme(dark), { immediate: true })
  },
})
