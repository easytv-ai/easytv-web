<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import projectApi from '~/api/project'
import type { Project, ProjectComment } from '~/types/creative'

/**
 * 项目评论批注抽屉（API.md 10.10）：
 * GET /user/project/:id/comment（未解决排在前）、POST 发表、PUT 标记解决 / 重新打开、DELETE 删除。
 * 抽屉外观直接复用播放页评论的 inbox-panel / wc-* 样式，保持创作台弹层观感一致。
 */
const props = defineProps<{
  open: boolean
  /** 目标项目；关闭时父级可以置空，这里靠 open 守卫不发请求 */
  project: Project | null
  /** 预留给画布：>0 只看该画布，非空 node_id 只看该节点的批注 */
  canvasId?: number
  nodeId?: string
  /** 画布页把 node_id 对成卡片标题和正文摘要；项目页没有画布时不传 */
  nodeHint?: (nodeId: string) => { title: string, excerpt: string } | null
}>()

const emit = defineEmits<{
  close: []
  /** 未解决数变化（发表 / 解决 / 重开 / 删除），父级据此更新卡片角标 */
  openCountChange: [projectId: number, delta: number]
  /** 点某条节点批注：画布选中并居中那个节点 */
  locate: [nodeId: string]
}>()

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { user } = useAuth()
const { requireLogin } = useRequireLogin()

const MAX_LEN = 1000
const PAGE_SIZE = 20

const draft = ref('')
const posting = ref(false)
/** 正在提交 resolved 变更 / 删除的批注 id，避免同一行重复点击 */
const toggling = ref<number | null>(null)
const deleting = ref<number | null>(null)
const onlyOpen = ref(false)
const inputRef = ref<HTMLTextAreaElement | null>(null)

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const {
  items: comments,
  total,
  busy,
  failed,
  loadingMore,
  hasMore,
  loaded,
  reload,
  loadMore,
  removeById,
  prepend,
} = useStudioPaged<ProjectComment>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const id = props.project?.id
    if (!id)
      return null
    const res = await projectApi.comments(id, {
      page,
      page_size: pageSize,
      canvas_id: props.canvasId && props.canvasId > 0 ? props.canvasId : undefined,
      node_id: props.nodeId || undefined,
      only_open: onlyOpen.value ? 1 : undefined,
    })
    if (!res?.success || !res.data) {
      notify(res?.message || t('批注加载失败'), 'error')
      return null
    }
    return res.data
  },
})

const trimmed = computed(() => draft.value.trim())
const overLimit = computed(() => draft.value.length > MAX_LEN)
const canSend = computed(() => Boolean(trimmed.value) && !overLimit.value && !posting.value)
const openCount = computed(() => comments.value.filter(item => !item.resolved).length)
/** AuthUser.id 走索引签名是 unknown，这里统一收成数字再比对 */
const myId = computed(() => Number(user.value?.id ?? 0) || 0)
/** 项目所有者可删除任意批注（后端同口径） */
const isProjectOwner = computed(() =>
  Boolean(myId.value && props.project && myId.value === props.project.user_id),
)

function fitInput() {
  const el = inputRef.value
  if (!el)
    return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 160)}px`
}

/** 与播放页评论一致的相对时间口径 */
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

function hintOf(nodeId: string) {
  if (!nodeId || !props.nodeHint)
    return null
  return props.nodeHint(nodeId)
}

const scopedHint = computed(() => hintOf(props.nodeId || ''))
const rows = computed(() => comments.value.map(item => ({
  item,
  hint: hintOf(item.node_id),
})))

function authorOf(item: ProjectComment) {
  return item.author_nickname || t('用户')
}

function canDelete(item: ProjectComment) {
  return (myId.value > 0 && myId.value === item.user_id) || isProjectOwner.value
}

async function submit() {
  const projectId = props.project?.id
  const content = trimmed.value
  if (!projectId || !content || posting.value || overLimit.value)
    return
  if (!requireLogin())
    return
  posting.value = true
  try {
    const res = await projectApi.addComment(projectId, {
      content,
      canvas_id: props.canvasId && props.canvasId > 0 ? props.canvasId : undefined,
      node_id: props.nodeId || undefined,
    })
    if (!res?.success || !res.data) {
      notify(res?.message || t('发表失败'), 'error')
      return
    }
    prepend(res.data)
    draft.value = ''
    void nextTick(fitInput)
    emit('openCountChange', projectId, 1)
    notify(t('已发表'), 'success')
  }
  finally {
    posting.value = false
  }
}

async function toggleResolved(item: ProjectComment) {
  if (toggling.value || deleting.value)
    return
  const next = !item.resolved
  toggling.value = item.id
  try {
    const res = await projectApi.setCommentResolved(item.id, next)
    if (!res?.success) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    item.resolved = next ? 1 : 0
    item.resolved_by = next ? myId.value : 0
    item.resolved_at = next ? Math.floor(Date.now() / 1000) : 0
    item.resolved_by_nickname = next ? (user.value?.nickname || '') : ''
    // 只看未解决时，标记解决后这行不再属于当前筛选，直接移出列表
    if (next && onlyOpen.value)
      removeById(item.id)
    emit('openCountChange', item.project_id, next ? -1 : 1)
  }
  finally {
    toggling.value = null
  }
}

async function remove(item: ProjectComment) {
  if (deleting.value)
    return
  if (!(await confirm({
    title: t('删除批注'),
    message: t('删除这条批注？删除后无法恢复。'),
    confirmText: t('删除'),
    danger: true,
  })))
    return
  deleting.value = item.id
  try {
    const res = await projectApi.removeComment(item.id)
    if (!res?.success) {
      notify(res?.message || t('删除失败'), 'error')
      return
    }
    const wasOpen = !item.resolved
    removeById(item.id)
    if (wasOpen)
      emit('openCountChange', item.project_id, -1)
  }
  finally {
    deleting.value = null
  }
}

function onInputKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void submit()
  }
}

function onKeydown(event: KeyboardEvent) {
  // 确认框自己会吞掉 Escape，这里只负责抽屉本体
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}

watch(() => [props.open, props.project?.id, props.canvasId, props.nodeId] as const, ([open]) => {
  if (!open)
    return
  draft.value = ''
  onlyOpen.value = false
  void reload().then(() => nextTick(() => {
    fitInput()
    inputRef.value?.focus()
  }))
})

watch(onlyOpen, () => {
  if (props.open)
    void reload()
})

watch(draft, () => nextTick(fitInput))

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="inbox-mask" @click.self="emit('close')">
      <aside
        class="inbox-panel watch-comments project-comments"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-comments-title"
      >
        <header class="watch-comments__head">
          <div>
            <h2 id="project-comments-title">
              {{ t('批注') }} <small>{{ total }}</small>
            </h2>
            <p v-if="scopedHint">{{ t('挂在 {name}', { name: scopedHint.title }) }}</p>
            <p v-else>{{ project?.name || t('项目') }}</p>
            <p v-if="scopedHint?.excerpt" class="pc-target">{{ scopedHint.excerpt }}</p>
          </div>
          <button type="button" class="inbox-panel__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="pc-filter">
          <button type="button" :class="{ 'is-on': !onlyOpen }" @click="onlyOpen = false">
            {{ t('全部') }}
          </button>
          <button type="button" :class="{ 'is-on': onlyOpen }" @click="onlyOpen = true">
            {{ t('只看未解决') }}
          </button>
          <span v-if="openCount" class="pc-filter__count">{{ t('{n} 条待处理', { n: openCount }) }}</span>
        </div>

        <div class="watch-comments__list">
          <div v-if="busy" class="watch-comments__empty">{{ t('加载中…') }}</div>
          <div v-else-if="failed && !comments.length" class="watch-comments__empty">
            <strong>{{ t('加载失败，请稍后重试') }}</strong>
          </div>
          <div
            v-else-if="!comments.length"
            class="watch-comments__empty"
            @click="inputRef?.focus()"
          >
            <span class="watch-comments__empty-icon" aria-hidden="true">
              <UIcon name="i-lucide-message-square-dashed" class="size-7" />
            </span>
            <strong>{{ onlyOpen ? t('没有待处理的批注') : t('还没有批注') }}</strong>
            <p>{{ t('给队友留一条反馈，或记下自己的待办。') }}</p>
          </div>
          <template v-else>
            <article
              v-for="row in rows"
              :key="row.item.id"
              class="wc-item pc-item"
              :class="{ 'is-resolved': !!row.item.resolved }"
            >
              <span class="wc-avatar">{{ authorOf(row.item).slice(0, 1) }}</span>
              <div class="wc-main">
                <div class="wc-head">
                  <strong>{{ authorOf(row.item) }}</strong>
                  <em v-if="project && row.item.user_id === project.user_id">{{ t('项目所有者') }}</em>
                  <time>{{ formatTime(row.item.created_at) }}</time>
                </div>
                <button
                  v-if="row.hint"
                  type="button"
                  class="pc-anchor"
                  @click="emit('locate', row.item.node_id)"
                >
                  <UIcon name="i-lucide-locate-fixed" class="size-3.5" />
                  <span>
                    <strong>{{ row.hint.title }}</strong>
                    <small v-if="row.hint.excerpt">{{ row.hint.excerpt }}</small>
                  </span>
                </button>
                <span v-else-if="row.item.node_id && nodeHint" class="pc-chip">{{ t('节点已不在这张画布上') }}</span>
                <span v-else-if="row.item.node_id" class="pc-chip">{{ t('节点批注') }}</span>
                <p class="wc-text pc-text">{{ row.item.content }}</p>
                <p v-if="row.item.resolved" class="pc-resolved">
                  <UIcon name="i-lucide-check-circle-2" class="size-3.5" />
                  {{ row.item.resolved_by_nickname
                    ? t('{name} 已处理 · {time}', { name: row.item.resolved_by_nickname, time: formatTime(row.item.resolved_at) })
                    : t('已处理 · {time}', { time: formatTime(row.item.resolved_at) }) }}
                </p>
                <div class="wc-actions">
                  <button
                    type="button"
                    :disabled="toggling === row.item.id"
                    @click="toggleResolved(row.item)"
                  >
                    {{ row.item.resolved ? t('重新打开') : t('标记解决') }}
                  </button>
                  <button
                    v-if="canDelete(row.item)"
                    type="button"
                    class="wc-actions__del"
                    :disabled="deleting === row.item.id"
                    @click="remove(row.item)"
                  >
                    {{ t('删除') }}
                  </button>
                </div>
              </div>
            </article>
            <button
              v-if="hasMore"
              type="button"
              class="wc-more wc-more--page"
              :disabled="loadingMore || !loaded"
              @click="loadMore"
            >
              {{ loadingMore ? t('加载中…') : t('加载更多') }}
            </button>
          </template>
        </div>

        <footer class="watch-comments__input">
          <div class="wc-compose">
            <div class="wc-compose__box" :class="{ 'is-over': overLimit }">
              <textarea
                ref="inputRef"
                v-model="draft"
                rows="2"
                :maxlength="MAX_LEN"
                :placeholder="scopedHint ? t('给 {name} 写批注，队友会收到站内信…', { name: scopedHint.title }) : t('写下批注，队友会收到站内信…')"
                @keydown="onInputKeydown"
              />
              <div class="wc-compose__bar">
                <small :class="{ 'is-over': overLimit }">
                  {{ t('Ctrl + Enter 发送') }} · {{ draft.length }}/{{ MAX_LEN }}
                </small>
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
