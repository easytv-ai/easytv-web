<script setup lang="ts">
import contentApi, { type Notice } from '~/api/content'
import notificationApi from '~/api/notification'
import type { Notification } from '~/types/creative'

const { t } = useI18n()

const { inboxOpen, closeInbox, unreadCount, markRead, markAllRead, refreshUnread } = useStudioInbox()
const { isLoggedIn } = useAuth()
const localePath = useLocalePath()
const canDismiss = ref(false)
const expanded = ref<string | null>(null)
type Tab = 'mine' | 'notice'
const tab = ref<Tab>('mine')
const PAGE_SIZE = 20

const {
  items: notices,
  busy: noticesBusy,
  failed: noticesFailed,
  loadingMore: noticesLoadingMore,
  hasMore: noticesHasMore,
  total: noticesTotal,
  reload: reloadNotices,
  loadMore: loadMoreNotices,
} = useStudioPaged<Notice>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await contentApi.notices({ page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

const {
  items: notifications,
  busy: notificationsBusy,
  failed: notificationsFailed,
  loadingMore: notificationsLoadingMore,
  hasMore: notificationsHasMore,
  reload: reloadNotifications,
  loadMore: loadMoreNotifications,
} = useStudioPaged<Notification>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    if (!isLoggedIn.value)
      return { items: [], total: 0 }
    const res = await notificationApi.list({ page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

function fmtTime(ts: number) {
  if (!ts)
    return ''
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60)
    return t('刚刚')
  if (diff < 3600)
    return t('{n} 分钟前', { n: Math.floor(diff / 60) })
  if (diff < 86400)
    return t('{n} 小时前', { n: Math.floor(diff / 3600) })
  if (diff < 86400 * 7)
    return t('{n} 天前', { n: Math.floor(diff / 86400) })
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function typeIcon(type: string) {
  if (type === 'comment')
    return 'i-lucide-message-circle'
  if (type === 'like')
    return 'i-lucide-heart'
  if (type === 'work')
    return 'i-lucide-clapperboard'
  if (type === 'task')
    return 'i-lucide-sparkles'
  if (type === 'activity')
    return 'i-lucide-megaphone'
  return 'i-lucide-bell'
}

function stampRead(n: Notification) {
  if (n.read_at)
    return false
  n.read_at = Math.floor(Date.now() / 1000)
  return true
}

function onMarkRead(n: Notification) {
  if (stampRead(n))
    void markRead([n.id])
}

function onItemClick(n: Notification) {
  if (n.link) {
    go(n)
    return
  }
  toggleExpand(`n-${n.id}`)
}

async function onMarkAllRead() {
  if (!unreadCount.value)
    return
  for (const n of notifications.value)
    stampRead(n)
  await markAllRead()
}

async function loadAll() {
  await Promise.all([
    reloadNotices(),
    isLoggedIn.value ? reloadNotifications() : Promise.resolve(),
  ])
  if (!notifications.value.length && notices.value.length)
    tab.value = 'notice'
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    closeInbox()
}

function onMaskClick() {
  if (canDismiss.value)
    closeInbox()
}

function go(n: Notification) {
  if (stampRead(n))
    void markRead([n.id])
  closeInbox()
  if (n.link)
    void navigateTo(localePath(n.link))
}

function toggleExpand(id: string) {
  expanded.value = expanded.value === id ? null : id
}

const TYPE_LABEL: Record<Notification['type'], string> = {
  work: '作品',
  task: '生成',
  system: '系统',
  comment: '评论',
  like: '喜欢',
}

watch(inboxOpen, (open) => {
  if (!import.meta.client)
    return
  document.body.style.overflow = open ? 'hidden' : ''
  canDismiss.value = false
  if (open) {
    window.setTimeout(() => { canDismiss.value = true }, 80)
    tab.value = 'mine'
    void loadAll()
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void refreshUnread()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (import.meta.client)
    document.body.style.overflow = ''
})
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        v-if="inboxOpen"
        class="inbox-mask"
        @click.self="onMaskClick"
      >
        <aside class="inbox-panel" role="dialog" aria-modal="true" aria-labelledby="inbox-title">
          <header class="inbox-panel__head">
            <div>
              <h2 id="inbox-title">{{ t('消息中心') }}</h2>
              <p>{{ t('作品审核、生成任务与系统公告') }}</p>
            </div>
            <div class="inbox-panel__tools">
              <button
                v-if="unreadCount"
                type="button"
                class="inbox-panel__prefs"
                :aria-label="t('inbox.markAll')"
                @click="onMarkAllRead"
              >
                <UIcon name="i-lucide-check-check" class="size-4" />
                <span class="canvas-tip canvas-tip--down">{{ t('inbox.markAll') }}</span>
              </button>
              <NuxtLink :to="localePath('/settings?tab=notify')" class="inbox-panel__prefs" :aria-label="t('通知偏好')" @click="closeInbox">
                <UIcon name="i-lucide-settings-2" class="size-4" />
                <span class="canvas-tip canvas-tip--down">{{ t('通知偏好') }}</span>
              </NuxtLink>
              <button type="button" class="inbox-panel__close" :aria-label="t('关闭')" @click="closeInbox">
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </div>
          </header>
          <div class="inbox-panel__tabs">
            <button type="button" :class="{ 'is-on': tab === 'mine' }" @click="tab = 'mine'">
              {{ t('我的消息') }}<b v-if="unreadCount">{{ unreadCount }}</b>
            </button>
            <button type="button" :class="{ 'is-on': tab === 'notice' }" @click="tab = 'notice'">
              {{ t('公告') }}<b v-if="noticesTotal">{{ noticesTotal }}</b>
            </button>
          </div>

          <div class="inbox-panel__body">
            <StudioPaging
              v-if="tab === 'mine'"
              root=".inbox-panel__body"
              grid-class="notice-list"
              compact
              :loading="notificationsBusy"
              :error="notificationsFailed"
              :loading-more="notificationsLoadingMore"
              :has-more="notificationsHasMore"
              :count="notifications.length"
              :empty-title="t('暂无消息')"
              :empty-description="t('作品审核结果、生成任务异常会在这里通知你。')"
              :load-more="loadMoreNotifications"
            >
              <template #skeleton>
                <div v-for="n in 6" :key="n" class="notice-item">
                  <USkeleton class="size-9 shrink-0 rounded-full" />
                  <div>
                    <USkeleton class="h-3.5 w-2/5" />
                    <USkeleton class="mt-2 h-3 w-4/5" />
                  </div>
                </div>
              </template>
              <ul class="notice-list">
                <li
                  v-for="n in notifications"
                  :key="`n-${n.id}`"
                  class="notice-item"
                  :class="{
                    'is-open': expanded === `n-${n.id}`,
                    'is-unread': !n.read_at,
                    'is-link': Boolean(n.link),
                    [`is-${n.type}`]: true,
                  }"
                  @click="onItemClick(n)"
                >
                  <span class="notice-item__icon" :aria-label="t(TYPE_LABEL[n.type] || '系统')">
                    <UIcon :name="typeIcon(n.type)" class="size-4" />
                    <button
                      v-if="!n.read_at"
                      type="button"
                      class="notice-item__dot"
                      :aria-label="t('inbox.markOne')"
                      @click.stop="onMarkRead(n)"
                    />
                  </span>
                  <div class="notice-item__main">
                    <div class="notice-item__head">
                      <strong>{{ n.title }}</strong>
                      <span class="notice-item__when">
                        <button
                          v-if="!n.read_at"
                          type="button"
                          class="notice-item__read"
                          :aria-label="t('inbox.markOne')"
                          @click.stop="onMarkRead(n)"
                        >
                          <UIcon name="i-lucide-check" class="size-3.5" />
                        </button>
                        <time>{{ fmtTime(n.created_at) }}</time>
                      </span>
                    </div>
                    <p v-if="n.content" class="notice-item__body">{{ n.content }}</p>
                    <button v-if="n.link" type="button" class="notice-item__link" @click.stop="go(n)">
                      {{ t('前往查看') }}
                      <UIcon name="i-lucide-chevron-right" class="size-3.5" />
                    </button>
                  </div>
                </li>
              </ul>
            </StudioPaging>

            <StudioPaging
              v-else
              root=".inbox-panel__body"
              grid-class="notice-list"
              compact
              :loading="noticesBusy"
              :error="noticesFailed"
              :loading-more="noticesLoadingMore"
              :has-more="noticesHasMore"
              :count="notices.length"
              :empty-title="t('暂无公告')"
              :empty-description="t('有新公告时会在这里通知你。')"
              :load-more="loadMoreNotices"
            >
              <template #skeleton>
                <div v-for="n in 6" :key="n" class="notice-item">
                  <USkeleton class="size-9 shrink-0 rounded-full" />
                  <div>
                    <USkeleton class="h-3.5 w-2/5" />
                    <USkeleton class="mt-2 h-3 w-4/5" />
                  </div>
                </div>
              </template>
              <ul class="notice-list">
                <li
                  v-for="n in notices"
                  :key="`c-${n.id}`"
                  class="notice-item"
                  :class="{ 'is-open': expanded === `c-${n.id}`, [`is-${n.type}`]: true }"
                  @click="toggleExpand(`c-${n.id}`)"
                >
                  <span class="notice-item__icon" :aria-label="n.type === 'activity' ? t('活动') : t('系统')">
                    <UIcon :name="typeIcon(n.type)" class="size-4" />
                  </span>
                  <div class="notice-item__main">
                    <div class="notice-item__head">
                      <strong>{{ n.title }}</strong>
                      <em v-if="n.pinned">{{ t('置顶') }}</em>
                      <time>{{ fmtTime(n.published_at || n.created_at) }}</time>
                    </div>
                    <p v-if="n.content" class="notice-item__body">{{ n.content }}</p>
                  </div>
                </li>
              </ul>
            </StudioPaging>
          </div>
        </aside>
      </div>
    </Teleport>
  </ClientOnly>
</template>
