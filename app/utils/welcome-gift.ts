/** 注册成功后由 LoginRegister 写入 sessionStorage，创作台首页读到即弹「新人红包」并清除 */
export const WELCOME_GIFT_SESSION_KEY = 'easytv_welcome_gift'

/** 每个用户只弹一次：localStorage 记录已展示 */
export function welcomeGiftShownKey(userId: string) {
  return `easytv_welcome_gift_shown_${userId}`
}
