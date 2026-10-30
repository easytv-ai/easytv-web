<script setup lang="ts">
/**
 * 设置 · 我的作品
 *
 * - 列表分页：useStudioPaged（父页持有）
 * - 状态筛选 + 标题搜索（GET /user/work?status=&keyword=）
 * - 上下架、删除、编辑（StudioWorkEditModal）
 */
import workApi from '~/api/work'
import { resolveMediaUrl } from '~/utils/media'
import type { Work, WorkStatus } from '~/types/creative'

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const localePath = useLocalePath()

const statusFilter = ref<WorkStatus | ''>('')
const keyword = ref('')
let keywordTimer: number | undefined
const STATUS_TABS: { value: WorkStatus | '', label: string }[] = [
  { value: '', label: '全部' },
  { value: 1, label: '已发布' },
  { value: 0, label: '草稿' },
  { value: 2, label: '已下架' },
  { value: -1, label: '审核驳回' },
]

const {
  items: works,
  busy: worksBusy,
  failed: worksFailed,
  loadingMore: worksLoadingMore,
  hasMore: worksHasMore,
  loaded: worksLoaded,
  reload: reloadWorks,
  loadMore: loadMoreWorks,
  removeById: removeWorkById,
} = useStudioPaged<Work>({
  pageSize: 20,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await workApi.mine({
      page,
      page_size: pageSize,
      ...(statusFilter.value !== '' ? { status: statusFilter.value } : {}),
      keyword: q || undefined,
    })
    if (!res?.success || !res.data) {
      notify(res?.message || t('作品加载失败'), 'error')
      return null
    }
    return res.data
  },
})

function setStatus(value: WorkStatus | '') {
  if (statusFilter.value === value)
    return
  statusFilter.value = value
  void reloadWorks()
}

const worksFiltered = computed(() => Boolean(keyword.value.trim() || statusFilter.value !== ''))
const worksEmptyTitle = computed(() => worksFiltered.value ? t('account.work.emptyFiltered') : t('还没有发布过作品'))
const worksEmptyHint = computed(() => worksFiltered.value ? '' : t('在资产页或画布视频节点上选择「发布为作品」。'))

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => { void reloadWorks() }, 320)
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function fmt(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const WORK_STATUS: Record<number, { label: string, cls: string }> = {
  1: { label: '已发布', cls: 'is-ok' },
  2: { label: '已下架', cls: 'is-off' },
  0: { label: '草稿', cls: 'is-off' },
  [-1]: { label: '审核驳回', cls: 'is-bad' },
}

function workStatus(w: Work) {
  return WORK_STATUS[w.status] ?? WORK_STATUS[0]!
}

const workBusy = ref<number | null>(null)
const editingWork = ref<Work | null>(null)

async function toggleWork(w: Work) {
  if (workBusy.value)
    return
  const next = w.status === 1 ? 2 : 1
  if (next === 2) {
    const ok = await confirm({
      title: t('account.work.unpublishTitle'),
      message: t('account.work.unpublishMessage', { name: w.title }),
      confirmText: t('下架'),
      danger: true,
    })
    if (!ok || workBusy.value)
      return
  }
  workBusy.value = w.id
  try {
    const res = await workApi.update(w.id, { status: next })
    if (!res?.success) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    w.status = next
    if (statusFilter.value !== '' && statusFilter.value !== next)
      removeWorkById(w.id)
    notify(next === 1 ? t('作品已重新上架') : t('作品已下架'), 'success')
  }
  finally {
    workBusy.value = null
  }
}

function onWorkSaved(updated: Work) {
  works.value = works.value.map(item => item.id === updated.id ? { ...item, ...updated } : item)
}

async function removeWork(w: Work) {
  if (workBusy.value)
    return
  if (!(await confirm({
    title: t('删除作品'),
    message: t('删除作品「{name}」？此操作不可恢复。', { name: w.title }),
    confirmText: t('删除'),
    danger: true,
  })))
    return
  workBusy.value = w.id
  try {
    const res = await workApi.remove(w.id)
    if (!res?.success) {
      notify(res?.message || t('删除失败'), 'error')
      return
    }
    removeWorkById(w.id)
    notify(t('作品已删除'), 'success')
  }
  finally {
    workBusy.value = null
  }
}

onMounted(() => {
  if (!worksLoaded.value)
    void reloadWorks()
})

onUnmounted(() => {
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <section class="wallet-card" :class="{ 'settings-empty-card': !worksBusy && !works.length }">
    <h3>{{ t('我的作品') }}</h3>
    <label class="projects-search work-list__search">
      <UIcon name="i-lucide-search" class="size-4" />
      <input v-model="keyword" type="search" :placeholder="t('account.work.searchTitle')">
    </label>
    <div class="work-list__tabs" role="tablist" :aria-label="t('我的作品')">
      <button
        v-for="tab in STATUS_TABS"
        :key="String(tab.value)"
        type="button"
        role="tab"
        :aria-selected="statusFilter === tab.value"
        :class="{ 'is-on': statusFilter === tab.value }"
        @click="setStatus(tab.value)"
      >
        {{ t(tab.label) }}
      </button>
    </div>
    <StudioPaging
      compact
      grid-class="work-list"
      :loading="worksBusy"
      :error="worksFailed"
      :loading-more="worksLoadingMore"
      :has-more="worksHasMore"
      :count="works.length"
      :empty-title="worksEmptyTitle"
      :empty-description="worksEmptyHint"
      :load-more="loadMoreWorks"
    >
      <template #skeleton>
        <div v-for="n in 4" :key="n" class="work-list__skel">
          <USkeleton class="work-list__thumb" />
          <div class="work-list__main">
            <USkeleton class="h-4 w-2/5" />
            <USkeleton class="mt-2 h-3 w-3/5" />
          </div>
        </div>
      </template>
      <template #empty>
        <StudioEmpty
          compact
          :title="worksEmptyTitle"
          :description="worksEmptyHint"
        >
          <NuxtLink v-if="!worksFiltered" :to="localePath('/assets')" class="plan-btn plan-btn--solid">{{ t('去资产页') }}</NuxtLink>
        </StudioEmpty>
      </template>
      <ul class="work-list">
        <li v-for="w in works" :key="w.id">
          <NuxtLink v-if="w.status === 1" :to="localePath(`/watch/${w.id}`)" class="work-list__thumb">
            <img v-if="w.cover_url" :src="resolveMediaUrl(w.cover_url)" :alt="w.title">
            <video v-else :src="resolveMediaUrl(w.video_url)" muted preload="metadata" />
          </NuxtLink>
          <span v-else class="work-list__thumb">
            <img v-if="w.cover_url" :src="resolveMediaUrl(w.cover_url)" :alt="w.title">
            <video v-else :src="resolveMediaUrl(w.video_url)" muted preload="metadata" />
          </span>
          <div class="work-list__main">
            <strong>{{ w.title }}</strong>
            <span class="work-list__meta">
              <em class="work-list__status" :class="workStatus(w).cls">{{ t(workStatus(w).label) }}</em>
              <template v-if="w.category"> · {{ t(w.category) }}</template>
              · {{ w.like_count }} {{ t('喜欢') }} · {{ w.view_count }} {{ t('播放') }}
              · {{ fmt(w.published_at || w.created_at).slice(0, 10) }}
            </span>
            <span v-if="w.remark" class="work-list__remark">{{ t('审核备注') }}：{{ w.remark }}</span>
            <span v-if="w.status === -1" class="work-list__remark">{{ t('被驳回的作品无法自行上架，如有疑问请联系客服。') }}</span>
          </div>
          <div class="work-list__actions">
            <button type="button" class="plan-btn plan-btn--ghost" :disabled="workBusy === w.id" @click="editingWork = w">{{ t('编辑') }}</button>
            <button
              v-if="w.status === 1 || w.status === 2"
              type="button"
              class="plan-btn plan-btn--ghost"
              :disabled="workBusy === w.id"
              @click="toggleWork(w)"
            >
              {{ workBusy === w.id && w.status === 1 ? t('account.work.unpublishing') : (w.status === 1 ? t('下架') : t('重新上架')) }}
            </button>
            <button type="button" class="plan-btn plan-btn--ghost is-danger" :disabled="workBusy === w.id" @click="removeWork(w)">{{ t('删除') }}</button>
          </div>
        </li>
      </ul>
    </StudioPaging>
  </section>
  <StudioWorkEditModal :open="!!editingWork" :work="editingWork" @close="editingWork = null" @saved="onWorkSaved" />
</template>
