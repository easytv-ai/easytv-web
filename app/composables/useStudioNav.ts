export function useStudioNav() {
  const localePath = useLocalePath()

  /**
   * 左侧主导航只放六个入口。首页是 EasyTV Agent + 精选成片，探索是全部已发布作品；
   * 技能是技能库（广场 / 我的 / 我创建的），资产 / 主体 / 提示词并进项目标签，
   * 任务收进积分钱包，设置等收进右上角头像菜单。match 里的路径访问时高亮对应入口。
   * auth：未登录点击时不跳转，先弹登录框，登录成功后再进入该页。
   */
  const resourceLinks = [
    { to: '/agent', label: '首页', icon: 'i-lucide-house', match: [], auth: false },
    { to: '/explore', label: '探索', icon: 'i-lucide-compass', match: [], auth: false },
    { to: '/create', label: '创作', icon: 'i-lucide-wand-sparkles', match: [], auth: true },
    { to: '/projects', label: '项目', icon: 'i-lucide-folder', match: ['/assets', '/subjects', '/prompts'], auth: true },
    { to: '/skills', label: '技能', icon: 'i-lucide-sparkles', match: [], auth: false },
    { to: '/campaign', label: '活动', icon: 'i-lucide-trophy', match: [], auth: false },
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
