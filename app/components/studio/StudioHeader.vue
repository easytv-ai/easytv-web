<script setup lang="ts">
import { AUTH_SESSION_COOKIE } from '~/utils/auth-session-cookie'
import { takeWorkspaceForbiddenNotice } from '~/utils/workspace'

const { t } = useI18n()
const localePath = useLocalePath()
const { pricingOpen, pricingTab, gotoPricing } = usePricingModal()
const { isLoggedIn, hydrate } = useAuth()
const { wallet, formatBalance, refresh, walletOpen, openWallet } = useWallet()
const { openInbox, unreadCount, refreshUnread } = useStudioInbox()
const { requireLogin } = useRequireLogin()
const { openLogin } = useLoginModal()
const { checkinPending, loadCheckin } = useGrowth()
const { activeCount } = useTaskActivity()
const { isTeam, currentTeam, loadTeams } = useWorkspace()
useTaskActivityPolling()

/**
 * 技能页等匿名可看的页面也用本布局：服务端只有登录标记 cookie，客户端才有 localStorage 会话。
 * 两者取并集决定出「钱包 / 消息」还是「登录」按钮，避免 SSR 与客户端首帧不一致。
 */
const sessionCookie = useCookie(AUTH_SESSION_COOKIE)
const showUser = computed(() => isLoggedIn.value || String(sessionCookie.value ?? '') === '1')

if (import.meta.client)
  hydrate()

function onInbox() {
  if (requireLogin())
    openInbox()
}

onMounted(() => {
  hydrate()
  const forbidden = takeWorkspaceForbiddenNotice()
  if (forbidden) {
    useToast().add({
      title: forbidden === '1' ? t('你已不在该团队，已切回个人空间') : `${forbidden}（${t('已切回个人空间')}）`,
      color: 'error',
      close: false,
      progress: false,
    })
  }
  if (isLoggedIn.value)
    void loadTeams()
  void refresh()
  void refreshUnread()
  void loadCheckin()
})
watch(isLoggedIn, (on) => {
  if (on) {
    void refresh()
    void refreshUnread()
    void loadCheckin()
  }
})
</script>

<template>
  <header class="studio-header">
    <NuxtLink :to="localePath('/agent')" class="studio-header__brand">
      <img src="/images/logo.svg" alt="EasyTV" width="24" height="24" class="size-6">
      EasyTV
    </NuxtLink>
    <ClientOnly>
      <span v-if="showUser && isTeam" class="studio-chip studio-chip--space" :title="t('当前在团队空间')">
        <UIcon name="i-lucide-users" class="size-4" />
        {{ currentTeam?.name || t('团队空间') }}
      </span>
    </ClientOnly>
    <button
      v-if="showUser"
      type="button"
      class="studio-chip"
      :class="{ 'is-on': walletOpen || (pricingOpen && pricingTab === 'points') }"
      @click="isLoggedIn ? openWallet() : gotoPricing('points')"
    >
      <span class="studio-chip__icon">
        <UIcon name="i-lucide-wallet" class="size-4" />
        <i v-if="checkinPending" class="studio-chip__dot" :title="t('今天还没签到')" />
      </span>
      {{ isTeam ? t('团队积分') : t('积分钱包') }}
      <b v-if="wallet" class="studio-chip__num">{{ formatBalance() }}</b>
      <span
        v-if="isLoggedIn && activeCount"
        class="studio-chip__busy"
        :title="t('{n} 个任务生成中', { n: activeCount })"
        @click.stop="openWallet('tasks')"
      >
        <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
        {{ activeCount }}
      </span>
    </button>
    <button v-else type="button" class="studio-chip" @click="openLogin({ tab: 'login' })">
      <UIcon name="i-lucide-log-in" class="size-4" />
      {{ t('登录') }}
    </button>
    <button
      type="button"
      class="studio-chip studio-chip--gold"
      :class="{ 'is-on': pricingOpen && pricingTab === 'membership' }"
      @click="gotoPricing('membership')"
    >
      {{ wallet?.is_member ? t('{plan}会员', { plan: wallet.membership?.plan_name }) : t('开通会员') }}
    </button>
    <div class="studio-header__tools">
      <!-- 未登录没有头像菜单，语言与主题留在顶栏 -->
      <template v-if="!showUser">
        <SiteLocaleSwitcher />
        <ThemeToggle />
      </template>
      <button
        v-if="showUser"
        type="button"
        class="ea-icon-btn"
        :aria-label="t('消息中心')"
        @click="onInbox"
      >
        <UIcon name="i-lucide-bell" class="size-[18px]" />
        <b v-if="unreadCount" class="studio-bell__dot">{{ unreadCount > 99 ? '99+' : unreadCount }}</b>
        <span class="canvas-tip canvas-tip--down">{{ t('消息中心') }}</span>
      </button>
      <!-- 头像菜单依赖客户端会话（localStorage），只在客户端渲染，服务端先占位避免水合不一致 -->
      <ClientOnly v-if="showUser">
        <StudioUserMenu />
        <template #fallback>
          <span class="user-menu__trigger"><span class="user-menu__avatar user-menu__avatar--letter" /></span>
        </template>
      </ClientOnly>
    </div>
  </header>
</template>
