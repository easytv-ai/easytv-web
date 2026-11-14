/**
 * 画布检查器在模型清单为空时给谁看什么提示。
 * 普通用户只能找运营 / 管理员；管理员本人可以直接去运营后台开通，所以多给一个入口。
 */

/** 与后端一致：role >= 10 为管理员（10 管理员 / 100 超级管理员） */
const ROLE_ADMIN = 10

/**
 * 登录用户对象里用到的两个字段：role（GET /user/self 同步来的角色）、
 * console_access（后台「进入控制台」代登的会话：看到的是被代登用户的界面，不当作管理员）。
 */
export type NoModelsViewer = Readonly<Record<string, unknown>> | null | undefined

export type NoModelsHint = {
  audience: 'admin' | 'user'
  /** 运营后台地址；空串表示没有可用地址，只显示文案不显示链接。只有 audience=admin 时才会有值 */
  manageUrl: string
}

/** 只接受 http(s) 地址，去掉末尾斜杠；其余一律当作没配 */
export function normalizeManageUrl(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!/^https?:\/\/[^\s/]+/i.test(text))
    return ''
  return text.replace(/\/+$/, '')
}

export function isStudioAdmin(viewer: NoModelsViewer): boolean {
  if (!viewer || viewer.console_access)
    return false
  const role = Number(viewer.role)
  return Number.isFinite(role) && role >= ROLE_ADMIN
}

export function resolveNoModelsHint(viewer: NoModelsViewer, manageUrl: unknown): NoModelsHint {
  if (!isStudioAdmin(viewer))
    return { audience: 'user', manageUrl: '' }
  return { audience: 'admin', manageUrl: normalizeManageUrl(manageUrl) }
}
