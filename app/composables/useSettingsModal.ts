export type SettingsTab = 'profile' | 'works' | 'team' | 'invite' | 'creator' | 'partner' | 'partner-program' | 'orders' | 'invoice' | 'notify'

export const SETTINGS_TABS: SettingsTab[] = ['profile', 'works', 'team', 'invite', 'creator', 'partner', 'partner-program', 'orders', 'invoice', 'notify']

/** 外链 / 旧书签里的 ?tab= 归一到合法标签；affiliate 是推广返利的旧名 */
export function resolveSettingsTab(raw: unknown): SettingsTab {
  if (raw === 'affiliate')
    return 'invite'
  return SETTINGS_TABS.includes(raw as SettingsTab) ? raw as SettingsTab : 'profile'
}

/** 设置弹窗：右上角账号菜单等入口打开，挂在 studio 布局与画布页 */
export function useSettingsModal() {
  const settingsOpen = useState('settings-modal-open', () => false)
  const settingsTab = useState<SettingsTab>('settings-modal-tab', () => 'profile')
  /** 首次打开后才挂载弹窗（懒加载 chunk 与面板样式），之后常驻以保留关闭动画 */
  const settingsMounted = useState('settings-modal-mounted', () => false)

  function openSettings(tab: SettingsTab = 'profile') {
    const { isLoggedIn } = useAuth()
    if (!isLoggedIn.value) {
      // 登录后回到 /settings 兼容页，再由它打开对应标签
      useLoginModal().openLogin({ tab: 'login', redirect: `/settings?tab=${tab}` })
      return
    }
    settingsTab.value = tab
    settingsMounted.value = true
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  return {
    settingsOpen,
    settingsTab,
    settingsMounted,
    openSettings,
    closeSettings,
  }
}
