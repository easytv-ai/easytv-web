import { storeLoginRedirect } from '~/utils/auth-login-redirect'

export const LOGIN_MODAL_OPEN = 'login-modal-open'
export const LOGIN_MODAL_REDIRECT = 'login-modal-redirect'
export const LOGIN_MODAL_TAB = 'login-modal-tab'
export const LOGIN_MODAL_REF = 'login-modal-ref'
export const LOGIN_MODAL_AFF = 'login-modal-aff'
export const LOGIN_MODAL_PCODE = 'login-modal-pcode'
export const OPEN_LOGIN_COOKIE = 'easytv-open-login'
export const LOGIN_MODAL_REQUIRED = 'login-modal-required'

export type LoginModalTab = 'login' | 'register' | 'forgot'

export interface LoginModalOptions {
  redirect?: string
  tab?: LoginModalTab
  ref?: string
  aff?: string
  pcode?: string
}

/** 打开登录弹窗。可在组件、中间件和请求拦截里调用。 */
export function openLoginModalState(options?: LoginModalOptions) {
  const open = useState(LOGIN_MODAL_OPEN, () => false)
  const redirect = useState<string | null>(LOGIN_MODAL_REDIRECT, () => null)
  const tab = useState<LoginModalTab>(LOGIN_MODAL_TAB, () => 'login')
  const inviteRef = useState(LOGIN_MODAL_REF, () => '')
  const inviteAff = useState(LOGIN_MODAL_AFF, () => '')
  const invitePcode = useState(LOGIN_MODAL_PCODE, () => '')
  const wasOpen = open.value

  if (options?.redirect) {
    redirect.value = options.redirect
    storeLoginRedirect(options.redirect)
  }
  if (options?.tab)
    tab.value = options.tab
  else if (!wasOpen)
    tab.value = 'login'

  const touchesInvite = !!options && ('ref' in options || 'aff' in options || 'pcode' in options)
  if (!wasOpen || touchesInvite) {
    inviteRef.value = options?.ref ?? ''
    inviteAff.value = options?.aff ?? ''
    invitePcode.value = options?.pcode ?? ''
  }
  open.value = true
}
