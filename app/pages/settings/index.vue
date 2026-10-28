<script setup lang="ts">
/**
 * 设置页
 *
 * 只做 tab 切换壳 + 路由同步，各 Tab 内容拆到 ./components/settings-*.vue。
 * 子组件自管数据加载（onMounted 拉取），父页只在跨 tab 事件（团队/支付到账刷新钱包）时介入。
 *
 * 注销弹窗单独拆到 deactivate-modal.vue。
 * 口令红包逻辑复用 utils/bonus-code.ts（与 BonusCodeClaimModal、LoginRegister 共用）。
 * 自备密钥（BYOK）常量还在 constants/byokProviders.ts，没有后端接口，这里不开放 Tab。
 */
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import usageApi, { type UsageView } from '~/api/usage'

const { t } = useI18n()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
})

useHead({ title: t('设置') })

type Tab = 'profile' | 'works' | 'team' | 'invite' | 'creator' | 'partner' | 'partner-program' | 'orders' | 'invoice' | 'notify'
const route = useRoute()
const TABS: Tab[] = ['profile', 'works', 'team', 'invite', 'creator', 'partner', 'partner-program', 'orders', 'invoice', 'notify']
function resolveSettingsTab(raw: unknown): Tab {
  if (raw === 'affiliate')
    return 'invite'
  return TABS.includes(raw as Tab) ? raw as Tab : 'profile'
}
const tab = ref<Tab>(resolveSettingsTab(route.query.tab))
const allTabs: { id: Tab, label: string, icon: string }[] = [
  { id: 'profile', label: t('账号资料'), icon: 'i-lucide-user-round' },
  { id: 'works', label: t('我的作品'), icon: 'i-lucide-clapperboard' },
  { id: 'team', label: t('团队'), icon: 'i-lucide-users' },
  { id: 'invite', label: t('settings.invite.title'), icon: 'i-lucide-gift' },
  { id: 'creator', label: t('创作者中心'), icon: 'i-lucide-badge-dollar-sign' },
  { id: 'partner', label: t('创作伙伴计划'), icon: 'i-lucide-megaphone' },
  { id: 'partner-program', label: t('渠道伙伴'), icon: 'i-lucide-handshake' },
  { id: 'orders', label: t('订单'), icon: 'i-lucide-receipt' },
  { id: 'invoice', label: t('发票'), icon: 'i-lucide-file-text' },
  { id: 'notify', label: t('通知'), icon: 'i-lucide-bell' },
]
/** 发票入口跟 /app/config 的 invoice_enabled 走；关闭时直链 ?tab=invoice 显示「暂未开放」 */
const { invoiceEnabled, loaded: appConfigLoaded, loading: appConfigLoading } = useStudioAppConfig()
const tabs = computed(() => allTabs.filter(tb => tb.id !== 'invoice' || invoiceEnabled.value))

// 子组件按 Tab 懒加载：首屏只拉当前 Tab 的 chunk，切到别的 Tab 再加载对应代码
const SettingsProfile = defineAsyncComponent(() => import('./components/settings-profile.vue'))
const SettingsWorks = defineAsyncComponent(() => import('./components/settings-works.vue'))
const SettingsTeam = defineAsyncComponent(() => import('./components/settings-team.vue'))
const SettingsInvite = defineAsyncComponent(() => import('./components/settings-invite.vue'))
const SettingsCreator = defineAsyncComponent(() => import('./components/settings-creator.vue'))
const SettingsPartner = defineAsyncComponent(() => import('./components/settings-partner.vue'))
const SettingsPartnerProgram = defineAsyncComponent(() => import('./components/settings-partner-program.vue'))
const SettingsOrders = defineAsyncComponent(() => import('./components/settings-orders.vue'))
const SettingsInvoice = defineAsyncComponent(() => import('./components/settings-invoice.vue'))
const SettingsNotify = defineAsyncComponent(() => import('./components/settings-notify.vue'))
const DeactivateModal = defineAsyncComponent(() => import('./components/deactivate-modal.vue'))

const settingsPanels: Record<Tab, Component> = {
  profile: SettingsProfile,
  works: SettingsWorks,
  team: SettingsTeam,
  invite: SettingsInvite,
  creator: SettingsCreator,
  partner: SettingsPartner,
  'partner-program': SettingsPartnerProgram,
  orders: SettingsOrders,
  invoice: SettingsInvoice,
  notify: SettingsNotify,
}

const activeSettingsPanel = computed(() => settingsPanels[tab.value])

// 订单、资料这些页有多个根节点。Transition 的 out-in 离开这种片段时等不到动画结束，
// 右侧会一直空白，后面再点别的页也不再显示。包成单根后再交给切换动画。
const SettingsPane = defineComponent({
  name: 'SettingsPane',
  props: {
    panel: { type: Object, required: true },
    panelProps: { type: Object, required: true },
  },
  emits: ['refreshed', 'team-changed', 'paid', 'goto-invoice', 'goto-pricing'],
  setup(props, { emit }) {
    return () => h('div', { class: 'settings-pane' }, [
      h(props.panel as any, {
        ...(props.panelProps as any),
        onRefreshed: () => emit('refreshed'),
        onTeamChanged: () => emit('team-changed'),
        onPaid: () => emit('paid'),
        onGotoInvoice: () => emit('goto-invoice'),
        onGotoPricing: (kind: 'membership' | 'points') => emit('goto-pricing', kind),
      }),
    ])
  },
})
const activeSettingsProps = computed(() => {
  if (tab.value === 'profile') {
    return {
      usage: usage.value,
      usageReady: !!usage.value,
      requestDeactivate,
    }
  }
  if (tab.value === 'invoice') {
    return {
      invoiceEnabled: invoiceEnabled.value,
      appConfigLoaded: appConfigLoaded.value,
      appConfigLoading: appConfigLoading.value,
    }
  }
  if (tab.value === 'orders')
    return { invoiceEnabled: invoiceEnabled.value }
  if (tab.value === 'notify')
    return { username: user.value?.username || '' }
  return {}
})

const { user } = useAuth()
const { refresh: refreshWallet } = useWallet()
const { gotoPricing } = usePricingModal()

// 注销弹窗由 profile tab 触发，弹窗本身在页面级渲染
const deactivateOpen = ref(false)
function requestDeactivate() {
  deactivateOpen.value = true
}

// 套餐额度与用量：profile tab 展示，页面级加载
const usage = ref<UsageView | null>(null)
async function loadUsage() {
  const res = await usageApi.mine()
  if (res?.success && res.data)
    usage.value = res.data
}

/** URL ?tab= 与当前标签同步（外链或刷新时落到对应页） */
watch(() => route.query.tab, (next) => {
  const resolved = resolveSettingsTab(next)
  if (tab.value !== resolved)
    tab.value = resolved
})

onMounted(() => {
  void loadUsage()
  void refreshWallet()
})
</script>

<template>
  <section class="settings-page">
    <div class="show-page__inner">
      <header class="projects-toolbar">
        <div class="projects-toolbar__left">
          <h1>{{ t('设置') }}</h1>
        </div>
      </header>

      <div class="settings-layout">
        <nav class="settings-tabs">
          <button
            v-for="tb in tabs"
            :key="tb.id"
            type="button"
            :class="{ 'is-on': tab === tb.id }"
            @click="tab = tb.id"
          >
            <UIcon :name="tb.icon" class="size-4" />
            {{ tb.label }}
          </button>
        </nav>

        <div class="settings-body">
          <Transition name="settings-pane" mode="out-in">
            <KeepAlive :max="8">
              <SettingsPane
                :key="tab"
                :panel="activeSettingsPanel"
                :panel-props="activeSettingsProps"
                @refreshed="refreshWallet"
                @team-changed="refreshWallet"
                @paid="refreshWallet"
                @goto-invoice="tab = 'invoice'"
                @goto-pricing="(kind: 'membership' | 'points') => gotoPricing(kind)"
              />
            </KeepAlive>
          </Transition>
        </div>
      </div>
    </div>

    <!-- 注销账号确认弹窗 -->
    <DeactivateModal v-model:open="deactivateOpen" />
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
