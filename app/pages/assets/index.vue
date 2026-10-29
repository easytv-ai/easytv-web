<script setup lang="ts">
import assetApi from '~/api/asset'
import subjectApi from '~/api/subject'
import StudioPublishModal from '~/components/studio/StudioPublishModal.vue'
import { resolveMediaUrl } from '~/utils/media'
import type { Asset, AssetType, SubjectKind, AssetRef } from '~/types/creative'

const { t } = useI18n()
const { libraryTabs } = useStudioNav()
const localePath = useLocalePath()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('资产') })

const toast = useToast()
const { confirm } = useConfirm()

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const keyword = ref('')
const typeFilter = ref<AssetType | ''>('')
const menuFor = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref({ done: 0, total: 0 })
const publishAsset = ref<Asset | null>(null)
const refsAsset = ref<Asset | null>(null)
const refs = ref<AssetRef[]>([])
const refsBusy = ref(false)
const refsFailed = ref(false)
const PAGE_SIZE = 24
const TRASH_PAGE_SIZE = 18
let keywordTimer: number | undefined

const {
  items: assets,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
  removeById,
} = useStudioPaged<Asset>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await assetApi.list({
      page,
      page_size: pageSize,
      keyword: q || undefined,
      ...(typeFilter.value ? { type: typeFilter.value } : {}),
    })
    if (!res?.success || !res.data) {
      notify(res?.message || t('资产列表加载失败'), 'error')
      return null
    }
    return res.data
  },
})

type TrashAsset = Asset & { deleted_at: string }

const {
  items: trashItems,
  busy: trashBusy,
  failed: trashFailed,
  loadingMore: trashLoadingMore,
  hasMore: trashHasMore,
  reload: reloadTrash,
  loadMore: loadMoreTrash,
} = useStudioPaged<TrashAsset>({
  pageSize: TRASH_PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await assetApi.trash({ page, page_size: pageSize })
    if (!res?.success || !res.data) {
      notify(res?.message || t('回收站加载失败'), 'error')
      return null
    }
    return res.data
  },
})

// ---- 回收站 ----
const trashOpen = ref(false)
const selectedTrash = ref<number[]>([])
const restoring = ref(false)
const allTrashSelected = computed(() => trashItems.value.length > 0 && selectedTrash.value.length === trashItems.value.length)

function daysLeft(deletedAt: string) {
  const t = new Date(deletedAt).getTime()
  if (!Number.isFinite(t))
    return 30
  return Math.max(0, 30 - Math.floor((Date.now() - t) / 86400000))
}

async function openTrash() {
  trashOpen.value = true
  selectedTrash.value = []
  await reloadTrash()
}

function toggleTrashItem(id: number) {
  selectedTrash.value = selectedTrash.value.includes(id)
    ? selectedTrash.value.filter(i => i !== id)
    : [...selectedTrash.value, id]
}

function toggleAllTrash() {
  selectedTrash.value = allTrashSelected.value ? [] : trashItems.value.map(i => i.id)
}

function closeTrash() {
  trashOpen.value = false
  selectedTrash.value = []
}

async function restoreTrash() {
  if (!selectedTrash.value.length || restoring.value)
    return
  restoring.value = true
  try {
    const results = await Promise.all(selectedTrash.value.map(id => assetApi.restore(id)))
    const failed = results.filter(r => !r?.success).length
    notify(failed ? t('{n} 个恢复失败', { n: failed }) : t('已恢复'), failed ? 'error' : 'neutral')
    closeTrash()
    await reload()
  }
  finally {
    restoring.value = false
  }
}

function openPublish(item: Asset) {
  menuFor.value = null
  publishAsset.value = item
}

// ---- 存为主体（API.md 10.2 POST /user/subject/from-asset）----
const SUBJECT_KINDS: { value: SubjectKind, label: string }[] = [
  { value: 'character', label: t('角色') },
  { value: 'scene', label: t('场景') },
  { value: 'prop', label: t('道具') },
]
const subjectAsset = ref<Asset | null>(null)
const subjectSaving = ref(false)
const subjectError = ref('')
const subjectForm = reactive<{ kind: SubjectKind, name: string, look: string }>({ kind: 'character', name: '', look: '' })

function openSubject(item: Asset) {
  menuFor.value = null
  subjectError.value = ''
  Object.assign(subjectForm, {
    kind: 'character' as SubjectKind,
    name: item.name.replace(/\.[^.]+$/, '').slice(0, 30),
    look: '',
  })
  subjectAsset.value = item
}

function closeSubject() {
  if (subjectSaving.value)
    return
  subjectAsset.value = null
}

async function saveSubject() {
  const item = subjectAsset.value
  if (!item)
    return
  const name = subjectForm.name.trim()
  if (!name) {
    subjectError.value = t('请填写主体名称')
    return
  }
  subjectSaving.value = true
  subjectError.value = ''
  try {
    const res = await subjectApi.fromAsset({
      asset_id: item.id,
      kind: subjectForm.kind,
      name,
      look: subjectForm.look.trim() || undefined,
    })
    if (!res?.success) {
      subjectError.value = res?.message || t('保存失败')
      return
    }
    subjectAsset.value = null
    toast.add({
      title: t('已存为主体'),
      description: name,
      color: 'success',
      close: false,
      progress: false,
      orientation: 'horizontal',
      actions: [{ label: t('去主体库'), onClick: () => void navigateTo(localePath('/subjects')) }],
    })
  }
  finally {
    subjectSaving.value = false
  }
}

const TYPE_TABS: { value: AssetType | '', label: string }[] = [
  { value: '', label: t('全部') },
  { value: 'video', label: t('视频') },
  { value: 'image', label: t('图片') },
  { value: 'audio', label: t('音频') },
]

const TYPE_LABEL: Record<AssetType, string> = {
  image: t('图片'),
  video: t('视频'),
  audio: t('音频'),
  text: t('文本'),
  other: t('文件'),
}

function formatSize(bytes: number) {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function assetUrl(item: Asset) {
  return resolveMediaUrl(item.url)
}

watch(typeFilter, () => void reload())

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    void reload()
  }, 320)
})

function pickFiles() {
  fileInput.value?.click()
}

async function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length)
    return
  uploading.value = true
  uploadProgress.value = { done: 0, total: files.length }
  let failed = 0
  for (const file of files) {
    const res = await assetApi.upload(file)
    if (!res?.success) {
      failed += 1
      notify(`${file.name}：${res?.message || t('上传失败')}`, 'error')
    }
    uploadProgress.value.done += 1
  }
  uploading.value = false
  if (failed < files.length)
    notify(t('已上传 {n} 个文件', { n: files.length - failed }))
  await reload()
}

function toggleMenu(id: number) {
  menuFor.value = menuFor.value === id ? null : id
}

function refLabel(ref: AssetRef) {
  switch (ref.type) {
    case 'canvas': return t('画布「{name}」的 {n} 个节点', { name: ref.name || `#${ref.id}`, n: ref.node_ids?.length ?? 1 })
    case 'subject': return t('主体「{name}」', { name: ref.name || `#${ref.id}` })
    case 'work': return t('作品「{name}」', { name: ref.name || `#${ref.id}` })
    default: return t('画布 #{id} 的成片时间线', { id: ref.id })
  }
}

async function removeAsset(item: Asset) {
  menuFor.value = null
  if (!(await confirm({
    title: t('移到回收站'),
    message: t('将「{name}」移到回收站？30 天内可恢复。', { name: item.name }),
    confirmText: t('移到回收站'),
    danger: true,
  })))
    return
  let res = await assetApi.remove(item.id)
  // 还在被使用：列出影响范围，确认后强制删除
  const inUse = !res?.success && res?.data && typeof res.data === 'object' && res.data.reason === 'in_use'
  if (inUse) {
    const refs = (res?.data as { refs?: AssetRef[] }).refs ?? []
    const lines = refs.slice(0, 6).map(ref => refLabel(ref))
    if (refs.length > 6)
      lines.push(t('等 {n} 处', { n: refs.length }))
    if (!(await confirm({
      title: t('素材正在使用'),
      message: `${res?.message || ''}\n${lines.join('\n')}`,
      confirmText: t('仍然删除'),
      danger: true,
    })))
      return
    res = await assetApi.remove(item.id, true)
  }
  if (!res?.success) {
    notify(res?.message || t('删除失败'), 'error')
    return
  }
  removeById(item.id)
  notify(t('已移到回收站'))
}

const preview = ref<{ src: string, kind: 'video' | 'image' | 'audio', caption: string } | null>(null)

function openAsset(item: Asset) {
  menuFor.value = null
  const kind = item.type === 'video' || item.type === 'image' || item.type === 'audio' ? item.type : 'image'
  preview.value = { src: assetUrl(item), kind, caption: item.name }
}

function refHref(ref: AssetRef) {
  if (ref.type === 'work')
    return localePath(`/watch/${ref.id}`)
  if (ref.type === 'subject')
    return localePath('/subjects')
  return localePath({ path: '/canvas', query: { id: String(ref.id) } })
}

async function openRefs(item: Asset) {
  menuFor.value = null
  refsAsset.value = item
  refs.value = []
  refsFailed.value = false
  refsBusy.value = true
  try {
    const res = await assetApi.refs(item.id)
    if (!res?.success || !res.data) {
      refsFailed.value = true
      notify(res?.message || t('加载失败，请稍后重试'), 'error')
      return
    }
    refs.value = res.data.refs ?? []
  }
  catch {
    refsFailed.value = true
    notify(t('加载失败，请稍后重试'), 'error')
  }
  finally {
    refsBusy.value = false
  }
}

function closeRefs() {
  refsAsset.value = null
  refs.value = []
  refsFailed.value = false
}

function onDocumentClick(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.projects-card__menu, .projects-card__more'))
    menuFor.value = null
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  void reload()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <section class="projects-page">
    <div class="show-page__inner">
      <div class="projects-stick">
      <header class="projects-toolbar">
        <div class="projects-toolbar__left">
          <h1 class="sr-only">{{ t('全部资产') }}</h1>
          <StudioSectionTabs :items="libraryTabs" :label="t('项目')" />
        </div>
        <div class="projects-toolbar__right">
          <label class="projects-search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input
              v-model="keyword"
              type="search"
              :placeholder="t('搜索资产')"
            >
          </label>
          <button type="button" class="projects-tool-btn" @click="openTrash">
            <UIcon name="i-lucide-trash-2" class="size-4" />
            {{ t('回收站') }}
          </button>
          <button type="button" class="projects-tool-btn" :disabled="uploading" @click="pickFiles">
            <UIcon name="i-lucide-upload" class="size-4" />
            {{ uploading ? `${t('上传中')} ${uploadProgress.done}/${uploadProgress.total}` : t('上传') }}
          </button>
          <input
            ref="fileInput"
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            hidden
            @change="onFilesChosen"
          >
        </div>
      </header>

      <div class="projects-toolbar" style="padding-top: 0;">
        <div class="projects-toolbar__left" style="gap: 6px;">
          <button
            v-for="tab in TYPE_TABS"
            :key="tab.value"
            type="button"
            class="projects-tool-btn"
            :style="typeFilter === tab.value ? 'font-weight:600;' : 'opacity:.7;'"
            @click="typeFilter = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      </div>

      <StudioPaging
        grid-class="projects-grid"
        :loading="busy"
        :error="failed"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :count="assets.length"
        :empty-title="t('暂无资产')"
        :empty-description="t('上传图片、视频或音频素材，生成的作品也会集中出现在这里。')"
        :load-more="loadMore"
      >
        <template #skeleton>
          <article v-for="n in 8" :key="n" class="projects-card projects-card--skeleton">
            <USkeleton class="projects-card__thumb" />
            <div class="projects-card__meta">
              <div class="projects-card__text">
                <USkeleton class="h-3.5 w-3/5" />
                <USkeleton class="mt-1.5 h-3 w-2/5" />
              </div>
            </div>
          </article>
        </template>
        <template #empty>
          <div class="projects-grid">
            <button type="button" class="projects-card projects-card--create" :disabled="uploading" @click="pickFiles">
              <span class="projects-card__thumb">
                <span class="projects-card__plus">
                  <UIcon name="i-lucide-upload" class="size-7" />
                </span>
              </span>
              <span class="projects-card__meta">
                <span class="projects-card__title">{{ t('上传素材') }}</span>
              </span>
            </button>
          </div>
          <StudioEmpty
            compact
            :title="t('暂无资产')"
            :description="t('上传图片、视频或音频素材，生成的作品也会集中出现在这里。')"
          />
        </template>
        <div class="projects-grid">
          <button type="button" class="projects-card projects-card--create" :disabled="uploading" @click="pickFiles">
            <span class="projects-card__thumb">
              <span class="projects-card__plus">
                <UIcon name="i-lucide-upload" class="size-7" />
              </span>
            </span>
            <span class="projects-card__meta">
              <span class="projects-card__title">{{ t('上传素材') }}</span>
            </span>
          </button>

          <article v-for="item in assets" :key="item.id" class="projects-card">
            <button type="button" class="projects-card__thumb" @click="openAsset(item)">
              <img v-if="item.type === 'image'" :src="assetUrl(item)" :alt="item.name" loading="lazy">
              <video v-else-if="item.type === 'video'" :src="assetUrl(item)" muted preload="metadata" />
              <UIcon v-else :name="item.type === 'audio' ? 'i-lucide-music' : 'i-lucide-file'" class="projects-card__ph" />
              <span class="projects-card__badge">{{ TYPE_LABEL[item.type] }}</span>
            </button>
            <div class="projects-card__meta">
              <div class="projects-card__text">
                <h2 class="projects-card__title" :title="item.name">{{ item.name }}</h2>
                <p class="projects-card__sub">{{ formatSize(item.size) }} · {{ formatDate(item.created_at) }}</p>
              </div>
              <button type="button" class="projects-card__more" :class="{ 'is-on': menuFor === item.id }" :aria-label="t('更多')" @click.stop="toggleMenu(item.id)">
                <UIcon name="i-lucide-ellipsis" class="size-4" />
              </button>
            </div>
            <div v-if="menuFor === item.id" class="projects-card__menu" @click.stop>
              <button v-if="item.type === 'video'" type="button" @click="openPublish(item)">
                <UIcon name="i-lucide-send" class="size-4" />
                {{ t('发布为作品') }}
              </button>
              <button v-if="item.type === 'image'" type="button" @click="openSubject(item)">
                <UIcon name="i-lucide-users-round" class="size-4" />
                {{ t('存为主体') }}
              </button>
              <button type="button" @click="openAsset(item)">
                <UIcon :name="item.type === 'audio' ? 'i-lucide-audio-lines' : 'i-lucide-maximize-2'" class="size-4" />
                {{ item.type === 'video' ? t('放大播放') : item.type === 'audio' ? t('播放音频') : t('放大查看') }}
              </button>
              <button type="button" @click="openRefs(item)">
                <UIcon name="i-lucide-link" class="size-4" />
                {{ t('account.asset.refsTitle') }}
              </button>
              <button type="button" class="is-danger" @click="removeAsset(item)">
                <UIcon name="i-lucide-trash-2" class="size-4" />
                {{ t('删除') }}
              </button>
            </div>
          </article>
        </div>
      </StudioPaging>

      <div v-if="trashOpen" class="studio-modal-mask" @click.self="closeTrash">
        <div class="trash-modal" role="dialog" aria-modal="true" aria-labelledby="asset-trash-title">
          <header class="trash-modal__head">
            <div>
              <h2 id="asset-trash-title">{{ t('回收站') }}</h2>
              <p>{{ t('仅显示最近 30 天内删除的素材') }}</p>
            </div>
            <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="closeTrash">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </header>
          <div class="trash-modal__body">
            <StudioPaging
              root=".trash-modal__body"
              grid-class="trash-grid"
              compact
              :loading="trashBusy"
              :error="trashFailed"
              :loading-more="trashLoadingMore"
              :has-more="trashHasMore"
              :count="trashItems.length"
              :empty-title="t('回收站是空的')"
              :empty-description="t('最近 30 天删除的素材会出现在这里。')"
              :load-more="loadMoreTrash"
            >
              <template #skeleton>
                <article v-for="n in 6" :key="n" class="trash-card trash-card--skeleton" aria-hidden="true">
                  <USkeleton class="trash-card__thumb" />
                  <USkeleton class="mt-2 h-3.5 w-3/5" />
                  <USkeleton class="mt-1.5 h-3 w-2/5" />
                </article>
              </template>
              <div class="trash-grid">
                <article v-for="item in trashItems" :key="item.id" class="trash-card" :class="{ 'is-on': selectedTrash.includes(item.id) }">
                  <button type="button" class="trash-card__thumb" @click="toggleTrashItem(item.id)">
                    <img v-if="item.type === 'image'" :src="assetUrl(item)" :alt="item.name">
                    <video v-else-if="item.type === 'video'" :src="assetUrl(item)" muted preload="metadata" />
                    <UIcon v-else name="i-lucide-file" class="projects-card__ph" />
                    <span class="trash-check" :class="{ 'is-on': selectedTrash.includes(item.id) }" />
                  </button>
                  <h3>{{ item.name }}</h3>
                  <p>{{ t('剩余 {n} 天', { n: daysLeft(item.deleted_at) }) }}</p>
                </article>
              </div>
            </StudioPaging>
          </div>
          <footer class="trash-modal__foot">
            <label class="trash-modal__count">
              <input type="checkbox" :checked="allTrashSelected" :disabled="!trashItems.length" @change="toggleAllTrash">
              <span
                class="trash-check trash-check--plain"
                :class="{
                  'is-on': allTrashSelected,
                  'is-mix': selectedTrash.length > 0 && !allTrashSelected,
                }"
              />
              {{ t('已选择 {n} 项', { n: selectedTrash.length }) }}
            </label>
            <button type="button" class="trash-modal__restore" :disabled="!selectedTrash.length || restoring" @click="restoreTrash">{{ t('恢复') }}</button>
          </footer>
        </div>
      </div>

      <div v-if="subjectAsset" class="studio-modal-mask" @click.self="closeSubject">
        <div class="studio-modal subject-modal" role="dialog" aria-modal="true" aria-labelledby="asset-subject-title">
          <h2 id="asset-subject-title">{{ t('存为主体') }}</h2>
          <p class="subject-modal__lead">{{ t('用这张图片建一个可复用的主体，之后在画布里一键引用。') }}</p>
          <label class="publish-field">
            <span>{{ t('名称') }}</span>
            <input v-model="subjectForm.name" maxlength="30" :disabled="subjectSaving" :placeholder="t('例如：橘猫阿橘')">
          </label>
          <label class="publish-field">
            <span>{{ t('类型') }}</span>
            <div class="publish-tags">
              <button
                v-for="k in SUBJECT_KINDS"
                :key="k.value"
                type="button"
                :class="{ 'is-on': subjectForm.kind === k.value }"
                :disabled="subjectSaving"
                @click="subjectForm.kind = k.value"
              >
                {{ k.label }}
              </button>
            </div>
          </label>
          <label class="publish-field">
            <span>{{ t('外观描述') }}<small class="ml-1 opacity-60">{{ t('选填') }}</small></span>
            <textarea v-model="subjectForm.look" rows="3" maxlength="500" :disabled="subjectSaving" :placeholder="t('外貌、服装、材质与配色，用于文生图')" />
          </label>
          <p v-if="subjectError" class="publish-error">{{ subjectError }}</p>
          <div class="subject-modal__actions">
            <button type="button" class="plan-btn plan-btn--ghost" :disabled="subjectSaving" @click="closeSubject">{{ t('取消') }}</button>
            <button type="button" class="plan-btn plan-btn--solid" :disabled="subjectSaving" @click="saveSubject">{{ subjectSaving ? t('保存中…') : t('保存') }}</button>
          </div>
        </div>
      </div>

      <div v-if="refsAsset" class="studio-modal-mask" @click.self="closeRefs">
        <div class="studio-modal asset-refs-modal" role="dialog" aria-modal="true" aria-labelledby="asset-refs-title">
          <h2 id="asset-refs-title">{{ t('account.asset.refsTitle') }}</h2>
          <p class="subject-modal__lead">{{ refsAsset.name }} · {{ t('account.asset.refsLead') }}</p>
          <p v-if="refsBusy" class="asset-refs__empty">{{ t('加载中…') }}</p>
          <p v-else-if="refsFailed" class="asset-refs__empty">
            {{ t('加载失败，请稍后重试') }}
            <button type="button" class="plan-btn plan-btn--ghost" @click="openRefs(refsAsset)">{{ t('重试') }}</button>
          </p>
          <p v-else-if="!refs.length" class="asset-refs__empty">{{ t('account.asset.refsEmpty') }}</p>
          <ul v-else class="asset-refs">
            <li v-for="(ref, index) in refs" :key="`${ref.type}-${ref.id}-${index}`">
              <NuxtLink :to="refHref(ref)" @click="closeRefs">{{ refLabel(ref) }}</NuxtLink>
            </li>
          </ul>
          <div class="subject-modal__actions">
            <button type="button" class="plan-btn plan-btn--ghost" @click="closeRefs">{{ t('关闭') }}</button>
          </div>
        </div>
      </div>

      <CanvasMediaPreview
        :open="!!preview"
        :src="preview?.src || ''"
        :kind="preview?.kind || 'image'"
        :caption="preview?.caption || ''"
        @close="preview = null"
      />

      <StudioPublishModal
        :open="!!publishAsset"
        :asset="publishAsset"
        :project-id="publishAsset?.project_id"
        @close="publishAsset = null"
      />
    </div>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
