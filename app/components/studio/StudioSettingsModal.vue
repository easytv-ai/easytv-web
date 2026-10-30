<script setup lang="ts">
/**
 * 设置弹窗：右上角账号菜单打开，左侧分组导航 + 右侧标签内容。
 *
 * 各标签内容在 components/settings/settings-*.vue，自管数据加载；弹窗只在跨标签事件
 *（团队 / 支付到账刷新钱包、订单跳发票）时介入。关闭即卸载面板，下次打开重新拉数据。
 * 自备密钥（BYOK）常量还在 constants/byokProviders.ts，没有后端接口，这里不开放标签。
 */
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'
import usageApi, { type UsageView } from '~/api/usage'
import type { SettingsTab } from '~/composables/useSettingsModal'

const { t } = useI18n()
const route = useRoute()
const { user } = useAuth()
const { refresh: refreshWallet } = useWallet()
const { gotoPricing } = usePricingModal()
const { settingsOpen, settingsTab, closeSettings } = useSettingsModal()
/** 发票入口跟 /app/config 的 invoice_enabled 走；关闭时标签里显示「暂未开放」 */
const { invoiceEnabled, loaded: appConfigLoaded, loading: appConfigLoading } = useStudioAppConfig()

type NavItem = { id: SettingsTab, label: string, icon: string }

const NAV_GROUPS = computed<{ key: string, label: string, items: NavItem[] }[]>(() => [
  {
    key: 'account',
    label: t('settings.group.account'),
    items: [
      { id: 'profile', label: t('账号资料'), icon: 'i-lucide-user-round' },
      { id: 'works', label: t('我的作品'), icon: 'i-lucide-clapperboard' },
      { id: 'team', label: t('团队'), icon: 'i-lucide-users' },
      { id: 'notify', label: t('通知'), icon: 'i-lucide-bell' },
    ],
  },
  {
    key: 'earn',
    label: t('settings.group.earn'),
    items: [
      { id: 'invite', label: t('settings.invite.title'), icon: 'i-lucide-gift' },
      { id: 'creator', label: t('创作者中心'), icon: 'i-lucide-badge-dollar-sign' },
      { id: 'partner', label: t('创作伙伴计划'), icon: 'i-lucide-megaphone' },
      { id: 'partner-program', label: t('渠道伙伴'), icon: 'i-lucide-handshake' },
    ],
  },
  {
    key: 'billing',
    label: t('settings.group.billing'),
    items: [
      { id: 'orders', label: t('订单'), icon: 'i-lucide-receipt' },
      ...(invoiceEnabled.value ? [{ id: 'invoice' as const, label: t('发票'), icon: 'i-lucide-file-text' }] : []),
    ],
  },
])

const activeLabel = computed(() => {
  for (const group of NAV_GROUPS.value) {
    const hit = group.items.find(item => item.id === settingsTab.value)
    if (hit)
      return hit.label
  }
  return t('设置')
})

const nickname = computed(() => String(user.value?.nickname || user.value?.username || t('创作者')))
const avatar = computed(() => String(user.value?.avatar || ''))
const userId = computed(() => Number(user.value?.id ?? 0))

// 面板按标签懒加载：首开只拉当前标签的 chunk
const settingsPanels: Record<SettingsTab, Component> = {
  profile: defineAsyncComponent(() => import('~/components/settings/settings-profile.vue')),
  works: defineAsyncComponent(() => import('~/components/settings/settings-works.vue')),
  team: defineAsyncComponent(() => import('~/components/settings/settings-team.vue')),
  invite: defineAsyncComponent(() => import('~/components/settings/settings-invite.vue')),
  creator: defineAsyncComponent(() => import('~/components/settings/settings-creator.vue')),
  partner: defineAsyncComponent(() => import('~/components/settings/settings-partner.vue')),
  'partner-program': defineAsyncComponent(() => import('~/components/settings/settings-partner-program.vue')),
  orders: defineAsyncComponent(() => import('~/components/settings/settings-orders.vue')),
  invoice: defineAsyncComponent(() => import('~/components/settings/settings-invoice.vue')),
  notify: defineAsyncComponent(() => import('~/components/settings/settings-notify.vue')),
}
const DeactivateModal = defineAsyncComponent(() => import('~/components/settings/deactivate-modal.vue'))

const activePanel = computed(() => settingsPanels[settingsTab.value])

// 订单、资料这些面板有多个根节点。Transition 的 out-in 离开这种片段时等不到动画结束，
// 右侧会一直空白，后面再点别的标签也不再显示。包成单根后再交给切换动画。
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

const usage = ref<UsageView | null>(null)
const deactivateOpen = ref(false)

const activePanelProps = computed(() => {
  if (settingsTab.value === 'profile') {
    return {
      usage: usage.value,
      usageReady: !!usage.value,
      requestDeactivate: () => { deactivateOpen.value = true },
    }
  }
  if (settingsTab.value === 'invoice') {
    return {
      invoiceEnabled: invoiceEnabled.value,
      appConfigLoaded: appConfigLoaded.value,
      appConfigLoading: appConfigLoading.value,
    }
  }
  if (settingsTab.value === 'orders')
    return { invoiceEnabled: invoiceEnabled.value }
  if (settingsTab.value === 'notify')
    return { username: user.value?.username || '' }
  return {}
})

async function loadUsage() {
  try {
    const res = await usageApi.mine()
    if (res?.success && res.data)
      usage.value = res.data
  }
  catch {
    usage.value = null
  }
}

const bodyRef = ref<HTMLElement | null>(null)
const navRef = ref<HTMLElement | null>(null)

function selectTab(next: SettingsTab) {
  settingsTab.value = next
}

/** 手机上导航是横向滚动条，从外部直接打开某个标签时要把它滚进视野 */
async function revealActiveTab() {
  await nextTick()
  navRef.value?.querySelector('button.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

watch(settingsTab, () => {
  bodyRef.value?.scrollTo({ top: 0 })
  void revealActiveTab()
})

watch(settingsOpen, (open) => {
  if (!import.meta.client)
    return
  document.body.style.overflow = open ? 'hidden' : ''
  if (!open)
    return
  void loadUsage()
  void refreshWallet()
  void revealActiveTab()
}, { immediate: true })

// 面板里的站内链接（作品、协议、技能库等）跳走时收起弹窗
watch(() => route.fullPath, () => {
  if (settingsOpen.value)
    closeSettings()
})

/** 弹窗里还叠着二次确认、发票抽屉等对话框时，Esc 交给最上层的那个 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !settingsOpen.value || deactivateOpen.value)
    return
  if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1)
    return
  closeSettings()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (import.meta.client)
    document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="settings-modal" appear>
      <div v-if="settingsOpen" class="settings-modal-mask" @click.self="closeSettings">
        <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
          <aside class="settings-modal__side">
            <div class="settings-modal__who">
              <img v-if="avatar" :src="avatar" alt="" class="settings-modal__avatar">
              <span v-else class="settings-modal__avatar">{{ nickname.slice(0, 1).toUpperCase() }}</span>
              <span class="settings-modal__name">
                <strong :title="nickname">{{ nickname }}</strong>
                <small>ID {{ userId }}</small>
              </span>
            </div>
            <nav ref="navRef" class="settings-modal__nav" :aria-label="t('设置')">
              <div v-for="group in NAV_GROUPS" :key="group.key" class="settings-modal__group">
                <p>{{ group.label }}</p>
                <button
                  v-for="item in group.items"
                  :key="item.id"
                  type="button"
                  :class="{ 'is-on': settingsTab === item.id }"
                  :aria-current="settingsTab === item.id ? 'page' : undefined"
                  @click="selectTab(item.id)"
                >
                  <UIcon :name="item.icon" class="size-4" />
                  <span>{{ item.label }}</span>
                </button>
              </div>
            </nav>
          </aside>

          <section class="settings-modal__main">
            <header class="settings-modal__head">
              <h2 id="settings-modal-title">{{ activeLabel }}</h2>
              <button type="button" class="settings-modal__close" :aria-label="t('关闭')" @click="closeSettings">
                <UIcon name="i-lucide-x" class="size-5" />
              </button>
            </header>
            <div ref="bodyRef" class="settings-modal__body settings-body">
              <Transition name="settings-pane" mode="out-in">
                <KeepAlive :max="8">
                  <SettingsPane
                    :key="settingsTab"
                    :panel="activePanel"
                    :panel-props="activePanelProps"
                    @refreshed="refreshWallet"
                    @team-changed="refreshWallet"
                    @paid="refreshWallet"
                    @goto-invoice="selectTab('invoice')"
                    @goto-pricing="(kind: 'membership' | 'points') => gotoPricing(kind)"
                  />
                </KeepAlive>
              </Transition>
            </div>
          </section>
        </div>
      </div>
    </Transition>
    <DeactivateModal v-model:open="deactivateOpen" />
  </Teleport>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
