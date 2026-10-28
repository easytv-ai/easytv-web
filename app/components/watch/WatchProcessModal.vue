<script setup lang="ts">
import workApi from '~/api/work'
import type { WorkProcess } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/**
 * 播放页「查看制作过程」：GET /work/:id/process，把画布节点按连线拓扑排序成步骤列表只读展示。
 */
const props = defineProps<{
  open: boolean
  workId: number
}>()

const emit = defineEmits<{
  close: []
}>()

const loading = ref(false)
const error = ref('')
const data = ref<WorkProcess | null>(null)

const KIND_ICON: Record<string, string> = {
  text: 'i-lucide-file-text',
  image: 'i-lucide-image',
  video: 'i-lucide-play',
  audio: 'i-lucide-music',
  director: 'i-lucide-clapperboard',
}
const KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  director: '3D 导演台',
}

/** 按连线拓扑排序；无连线的节点按位置从左到右 */
const steps = computed(() => {
  if (!data.value)
    return []
  const nodes = [...data.value.nodes].sort((a, b) => a.x - b.x || a.y - b.y)
  const indeg = new Map(nodes.map(n => [n.id, 0]))
  const out = new Map<string, string[]>()
  for (const e of data.value.edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target))
      continue
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  }
  const queue = nodes.filter(n => (indeg.get(n.id) ?? 0) === 0)
  const ordered: typeof nodes = []
  const seen = new Set<string>()
  while (queue.length) {
    const n = queue.shift()!
    if (seen.has(n.id))
      continue
    seen.add(n.id)
    ordered.push(n)
    for (const next of out.get(n.id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 1) - 1)
      if ((indeg.get(next) ?? 0) <= 0) {
        const node = nodes.find(item => item.id === next)
        if (node)
          queue.push(node)
      }
    }
  }
  for (const n of nodes) {
    if (!seen.has(n.id))
      ordered.push(n)
  }
  return ordered
})

function isMedia(url: string) {
  return /^(https?:)?\/|^\//.test(url)
}

async function load() {
  if (!props.workId)
    return
  loading.value = true
  error.value = ''
  data.value = null
  try {
    const res = await workApi.process(props.workId)
    if (!res?.success || !res.data) {
      error.value = res?.message || t('制作过程暂不可用')
      return
    }
    data.value = res.data
  }
  finally {
    loading.value = false
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
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')">
      <div class="studio-modal watch-process" role="dialog" aria-modal="true" aria-labelledby="watch-process-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="watch-process-title">{{ t('制作过程') }}</h2>
            <p v-if="data">{{ t('来自画布「{name}」，共 {n} 个节点', { name: data.canvas.name, n: data.nodes.length }) }}</p>
            <p v-else>{{ t('作者在画布里的节点与提示词') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="watch-process__body">
          <div v-if="loading" class="asset-picker__empty">{{ t('加载中…') }}</div>
          <div v-else-if="error" class="asset-picker__empty">
            <UIcon name="i-lucide-eye-off" class="size-8" />
            {{ error }}
          </div>
          <div v-else-if="!steps.length" class="asset-picker__empty">{{ t('画布里还没有节点') }}</div>
          <ol v-else class="watch-process__steps">
            <li v-for="(node, index) in steps" :key="node.id">
              <span class="watch-process__no">{{ index + 1 }}</span>
              <div class="watch-process__card">
                <div class="watch-process__head">
                  <UIcon :name="KIND_ICON[node.kind] || 'i-lucide-box'" class="size-4" />
                  <strong>{{ node.label || t(KIND_LABEL[node.kind] || '节点') }}</strong>
                  <small>{{ t(KIND_LABEL[node.kind] || node.kind) }}<template v-if="node.model"> · {{ node.model }}</template></small>
                </div>
                <p v-if="node.kind === 'text' && node.content" class="watch-process__text">{{ node.content }}</p>
                <p v-if="node.prompt" class="watch-process__prompt"><em>{{ t('提示词') }}</em>{{ node.prompt }}</p>
                <div v-if="node.kind !== 'text' && node.content && isMedia(node.content)" class="watch-process__media">
                  <img v-if="node.kind === 'image'" :src="resolveMediaUrl(node.content)" :alt="node.label" loading="lazy">
                  <video v-else-if="node.kind === 'video' || node.kind === 'director'" :src="resolveMediaUrl(node.content)" controls muted playsinline preload="metadata" />
                  <audio v-else-if="node.kind === 'audio'" :src="resolveMediaUrl(node.content)" controls preload="metadata" />
                </div>
                <div v-if="node.ref_url" class="watch-process__ref">
                  <small>{{ t('参考') }}</small>
                  <img :src="resolveMediaUrl(node.ref_url)" alt="" loading="lazy">
                </div>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  </Teleport>
</template>
