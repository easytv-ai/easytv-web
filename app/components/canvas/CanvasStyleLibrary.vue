<script setup lang="ts">
import styleApi from '~/api/style'
import type { Style } from '~/types/creative'
import { styleStatusLabel } from '~/utils/canvas-style-extract'

const { t } = useI18n()
const { isLoggedIn, requireLogin } = useRequireLogin()
const { confirm } = useConfirm()
const toast = useToast()

const props = defineProps<{
  open: boolean
  /** 当前节点已套用的风格 id，0 / undefined 表示没选 */
  value?: number
  /** 节点类型：只列 kinds 为空或包含该类型的风格 */
  kind?: 'image' | 'video'
  /** 当前节点的图（「从当前图定风格」的来源）；没有则该按钮置灰 */
  sourceImage?: { url: string, assetId?: number } | null
  /** 「从当前图定风格」进行中（工作区在跑文本任务） */
  extracting?: boolean
  /** 上层还叠着编辑弹窗：忽略 Esc 与蒙层点击 */
  locked?: boolean
  /** 工作区保存 / 编辑我的风格后递增，触发重拉「我的」 */
  mineVersion?: number
}>()

const emit = defineEmits<{
  close: []
  pick: [style: Style]
  clear: []
  /** 「我的」页签：新建 / 编辑 / 从当前图定风格，弹窗由工作区托管 */
  create: []
  edit: [style: Style]
  extract: []
}>()

/** 一次拉全（风格库量级几十条），关键词与分类在本地筛 */
const PAGE_SIZE = 200
/** 我的风格每人上限 100 条（API.md 34.5），一页拉完 */
const MINE_PAGE_SIZE = 100
const ALL = '__all__'
const MINE = '__mine__'

const keyword = ref('')
const category = ref(ALL)
const categories = ref<string[]>([])
const list = ref<Style[]>([])
const loading = ref(false)
const failed = ref(false)
const mine = ref<Style[]>([])
const mineLoading = ref(false)
const mineFailed = ref(false)
/** 正在投稿 / 撤回 / 删除的那条 */
const busyId = ref(0)
let seq = 0
let mineSeq = 0

const tabs = computed(() => [
  { id: ALL, label: t('全部') },
  ...categories.value.map(item => ({ id: item, label: item })),
  { id: MINE, label: t('我的') },
])

const onMine = computed(() => category.value === MINE)

function matches(item: Style, q: string) {
  return item.name.toLowerCase().includes(q)
    || item.prompt.toLowerCase().includes(q)
    || item.tags.some(tag => tag.toLowerCase().includes(q))
}

const items = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  let out = onMine.value ? mine.value : list.value
  if (!onMine.value && category.value !== ALL)
    out = out.filter(item => item.category === category.value)
  if (!q)
    return out
  return out.filter(item => matches(item, q))
})

const current = computed(() =>
  list.value.find(item => item.id === props.value)
  || mine.value.find(item => item.id === props.value)
  || null,
)

const showLoading = computed(() => onMine.value ? mineLoading.value && !mine.value.length : loading.value && !list.value.length)

const emptyTitle = computed(() => {
  if (onMine.value) {
    if (!isLoggedIn.value)
      return t('登录后管理我的风格')
    if (mineFailed.value)
      return t('我的风格加载失败')
    if (keyword.value.trim())
      return t('没有匹配的风格')
    return t('还没有自定义风格')
  }
  if (failed.value)
    return t('风格库加载失败')
  if (keyword.value.trim())
    return t('没有匹配的风格')
  return t('暂无风格')
})

const emptyDesc = computed(() => {
  if (onMine.value) {
    if (!isLoggedIn.value)
      return t('把一段风格描述存成自己的风格，也可以从画布上的图定风格')
    if (mineFailed.value)
      return t('稍后再试')
    if (keyword.value.trim())
      return t('换个关键词试试')
    return t('新建一个，或从当前图定风格')
  }
  if (failed.value)
    return t('稍后再试')
  if (keyword.value.trim())
    return t('换个关键词试试')
  return t('运营还没有配置风格')
})

const extractTitle = computed(() => {
  if (props.extracting)
    return t('正在分析这张图的风格…')
  if (!props.sourceImage?.url)
    return t('当前节点没有图片，先生成或添加一张图')
  return t('让 AI 看图总结风格，再存成我的风格')
})

async function loadMine() {
  const mySeq = ++mineSeq
  if (!isLoggedIn.value) {
    mine.value = []
    mineFailed.value = false
    return
  }
  mineLoading.value = true
  mineFailed.value = false
  try {
    const res = await styleApi.mine({ page: 1, page_size: MINE_PAGE_SIZE, kind: props.kind })
    if (mySeq !== mineSeq || !props.open)
      return
    if (!res?.success) {
      mineFailed.value = true
      return
    }
    mine.value = Array.isArray(res.data?.items) ? res.data.items : []
  }
  catch {
    if (mySeq === mineSeq)
      mineFailed.value = true
  }
  finally {
    if (mySeq === mineSeq)
      mineLoading.value = false
  }
}

async function load() {
  const mySeq = ++seq
  loading.value = true
  failed.value = false
  try {
    const [listRes, catRes] = await Promise.all([
      styleApi.list({ page: 1, page_size: PAGE_SIZE, kind: props.kind }),
      styleApi.categories(),
      loadMine(),
    ])
    if (mySeq !== seq || !props.open)
      return
    if (!listRes?.success) {
      failed.value = true
      list.value = []
      return
    }
    list.value = Array.isArray(listRes.data?.items) ? listRes.data.items : []
    categories.value = catRes?.success && Array.isArray(catRes.data) ? catRes.data : []
    if (category.value !== ALL && category.value !== MINE && !categories.value.includes(category.value))
      category.value = ALL
    // 节点套的是自己的私有风格：直接落在「我的」页签
    if (props.value && !list.value.some(item => item.id === props.value) && mine.value.some(item => item.id === props.value))
      category.value = MINE
  }
  catch {
    if (mySeq === seq) {
      failed.value = true
      list.value = []
    }
  }
  finally {
    if (mySeq === seq)
      loading.value = false
  }
}

function selectTab(id: string) {
  if (id === MINE && !isLoggedIn.value) {
    // 未登录也能进「我的」看提示，登录门槛放在动作上
    category.value = MINE
    return
  }
  category.value = id
}

function onCreate() {
  if (!requireLogin())
    return
  emit('create')
}

function onExtract() {
  if (!props.sourceImage?.url || props.extracting)
    return
  if (!requireLogin())
    return
  emit('extract')
}

function fail(message: string) {
  toast.add({ title: message, color: 'error', close: false, progress: false, orientation: 'horizontal' })
}

function patchMine(id: number, patch: Partial<Style>) {
  mine.value = mine.value.map(item => item.id === id ? { ...item, ...patch } : item)
}

async function onSubmit(item: Style) {
  if (busyId.value)
    return
  busyId.value = item.id
  try {
    const res = await styleApi.submit(item.id)
    if (!res?.success) {
      fail(res?.message || t('投稿失败'))
      return
    }
    patchMine(item.id, { ...(res.data && typeof res.data === 'object' ? res.data : {}), status: 3 })
    toast.add({ title: t('已投稿，等待运营审核'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
  }
  catch (error) {
    fail(error instanceof Error ? error.message : t('投稿失败'))
  }
  finally {
    busyId.value = 0
  }
}

async function onWithdraw(item: Style) {
  if (busyId.value)
    return
  busyId.value = item.id
  try {
    const res = await styleApi.withdraw(item.id)
    if (!res?.success) {
      fail(res?.message || t('撤回失败'))
      return
    }
    patchMine(item.id, { ...(res.data && typeof res.data === 'object' ? res.data : {}), status: 1 })
    toast.add({ title: t('已撤回'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
  }
  catch (error) {
    fail(error instanceof Error ? error.message : t('撤回失败'))
  }
  finally {
    busyId.value = 0
  }
}

async function onRemove(item: Style) {
  if (busyId.value)
    return
  const ok = await confirm({
    title: t('删除风格'),
    message: t('确定删除风格「{name}」？已套用该风格的节点不受影响。', { name: item.name }),
    confirmText: t('删除'),
    danger: true,
  })
  if (!ok)
    return
  busyId.value = item.id
  try {
    const res = await styleApi.remove(item.id)
    if (!res?.success) {
      fail(res?.message || t('删除失败'))
      return
    }
    mine.value = mine.value.filter(row => row.id !== item.id)
    toast.add({ title: t('已删除'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
  }
  catch (error) {
    fail(error instanceof Error ? error.message : t('删除失败'))
  }
  finally {
    busyId.value = 0
  }
}

function onKey(event: KeyboardEvent) {
  if (props.open && !props.locked && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

function onMask() {
  if (!props.locked)
    emit('close')
}

/** 短名字用前两个字当占位图，没有封面时卡片也认得出来 */
function initials(name: string) {
  return Array.from(name.trim()).slice(0, 2).join('')
}

function statusLabel(item: Style) {
  return styleStatusLabel(item.status, t)
}

watch(() => props.open, (open) => {
  if (!open)
    return
  keyword.value = ''
  category.value = ALL
  void load()
}, { immediate: true })

watch(() => props.mineVersion, () => {
  if (props.open)
    void loadMine()
})

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask camera-lib-mask style-lib-mask"
      @click.self="onMask"
      @pointerdown.stop
    >
      <div class="studio-modal camera-lib style-lib" role="dialog" aria-modal="true" aria-labelledby="style-lib-title">
        <header class="camera-lib__head style-lib__head">
          <div class="style-lib__heading">
            <h2 id="style-lib-title">{{ t('风格库') }}</h2>
            <button
              v-if="value"
              type="button"
              class="style-lib__clear"
              :title="current ? t('已选风格：{name}', { name: current.name }) : t('清除风格')"
              @click="emit('clear')"
            >
              <UIcon name="i-lucide-x" class="size-3.5" />
              {{ t('清除风格') }}
            </button>
          </div>
          <label class="projects-search camera-lib__search">
            <input v-model="keyword" type="search" :placeholder="t('搜索风格')">
            <UIcon name="i-lucide-search" class="size-3.5" />
          </label>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </header>

        <div class="camera-lib__tabs">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            :class="{ 'is-on': category === item.id, 'is-mine': item.id === MINE }"
            @click="selectTab(item.id)"
          >
            <UIcon v-if="item.id === MINE" name="i-lucide-user-round" class="size-3.5" />
            {{ item.label }}
          </button>
        </div>

        <div v-if="onMine" class="style-lib__bar">
          <button type="button" class="style-lib__act" @click="onCreate">
            <UIcon name="i-lucide-plus" class="size-3.5" />
            {{ t('新建风格') }}
          </button>
          <button
            type="button"
            class="style-lib__act is-primary"
            :disabled="!sourceImage?.url || extracting"
            :title="extractTitle"
            @click="onExtract"
          >
            <UIcon :name="extracting ? 'i-lucide-loader-circle' : 'i-lucide-wand-sparkles'" class="size-3.5" :class="{ 'animate-spin': extracting }" />
            {{ extracting ? t('分析中…') : t('从当前图定风格') }}
          </button>
          <small v-if="isLoggedIn && mine.length" class="style-lib__count">{{ mine.length }} / 100</small>
        </div>

        <div class="camera-lib__body">
          <div v-if="showLoading" class="camera-lib__grid style-lib__skel" aria-busy="true" :aria-label="t('加载中…')">
            <USkeleton v-for="n in 9" :key="n" class="style-lib__skel-card" />
          </div>
          <div v-else-if="items.length === 0" class="asset-picker__empty camera-lib__empty">
            <span class="asset-picker__empty-mark">
              <UIcon :name="onMine ? 'i-lucide-user-round' : 'i-lucide-palette'" class="size-8" />
            </span>
            <strong>{{ emptyTitle }}</strong>
            <p v-if="emptyDesc">{{ emptyDesc }}</p>
            <button v-if="onMine && !isLoggedIn" type="button" class="style-lib__act is-primary" @click="requireLogin()">
              {{ t('去登录') }}
            </button>
          </div>
          <div v-else-if="onMine" class="camera-lib__grid">
            <div
              v-for="item in items"
              :key="item.id"
              class="camera-lib__card style-lib__card style-lib__card--mine"
              :class="{ 'is-on': value === item.id, 'is-text': !item.cover_url, 'is-busy': busyId === item.id }"
              role="button"
              tabindex="0"
              :title="item.prompt"
              @click="emit('pick', item)"
              @keydown.enter.self="emit('pick', item)"
            >
              <img
                v-if="item.cover_url"
                class="camera-lib__media is-ready"
                :src="item.cover_url"
                :alt="item.name"
                loading="lazy"
              >
              <span v-else class="style-lib__text">
                <strong>{{ initials(item.name) }}</strong>
                <small>{{ item.prompt }}</small>
              </span>
              <span class="camera-lib__shade" />
              <span v-if="statusLabel(item)" class="style-lib__badge" :class="`is-${item.status}`">{{ statusLabel(item) }}</span>
              <span class="camera-lib__label">{{ item.name }}</span>
              <span class="style-lib__tools" @click.stop>
                <button type="button" :title="t('编辑')" :disabled="busyId === item.id" @click="emit('edit', item)">
                  <UIcon name="i-lucide-pencil" class="size-3.5" />
                </button>
                <button
                  v-if="item.status === 3 || item.status === 4"
                  type="button"
                  :title="item.status === 4 ? t('撤下已收录的风格') : t('撤回投稿')"
                  :disabled="busyId === item.id"
                  @click="onWithdraw(item)"
                >
                  <UIcon name="i-lucide-undo-2" class="size-3.5" />
                </button>
                <button
                  v-else
                  type="button"
                  :title="t('投稿到官方风格库')"
                  :disabled="busyId === item.id"
                  @click="onSubmit(item)"
                >
                  <UIcon name="i-lucide-send" class="size-3.5" />
                </button>
                <button type="button" class="is-danger" :title="t('删除')" :disabled="busyId === item.id" @click="onRemove(item)">
                  <UIcon name="i-lucide-trash-2" class="size-3.5" />
                </button>
              </span>
            </div>
          </div>
          <div v-else class="camera-lib__grid">
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="camera-lib__card style-lib__card"
              :class="{ 'is-on': value === item.id, 'is-text': !item.cover_url }"
              :title="item.prompt"
              @click="emit('pick', item)"
            >
              <img
                v-if="item.cover_url"
                class="camera-lib__media is-ready"
                :src="item.cover_url"
                :alt="item.name"
                loading="lazy"
              >
              <span v-else class="style-lib__text">
                <strong>{{ initials(item.name) }}</strong>
                <small>{{ item.prompt }}</small>
              </span>
              <span class="camera-lib__shade" />
              <span v-if="item.category" class="style-lib__cat">{{ item.category }}</span>
              <span class="camera-lib__label">{{ item.name }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
