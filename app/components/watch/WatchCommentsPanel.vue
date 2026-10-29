<script setup lang="ts">
import workApi from '~/api/work'
import type { WorkComment } from '~/types/creative'

const { t } = useI18n()

/**
 * 播放页评论抽屉：GET /work/:id/comments（一级分页 + 每条前 3 条回复），
 * 发表 / 回复 POST /user/work/:id/comment，删除 DELETE /user/comment/:id，举报交给父组件复用举报弹窗。
 */
const props = withDefaults(defineProps<{
  open?: boolean
  workId: number
  /** 作品作者：可删除任何评论 */
  ownerId: number
  /** 嵌在播放页右栏：不弹抽屉、不抢焦点，换作品时自动重新加载 */
  inline?: boolean
}>(), {
  open: false,
  inline: false,
})

const active = computed(() => props.inline || props.open)

const emit = defineEmits<{
  close: []
  /** 可见评论数变化（发表 / 删除后） */
  countChange: [delta: number]
  report: [commentId: number]
}>()

const toast = useToast()
const { confirm } = useConfirm()
const { user } = useAuth()
const { requireLogin } = useRequireLogin()

const PAGE_SIZE = 20
const list = ref<WorkComment[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const failed = ref(false)
const posting = ref(false)
const deleting = ref<number | null>(null)
const expanding = ref<number | null>(null)
const opened = ref<Set<number>>(new Set())
const draft = ref('')
const replyTo = ref<WorkComment | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const hasMore = computed(() => list.value.length < total.value)
const isOwner = computed(() => Boolean(user.value?.id && user.value.id === props.ownerId))
const canSend = computed(() => Boolean(draft.value.trim()) && !posting.value)

function fitInput() {
  const el = inputRef.value
  if (!el)
    return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 128)}px`
}

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function formatTime(ts: number) {
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

function canDelete(item: WorkComment) {
  return Boolean(item.mine || isOwner.value)
}

async function load(reset = true) {
  if (!props.workId)
    return
  if (reset) {
    page.value = 1
    loading.value = true
    failed.value = false
    opened.value = new Set()
  }
  else {
    loadingMore.value = true
  }
  try {
    const res = await workApi.comments(props.workId, { page: page.value, page_size: PAGE_SIZE })
    if (!res?.success || !res.data) {
      if (!reset)
        page.value = Math.max(1, page.value - 1)
      failed.value = list.value.length === 0
      notify(res?.message || t('评论加载失败'), 'error')
      return
    }
    list.value = reset ? res.data.items : [...list.value, ...res.data.items]
    total.value = res.data.total
    failed.value = false
  }
  catch {
    if (!reset)
      page.value = Math.max(1, page.value - 1)
    failed.value = list.value.length === 0
    notify(t('评论加载失败'), 'error')
  }
  finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value)
    return
  page.value += 1
  await load(false)
}

function isOpen(id: number) {
  return opened.value.has(id)
}

function threadOf(commentId: number) {
  return list.value.find(c => c.id === commentId)
    ?? list.value.find(c => (c.replies ?? []).some(r => r.id === commentId))
}

function setOpen(id: number, on: boolean) {
  const next = new Set(opened.value)
  if (on)
    next.add(id)
  else
    next.delete(id)
  opened.value = next
}

async function expandReplies(item: WorkComment) {
  if (expanding.value)
    return
  expanding.value = item.id
  try {
    const res = await workApi.replies(item.id, { page: 1, page_size: 100 })
    if (res?.success && res.data)
      item.replies = res.data.items
  }
  finally {
    expanding.value = null
  }
}

async function openReplies(item: WorkComment) {
  setOpen(item.id, true)
  if (!(item.replies?.length) && item.reply_count > 0)
    await expandReplies(item)
}

function startReply(item: WorkComment) {
  if (!requireLogin())
    return
  replyTo.value = item
  nextTick(() => inputRef.value?.focus())
}

function cancelReply() {
  replyTo.value = null
}

async function submit() {
  const content = draft.value.trim()
  if (!content || posting.value || !props.workId)
    return
  if (!requireLogin())
    return
  posting.value = true
  try {
    const res = await workApi.comment(props.workId, { content, parent_id: replyTo.value?.id })
    if (!res?.success || !res.data) {
      notify(res?.message || t('发表失败'), 'error')
      return
    }
    const created = res.data
    const thread = replyTo.value ? threadOf(replyTo.value.id) : undefined
    if (thread) {
      thread.replies = [...(thread.replies ?? []), created]
      thread.reply_count += 1
      setOpen(thread.id, true)
    }
    else {
      list.value = [{ ...created, replies: [] }, ...list.value]
      total.value += 1
    }
    draft.value = ''
    replyTo.value = null
    nextTick(fitInput)
    emit('countChange', 1)
    notify(t('已发表'), 'success')
  }
  finally {
    posting.value = false
  }
}

async function remove(item: WorkComment, parent?: WorkComment) {
  if (deleting.value)
    return
  const ok = await confirm({ message: t('删除这条评论？'), danger: true, confirmText: t('删除') })
  if (!ok)
    return
  deleting.value = item.id
  try {
    const res = await workApi.removeComment(item.id)
    if (!res?.success) {
      notify(res?.message || t('删除失败'), 'error')
      return
    }
    let removed = 1
    if (parent) {
      parent.replies = (parent.replies ?? []).filter(r => r.id !== item.id)
      parent.reply_count = Math.max(0, parent.reply_count - 1)
    }
    else {
      removed += item.reply_count
      list.value = list.value.filter(c => c.id !== item.id)
      total.value = Math.max(0, total.value - 1)
    }
    emit('countChange', -removed)
  }
  finally {
    deleting.value = null
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !props.inline) {
    event.stopPropagation()
    emit('close')
  }
}

function onInputKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void submit()
  }
}

watch(() => [active.value, props.workId] as const, ([on]) => {
  if (!on || !import.meta.client)
    return
  draft.value = ''
  replyTo.value = null
  void load().then(() => nextTick(() => {
    fitInput()
    if (!props.inline)
      inputRef.value?.focus()
  }))
}, { immediate: true })

watch(draft, () => nextTick(fitInput))

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div v-if="active" :class="inline ? 'watch-comments-inline' : 'inbox-mask'" @click.self="!inline && emit('close')">
      <aside
        class="watch-comments"
        :class="{ 'inbox-panel': !inline }"
        :role="inline ? 'region' : 'dialog'"
        :aria-modal="inline ? undefined : true"
        aria-labelledby="watch-comments-title"
      >
        <header class="watch-comments__head">
          <div>
            <h2 id="watch-comments-title">{{ t('评论') }} <small>{{ total }}</small></h2>
            <p v-if="!inline">{{ t('聊聊这部作品，或给作者一点建议') }}</p>
          </div>
          <button v-if="!inline" type="button" class="inbox-panel__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div ref="listRef" class="watch-comments__list">
          <div v-if="loading" class="watch-comments__empty">{{ t('加载中…') }}</div>
          <div v-else-if="failed && !list.length" class="watch-comments__empty">
            <strong>{{ t('评论加载失败') }}</strong>
            <button type="button" class="wc-more wc-more--page" @click="load(true)">{{ t('重试') }}</button>
          </div>
          <div v-else-if="!list.length" class="watch-comments__empty" @click="inputRef?.focus()">
            <span class="watch-comments__empty-icon" aria-hidden="true">
              <UIcon name="i-lucide-message-circle" class="size-7" />
            </span>
            <strong>{{ t('还没有评论，来说第一句') }}</strong>
            <p>{{ t('聊聊这部作品，或给作者一点建议') }}</p>
          </div>
          <template v-else>
            <article v-for="item in list" :key="item.id" class="wc-item">
              <span class="wc-avatar">{{ (item.author?.nickname || '?').slice(0, 1) }}</span>
              <div class="wc-main">
                <div class="wc-head">
                  <strong>{{ item.author?.nickname || t('用户') }}</strong>
                  <em v-if="item.user_id === ownerId">{{ t('作者') }}</em>
                  <time>{{ formatTime(item.created_at) }}</time>
                </div>
                <p class="wc-text">{{ item.content }}</p>
                <div class="wc-actions">
                  <button type="button" @click="startReply(item)">{{ t('回复') }}</button>
                  <button v-if="canDelete(item)" type="button" class="wc-actions__del" :disabled="deleting === item.id" @click="remove(item)">{{ t('删除') }}</button>
                  <button v-else type="button" class="wc-actions__report" @click="emit('report', item.id)">{{ t('举报') }}</button>
                </div>

                <div v-if="item.reply_count" class="wc-thread">
                  <template v-if="isOpen(item.id)">
                    <div class="wc-replies">
                      <article v-for="reply in item.replies" :key="reply.id" class="wc-item wc-item--reply">
                        <span class="wc-avatar">{{ (reply.author?.nickname || '?').slice(0, 1) }}</span>
                        <div class="wc-main">
                          <div class="wc-head">
                            <strong>{{ reply.author?.nickname || t('用户') }}</strong>
                            <em v-if="reply.user_id === ownerId">{{ t('作者') }}</em>
                            <span v-if="reply.reply_to && reply.reply_to.id !== item.user_id" class="wc-replyto">{{ t('回复') }} @{{ reply.reply_to.nickname }}</span>
                            <time>{{ formatTime(reply.created_at) }}</time>
                          </div>
                          <p class="wc-text">{{ reply.content }}</p>
                          <div class="wc-actions">
                            <button type="button" @click="startReply(reply)">{{ t('回复') }}</button>
                            <button v-if="canDelete(reply)" type="button" class="wc-actions__del" :disabled="deleting === reply.id" @click="remove(reply, item)">{{ t('删除') }}</button>
                            <button v-else type="button" class="wc-actions__report" @click="emit('report', reply.id)">{{ t('举报') }}</button>
                          </div>
                        </div>
                      </article>
                    </div>
                    <div class="wc-toggle-row">
                      <button
                        v-if="item.reply_count > (item.replies?.length || 0)"
                        type="button"
                        class="wc-toggle"
                        :disabled="expanding === item.id"
                        @click="expandReplies(item)"
                      >
                        {{ expanding === item.id ? t('加载中…') : t('展开更多回复') }}
                        <UIcon name="i-lucide-chevron-down" class="size-3.5" />
                      </button>
                      <button type="button" class="wc-toggle" @click="setOpen(item.id, false)">
                        {{ t('收起') }}
                        <UIcon name="i-lucide-chevron-up" class="size-3.5" />
                      </button>
                    </div>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="wc-toggle"
                    :disabled="expanding === item.id"
                    @click="openReplies(item)"
                  >
                    {{ expanding === item.id ? t('加载中…') : t('展开 {n} 条回复', { n: item.reply_count }) }}
                    <UIcon name="i-lucide-chevron-down" class="size-3.5" />
                  </button>
                </div>
              </div>
            </article>
            <button v-if="hasMore" type="button" class="wc-more wc-more--page" :disabled="loadingMore" @click="loadMore">
              {{ loadingMore ? t('加载中…') : t('加载更多') }}
            </button>
            <p v-else class="wc-more wc-more--end">{{ t('没有更多数据了') }}</p>
          </template>
        </div>

        <footer class="watch-comments__input">
          <div v-if="replyTo" class="wc-replying">
            <span>{{ t('回复') }} @{{ replyTo.author?.nickname || t('用户') }}</span>
            <button type="button" :aria-label="t('取消')" @click="cancelReply"><UIcon name="i-lucide-x" class="size-3.5" /></button>
          </div>
          <div class="wc-compose">
            <div class="wc-compose__box">
              <textarea
                ref="inputRef"
                v-model="draft"
                rows="1"
                maxlength="500"
                :placeholder="replyTo ? t('写下你的回复…') : t('写下你的评论…')"
                @keydown="onInputKeydown"
              />
              <div class="wc-compose__bar">
                <small>{{ t('Ctrl + Enter 发送') }} · {{ draft.length }}/500</small>
                <button type="button" class="wc-send" :disabled="!canSend" @click="submit">
                  <UIcon name="i-lucide-send" class="size-3.5" />
                  {{ posting ? t('发送中…') : t('发送') }}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
