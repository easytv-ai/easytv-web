import { buildLoginRedirectQuery } from '~/utils/auth-login-redirect'

/**
 * 匿名可看页面里的登录门槛：点赞 / 评论 / 收藏 / 加入创作台等动作前调用。
 * 未登录时跳登录页并带回跳地址，返回 false；已登录返回 true。
 */
export function useRequireLogin() {
  const { isLoggedIn } = useAuth()
  const route = useRoute()
  const localePath = useLocalePath()

  function loginPath(redirectPath?: string) {
    return localePath({
      path: '/login',
      query: buildLoginRedirectQuery(redirectPath ?? route.fullPath),
    })
  }

  function requireLogin(redirectPath?: string): boolean {
    if (isLoggedIn.value)
      return true
    void navigateTo(loginPath(redirectPath))
    return false
  }

  return { isLoggedIn, requireLogin, loginPath }
}
