<script setup lang="ts">
import assetApi from '~/api/asset'
import StudioSelect from '~/components/studio/StudioSelect.vue'
import type { Asset, AssetRef, AssetType } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()
const localePath = useLocalePath()
const { confirm, state: confirmState } = useConfirm()

/**
 * 资产选择器：资产库列表 + 上传，供画布「上传 / 从资产库选择 / 资产 / 参考」入口复用。
 * - accept 限定可选类型
 * - 点卡片多选，确定后提交；删除需二次确认；放大看原图/视频/音频
 */
const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  accept?: AssetType[]
  /** 打开即弹系统文件选择框 */
  autoUpload?: boolean
}>(), {
  title: '',
  accept: () => ['image', 'video', 'audio'],
  autoUpload: false,
})

const emit = defineEmits<{
  close: []
  pick: [assets: Asset[]]
  uploading: [value: boolean]
  /** 自动上传流程：选完文件即通知（右键上传据此先在画布落「上传中」占位节点） */
  'upload-start': [file: File]
  /** 自动上传失败 / 类型不符：通知工作区撤掉占位节点 */
  'upload-fail': []
}>()

const toast = useToast()
const uploading = ref(false)
watch(uploading, value => emit('uploading', value))
const keyword = ref('')
const typeFilter = ref<AssetType | ''>('')
const fileInput = ref<HTMLInputElement | null>(null)
const PAGE_SIZE_OPTIONS = [15, 20, 30] as const
const pageSize = ref<(typeof PAGE_SIZE_OPTIONS)[number]>(15)
const page = ref(1)
const total = ref(0)
const assets = ref<Asset[]>([])
const loading = ref(false)
const jumpPage = ref('1')
const selected = ref<Asset[]>([])
const preview = ref<Asset | null>(null)
let keywordTimer: number | undefined
let seq = 0

const TYPE_LABEL: Record<AssetType, string> = { image: t('图片'), video: t('视频'), audio: t('音频'), text: t('文本'), other: t('文件') }
/** 入口只收一种类型（风格封面只有图片）时，列表按这个类型向接口要满页，不再在本地丢掉别的类型 */
const pinnedType = computed(() => props.accept.length === 1 ? props.accept[0] : '')
const tabs = computed(() => {
  if (pinnedType.value)
    return []
  return [
    { value: '' as const, label: t('全部') },
    ...props.accept.map(item => ({ value: item, label: TYPE_LABEL[item] })),
  ]
})
const acceptAttr = computed(() => props.accept.map(item => `${item}/*`).join(','))
const pageSizeItems = computed(() => PAGE_SIZE_OPTIONS.map(n => ({ value: n, label: `${n}${t('条/页')}` })))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))
/** 页码条：页数少时全列出来；多的时候当前页前后各留两页，首尾用省略号隔开 */
const pageTokens = computed(() => {
  const count = pageCount.value
  const current = page.value
  if (count <= 7)
    return Array.from({ length: count }, (_, index) => index + 1)
  const near = new Set<number>([1, count])
  for (let n = current - 2; n <= current + 2; n++) {
    if (n >= 1 && n <= count)
      near.add(n)
  }
  const sorted = [...near].sort((a, b) => a - b)
  const tokens: Array<number | 'gap'> = []
  for (const n of sorted) {
    const prev = tokens[tokens.length - 1]
    if (typeof prev === 'number' && n - prev > 1)
      tokens.push('gap')
    tokens.push(n)
  }
  return tokens
})
const busy = computed(() => loading.value && assets.value.length === 0)
const failed = ref(false)
let loadedPage = 1
const selectedIds = computed(() => new Set(selected.value.map(item => item.id)))

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function durationLabel(sec: number) {
  if (!sec || sec <= 0)
    return ''
  const n = sec >= 1000 ? sec / 1000 : sec
  return `${Number(n.toFixed(1))}s`
}

async function load() {
  const current = ++seq
  const requested = page.value
  loading.value = true
  failed.value = false
  try {
    const q = keyword.value.trim()
    const type = typeFilter.value || pinnedType.value
    const res = await assetApi.list({
      page: page.value,
      page_size: pageSize.value,
      keyword: q || undefined,
      ...(type ? { type } : {}),
    })
    if (current !== seq)
      return
    if (!res?.success || !res.data) {
      page.value = loadedPage
      jumpPage.value = String(loadedPage)
      failed.value = assets.value.length === 0
      notify(res?.message || t('资产加载失败'), 'error')
      return
    }
    const rows = res.data.items ?? []
    assets.value = type ? rows : rows.filter(item => props.accept.includes(item.type))
    total.value = res.data.total
    loadedPage = requested
    failed.value = false
    const last = Math.max(1, Math.ceil(total.value / pageSize.value) || 1)
    if (page.value > last) {
      page.value = last
      jumpPage.value = String(last)
      await load()
      return
    }
    jumpPage.value = String(page.value)
  }
  catch {
    if (current !== seq)
      return
    page.value = loadedPage
    jumpPage.value = String(loadedPage)
    failed.value = assets.value.length === 0
    notify(t('资产加载失败'), 'error')
  }
  finally {
    if (current === seq)
      loading.value = false
  }
}

function gotoPage(next: number) {
  const last = pageCount.value
  const n = Math.min(last, Math.max(1, Math.trunc(next) || 1))
  if (n === page.value && assets.value.length)
    return
  page.value = n
  jumpPage.value = String(n)
  void load()
}

function onPageSize(value: string | number) {
  const n = Number(value)
  if (!PAGE_SIZE_OPTIONS.includes(n as any))
    return
  pageSize.value = n as (typeof PAGE_SIZE_OPTIONS)[number]
  page.value = 1
  jumpPage.value = '1'
  void load()
}

function onJumpKey(event: KeyboardEvent) {
  if (event.key !== 'Enter')
    return
  event.preventDefault()
  gotoPage(Number(jumpPage.value))
}

function isPicked(id: number) {
  return selectedIds.value.has(id)
}

function togglePick(item: Asset) {
  if (isPicked(item.id))
    selected.value = selected.value.filter(row => row.id !== item.id)
  else
    selected.value = [...selected.value, item]
}

function confirmPick() {
  if (!selected.value.length) {
    emit('close')
    return
  }
  emit('pick', [...selected.value])
}

function pickFiles() {
  fileInput.value?.click()
  if (!props.autoUpload)
    return
  const onBack = () => {
    window.removeEventListener('focus', onBack)
    window.setTimeout(() => {
      if (props.open && props.autoUpload && !uploading.value)
        emit('close')
    }, 250)
  }
  window.addEventListener('focus', onBack)
}

async function onFilesChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    if (props.autoUpload)
      emit('close')
    return
  }
  uploading.value = true
  if (props.autoUpload)
    emit('upload-start', file)
  try {
    const res = await assetApi.upload(file)
    if (!res?.success || !res.data) {
      notify(res?.message || t('上传失败'), 'error')
      if (props.autoUpload) {
        emit('upload-fail')
        emit('close')
      }
      return
    }
    const uploaded = res.data
    if (!props.accept.includes(uploaded.type)) {
      notify(t('已上传，但此处只能使用{types}', { types: props.accept.map(k => TYPE_LABEL[k]).join('、') }), 'error')
      if (props.autoUpload) {
        emit('upload-fail')
        emit('close')
      }
      return
    }
    if (props.autoUpload) {
      emit('pick', [uploaded])
      return
    }
    notify(t('上传成功，已加入选中'), 'success')
    if (!isPicked(uploaded.id))
      selected.value = [...selected.value, uploaded]
    page.value = 1
    jumpPage.value = '1'
    await load()
  }
  finally {
    uploading.value = false
  }
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
  if (!(await confirm({
    title: t('移到回收站'),
    message: t('将「{name}」移到回收站？30 天内可恢复。', { name: item.name }),
    confirmText: t('移到回收站'),
    danger: true,
  })))
    return
  let res = await assetApi.remove(item.id)
  const inUse = !res?.success && res?.data && typeof res.data === 'object' && (res.data as any).reason === 'in_use'
  if (inUse) {
    const refs = ((res?.data as any).refs ?? []) as AssetRef[]
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
  selected.value = selected.value.filter(row => row.id !== item.id)
  if (preview.value?.id === item.id)
    preview.value = null
  notify(t('已移到回收站'))
  await load()
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open)
    return
  // 删除确认框开着时 Esc 交给确认框，只关确认框
  if (event.key !== 'Escape' || confirmState.value.open)
    return
  event.stopPropagation()
  if (preview.value) {
    preview.value = null
    return
  }
  emit('close')
}

watch(() => props.open, (open) => {
  if (!open)
    return
  if (props.autoUpload) {
    nextTick(() => pickFiles())
    return
  }
  keyword.value = ''
  typeFilter.value = ''
  page.value = 1
  pageSize.value = 15
  jumpPage.value = '1'
  selected.value = []
  preview.value = null
  void load()
}, { immediate: true })

watch(typeFilter, () => {
  if (props.open && !props.autoUpload) {
    page.value = 1
    jumpPage.value = '1'
    void load()
  }
})

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    if (props.open && !props.autoUpload) {
      page.value = 1
      jumpPage.value = '1'
      void load()
    }
  }, 320)
})

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <Teleport to="body">
    <input ref="fileInput" type="file" :accept="acceptAttr" hidden @change="onFilesChosen">
    <div v-if="open && !autoUpload" class="studio-modal-mask asset-picker-mask" @click.self="emit('close')" @pointerdown.stop @keydown.stop>
      <div class="studio-modal asset-picker" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="asset-picker-title">{{ title || t('从资产库选择') }}</h2>
            <p>{{ t('从资产库选择，或上传新的资产') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="asset-picker__bar">
          <div v-if="tabs.length" class="asset-picker__tabs">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              type="button"
              :class="{ 'is-on': typeFilter === tab.value }"
              @click="typeFilter = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
          <label class="projects-search asset-picker__search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input v-model="keyword" type="search" :placeholder="t('搜索资产')">
          </label>
          <NuxtLink :to="localePath('/assets')" target="_blank" class="asset-picker__manage">
            <UIcon name="i-lucide-library" class="size-4" />
            {{ t('管理资产') }}
          </NuxtLink>
          <button type="button" class="asset-picker__upload" :disabled="uploading" @click="pickFiles">
            <UIcon name="i-lucide-upload" class="size-4" />
            {{ uploading ? t('上传中…') : t('上传') }}
          </button>
        </div>

        <div class="asset-picker__body">
          <div v-if="busy" class="asset-picker__grid" role="status" aria-busy="true">
            <div v-for="n in pageSize" :key="n" class="asset-picker__item">
              <USkeleton class="asset-picker__thumb" />
              <USkeleton class="mt-2 h-3 w-3/5" />
            </div>
          </div>
          <div v-else-if="failed && !assets.length" class="asset-picker__empty">
            <span class="asset-picker__empty-mark">
              <UIcon name="i-lucide-images" class="size-8" />
            </span>
            <strong>{{ t('资产加载失败') }}</strong>
            <button type="button" class="asset-picker__cta" @click="load">{{ t('重试') }}</button>
          </div>
          <div v-else-if="!assets.length" class="asset-picker__empty">
            <span class="asset-picker__empty-mark">
              <UIcon name="i-lucide-images" class="size-8" />
            </span>
            <strong>{{ t('还没有可用资产') }}</strong>
            <p>{{ t('从资产库选择，或上传新的资产') }}</p>
            <button type="button" class="asset-picker__cta" :disabled="uploading" @click="pickFiles">
              <UIcon name="i-lucide-upload" class="size-4" />
              {{ uploading ? t('上传中…') : t('上传资产') }}
            </button>
          </div>
          <div v-else class="asset-picker__grid">
            <div
              v-for="item in assets"
              :key="item.id"
              class="asset-picker__item"
              :class="{ 'is-on': isPicked(item.id) }"
              :title="item.name"
              @click="togglePick(item)"
            >
              <div class="asset-picker__thumb" :class="{ 'is-on': isPicked(item.id) }">
                <img v-if="item.type === 'image'" :src="resolveMediaUrl(item.url)" :alt="item.name" loading="lazy">
                <video v-else-if="item.type === 'video'" :src="resolveMediaUrl(item.url)" :poster="item.cover_url ? resolveMediaUrl(item.cover_url) : undefined" muted preload="metadata" />
                <UIcon v-else :name="item.type === 'audio' ? 'i-lucide-music' : 'i-lucide-file'" class="size-8" />
                <i>{{ TYPE_LABEL[item.type] }}</i>
                <em v-if="durationLabel(item.duration)" class="asset-picker__time">{{ durationLabel(item.duration) }}</em>
                <span class="asset-picker__check" :class="{ 'is-on': isPicked(item.id) }">
                  <UIcon v-if="isPicked(item.id)" name="i-lucide-check" class="size-3.5" />
                </span>
                <span class="asset-picker__actions">
                  <button type="button" :aria-label="t('删除')" @click.stop="removeAsset(item)">
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>
                  <button type="button" :aria-label="t('放大')" @click.stop="preview = item">
                    <UIcon name="i-lucide-maximize-2" class="size-3.5" />
                  </button>
                </span>
              </div>
              <span class="asset-picker__name">{{ item.name }}</span>
            </div>
          </div>
        </div>

        <footer class="asset-picker__pager">
          <span class="asset-picker__count">{{ t('已选 {n}', { n: selected.length }) }}</span>
          <div class="asset-picker__pager-nav">
            <button type="button" :disabled="page <= 1 || loading" :aria-label="t('上一页')" @click="gotoPage(page - 1)">
              <UIcon name="i-lucide-chevron-left" class="size-4" />
            </button>
            <template v-for="(item, index) in pageTokens" :key="item === 'gap' ? `gap-${index}` : item">
              <span v-if="item === 'gap'" class="asset-picker__gap" aria-hidden="true">…</span>
              <button
                v-else
                type="button"
                class="asset-picker__page"
                :class="{ 'is-on': item === page }"
                :disabled="loading"
                :aria-current="item === page ? 'page' : undefined"
                @click="gotoPage(item)"
              >
                {{ item }}
              </button>
            </template>
            <button type="button" :disabled="page >= pageCount || loading" :aria-label="t('下一页')" @click="gotoPage(page + 1)">
              <UIcon name="i-lucide-chevron-right" class="size-4" />
            </button>
            <StudioSelect
              :model-value="pageSize"
              :options="pageSizeItems"
              :sr-label="t('每页条数')"
              size="compact"
              placement="up"
              @update:model-value="onPageSize"
            />
            <label class="asset-picker__jump">
              {{ t('跳至') }}
              <input
                v-model="jumpPage"
                type="text"
                inputmode="numeric"
                :aria-label="t('页码')"
                @keydown="onJumpKey"
              >
              {{ t('页') }}
            </label>
          </div>
          <button type="button" class="asset-picker__ok" @click="confirmPick">
            {{ t('确定') }}
          </button>
        </footer>
      </div>

      <div v-if="preview" class="asset-picker__preview" @click.self="preview = null" @pointerdown.stop>
        <button type="button" class="asset-picker__preview-x" :aria-label="t('关闭')" @click="preview = null">
          <UIcon name="i-lucide-x" class="size-5" />
        </button>
        <img v-if="preview.type === 'image'" :src="resolveMediaUrl(preview.url)" :alt="preview.name">
        <video v-else-if="preview.type === 'video'" :src="resolveMediaUrl(preview.url)" controls autoplay />
        <audio v-else-if="preview.type === 'audio'" :src="resolveMediaUrl(preview.url)" controls autoplay />
      </div>
    </div>
  </Teleport>
</template>
