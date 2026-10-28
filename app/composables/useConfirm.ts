export type ConfirmOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

type ConfirmState = {
  open: boolean
  title: string
  message: string
  confirmText: string
  cancelText: string
  danger: boolean
}

let pending: ((ok: boolean) => void) | null = null

export function useConfirm() {
  const state = useState<ConfirmState>('studio-confirm', () => ({
    open: false,
    title: '',
    message: '',
    confirmText: '',
    cancelText: '',
    danger: false,
  }))

  function confirm(options: string | ConfirmOptions): Promise<boolean> {
    const opts = typeof options === 'string' ? { message: options } : options
    pending?.(false)
    return new Promise((resolve) => {
      pending = resolve
      state.value = {
        open: true,
        title: opts.title ?? '',
        message: opts.message,
        confirmText: opts.confirmText ?? '',
        cancelText: opts.cancelText ?? '',
        danger: !!opts.danger,
      }
    })
  }

  function settle(ok: boolean) {
    if (!state.value.open)
      return
    state.value.open = false
    const done = pending
    pending = null
    done?.(ok)
  }

  return { state, confirm, settle }
}
