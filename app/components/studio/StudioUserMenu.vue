<script setup lang="ts">
/**
 * 右上角头像菜单：账号与工作空间、会员、积分、存储空间，以及原来散在左侧「设置」里的入口。
 * 语言、主题也收在这里，顶栏只留高频操作。
 */
import usageApi, { type UsageView } from '~/api/usage'

const { t } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const { user, logout } = useAuth()
const { wallet, balance, isMember, membership, openWallet } = useWallet()
const { gotoPricing } = usePricingModal()
const { confirm } = useConfirm()
const { activeCount } = useTaskActivity()
const { isDark, setTheme } = useTheme()
const toast = useToast()
const { invoiceEnabled } = useStudioAppConfig()
const { teams, teamsFailed, isTeam, currentTeam, loadTeams, switchTo } = useWorkspace()
const switcherOpen = ref(false)
/** 画布外的「新手跟练」入口：置位后 workspace 会起跟练会话 */
const practiceOpen = useState('canvas-practice-open', () => false)

const PERMISSION_LABEL: Record<string, string> = {
  admin: t('管理员'),
  editor: t('编辑者'),
  viewer: t('查看者'),
}

function teamRoleText(item: { role: string, permission: string }) {
  return item.role === 'owner' ? t('负责人') : (PERMISSION_LABEL[item.permission] || '')
}

function onSwitch(id: number) {
  switcherOpen.value = false
  open.value = false
  switchTo(id)
}

const open = ref(false)
const usage = ref<UsageView | null>(null)

const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

const userId = computed(() => Number(user.value?.id ?? 0))
const nickname = computed(() => String(user.value?.nickname || user.value?.username || t('创作者')))
const avatar = computed(() => String(user.value?.avatar || ''))
const initial = computed(() => nickname.value.trim().slice(0, 1).toUpperCase() || 'E')

watch(open, (on) => {
  if (!on)
    return
  void loadTeams(true)
  void usageApi.mine().then((res) => {
    if (res?.success && res.data)
      usage.value = res.data
  }).catch(() => {})
})

const memberLine = computed(() => {
  const m = membership.value
  if (!m)
    return t('未开通会员')
  return t('{plan}会员 · {date} 到期', { plan: m.plan_name, date: fmtDate(m.expires_at) })
})

function fmtDate(ts?: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtBytes(n?: number) {
  const v = Number(n || 0)
  if (v >= 1024 ** 3)
    return `${(v / 1024 ** 3).toFixed(1)}G`
  if (v >= 1024 ** 2)
    return `${Math.round(v / 1024 ** 2)}M`
  return `${Math.round(v / 1024)}K`
}

const storagePct = computed(() => {
  const s = usage.value?.storage
  if (!s?.limit_bytes)
    return 0
  return Math.min(100, Math.round((s.used_bytes / s.limit_bytes) * 100))
})

async function copyId() {
  try {
    await navigator.clipboard.writeText(String(userId.value))
    toast.add({ title: t('已复制'), close: false, progress: false })
  }
  catch {}
}

function go(path: string, query?: Record<string, string>) {
  open.value = false
  void navigateTo(localePath({ path, query }))
}

function startGuide() {
  open.value = false
  // 新手跟练（回放式）：画布外的入口用 useState 通知 workspace 起会话；
  // 跟练里不会真的生成，随时可退出并还原画布。
  practiceOpen.value = true
  if (/\/canvas\/?$/.test(route.path))
    return
  void navigateTo(localePath('/canvas'))
}

function onWallet(tab: 'overview' | 'logs' | 'tasks') {
  open.value = false
  openWallet(tab)
}

function onPricing(tab: 'membership' | 'points') {
  open.value = false
  gotoPricing(tab)
}

async function onLogout() {
  open.value = false
  if (!(await confirm({
    title: t('退出登录'),
    message: t('退出后需要重新登录才能继续创作。'),
    confirmText: t('退出登录'),
    danger: true,
  })))
    return
  const res = await logout()
  if (!res.ok) {
    toast.add({ title: res.message ?? t('退出登录失败'), color: 'error', close: false, progress: false })
    return
  }
  await navigateTo(localePath('/'))
}

const menuItems = computed(() => [
  { key: 'guide', label: t('新手跟练'), icon: 'i-lucide-list', action: startGuide },
  { key: 'profile', label: t('个人中心'), icon: 'i-lucide-user-round', action: () => go('/settings', { tab: 'profile' }) },
  { key: 'home', label: t('我的主页'), icon: 'i-lucide-clapperboard', action: () => go(`/author/${userId.value}`) },
  { key: 'invite', label: t('settings.invite.title'), icon: 'i-lucide-gift', action: () => go('/settings', { tab: 'invite' }) },
  { key: 'creator', label: t('创作者中心'), icon: 'i-lucide-badge-dollar-sign', action: () => go('/settings', { tab: 'creator' }) },
  { key: 'partner', label: t('创作伙伴计划'), icon: 'i-lucide-megaphone', action: () => go('/settings', { tab: 'partner' }) },
  { key: 'partner-program', label: t('渠道伙伴'), icon: 'i-lucide-handshake', action: () => go('/settings', { tab: 'partner-program' }) },
  // 发票功能开启后（API.md 21）订单页有「开发票」入口，先落到订单
  { key: 'orders', label: invoiceEnabled.value ? t('订单与发票') : t('订单'), icon: 'i-lucide-receipt', action: () => go('/settings', { tab: 'orders' }) },
  { key: 'team', label: isTeam.value ? t('团队管理') : t('团队'), icon: 'i-lucide-users', action: () => go('/settings', { tab: 'team' }) },
])
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
    :ui="{ content: 'user-menu-pop' }"
  >
    <button type="button" class="user-menu__trigger" :aria-label="t('账号菜单')" :aria-expanded="open">
      <img v-if="mounted && avatar" :src="avatar" alt="" class="user-menu__avatar">
      <span v-else class="user-menu__avatar user-menu__avatar--letter">{{ mounted ? initial : '' }}</span>
      <span class="canvas-tip canvas-tip--down">{{ t('账号菜单') }}</span>
    </button>

    <template #content>
      <div class="user-menu">
        <section class="user-menu__account">
          <img v-if="avatar" :src="avatar" alt="" class="user-menu__avatar user-menu__avatar--lg">
          <span v-else class="user-menu__avatar user-menu__avatar--lg user-menu__avatar--letter">{{ initial }}</span>
          <div class="user-menu__who">
            <strong>{{ nickname }}</strong>
            <span class="user-menu__space">
              <template v-if="isTeam && currentTeam">
                <UIcon name="i-lucide-users" class="size-3" />
                {{ currentTeam.name }} · {{ teamRoleText(currentTeam) }}
              </template>
              <template v-else>
                <button type="button" class="user-menu__id" @click="copyId">
                  ID {{ userId }}
                  <UIcon name="i-lucide-copy" class="size-3" />
                </button>
              </template>
            </span>
          </div>
          <UPopover
            v-model:open="switcherOpen"
            :content="{ align: 'end', side: 'left', sideOffset: 12 }"
            :ui="{ content: 'user-menu-pop space-switcher-pop' }"
          >
            <button type="button" class="user-menu__switch" :aria-expanded="switcherOpen">
              <UIcon name="i-lucide-arrow-left-right" class="size-3.5" />
              {{ t('切换空间') }}
            </button>
            <template #content>
              <div class="space-switcher">
                <p class="space-switcher__group">{{ t('个人空间') }}</p>
                <button type="button" class="space-switcher__item" :class="{ 'is-on': !isTeam }" @click="onSwitch(0)">
                  <img v-if="avatar" :src="avatar" alt="" class="user-menu__avatar">
                  <span v-else class="user-menu__avatar user-menu__avatar--letter">{{ initial }}</span>
                  <span class="space-switcher__text">
                    <b>{{ nickname }}</b>
                    <small>{{ memberLine }}</small>
                  </span>
                  <UIcon v-if="!isTeam" name="i-lucide-check" class="size-4" />
                </button>

                <p class="space-switcher__group">{{ t('团队空间') }}</p>
                <button
                  v-for="item in teams"
                  :key="item.id"
                  type="button"
                  class="space-switcher__item"
                  :class="{ 'is-on': isTeam && currentTeam?.id === item.id }"
                  @click="onSwitch(item.id)"
                >
                  <span class="user-menu__avatar user-menu__avatar--letter user-menu__avatar--team">{{ item.name.slice(0, 1) }}</span>
                  <span class="space-switcher__text">
                    <b>{{ item.name }} <em>{{ teamRoleText(item) }}</em></b>
                    <small>
                      {{ t('{n} 位成员', { n: item.member_count }) }}
                      <template v-if="!item.edition_active"> · {{ t('团队版已过期') }}</template>
                    </small>
                  </span>
                  <UIcon v-if="isTeam && currentTeam?.id === item.id" name="i-lucide-check" class="size-4" />
                </button>
                <p v-if="teamsFailed && !teams.length" class="space-switcher__empty">{{ t('加载失败，请稍后重试') }}</p>
                <p v-else-if="!teams.length" class="space-switcher__empty">{{ t('还没有加入团队') }}</p>

                <button type="button" class="space-switcher__item space-switcher__create" @click="switcherOpen = false; go('/settings', { tab: 'team' })">
                  <UIcon :name="teams.length ? 'i-lucide-settings-2' : 'i-lucide-plus'" class="size-4" />
                  <span class="space-switcher__text"><b>{{ teams.length ? t('团队管理') : t('创建或加入团队') }}</b></span>
                </button>
              </div>
            </template>
          </UPopover>
        </section>

        <section class="user-menu__card user-menu__member" :class="{ 'is-member': isMember }">
          <span>{{ memberLine }}</span>
          <button type="button" class="user-menu__pill" @click="onPricing('membership')">
            {{ isMember ? t('续费') : t('开通会员') }}
          </button>
        </section>

        <section class="user-menu__card">
          <div class="user-menu__row">
            <button type="button" class="user-menu__link user-menu__balance" @click="onWallet('overview')">
              {{ isTeam ? t('团队积分') : t('积分余额') }} <b>{{ balance.toLocaleString() }}</b>
              <UIcon name="i-lucide-chevron-right" class="size-3.5" />
            </button>
            <span class="user-menu__actions">
              <button type="button" class="user-menu__link" @click="onPricing('points')">{{ t('充值') }}</button>
              <i />
              <button type="button" class="user-menu__link" @click="onWallet('logs')">{{ t('明细') }}</button>
            </span>
          </div>
          <button type="button" class="user-menu__sub user-menu__link" @click="onWallet('tasks')">
            <span v-if="activeCount">{{ t('{n} 个任务生成中', { n: activeCount }) }}</span>
            <span v-else>{{ t('生成任务与积分消耗') }}</span>
            <template v-if="wallet?.frozen"> · {{ t('占用 {n} 积分', { n: wallet.frozen }) }}</template>
            <UIcon name="i-lucide-chevron-right" class="size-3.5" />
          </button>
        </section>

        <section v-if="usage?.storage" class="user-menu__card">
          <div class="user-menu__row">
            <span>{{ t('存储空间') }}</span>
            <button type="button" class="user-menu__link" @click="go('/assets')">{{ t('管理资产') }}</button>
          </div>
          <p class="user-menu__storage">
            <b>{{ fmtBytes(usage.storage.used_bytes) }}</b>
            <small>/ {{ fmtBytes(usage.storage.limit_bytes) }}</small>
          </p>
          <span class="user-menu__bar"><i :style="{ width: `${storagePct}%` }" /></span>
        </section>

        <nav class="user-menu__list">
          <button v-for="item in menuItems" :key="item.key" type="button" class="user-menu__item" @click="item.action()">
            <UIcon :name="item.icon" class="size-4" />
            <span class="user-menu__label">{{ item.label }}</span>
          </button>
        </nav>

        <div class="user-menu__list">
          <div class="user-menu__item user-menu__item--static">
            <UIcon name="i-lucide-languages" class="size-4" />
            <span class="user-menu__label">{{ t('语言') }}</span>
            <SiteLocaleSwitcher variant="menu-row" />
          </div>
          <div class="user-menu__item user-menu__item--static">
            <UIcon name="i-lucide-sun-moon" class="size-4" />
            <span class="user-menu__label">{{ t('主题') }}</span>
            <span class="user-menu__theme" role="group" :aria-label="t('主题')">
              <button type="button" :class="{ 'is-on': mounted && !isDark }" :aria-pressed="mounted && !isDark" :aria-label="t('浅色')" @click="setTheme('light', $event)">
                <UIcon name="i-lucide-sun" class="size-3.5" />
              </button>
              <button type="button" :class="{ 'is-on': mounted && isDark }" :aria-pressed="mounted && isDark" :aria-label="t('深色')" @click="setTheme('dark', $event)">
                <UIcon name="i-lucide-moon" class="size-3.5" />
              </button>
            </span>
          </div>
        </div>

        <div class="user-menu__list">
          <button type="button" class="user-menu__item" @click="go('/')">
            <UIcon name="i-lucide-globe" class="size-4" />
            <span class="user-menu__label">{{ t('前往官网') }}</span>
          </button>
          <button type="button" class="user-menu__item" @click="onLogout">
            <UIcon name="i-lucide-log-out" class="size-4" />
            <span class="user-menu__label">{{ t('退出登录') }}</span>
          </button>
        </div>
      </div>
    </template>
  </UPopover>
</template>
