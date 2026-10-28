<script setup lang="ts">
import canvasApi from '~/api/canvas'
import type { CanvasDetail, CanvasVersion } from '~/types/creative'

const { t } = useI18n()

/**
 * 画布版本历史（GET /user/canvas/:id/versions）：自动保存 10 分钟内合并为一条，
 * Ctrl+S / 保存按钮单独记一条。恢复只套回该版本图，不再走后端「恢复前备份」。
 */
const props = defineProps<{
  open: boolean
  canvasId: number
  /** 当前画布 version，用于标记「当前」 */
  currentVersion: number
  /** 恢复后钉住被恢复的那条；保存后由父级清空 */
  currentVersionId?: number
}>()

const emit = defineEmits<{
  close: []
  restored: [detail: CanvasDetail, from: CanvasVersion]
}>()

function isCurrent(item: CanvasVersion) {
  if (props.currentVersionId)
    return item.id === props.currentVersionId
  return item.version === props.currentVersion
}

const toast = useToast()
const { confirm } = useConfirm()
const loading = ref(false)
const failed = ref(false)
const restoring = ref<number | null>(null)
const versions = ref<CanvasVersion[]>([])
const visibleVersions = computed(() => versions.value.filter(item => item.source !== 'restore'))

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const SOURCE_LABEL: Record<CanvasVersion['source'], string> = {
  auto: '自动保存',
  manual: '手动保存',
  restore: '恢复前备份',
}

function formatTime(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay = new Date().toDateString() === d.toDateString()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

async function load() {
  if (!props.canvasId)
    return
  loading.value = true
  failed.value = false
  try {
    const res = await canvasApi.versions(props.canvasId)
    if (!res?.success || !res.data) {
      failed.value = visibleVersions.value.length === 0
      notify(res?.message || t('版本历史加载失败'), 'error')
      return
    }
    versions.value = res.data.items
    failed.value = false
  }
  catch {
    failed.value = visibleVersions.value.length === 0
    notify(t('版本历史加载失败'), 'error')
  }
  finally {
    loading.value = false
  }
}

async function restore(item: CanvasVersion) {
  if (restoring.value)
    return
  if (!(await confirm({
    title: t('恢复版本'),
    message: t('恢复到 {time} 的版本？未保存的修改会丢失。', { time: formatTime(item.created_at) }),
    confirmText: t('恢复'),
  })))
    return
  restoring.value = item.id
  try {
    const res = await canvasApi.version(props.canvasId, item.id)
    if (!res?.success || !res.data) {
      notify(res?.message || t('恢复失败'), 'error')
      return
    }
    notify(t('已恢复到 {time} 的版本', { time: formatTime(item.created_at) }))
    emit('restored', {
      id: props.canvasId,
      user_id: 0,
      project_id: 0,
      name: res.data.name,
      version: props.currentVersion,
      thumbnail_url: '',
      created_at: res.data.created_at,
      updated_at: res.data.created_at,
      graph: res.data.graph,
    }, item)
    await load()
  }
  finally {
    restoring.value = null
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}

watch(() => props.open, (open) => {
  if (open)
    void load()
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop @keydown.stop>
      <div class="studio-modal canvas-history" role="dialog" aria-modal="true" aria-labelledby="canvas-history-title">
        <header class="canvas-history__head">
          <div>
            <h2 id="canvas-history-title">{{ t('版本历史') }}</h2>
            <p>{{ t('自动保存 10 分钟内合并为一条，Ctrl+S 单独记录；最多保留 50 个版本') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </header>

        <div class="canvas-history__body">
          <div v-if="!canvasId" class="asset-picker__empty">{{ t('画布保存后才会有版本记录') }}</div>
          <div v-else-if="loading && !visibleVersions.length" class="asset-picker__empty">{{ t('加载中…') }}</div>
          <div v-else-if="failed && !visibleVersions.length" class="asset-picker__empty">
            {{ t('版本历史加载失败') }}
            <button type="button" class="asset-picker__cta" @click="load">{{ t('重试') }}</button>
          </div>
          <div v-else-if="!visibleVersions.length" class="asset-picker__empty">
            <UIcon name="i-lucide-history" class="size-8" />
            {{ t('还没有版本记录，保存后会出现在这里') }}
          </div>
          <ul v-else class="canvas-history__list">
            <li v-for="item in visibleVersions" :key="item.id" :class="{ 'is-current': isCurrent(item) }">
              <span class="canvas-history__dot" aria-hidden="true" />
              <div class="canvas-history__main">
                <div class="canvas-history__meta">
                  <strong>{{ formatTime(item.created_at) }}</strong>
                  <span class="canvas-history__tag" :class="`is-${item.source}`">{{ t(SOURCE_LABEL[item.source]) }}</span>
                  <span v-if="isCurrent(item)" class="canvas-history__tag is-now">{{ t('当前') }}</span>
                </div>
                <p>
                  {{ item.name }} · {{ t('{n} 个节点', { n: item.node_count }) }} · v{{ item.version }}
                  <template v-if="item.note"> · {{ item.note }}</template>
                </p>
              </div>
              <button
                v-if="!isCurrent(item)"
                type="button"
                class="canvas-history__restore"
                :disabled="restoring !== null"
                @click="restore(item)"
              >
                <UIcon name="i-lucide-rotate-ccw" class="size-4" />
                {{ restoring === item.id ? t('恢复中…') : t('恢复') }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
