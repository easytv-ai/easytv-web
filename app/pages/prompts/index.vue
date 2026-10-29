<script setup lang="ts">
import promptApi from '~/api/prompt'
import { resolveMediaUrl } from '~/utils/media'
import type { Prompt, PromptSourceBrief } from '~/types/creative'

const { t } = useI18n()
const { libraryTabs } = useStudioNav()
const localePath = useLocalePath()

/**
 * 提示词库（API.md 1.11）：运营录入 + 远程源定时同步来的提示词，匿名可看。
 * 列表接口不返回正文，点开详情才拉 content 并记一次复制。
 */
definePageMeta({
  layout: 'studio',
  keepalive: true,
})

useHead({ title: t('提示词库') })

const toast = useToast()

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const PAGE_SIZE = 24

const keyword = ref('')
const activeTag = ref('')
const activeSource = ref(0)
const tags = ref<string[]>([])
const sources = ref<PromptSourceBrief[]>([])

const items = ref<Prompt[]>([])
const total = ref(0)
const page = ref(1)
const busy = ref(false)
const loadingMore = ref(false)
const loaded = ref(false)
const failed = ref(false)
const hasMore = computed(() => loaded.value && items.value.length < total.value)

/** 并发保护：筛选条件连点时只认最后一次请求的结果 */
let fetchSeq = 0

function restorePromptPage(reset: boolean, previousPage: number, message?: string) {
  page.value = reset ? previousPage : Math.max(1, page.value - 1)
  failed.value = items.value.length === 0
  notify(message || t('加载失败，请稍后重试'), 'error')
}

async function fetchList(reset = true) {
  const seq = ++fetchSeq
  const previousPage = page.value
  if (reset) {
    page.value = 1
    busy.value = true
    failed.value = false
  }
  else {
    loadingMore.value = true
  }
  try {
    const res = await promptApi.list({
      page: page.value,
      page_size: PAGE_SIZE,
      keyword: keyword.value.trim() || undefined,
      tag: activeTag.value || undefined,
      source_id: activeSource.value || undefined,
    })
    if (seq !== fetchSeq)
      return
    if (!res?.success || !res.data) {
      restorePromptPage(reset, previousPage, res?.message)
      return
    }
    total.value = res.data.total
    items.value = reset ? res.data.items : [...items.value, ...res.data.items]
    loaded.value = true
    failed.value = false
  }
  catch {
    if (seq !== fetchSeq)
      return
    restorePromptPage(reset, previousPage)
  }
  finally {
    if (seq === fetchSeq) {
      busy.value = false
      loadingMore.value = false
    }
  }
}

async function loadMore() {
  if (busy.value || loadingMore.value || !hasMore.value)
    return
  page.value += 1
  await fetchList(false)
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(keyword, () => {
  if (searchTimer)
    clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void fetchList(), 300)
})
watch([activeTag, activeSource], () => void fetchList())

onMounted(async () => {
  void fetchList()
  const [tagRes, sourceRes] = await Promise.all([promptApi.tags(), promptApi.sources()])
  if (tagRes?.success && Array.isArray(tagRes.data))
    tags.value = tagRes.data
  if (sourceRes?.success && Array.isArray(sourceRes.data))
    sources.value = sourceRes.data
})

// ---- 详情 ----
const detail = ref<Prompt | null>(null)
const detailLoading = ref(false)

async function openDetail(item: Prompt) {
  detail.value = item
  if (item.content)
    return
  detailLoading.value = true
  const res = await promptApi.get(item.id)
  detailLoading.value = false
  if (res?.success && res.data) {
    detail.value = res.data
    // 列表里的那条也补上正文，再点开就不用重新请求
    const hit = items.value.find(row => row.id === item.id)
    if (hit) {
      hit.content = res.data.content
      hit.uses = res.data.uses
    }
  }
}

async function copyPrompt() {
  const text = detail.value?.content?.trim()
  if (!text)
    return
  try {
    await navigator.clipboard.writeText(text)
    notify(t('已复制提示词'), 'success')
  }
  catch {
    notify(t('复制失败，请手动选中文本'), 'error')
  }
}

/** 带着提示词开一张新画布（/canvas?prompt= 已支持） */
function useInCanvas() {
  const text = detail.value?.content?.trim()
  if (!text)
    return
  void navigateTo(localePath(`/canvas?prompt=${encodeURIComponent(text)}`))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && detail.value)
    detail.value = null
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (searchTimer)
    clearTimeout(searchTimer)
})
</script>

<template>
  <section class="projects-page">
    <div class="show-page__inner">
      <div class="projects-stick">
      <header class="projects-toolbar">
        <div class="projects-toolbar__left">
          <h1 class="sr-only">{{ t('提示词库') }}</h1>
          <StudioSectionTabs :items="libraryTabs" :label="t('项目')" />
        </div>
        <div class="projects-toolbar__right">
          <label class="projects-search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input v-model="keyword" type="search" :placeholder="t('搜索提示词')">
          </label>
        </div>
      </header>

      <div v-if="tags.length" class="projects-toolbar" style="padding-top: 0;">
        <div class="projects-toolbar__left" style="gap: 6px;">
          <button
            type="button"
            class="projects-tool-btn"
            :style="!activeTag ? 'font-weight:600;' : 'opacity:.7;'"
            @click="activeTag = ''"
          >
            {{ t('全部') }}
          </button>
          <button
            v-for="tag in tags"
            :key="tag"
            type="button"
            class="projects-tool-btn"
            :style="activeTag === tag ? 'font-weight:600;' : 'opacity:.7;'"
            @click="activeTag = activeTag === tag ? '' : tag"
          >
            {{ tag }}
          </button>
        </div>
      </div>
      <div v-if="sources.length" class="projects-toolbar" style="padding-top: 0;">
        <div class="projects-toolbar__left" style="gap: 6px;">
          <button
            type="button"
            class="projects-tool-btn"
            :style="!activeSource ? 'font-weight:600;' : 'opacity:.7;'"
            @click="activeSource = 0"
          >
            {{ t('全部') }}
          </button>
          <button
            v-for="src in sources"
            :key="src.id"
            type="button"
            class="projects-tool-btn"
            :style="activeSource === src.id ? 'font-weight:600;' : 'opacity:.7;'"
            @click="activeSource = activeSource === src.id ? 0 : src.id"
          >
            {{ src.name }}
          </button>
        </div>
      </div>
      </div>

      <p class="create-hint">{{ t('这些提示词可直接复制使用，也能一键带进画布继续改。') }}</p>

      <StudioPaging
        grid-class="prompt-grid"
        :loading="busy"
        :error="failed"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :count="items.length"
        :empty-title="t('还没有提示词')"
        :empty-description="t('运营录入或配置远程源同步后，提示词会出现在这里。')"
        :load-more="loadMore"
      >
        <template #skeleton>
          <article v-for="n in 6" :key="n" class="prompt-card prompt-card--skeleton" aria-hidden="true">
            <USkeleton class="prompt-card__thumb" />
            <div class="prompt-card__body">
              <USkeleton class="h-4 w-2/3" />
              <USkeleton class="h-3 w-1/3" />
            </div>
          </article>
        </template>

        <article
          v-for="item in items"
          :key="item.id"
          class="prompt-card"
          role="button"
          tabindex="0"
          @click="openDetail(item)"
          @keydown.enter="openDetail(item)"
        >
          <div class="prompt-card__thumb">
            <img v-if="item.cover_url" :src="resolveMediaUrl(item.cover_url)" :alt="item.title" loading="lazy">
            <UIcon v-else name="i-lucide-quote" class="size-5" />
          </div>
          <div class="prompt-card__body">
            <h3>{{ item.title }}</h3>
            <div class="prompt-card__meta">
              <span v-for="tag in item.tags.slice(0, 3)" :key="tag">{{ tag }}</span>
              <em v-if="item.source_name">{{ item.source_name }}</em>
            </div>
          </div>
        </article>
      </StudioPaging>
    </div>

    <Teleport to="body">
      <div v-if="detail" class="studio-modal-mask" @click.self="detail = null">
        <div class="studio-modal prompt-detail" role="dialog" aria-modal="true">
          <header class="asset-picker__head">
            <div>
              <h2>{{ detail.title }}</h2>
              <p v-if="detail.source_name">{{ t('来源：{name}', { name: detail.source_name }) }}</p>
            </div>
            <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="detail = null">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </header>

          <div class="prompt-detail__body">
            <img
              v-if="detail.result_url || detail.cover_url"
              :src="resolveMediaUrl(detail.result_url || detail.cover_url)"
              :alt="detail.title"
              class="prompt-detail__img"
            >
            <p v-if="detailLoading" class="wallet-card__empty">{{ t('加载中…') }}</p>
            <pre v-else class="prompt-detail__text">{{ detail.content || t('（这条提示词没有正文）') }}</pre>
            <div v-if="detail.tags.length" class="prompt-detail__tags">
              <span v-for="tag in detail.tags" :key="tag">{{ tag }}</span>
            </div>
            <a
              v-if="detail.source_url"
              :href="detail.source_url"
              target="_blank"
              rel="noopener noreferrer"
              class="prompt-detail__link"
            >
              {{ t('查看原文') }}
              <UIcon name="i-lucide-external-link" class="size-3.5" />
            </a>
          </div>

          <footer class="plan-confirm__actions publish-modal__foot">
            <button type="button" class="plan-btn plan-btn--ghost" :disabled="!detail.content" @click="copyPrompt">
              {{ t('复制') }}
            </button>
            <button type="button" class="plan-btn plan-btn--solid" :disabled="!detail.content" @click="useInCanvas">
              {{ t('去画布创作') }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
