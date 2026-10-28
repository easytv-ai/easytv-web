function toastIcon(color?: string) {
  if (color === 'success' || color === 'primary')
    return 'i-lucide-circle-check'
  if (color === 'warning')
    return 'i-lucide-triangle-alert'
  if (color === 'error')
    return 'i-lucide-circle-alert'
  return 'i-lucide-info'
}

export default defineNuxtPlugin({
  name: 'toast-icons',
  setup() {
    const toasts = useState<Array<{ icon?: string, color?: string }>>('toasts', () => [])
    watch(toasts, (list) => {
      for (const item of list) {
        if (item && !item.icon)
          item.icon = toastIcon(item.color)
      }
    }, { deep: true, flush: 'sync' })
  },
})
