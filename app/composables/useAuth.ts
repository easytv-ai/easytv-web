/**
 * 登录 / 注册 / 退出
 */

import userAuth from '~/api/user-auth'
import { hydrateAuthUserFromSelf } from '~/composables/useAuthSelfSync'
import { AUTH_USER_STORAGE_KEY } from '~/utils/auth-user'
import { writeAuthSessionCookie } from '~/utils/auth-session-cookie'
import {
  isApiFailure,
  isLoginApiSuccess,
  parseStoredAuthUser,
  userFromLoginResponse,
  type AuthUser,
} from '~/utils/auth-login-parse'
import { cnMobileError, normalizeMobile } from '~/utils/phone'

/** 中间件 / 插件也会调用 useAuth，不能在里边用 useI18n() */
function tAuth(key: string): string {
  try {
    const nuxtApp = tryUseNuxtApp()
    const i18n = nuxtApp?.$i18n as { t?: (k: string) => unknown } | undefined
    if (typeof i18n?.t === 'function')
      return String(i18n.t(key))
  }
  catch {
    // outside Nuxt context
  }
  return key
}

export type TryLoginResult = { ok: true } | { ok: false; message?: string };
export type TryRegisterResult = { ok: true } | { ok: false; message?: string };
export type LogoutResult = { ok: true } | { ok: false; message?: string };

export function useAuth() {
  const user = useState<AuthUser | null>("easyapi-auth-user", () => null);
  const isLoggedIn = useState("isLoggedIn", () => false);
  const authReady = useState("auth-ready", () => false);

  /** 根据 localStorage 会话同步全局登录标记 */
  function syncLoginState() {
    if (!import.meta.client) return;
    const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    const parsed = parseStoredAuthUser(raw);
    if (raw && !parsed) {
      localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      user.value = null;
      writeAuthSessionCookie(false);
    }
    else if (parsed && !user.value) {
      user.value = parsed;
    }
    isLoggedIn.value = !!user.value;
    authReady.value = true;
  }

  /** 从 localStorage 恢复登录态（在客户端插件中调用一次） */
  function hydrate() {
    if (!import.meta.client) return;
    const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    const parsed = parseStoredAuthUser(raw);
    if (raw && !parsed)
      localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    user.value = parsed;
    // 老会话补写登录标记 cookie，下一次服务端渲染就能直接出创作台外壳
    writeAuthSessionCookie(!!parsed);
    syncLoginState();
  }

  function setUser(u: AuthUser | null) {
    user.value = u;
    isLoggedIn.value = !!u;
    if (import.meta.client) {
      if (u)
        localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(u));
      else
        localStorage.removeItem(AUTH_USER_STORAGE_KEY);
      writeAuthSessionCookie(!!u);
    }
  }

  async function logout(): Promise<LogoutResult> {
    // 管理员从后台「进入控制台」代登：服务端退出会作废用户本人的 access_token、把真实用户踢下线，
    // 所以只清本浏览器的会话
    if (user.value?.console_access) {
      setUser(null)
      return { ok: true }
    }
    try {
      const res = await userAuth.logout()
      if (isApiFailure(res)) {
        return {
          ok: false,
          message: res?.message ?? res?.statusMessage ?? tAuth('退出登录失败，请稍后重试'),
        }
      }
      setUser(null)
      return { ok: true }
    }
    catch {
      return { ok: false, message: tAuth('网络错误，请稍后重试') }
    }
  }

  /** 调用 POST /api/user/register */
  async function tryRegister(data: {
    username: string;
    email: string;
    nickname: string;
    password: string;
    verification_code: string;
    aff_code?: string;
    /** 渠道伙伴邀请码，注册即绑定伙伴归属 */
    pcode?: string;
    /** 归因（API.md 7.2）：来源 / 邀请码 / 口令 / 匿名 id，后端据此写来源、绑邀请人、自动领口令 */
    attr?: {
      source?: string;
      medium?: string;
      campaign?: string;
      ref?: string;
      code?: string;
      anon_id?: string;
    };
  }): Promise<TryRegisterResult> {
    try {
      const res = await userAuth.register(data);
      if (!isLoginApiSuccess(res)) return { ok: false, message: res?.message };
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** 校验密码是否正确（不写入会话），用于关闭 2FA 等敏感操作前确认 */
  async function verifyPasswordOnly(
    username: string,
    password: string,
  ): Promise<boolean> {
    const id = username.trim();
    try {
      const res = await userAuth.login({ username: id, password });
      return isLoginApiSuccess(res);
    } catch {
      return false;
    }
  }

  /** 调用 POST /user/console_access/exchange，用后台下发的 ticket 换取登录态 */
  async function tryExchangeConsoleAccessTicket(
    ticket: string,
  ): Promise<TryLoginResult> {
    const trimmed = String(ticket ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: tAuth('无效的访问凭证') };
    }
    try {
      const res = await userAuth.consoleAccessExchange({ ticket: trimmed });
      if (isApiFailure(res) || !isLoginApiSuccess(res)) {
        return {
          ok: false,
          message: res?.message ?? tAuth('访问凭证无效或已过期'),
        };
      }
      const authUser = userFromLoginResponse(res, "");
      if (!authUser.access_token) {
        return { ok: false, message: tAuth('未获取到登录凭证') };
      }
      setUser(authUser);
      await hydrateAuthUserFromSelf();
      return { ok: true };
    } catch {
      return { ok: false, message: tAuth('网络错误，请稍后重试') };
    }
  }

  /** 调用 POST /api/user/login */
  async function tryLogin(
    username: string,
    password: string,
  ): Promise<TryLoginResult> {
    const id = username.trim();
    try {
      const res = await userAuth.login({ username: id, password });
      if (res?.error || res?.statusCode >= 400) {
        return {
          ok: false,
          message: res?.message ?? res?.statusMessage ?? tAuth('登录服务暂不可用'),
        };
      }
      if (!isLoginApiSuccess(res)) {
        return { ok: false, message: res?.message };
      }
      const authUser = userFromLoginResponse(res, id);
      if (!authUser.username) return { ok: false };
      setUser(authUser);
      return { ok: true };
    } catch {
      return { ok: false, message: tAuth('网络错误，请稍后重试') };
    }
  }

  /** 调用 POST /user/sms_login；未注册手机会自动开户 */
  async function tryPhoneLogin(
    phone: string,
    verificationCode: string,
  ): Promise<TryLoginResult> {
    const mobile = normalizeMobile(phone)
    const mobileErr = cnMobileError(mobile)
    if (mobileErr)
      return { ok: false, message: tAuth(mobileErr) }
    const code = String(verificationCode ?? '').replace(/\D/g, '').slice(0, 6)
    if (code.length !== 6)
      return { ok: false, message: tAuth('请输入6位验证码') }
    try {
      const res = await userAuth.smsLogin({ mobile, code })
      if (isApiFailure(res) || !isLoginApiSuccess(res)) {
        return {
          ok: false,
          message: res?.message ?? res?.statusMessage ?? tAuth('登录失败，请检查手机号与验证码'),
        }
      }
      const authUser = userFromLoginResponse(res, mobile)
      if (!authUser.access_token)
        return { ok: false, message: tAuth('未获取到登录凭证') }
      setUser(authUser)
      await hydrateAuthUserFromSelf()
      return { ok: true }
    }
    catch {
      return { ok: false, message: tAuth('网络错误，请稍后重试') }
    }
  }

  return {
    user: readonly(user),
    isLoggedIn,
    authReady,
    hydrate,
    syncLoginState,
    setUser,
    logout,
    tryRegister,
    tryLogin,
    tryPhoneLogin,
    tryExchangeConsoleAccessTicket,
    verifyPasswordOnly,
  };
}

/** 认证相关倒计时（验证码、重发重置邮件等） */
export function useAuthCountdown(initialSeconds = 60) {
  const secondsLeft = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null

  const isActive = computed(() => secondsLeft.value > 0)

  function clear() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function start(seconds = initialSeconds) {
    clear()
    secondsLeft.value = seconds
    timer = setInterval(() => {
      if (secondsLeft.value <= 1) {
        secondsLeft.value = 0
        clear()
      }
      else {
        secondsLeft.value -= 1
      }
    }, 1000)
  }

  onUnmounted(clear)

  return { secondsLeft, isActive, start, clear }
}
