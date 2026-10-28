import notificationApi from '~/api/notification'

/**
 * 消息中心：公告（面向全员）+ 站内通知（发给本人，API.md 1.9）。
 * unreadCount 供侧栏铃铛角标。点红点或悬停勾只标已读；点正文或前往查看才跳转并标已读。
 */
export function useStudioInbox() {
  const inboxOpen = useState('studio-inbox-open', () => false)
  const unreadCount = useState('studio-inbox-unread', () => 0)
  const { isLoggedIn } = useAuth()

  async function refreshUnread() {
    if (!isLoggedIn.value)
      return
    try {
      const res = await notificationApi.list({ page: 1, page_size: 1, unread: 1 })
      if (res?.success && res.data)
        unreadCount.value = Number(res.data.unread_count) || 0
    }
    catch {
      // 未登录或网络错误时保持原值
    }
  }

  async function markRead(ids: number[]) {
    const unique = [...new Set(ids.filter(id => id > 0))]
    if (!unique.length)
      return
    const res = await notificationApi.read(unique)
    if (res?.success)
      unreadCount.value = Number(res.data?.unread_count) || 0
  }

  async function markAllRead() {
    if (!unreadCount.value)
      return
    const res = await notificationApi.read()
    if (res?.success)
      unreadCount.value = Number(res.data?.unread_count) || 0
  }

  function openInbox() {
    inboxOpen.value = true
  }

  function closeInbox() {
    inboxOpen.value = false
  }

  return { inboxOpen, unreadCount, refreshUnread, markRead, markAllRead, openInbox, closeInbox }
}
