/**
 * 当前工作空间（API.md 20）：个人空间 / 团队空间。存 localStorage，所有请求带 `EasyTV-Team` 头。
 * 个人空间不带头；团队空间带团队 id，后端据此切换项目 / 资产 / 主体 / 任务 / 扣费范围。
 */
export const WORKSPACE_STORAGE_KEY = 'easytv_workspace'

/** 当前团队 id；个人空间为 0 */
export function readWorkspaceTeamId(): number {
  if (!import.meta.client)
    return 0
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY) || ''
    const m = /^team:(\d+)$/.exec(raw)
    return m ? Number(m[1]) : 0
  }
  catch {
    return 0
  }
}

const FORBIDDEN_NOTICE_KEY = 'easytv_workspace_forbidden'

/**
 * 接口回 data.reason=team_forbidden（已被移出团队 / 团队不对）：回到个人空间并整页重载，
 * 重载后由顶栏读一次提示（见 takeWorkspaceForbiddenNotice）。只处理一次，避免重载风暴。
 */
export function handleTeamForbidden(body: unknown) {
  if (!import.meta.client || readWorkspaceTeamId() <= 0)
    return
  const data = (body as { data?: { reason?: string } } | null)?.data
  if (data?.reason !== 'team_forbidden')
    return
  writeWorkspaceTeamId(0)
  try {
    sessionStorage.setItem(FORBIDDEN_NOTICE_KEY, String((body as { message?: string }).message || '1'))
  }
  catch {}
  window.location.reload()
}

/** 顶栏挂载时取出「已切回个人空间」的提示文案 */
export function takeWorkspaceForbiddenNotice(): string {
  if (!import.meta.client)
    return ''
  try {
    const msg = sessionStorage.getItem(FORBIDDEN_NOTICE_KEY) || ''
    sessionStorage.removeItem(FORBIDDEN_NOTICE_KEY)
    return msg
  }
  catch {
    return ''
  }
}

export function writeWorkspaceTeamId(teamId: number) {
  if (!import.meta.client)
    return
  try {
    if (teamId > 0)
      localStorage.setItem(WORKSPACE_STORAGE_KEY, `team:${teamId}`)
    else
      localStorage.removeItem(WORKSPACE_STORAGE_KEY)
  }
  catch {}
}
