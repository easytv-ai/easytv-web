<script setup lang="ts">
import taskApi from '~/api/task'
import type { GenerationTask, TaskStatus, TaskSummary, TaskType } from '~/types/creative'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'

const { t } = useI18n()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('任务中心') })

const toast = useToast()
const localePath = useLocalePath()
const { confirm } = useConfirm()
const { refresh: refreshWallet } = useWallet()

const PAGE_SIZE = 20
const POLL_MS = 4000

const summary = ref<TaskSummary | null>(null)
const tasks = ref<GenerationTask[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const failed = ref(false)
// 从积分钱包点流水 / 任务进来时带 ?keyword=任务单号
const route = useRoute()
const keyword = ref(String(route.query.keyword ?? ''))
const typeFilter = ref<TaskType | ''>('')
const statusFilter = ref<TaskStatus | 'active' | ''>('')
const busy = ref<number | null>(null)
const expandedText = ref<number | null>(null)
let stopTaskPoll = () => {}

const TYPE_ITEMS: { value: TaskType | '', label: string, icon: string }[] = [
  { value: '', label: '全部类型', icon: 'i-lucide-layers' },
  { value: 'text', label: '文本', icon: 'i-lucide-file-text' },
  { value: 'image', label: '图片', icon: 'i-lucide-image' },
  { value: 'video', label: '视频', icon: 'i-lucide-play' },
  { value: 'audio', label: '音频', icon: 'i-lucide-music' },
]
const STATUS_ITEMS: { value: TaskStatus | 'active' | '', label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '进行中' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
]
const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}
const TYPE_ICON: Record<TaskType, string> = {
  text: 'i-lucide-file-text',
  image: 'i-lucide-image',
  video: 'i-lucide-play',
  audio: 'i-lucide-music',
}

function typeLabel(type: TaskType) {
  return TYPE_ITEMS.find(item => item.value === type)?.label || type
}

const hasMore = computed(() => loaded.value && tasks.value.length < total.value)
const activeIds = computed(() => tasks.value.filter(item => item.status === 'pending' || item.status === 'running').map(item => item.id))

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function fmtTime(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay = new Date().toDateString() === d.toDateString()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

function duration(item: GenerationTask) {
  const start = item.started_at || item.created_at
  const end = item.finished_at || (item.status === 'pending' || item.status === 'running' ? Math.floor(Date.now() / 1000) : start)
  const sec = Math.max(0, end - start)
  if (sec < 60)
    return `${sec}s`
  return `${Math.floor(sec / 60)}m${sec % 60}s`
}

function isActive(item: GenerationTask) {
  return item.status === 'pending' || item.status === 'running'
}

function canRetry(item: GenerationTask) {
  return item.status === 'failed' || item.status === 'cancelled'
}

function queryParams() {
  const status = statusFilter.value
  return {
    page: page.value,
    page_size: PAGE_SIZE,
    keyword: keyword.value.trim() || undefined,
    type: typeFilter.value || undefined,
    status: status && status !== 'active' ? status : undefined,
    active: status === 'active' ? 1 as const : undefined,
  }
}

async function loadSummary() {
  const res = await taskApi.summary()
  if (res?.success && res.data)
    summary.value = res.data
}

let loadSeq = 0

function failTaskLoad(reset: boolean, previousPage: number, message?: string) {
  page.value = reset ? previousPage : Math.max(1, page.value - 1)
  failed.value = tasks.value.length === 0
  notify(message || t('任务加载失败'), 'error')
}

async function load(reset = true) {
  const seq = ++loadSeq
  const previousPage = page.value
  if (reset) {
    page.value = 1
    loading.value = true
    failed.value = false
  }
  else {
    loadingMore.value = true
  }
  try {
    const res = await taskApi.list(queryParams())
    if (seq !== loadSeq)
      return
    if (!res?.success || !res.data) {
      failTaskLoad(reset, previousPage, res?.message)
      return
    }
    tasks.value = reset ? res.data.items : [...tasks.value, ...res.data.items]
    total.value = res.data.total
    loaded.value = true
    failed.value = false
  }
  catch {
    if (seq !== loadSeq)
      return
    failTaskLoad(reset, previousPage)
  }
  finally {
    if (seq === loadSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value)
    return
  page.value += 1
  await load(false)
}

/** 轮询进行中的任务，状态变化后刷新概览与钱包 */
async function pollActive() {
  if (!activeIds.value.length)
    return
  const res = await taskApi.list({ page: 1, page_size: 100, active: 1 })
  if (!res?.success || !res.data)
    return
  const stillActive = new Map(res.data.items.map(item => [item.id, item]))
  let changed = false
  for (const id of activeIds.value) {
    const fresh = stillActive.get(id)
    if (fresh) {
      const local = tasks.value.find(item => item.id === id)
      if (local)
        Object.assign(local, fresh)
    }
    else {
      changed = true
      const detail = await taskApi.get(id)
      const local = tasks.value.find(item => item.id === id)
      if (local && detail?.success && detail.data)
        Object.assign(local, detail.data)
    }
  }
  if (changed) {
    void loadSummary()
    void refreshWallet()
  }
}

async function cancelTask(item: GenerationTask) {
  if (busy.value)
    return
  const ok = await confirm({ message: t('取消这个任务？预扣的积分会退回。'), confirmText: t('取消任务'), danger: true })
  if (!ok)
    return
  busy.value = item.id
  try {
    const res = await taskApi.cancel(item.id)
    if (!res?.success) {
      notify(res?.message || t('取消失败'), 'error')
      return
    }
    item.status = 'cancelled'
    item.points_frozen = 0
    notify(t('任务已取消，积分已退回'))
    void loadSummary()
    void refreshWallet()
  }
  finally {
    busy.value = null
  }
}

async function retryTask(item: GenerationTask) {
  if (busy.value)
    return
  busy.value = item.id
  try {
    const res = await taskApi.retry(item.id)
    if (!res?.success || !res.data) {
      notify(res?.message || t('重试失败'), 'error')
      return
    }
    tasks.value = [res.data, ...tasks.value]
    total.value += 1
    notify(res.data.status === 'failed' ? (res.data.error_msg || t('重试失败')) : t('已重新提交'), res.data.status === 'failed' ? 'error' : 'success')
    void loadSummary()
    void refreshWallet()
  }
  finally {
    busy.value = null
  }
}

function openCanvas(item: GenerationTask) {
  if (!item.canvas_id)
    return
  void navigateTo(localePath({ path: '/canvas', query: { id: String(item.canvas_id) } }))
}

async function copyText(text: string, ok: string) {
  if (!text)
    return
  try {
    await navigator.clipboard.writeText(text)
    notify(ok)
  }
  catch {
    notify(t('当前浏览器不支持复制'), 'error')
  }
}

async function copyPrompt(item: GenerationTask) {
  await copyText(item.prompt, t('提示词已复制'))
}

async function copyTaskNo(item: GenerationTask) {
  await copyText(item.task_no, t('account.task.copiedNo'))
}

async function copyResult(item: GenerationTask) {
  await copyText(item.result_text || '', t('account.task.copiedResult'))
}

// 已在任务页时再从钱包点另一条，地址变了但页面不重建
watch(() => route.query.keyword, (v) => {
  keyword.value = String(v ?? '')
  applyFilters()
})

function applyFilters() {
  void load()
}

watch([typeFilter, statusFilter], () => applyFilters())

onMounted(() => {
  void loadSummary()
  void load()
  stopTaskPoll = startHiddenAwarePoll(() => pollActive(), POLL_MS)
})

onBeforeUnmount(() => {
  stopTaskPoll()
})
</script>

<template>
  <section class="projects-page tasks-page">
    <header class="projects-toolbar">
      <div class="projects-toolbar__left">
        <h1>{{ t('任务中心') }}</h1>
      </div>
      <div class="projects-toolbar__right">
        <label class="projects-search">
          <UIcon name="i-lucide-search" class="size-4" />
          <input v-model="keyword" type="search" :placeholder="t('搜索提示词 / 模型 / 单号')" @keydown.enter="applyFilters">
        </label>
        <button type="button" class="projects-tool-btn" :disabled="loading" @click="load(); loadSummary()">
          <UIcon name="i-lucide-refresh-cw" class="size-4" :class="{ 'animate-spin': loading }" />
          {{ t('刷新') }}
        </button>
      </div>
    </header>

    <div v-if="summary" class="tasks-summary">
      <div class="tasks-tile">
        <small>{{ t('进行中') }}</small>
        <strong>{{ summary.active }}</strong>
        <em v-if="summary.points_frozen">{{ t('占用 {n} 积分', { n: summary.points_frozen }) }}</em>
      </div>
      <div class="tasks-tile">
        <small>{{ t('已完成') }}</small>
        <strong>{{ summary.succeeded }}</strong>
        <em>{{ t('共 {n} 个任务', { n: summary.total }) }}</em>
      </div>
      <div class="tasks-tile" :class="{ 'is-warn': summary.failed }">
        <small>{{ t('失败 / 取消') }}</small>
        <strong>{{ summary.failed + summary.cancelled }}</strong>
        <em>{{ t('积分已自动退回') }}</em>
      </div>
      <div class="tasks-tile">
        <small>{{ t('今日消耗') }}</small>
        <strong>{{ summary.points_today }}</strong>
        <em>{{ t('近 30 天 {n} 积分', { n: summary.points_30d }) }}</em>
      </div>
    </div>

    <div class="tasks-filters">
      <div class="agent-tags">
        <button
          v-for="item in TYPE_ITEMS"
          :key="item.value"
          type="button"
          :class="{ 'is-on': typeFilter === item.value }"
          @click="typeFilter = item.value"
        >
          <UIcon :name="item.icon" class="size-3.5" />
          {{ t(item.label) }}
        </button>
      </div>
      <div class="agent-tags tasks-status">
        <button
          v-for="item in STATUS_ITEMS"
          :key="item.value"
          type="button"
          :class="{ 'is-on': statusFilter === item.value }"
          @click="statusFilter = item.value"
        >
          {{ t(item.label) }}
        </button>
      </div>
    </div>

    <StudioPaging
      grid-class="tasks-list"
      :loading="loading && !tasks.length"
      :error="failed"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :count="tasks.length"
      :empty-title="t('还没有生成任务')"
      :empty-description="t('在画布里选择模型点击生成，任务会出现在这里。')"
      :load-more="loadMore"
    >
      <template #skeleton>
        <li v-for="n in 4" :key="n" class="tasks-item tasks-item--skeleton" aria-hidden="true">
          <USkeleton class="tasks-item__thumb" />
          <div class="tasks-item__main">
            <USkeleton class="h-4 w-2/5" />
            <USkeleton class="mt-2 h-3 w-4/5" />
            <USkeleton class="mt-2 h-3 w-1/3" />
          </div>
          <div class="tasks-item__actions">
            <USkeleton class="tasks-item__icon" />
            <USkeleton class="tasks-item__icon" />
            <USkeleton class="h-8 w-16 rounded-[10px]" />
          </div>
        </li>
      </template>
      <ul class="tasks-list">
      <li v-for="item in tasks" :key="item.id" class="tasks-item" :class="`is-${item.status}`">
        <div class="tasks-item__thumb">
          <img v-if="item.status === 'succeeded' && item.type === 'image' && item.result_url" :src="resolveMediaUrl(item.result_url)" alt="" loading="lazy">
          <video v-else-if="item.status === 'succeeded' && item.type === 'video' && item.result_url" :src="resolveMediaUrl(item.result_url)" muted preload="metadata" />
          <UIcon v-else :name="TYPE_ICON[item.type] || 'i-lucide-box'" class="size-5" />
        </div>
        <div class="tasks-item__main">
          <div class="tasks-item__head">
            <span class="tasks-status-badge" :class="`is-${item.status}`">
              <UIcon v-if="isActive(item)" name="i-lucide-loader-circle" class="size-3 animate-spin" />
              {{ t(STATUS_LABEL[item.status]) }}
              <template v-if="item.status === 'running' && item.progress"> {{ item.progress }}%</template>
            </span>
            <strong>{{ item.model }}</strong>
            <small>{{ t(typeLabel(item.type)) }} · {{ fmtTime(item.created_at) }} · {{ duration(item) }}</small>
          </div>
          <p class="tasks-item__prompt" :title="item.prompt">{{ item.prompt || t('（无提示词）') }}</p>
          <p v-if="item.status === 'failed' && item.error_msg" class="tasks-item__error">
            <UIcon name="i-lucide-circle-alert" class="size-3.5" />
            {{ item.error_msg }}
          </p>
          <div v-if="item.status === 'succeeded' && item.type === 'text' && item.result_text" class="tasks-item__text">
            <ClientOnly>
              <v-md-preview
                class="tasks-item__md"
                :class="{ 'is-clamped': expandedText !== item.id }"
                :text="item.result_text"
              />
              <template #fallback>
                <p :class="{ 'is-clamped': expandedText !== item.id }">{{ item.result_text }}</p>
              </template>
            </ClientOnly>
            <div class="tasks-item__text-actions">
              <button type="button" @click="copyResult(item)">{{ t('account.task.copyResult') }}</button>
              <button type="button" @click="expandedText = expandedText === item.id ? null : item.id">
                {{ expandedText === item.id ? t('收起') : t('展开结果') }}
              </button>
            </div>
          </div>
          <div class="tasks-item__meta">
            <span v-if="item.status === 'succeeded'">{{ t('消耗 {n} 积分', { n: item.cost_points }) }}</span>
            <span v-else-if="isActive(item)">{{ t('预扣 {n} 积分', { n: item.points_frozen }) }}</span>
            <span v-else>{{ t('积分已退回') }}</span>
            <button
              v-if="item.task_no"
              type="button"
              class="tasks-item__no"
              :aria-label="t('account.task.copyNo')"
              @click="copyTaskNo(item)"
            >
              {{ item.task_no }}
            </button>
          </div>
        </div>
        <div class="tasks-item__actions">
          <a
            v-if="item.status === 'succeeded' && item.result_url"
            class="tasks-item__icon"
            :href="resolveMediaUrl(item.result_url)"
            target="_blank"
            rel="noopener"
            :aria-label="t('查看结果')"
          >
            <UIcon name="i-lucide-external-link" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('查看结果') }}</span>
          </a>
          <button
            v-if="item.canvas_id"
            type="button"
            class="tasks-item__icon"
            :aria-label="t('打开画布')"
            @click="openCanvas(item)"
          >
            <UIcon name="i-lucide-layout-grid" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('打开画布') }}</span>
          </button>
          <button
            v-if="item.status === 'succeeded' && item.result_text"
            type="button"
            class="tasks-item__icon"
            :aria-label="t('account.task.copyResult')"
            @click="copyResult(item)"
          >
            <UIcon name="i-lucide-clipboard-copy" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('account.task.copyResult') }}</span>
          </button>
          <button
            v-if="item.prompt"
            type="button"
            class="tasks-item__icon"
            :aria-label="t('复制提示词')"
            @click="copyPrompt(item)"
          >
            <UIcon name="i-lucide-copy" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('复制提示词') }}</span>
          </button>
          <button
            v-if="isActive(item)"
            type="button"
            class="tasks-item__icon is-danger"
            :disabled="busy === item.id"
            :aria-label="t('取消')"
            @click="cancelTask(item)"
          >
            <UIcon name="i-lucide-x" class="size-4" />
            <span class="canvas-tip canvas-tip--up">{{ t('取消') }}</span>
          </button>
          <button
            v-if="canRetry(item)"
            type="button"
            class="tasks-item__retry"
            :disabled="busy === item.id"
            @click="retryTask(item)"
          >
            <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{ 'animate-spin': busy === item.id }" />
            {{ busy === item.id ? t('提交中…') : t('重试') }}
          </button>
        </div>
      </li>
    </ul>
    </StudioPaging>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
</style>
