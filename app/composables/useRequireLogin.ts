/**
 * 匿名可看页面里的登录门槛：点赞 / 评论 / 收藏 / 加入创作台等动作前调用。
 * 未登录时在当前页弹出登录框，返回 false；已登录返回 true。
 */
export function useRequireLogin() {
  const { isLoggedIn } = useAuth()
  const { openLogin } = useLoginModal()

  function requireLogin(redirectPath?: string): boolean {
    if (isLoggedIn.value)
      return true
    openLogin({ tab: 'login', redirect: redirectPath })
    return false
  }

  return { isLoggedIn, requireLogin }
}
