import billingApi from '~/api/billing'
import type { Wallet } from '~/types/creative'

/** 积分钱包：GET /user/wallet，跨组件共享；下单成功、任务创建后调用 refresh()。 */
export function useWallet() {
  const wallet = useState<Wallet | null>('billing-wallet', () => null)
  const loading = useState('billing-wallet-loading', () => false)
  const walletOpen = useState('billing-wallet-open', () => false)
  /** 钱包面板当前标签：概览 / 积分流水 / 任务（任务收进钱包，看积分变化就能看到任务） */
  const walletTab = useState<'overview' | 'logs' | 'tasks'>('billing-wallet-tab', () => 'overview')

  function openWallet(tab: 'overview' | 'logs' | 'tasks' = 'overview') {
    walletTab.value = tab
    walletOpen.value = true
  }

  function closeWallet() {
    walletOpen.value = false
  }
  const { isLoggedIn } = useAuth()

  const balance = computed(() => wallet.value?.balance ?? 0)
  const isMember = computed(() => Boolean(wallet.value?.is_member))
  const membership = computed(() => wallet.value?.membership ?? null)

  async function refresh() {
    if (!import.meta.client || !isLoggedIn.value || loading.value)
      return
    loading.value = true
    try {
      const res = await billingApi.wallet()
      if (res?.success && res.data)
        wallet.value = res.data
    }
    finally {
      loading.value = false
    }
  }

  function formatBalance() {
    const v = balance.value
    return v >= 10000 ? `${(v / 10000).toFixed(1)}w` : String(v)
  }

  return {
    wallet,
    balance,
    isMember,
    membership,
    loading,
    walletOpen,
    walletTab,
    openWallet,
    closeWallet,
    refresh,
    formatBalance,
  }
}
