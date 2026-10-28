<script setup lang="ts">
import { useInfiniteScroll } from '@vueuse/core'

/**
 * 列表分页：基于 VueUse useInfiniteScroll（Nuxt UI 官方无限滚动方案）。
 * 滚动容器默认是创作台主栏 `.studio-content`。
 */
const props = withDefaults(defineProps<{
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
  count?: number
  emptyTitle?: string
  emptyDescription?: string
  root?: string
  distance?: number
  gridClass?: string
  compact?: boolean
  loadMore?: () => Promise<void> | void
  /** 请求失败且列表为空：不要显示「暂无」 */
  error?: boolean
}>(), {
  loading: false,
  loadingMore: false,
  hasMore: false,
  count: 0,
  emptyTitle: '',
  emptyDescription: '',
  root: '.studio-content',
  distance: 120,
  gridClass: 'agent-grid',
  compact: false,
  error: false,
})

const { t } = useI18n()
const scrollRoot = shallowRef<HTMLElement | null>(null)

const showEmpty = computed(() => !props.loading && !props.error && props.count <= 0)

function canLoadMore() {
  return props.hasMore && !props.loading && !props.loadingMore
}

async function onLoadMore() {
  if (!canLoadMore())
    return
  await props.loadMore?.()
}

function bindRoot() {
  const el = document.querySelector(props.root)
  scrollRoot.value = el instanceof HTMLElement ? el : null
}

onMounted(async () => {
  bindRoot()
  if (!scrollRoot.value)
    await nextTick()
  bindRoot()
})

watch(() => props.root, () => {
  void nextTick(bindRoot)
})

const { reset } = useInfiniteScroll(scrollRoot, onLoadMore, {
  distance: props.distance,
  interval: 200,
  canLoadMore: () => canLoadMore(),
})

watch(() => [props.loadingMore, props.hasMore, props.count], async () => {
  await nextTick()
  if (canLoadMore())
    reset()
})
</script>

<template>
  <div class="studio-paging">
    <div v-if="loading && count <= 0" :class="gridClass" role="status" aria-busy="true">
      <slot name="skeleton">
        <div v-for="n in 6" :key="n" class="skill-card skill-card--skeleton">
          <USkeleton class="h-[84px] w-[112px] shrink-0 rounded-[10px]" />
          <div class="skill-card__body">
            <USkeleton class="h-3.5 w-3/5" />
            <USkeleton class="mt-2 h-3 w-full" />
            <div class="skill-card__meta">
              <USkeleton class="h-3 w-24" />
              <USkeleton class="h-3 w-10" />
            </div>
          </div>
        </div>
      </slot>
    </div>
    <template v-else-if="count > 0">
      <slot />
      <div class="agent-more">
        <StudioLoading v-if="loadingMore" :text="t('加载中…')" />
        <span v-else-if="!hasMore">{{ t('没有更多数据了') }}</span>
      </div>
    </template>
    <template v-else-if="error && count <= 0">
      <slot name="error">
        <StudioEmpty
          :compact="compact"
          :title="t('加载失败，请稍后重试')"
        />
      </slot>
    </template>
    <template v-else-if="showEmpty">
      <slot name="empty">
        <StudioEmpty
          :compact="compact"
          :title="emptyTitle || t('暂无 Skill')"
          :description="emptyDescription"
        />
      </slot>
    </template>
  </div>
</template>
