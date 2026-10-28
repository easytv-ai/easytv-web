import inviteApi from '~/api/invite'

/** 当前用户的邀请码（GET /user/invite/summary → aff_code），跨组件共享，只拉一次；分享链接带 ?ref= 用（API.md 8.4） */
export function useMyInviteCode() {
  const affCode = useState('my-invite-aff-code', () => '')
  const loaded = useState('my-invite-aff-code-loaded', () => false)
  const { isLoggedIn } = useAuth()

  async function load() {
    if (!import.meta.client || !isLoggedIn.value || loaded.value)
      return affCode.value
    loaded.value = true
    const res = await inviteApi.summary()
    if (res?.success && res.data?.aff_code)
      affCode.value = String(res.data.aff_code)
    else
      loaded.value = false
    return affCode.value
  }

  return { affCode, load }
}
