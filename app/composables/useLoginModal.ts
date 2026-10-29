import { resetSessionExpiryRedirectState } from '~/utils/auth-session-expired'
import {
  LOGIN_MODAL_AFF,
  LOGIN_MODAL_OPEN,
  LOGIN_MODAL_PCODE,
  LOGIN_MODAL_REDIRECT,
  LOGIN_MODAL_REF,
  LOGIN_MODAL_TAB,
  openLoginModalState,
  type LoginModalOptions,
  type LoginModalTab,
} from '~/utils/login-modal'

/** 全局登录弹窗：停在当前页，不再进入 /login。 */
export function useLoginModal() {
  const route = useRoute()
  const open = useState(LOGIN_MODAL_OPEN, () => false)
  const redirect = useState<string | null>(LOGIN_MODAL_REDIRECT, () => null)
  const tab = useState<LoginModalTab>(LOGIN_MODAL_TAB, () => 'login')
  const inviteRef = useState(LOGIN_MODAL_REF, () => '')
  const inviteAff = useState(LOGIN_MODAL_AFF, () => '')
  const invitePcode = useState(LOGIN_MODAL_PCODE, () => '')

  function openLogin(options?: LoginModalOptions) {
    openLoginModalState({
      ...options,
      redirect: options?.redirect ?? route.fullPath,
    })
  }

  function closeLogin() {
    open.value = false
    resetSessionExpiryRedirectState()
  }

  return {
    open,
    redirect,
    tab,
    inviteRef,
    inviteAff,
    invitePcode,
    openLogin,
    closeLogin,
  }
}
