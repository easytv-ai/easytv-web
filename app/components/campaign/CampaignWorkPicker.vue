<script setup lang="ts">
import campaignApi from '~/api/campaign'
import workApi from '~/api/work'
import type { CampaignEntry, Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

/**
 * 选一部已发布的作品投稿到活动（POST /user/work/:id/enter，API.md 8.6）。
 * 只列 status=1 的作品；重复投稿 / 活动不在投稿期等错误由后端文案直接提示。
 */
const props = defineProps<{
  open: boolean
  campaignId: number
}>()

const emit = defineEmits<{
  close: []
  entered: [entry: CampaignEntry]
}>()

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()

const keyword = ref('')
const submittingId = ref(0)
let keywordTimer: number | undefined

const {
  items: works,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
} = useStudioPaged<Work>({
  pageSize: 24,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await workApi.mine({
      status: 1,
      page,
      page_size: pageSize,
      keyword: q || undefined,
    })
    if (!res?.success || !res.data) {
      toast.add({ title: res?.message || t('加载失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return null
    }
    return res.data
  },
})

async function pick(work: Work) {
  if (submittingId.value)
    return
  submittingId.value = work.id
  try {
    const res = await campaignApi.enter(work.id, props.campaignId)
    if (!res?.success || !res.data) {
      toast.add({ title: res?.message || t('投稿失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    toast.add({ title: t('投稿成功，审核通过后出现在投稿墙'), description: work.title, color: 'success', close: false, progress: false, orientation: 'horizontal' })
    emit('entered', res.data)
    emit('close')
  }
  finally {
    submittingId.value = 0
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !submittingId.value) {
    event.stopPropagation()
    emit('close')
  }
}

watch(() => props.open, (open) => {
  if (!open)
    return
  window.clearTimeout(keywordTimer)
  keyword.value = ''
  void reload()
})

watch(keyword, () => {
  if (!props.open)
    return
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => { void reload() }, 320)
})

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask asset-picker-mask" @click.self="!submittingId && emit('close')">
      <div class="studio-modal asset-picker" role="dialog" aria-modal="true" aria-labelledby="campaign-picker-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="campaign-picker-title">{{ t('选择参赛作品') }}</h2>
            <p>{{ t('只能选已发布的作品，一部作品对同一活动只能投一次') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="!!submittingId" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="asset-picker__bar">
          <label class="projects-search asset-picker__search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input v-model="keyword" type="search" :placeholder="t('account.work.searchPublished')">
          </label>
        </div>

        <div class="asset-picker__body">
          <StudioPaging
            root=".asset-picker__body"
            grid-class="asset-picker__grid"
            compact
            :loading="busy"
            :error="failed"
            :loading-more="loadingMore"
            :has-more="hasMore"
            :count="works.length"
            :empty-title="keyword.trim() ? t('account.work.emptyFiltered') : t('还没有已发布的作品')"
            :empty-description="keyword.trim() ? '' : t('先去创作台生成视频并发布为作品，再回来投稿。')"
            :load-more="loadMore"
          >
            <template #skeleton>
              <div class="asset-picker__grid">
                <div v-for="n in 8" :key="n" class="asset-picker__item asset-picker__item--skeleton" aria-hidden="true">
                  <span class="asset-picker__thumb">
                    <USkeleton class="size-full rounded-[inherit]" />
                  </span>
                  <USkeleton class="h-3 w-3/5" />
                </div>
              </div>
            </template>
            <template #empty>
              <div class="asset-picker__empty">
                <strong>{{ keyword.trim() ? t('account.work.emptyFiltered') : t('还没有已发布的作品') }}</strong>
                <p v-if="!keyword.trim()">{{ t('先去创作台生成视频并发布为作品，再回来投稿。') }}</p>
                <NuxtLink v-if="!keyword.trim()" :to="localePath('/create')" class="asset-picker__cta">{{ t('去创作') }}</NuxtLink>
              </div>
            </template>
            <div class="asset-picker__grid">
              <button
                v-for="work in works"
                :key="work.id"
                type="button"
                class="asset-picker__item"
                :disabled="!!submittingId"
                @click="pick(work)"
              >
                <span class="asset-picker__thumb">
                  <img v-if="work.cover_url" :src="resolveMediaUrl(work.cover_url)" :alt="work.title" loading="lazy">
                  <video v-else :src="resolveMediaUrl(work.video_url)" muted playsinline preload="metadata" />
                  <i v-if="submittingId === work.id">{{ t('投稿中…') }}</i>
                </span>
                <span class="asset-picker__name">{{ work.title }}</span>
              </button>
            </div>
          </StudioPaging>
        </div>
      </div>
    </div>
  </Teleport>
</template>
