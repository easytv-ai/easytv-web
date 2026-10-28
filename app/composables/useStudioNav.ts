export function useStudioNav() {
  const localePath = useLocalePath()

  /**
   * 左侧主导航只放五个入口；关注 / 榜单并进首页标签，资产 / 主体 / 提示词并进项目标签，
   * 任务收进积分钱包，设置等收进右上角头像菜单。match 里的路径访问时高亮对应入口。
   */
  const resourceLinks = [
    { to: '/studio', label: '首页', icon: 'i-lucide-house', match: ['/following', '/rank'] },
    { to: '/create', label: '创作', icon: 'i-lucide-wand-sparkles', match: [] },
    { to: '/projects', label: '项目', icon: 'i-lucide-folder', match: ['/assets', '/subjects', '/prompts'] },
    { to: '/agent', label: 'EasyTV Agent', icon: 'i-lucide-sparkles', match: [] },
    { to: '/campaign', label: '活动', icon: 'i-lucide-trophy', match: [] },
  ] as const

  /** 首页顶部标签 */
  const homeTabs = [
    { to: '/studio', label: '推荐' },
    { to: '/following', label: '关注' },
    { to: '/rank', label: '榜单' },
  ] as const

  /** 项目顶部标签：创作素材集中管理（画布里的选择器也能直接用） */
  const libraryTabs = [
    { to: '/projects', label: '项目' },
    { to: '/assets', label: '资产' },
    { to: '/subjects', label: '主体' },
    { to: '/prompts', label: '提示词' },
  ] as const

  /** 新建项目：直接进空白画布，首次保存时生成项目 */
  function openNewProject() {
    void navigateTo(localePath('/canvas'))
  }

  /** 打开项目：有画布进画布，没有就以项目为参数新建 */
  function openProject(item: { id: number, name?: string, canvas_id?: number }) {
    const params = new URLSearchParams()
    if (item.canvas_id)
      params.set('id', String(item.canvas_id))
    else
      params.set('project_id', String(item.id))
    if (item.name)
      params.set('name', item.name)
    void navigateTo(localePath(`/canvas?${params.toString()}`))
  }

  return {
    resourceLinks,
    homeTabs,
    libraryTabs,
    openNewProject,
    openProject,
  }
}
