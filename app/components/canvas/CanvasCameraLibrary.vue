<script setup lang="ts">
import { CAMERA_MOVE_ITEMS, cameraMoveMotionPreview, cameraMoveVideoUrl } from '~/utils/canvas-node-kinds'
import preferenceApi from '~/api/preference'

const { t } = useI18n()
const { isLoggedIn } = useAuth()

const props = defineProps<{
  open: boolean
  value?: string
}>()

const emit = defineEmits<{
  close: []
  pick: [id: string]
}>()

const RECENT_KEY = 'easytv-camera-move-recent'
/** 收藏（L21）：点星进「收藏」页，与「最近」同一套读写 */
const FAV_KEY = 'easytv-camera-move-fav'
const MAX_RECENT = 12
/**
 * 云端同步（API.md 33）：本机 localStorage 先渲染，登录后再拉 /user/preference 以云端为准覆盖；
 * 写入时本机与云端都写，云端失败只提示不回滚（下次打开还会再拉一次）。
 */
const PREF_KEYS = { fav: 'camera.fav', recent: 'camera.recent' } as const
let cloudSeq = 0

const keyword = ref('')
const tab = ref<'all' | 'recent' | 'fav'>('all')
const recentIds = ref<string[]>([])
const favIds = ref<string[]>([])
const readyIds = ref<Set<string>>(new Set())

const tabs = computed(() => [
  { id: 'all' as const, label: t('全部') },
  { id: 'fav' as const, label: favIds.value.length ? t('收藏 {n}', { n: favIds.value.length }) : t('收藏') },
  { id: 'recent' as const, label: t('最近') },
])

function readIds(key: string) {
  if (typeof localStorage === 'undefined')
    return []
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    if (!Array.isArray(raw))
      return []
    return raw.map(item => String(item || '').trim()).filter(Boolean)
  }
  catch {
    return []
  }
}

function writeIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids))
  }
  catch {
    // 忽略
  }
}

/** 云端 value 是 JSON 数组文本；坏数据当空 */
function parseCloudIds(raw?: string) {
  if (!raw)
    return null
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.map(item => String(item || '').trim()).filter(Boolean) : null
  }
  catch {
    return null
  }
}

function pushCloud(key: string, ids: string[]) {
  if (!isLoggedIn.value)
    return
  preferenceApi.set(key, ids.length ? JSON.stringify(ids) : '').catch(() => {})
}

/** 打开时拉一次云端；面板已关或又重新打开就丢弃这次结果 */
async function pullCloud() {
  if (!isLoggedIn.value)
    return
  const seq = ++cloudSeq
  try {
    const res = await preferenceApi.all()
    if (seq !== cloudSeq || !props.open || !res?.success || !res.data)
      return
    const fav = parseCloudIds(res.data[PREF_KEYS.fav])
    const recent = parseCloudIds(res.data[PREF_KEYS.recent])
    if (fav) {
      favIds.value = fav
      writeIds(FAV_KEY, fav)
    }
    if (recent) {
      recentIds.value = recent.slice(0, MAX_RECENT)
      writeIds(RECENT_KEY, recentIds.value)
    }
    // 本机有、云端没有（老用户第一次登录同步）：把本机的推上去
    if (!fav && favIds.value.length)
      pushCloud(PREF_KEYS.fav, favIds.value)
    if (!recent && recentIds.value.length)
      pushCloud(PREF_KEYS.recent, recentIds.value)
  }
  catch {
    // 拉不到就用本机的
  }
}

function rememberRecent(id: string) {
  const next = [id, ...recentIds.value.filter(item => item !== id)].slice(0, MAX_RECENT)
  recentIds.value = next
  writeIds(RECENT_KEY, next)
  pushCloud(PREF_KEYS.recent, next)
}

function isFav(id: string) {
  return favIds.value.includes(id)
}

/** 点星：已收藏就取消；收藏页里取消后卡片立刻消失，所以不做动画 */
function toggleFav(id: string, event: Event) {
  event.stopPropagation()
  event.preventDefault()
  const next = isFav(id) ? favIds.value.filter(item => item !== id) : [...favIds.value, id]
  favIds.value = next
  writeIds(FAV_KEY, next)
  pushCloud(PREF_KEYS.fav, next)
}

const items = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const known = CAMERA_MOVE_ITEMS.map(item => ({
    id: item.id,
    label: t(item.label),
    video: cameraMoveVideoUrl(item.id),
    motion: cameraMoveMotionPreview(item.id),
  }))
  let list = known
  if (tab.value === 'recent' || tab.value === 'fav') {
    const map = new Map<string, typeof known[number]>(known.map(item => [item.id, item]))
    const ids = tab.value === 'recent' ? recentIds.value : favIds.value
    list = ids.map(id => map.get(id)).filter((item): item is typeof known[number] => Boolean(item))
  }
  if (!q)
    return list
  return list.filter(item => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q))
})

const emptyTitle = computed(() => {
  if (keyword.value.trim())
    return t('没有匹配的运镜')
  if (tab.value === 'recent')
    return t('还没有最近使用的运镜')
  if (tab.value === 'fav')
    return t('还没有收藏的运镜')
  return t('暂无运镜')
})

const emptyDesc = computed(() => {
  if (keyword.value.trim())
    return t('换个关键词试试')
  if (tab.value === 'recent')
    return t('选过的运镜会出现在这里')
  if (tab.value === 'fav')
    return t('点卡片右上角的星，常用的运镜就留在这里')
  return ''
})

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

function markReady(id: string) {
  if (readyIds.value.has(id))
    return
  const next = new Set(readyIds.value)
  next.add(id)
  readyIds.value = next
}

function isReady(id: string) {
  return readyIds.value.has(id)
}

function pick(id: string) {
  rememberRecent(id)
  emit('pick', id)
}

function videoOf(event: MouseEvent) {
  return (event.currentTarget as HTMLElement).querySelector('video')
}

function onEnter(event: MouseEvent) {
  const video = videoOf(event)
  if (video && video.readyState >= 2)
    void video.play().catch(() => {})
}

function onLeave(event: MouseEvent) {
  const video = videoOf(event)
  if (!video)
    return
  video.pause()
  video.currentTime = 0
}

watch(() => props.open, (open) => {
  if (!open)
    return
  keyword.value = ''
  recentIds.value = readIds(RECENT_KEY)
  favIds.value = readIds(FAV_KEY)
  // 有收藏就直接落到收藏页：常用的几个一眼就能点
  tab.value = favIds.value.length ? 'fav' : 'all'
  readyIds.value = new Set()
  void pullCloud()
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask camera-lib-mask"
      @click.self="emit('close')"
      @pointerdown.stop
    >
      <div class="studio-modal camera-lib" role="dialog" aria-modal="true" aria-labelledby="camera-lib-title">
        <header class="camera-lib__head">
          <h2 id="camera-lib-title" class="camera-lib__title">
            <UIcon name="i-lucide-film" class="size-4" />
            {{ t('运镜库') }}
          </h2>
          <label class="projects-search camera-lib__search">
            <input v-model="keyword" type="search" :placeholder="t('搜索运镜')">
            <UIcon name="i-lucide-search" class="size-3.5" />
          </label>
        </header>

        <div class="camera-lib__tabs">
          <button
            v-for="item in tabs"
            :key="item.id"
            type="button"
            :class="{ 'is-on': tab === item.id }"
            @click="tab = item.id"
          >
            {{ item.label }}
          </button>
        </div>

        <div class="camera-lib__body">
          <div v-if="items.length === 0" class="asset-picker__empty camera-lib__empty">
            <span class="asset-picker__empty-mark">
              <UIcon name="i-lucide-video" class="size-8" />
            </span>
            <strong>{{ emptyTitle }}</strong>
            <p v-if="emptyDesc">{{ emptyDesc }}</p>
          </div>
          <div v-else class="camera-lib__grid">
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="camera-lib__card"
              :class="{ 'is-on': value === item.id, 'is-ready': isReady(item.id), 'is-motion': Boolean(item.motion) }"
              :data-move="item.motion || undefined"
              :title="item.label"
              @click="pick(item.id)"
              @mouseenter="onEnter"
              @mouseleave="onLeave"
            >
              <span class="camera-lib__motion">
                <video
                  class="camera-lib__media"
                  :class="{ 'is-ready': isReady(item.id) }"
                  :src="item.video"
                  muted
                  loop
                  playsinline
                  preload="metadata"
                  @loadeddata="markReady(item.id)"
                  @canplay="markReady(item.id)"
                />
              </span>
              <span class="camera-lib__shade" />
              <span
                class="camera-lib__star"
                :class="{ 'is-on': isFav(item.id) }"
                role="button"
                :aria-label="isFav(item.id) ? t('取消收藏') : t('收藏')"
                :title="isFav(item.id) ? t('取消收藏') : t('收藏')"
                @click="toggleFav(item.id, $event)"
                @pointerdown.stop
              >
                <UIcon :name="isFav(item.id) ? 'i-lucide-star' : 'i-lucide-star'" class="size-3.5" />
              </span>
              <span class="camera-lib__label">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
