<script setup lang="ts">
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import type { Edge, Node, NodeMouseEvent } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import canvasApi from '~/api/canvas'
import type { SharedCanvas } from '~/types/creative'
import ShareCanvasNode from '~/components/share/ShareCanvasNode.vue'
import CanvasMediaPreview from '~/components/canvas/CanvasMediaPreview.vue'
import { buildLoginRedirectQuery } from '~/utils/auth-login-redirect'
import { canvasStageSize, type CanvasNodeData, type CanvasNodeKind } from '~/utils/canvas-node-kinds'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/**
 * 画布只读分享页：/share/:token，匿名可看（GET /share/canvas/:token）。
 * 登录后可「复制到我的画布」（POST /user/share/canvas/:token/copy）。
 */
definePageMeta({
  layout: false,
})

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { isLoggedIn, hydrate } = useAuth()

const token = computed(() => String(Array.isArray(route.params.token) ? route.params.token[0] : route.params.token))
const loading = ref(true)
const error = ref('')
const data = ref<SharedCanvas | null>(null)
const copying = ref(false)
const { preview: mediaPreview, open: openShareMedia, close: closeShareMedia } = useShareMediaPreview()

function nodeMediaSrc(data: CanvasNodeData, kind: 'image' | 'video' | 'audio') {
  const raw = (kind === 'image' && data.kind === 'director' ? data.previewUrl : data.content) || ''
  const value = String(raw).trim()
  return value && isMediaUrl(value) ? resolveMediaUrl(value) : ''
}

function onShareNodeClick(payload: NodeMouseEvent) {
  const data = payload.node.data as CanvasNodeData | undefined
  if (!data)
    return
  const caption = String(data.talking?.script || data.prompt || '').trim()
  if (data.kind === 'audio') {
    openShareMedia('audio', nodeMediaSrc(data, 'audio'), caption)
    return
  }
  const el = payload.event.target as HTMLElement | null
  if (el?.closest('button, a, textarea, input, audio, video, .cnode-player, .cnode__preview'))
    return
  if (data.kind === 'image' || data.kind === 'panorama' || data.kind === 'director')
    openShareMedia('image', nodeMediaSrc(data, 'image'), caption)
}

const nodeTypes = { easytv: markRaw(ShareCanvasNode), group: markRaw(ShareCanvasNode) }

function sizeOf(value: unknown) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

const nodes = computed<Node[]>(() => {
  const list = (data.value?.graph.nodes ?? []) as Array<Record<string, any>>
  return list.map((n) => {
    const kind = String(n.data?.kind || '') as CanvasNodeKind
    const stage = n.type === 'group' ? null : canvasStageSize(kind)
    const style = n.style && typeof n.style === 'object' ? n.style as Record<string, string | number> : {}
    const w = sizeOf(n.width) || sizeOf(style.width) || stage?.w || 260
    const h = sizeOf(n.height) || sizeOf(style.height) || stage?.h || 180
    return {
      id: String(n.id),
      type: n.type === 'group' ? 'group' : 'easytv',
      position: n.position ?? { x: 0, y: 0 },
      data: n.data ?? {},
      parentNode: n.parentNode,
      extent: n.extent,
      width: w,
      height: h,
      style: { ...style, width: `${w}px`, height: `${h}px` },
      class: 'nopan nodrag',
      draggable: false,
      selectable: false,
      connectable: false,
    }
  }) as Node[]
})

const edges = computed<Edge[]>(() => {
  const list = (data.value?.graph.edges ?? []) as Array<Record<string, any>>
  return list.map(e => ({
    id: String(e.id ?? `${e.source}-${e.target}`),
    source: String(e.source),
    target: String(e.target),
    animated: false,
    selectable: false,
    style: { stroke: '#c4c4c8', strokeWidth: 1 },
  }))
})

useHead({
  title: computed(() => data.value ? t('画布分享：{name}', { name: data.value.name }) : t('画布分享')),
})
useSeoMeta({
  description: computed(() => data.value ? t('{name} 在 EasyTV 分享的创作画布，共 {n} 个节点', { name: data.value.owner.nickname || t('创作者'), n: data.value.node_count }) : ''),
  robots: 'noindex',
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function fmtDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await canvasApi.shared(token.value)
    if (!res?.success || !res.data) {
      error.value = res?.message || t('分享链接不存在或已关闭')
      return
    }
    data.value = res.data
  }
  finally {
    loading.value = false
  }
}

async function copyToMine() {
  if (copying.value)
    return
  if (!isLoggedIn.value) {
    void navigateTo(localePath({ path: '/login', query: buildLoginRedirectQuery(route.fullPath) }))
    return
  }
  copying.value = true
  try {
    const res = await canvasApi.copyShared(token.value)
    if (!res?.success || !res.data) {
      notify(res?.message || t('复制失败'), 'error')
      return
    }
    notify(t('已复制到我的画布'), 'success')
    void navigateTo(localePath({ path: '/canvas', query: { id: String(res.data.id) } }))
  }
  finally {
    copying.value = false
  }
}

onMounted(() => {
  hydrate()
  void load()
})
</script>

<template>
  <div class="share-page">
    <header class="share-bar">
      <NuxtLink :to="localePath('/studio')" class="share-brand">
        <img src="/images/logo.svg" alt="EasyTV" width="22" height="22">
        EasyTV
      </NuxtLink>
      <div v-if="data" class="share-bar__title">
        <h1>{{ data.name }}</h1>
        <p>{{ t('{name} 分享 · {n} 个节点 · 更新于 {time}', { name: data.owner.nickname || t('创作者'), n: data.node_count, time: fmtDate(data.updated_at) }) }}</p>
      </div>
      <div class="share-bar__actions">
        <span class="share-bar__readonly">
          <UIcon name="i-lucide-eye" class="size-3.5" />
          {{ t('只读') }}
        </span>
        <ClientOnly>
          <button v-if="data && !data.mine" type="button" class="plan-btn plan-btn--solid" :disabled="copying" @click="copyToMine">
            {{ copying ? t('复制中…') : (isLoggedIn ? t('复制到我的画布') : t('登录后复制到我的画布')) }}
          </button>
          <NuxtLink v-else-if="data?.mine" :to="localePath('/projects')" class="plan-btn plan-btn--ghost">{{ t('这是你的画布，去项目里打开') }}</NuxtLink>
        </ClientOnly>
      </div>
    </header>

    <div class="share-stage">
      <div v-if="loading" class="share-state">{{ t('加载中…') }}</div>
      <div v-else-if="error" class="share-state">
        <UIcon name="i-lucide-link-2-off" class="size-8" />
        <p>{{ error }}</p>
        <NuxtLink :to="localePath('/studio')" class="plan-btn plan-btn--ghost">{{ t('去创作台') }}</NuxtLink>
      </div>
      <ClientOnly v-else>
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :node-types="nodeTypes"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :elements-selectable="false"
          :zoom-on-double-click="false"
          no-pan-class-name="nopan"
          :min-zoom="0.2"
          :max-zoom="2"
          fit-view-on-init
          :fit-view-options="{ padding: 0.18 }"
          class="share-flow canvas-flow"
          @node-click="onShareNodeClick"
        >
          <Background :gap="24" :size="1" />
        </VueFlow>
        <CanvasMediaPreview
          :open="mediaPreview.open"
          :src="mediaPreview.src"
          :kind="mediaPreview.kind"
          :caption="mediaPreview.caption"
          @close="closeShareMedia"
        />
      </ClientOnly>
    </div>

    <footer class="share-foot">
      <span>{{ t('用 EasyTV 画布把想法拆成镜头，一键生成图片与视频') }}</span>
      <NuxtLink :to="localePath('/studio')">{{ t('去创作台') }} →</NuxtLink>
    </footer>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio.css';
</style>
