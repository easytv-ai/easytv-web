import teamApi, { type TeamSpace } from '~/api/team'
import { readWorkspaceTeamId, writeWorkspaceTeamId } from '~/utils/workspace'

/**
 * 个人空间 / 团队空间（API.md 20）。切换后整页重载进项目页：项目、资产、主体、任务、钱包都按新空间重新拉。
 */
export function useWorkspace() {
  const teamId = useState('workspace-team-id', () => readWorkspaceTeamId())
  const teams = useState<TeamSpace[]>('workspace-teams', () => [])
  const loaded = useState('workspace-teams-loaded', () => false)
  const teamsFailed = useState('workspace-teams-failed', () => false)
  const localePath = useLocalePath()

  const isTeam = computed(() => teamId.value > 0)
  const currentTeam = computed(() => teams.value.find(item => item.id === teamId.value) ?? null)
  /** 团队里的查看者不能生成、不能改队友画布 */
  const canGenerate = computed(() => !isTeam.value || currentTeam.value?.permission !== 'viewer')
  const isTeamAdmin = computed(() => isTeam.value && currentTeam.value?.permission === 'admin')

  async function loadTeams(force = false) {
    if (!import.meta.client)
      return
    // useState 的初值来自服务端（服务端读不到 localStorage，恒为 0），挂载后再以本地记录为准
    const stored = readWorkspaceTeamId()
    if (teamId.value !== stored)
      teamId.value = stored
    if (loaded.value && !force)
      return
    try {
      const res = await teamApi.spaces()
      if (!res?.success || !res.data) {
        teamsFailed.value = teams.value.length === 0
        return
      }
      teams.value = res.data.items ?? []
      teamsFailed.value = false
      loaded.value = true
    }
    catch {
      teamsFailed.value = teams.value.length === 0
      return
    }
    // 已被移出团队 / 团队解散：自动回到个人空间
    if (teamId.value > 0 && !teams.value.some(item => item.id === teamId.value))
      switchTo(0)
  }

  function switchTo(id: number, path = '/projects') {
    if (!import.meta.client)
      return
    writeWorkspaceTeamId(id)
    teamId.value = id
    window.location.assign(localePath(path))
  }

  return { teamId, teams, teamsFailed, isTeam, currentTeam, canGenerate, isTeamAdmin, loadTeams, switchTo }
}
