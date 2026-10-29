<script setup lang="ts">
import workApi from '~/api/work'
import type { WorkProcess } from '~/types/creative'

const { t } = useI18n()

/**
 * 作品制作过程：/process/:id，匿名可看（GET /work/:id/process）。
 * 按作者画布原样只读展示节点与连线，不能编辑、保存或生成。
 */
definePageMeta({
  layout: false,
})

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()

const workId = computed(() => Number(Array.isArray(route.params.id) ? route.params.id[0] : route.params.id) || 0)
const loading = ref(true)
const error = ref('')
const data = ref<WorkProcess | null>(null)

/** 接口给的是精简节点，转成只读画布认识的 graph 结构 */
const graph = computed(() => ({
  nodes: (data.value?.nodes ?? []).map(n => ({
    id: n.id,
    type: n.kind === 'group' ? 'group' : 'easytv',
    position: { x: n.x, y: n.y },
    data: { kind: n.kind, label: n.label, prompt: n.prompt, content: n.content, model: n.model, refUrl: n.ref_url },
  })),
  edges: (data.value?.edges ?? []).map(e => ({ source: e.source, target: e.target })),
}))

useHead({
  title: computed(() => data.value ? `${data.value.work.title} · ${t('制作过程')}` : t('制作过程')),
})
useSeoMeta({ robots: 'noindex' })

async function load() {
  if (!workId.value) {
    error.value = t('制作过程暂不可用')
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await workApi.process(workId.value)
    if (!res?.success || !res.data) {
      error.value = res?.message || t('制作过程暂不可用')
      return
    }
    data.value = res.data
  }
  catch {
    error.value = t('制作过程暂不可用')
  }
  finally {
    loading.value = false
  }
}

function gotoBack() {
  if (window.history.state?.back)
    router.back()
  else
    void navigateTo(localePath(`/watch/${workId.value}`))
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="share-page">
    <header class="share-bar">
      <button type="button" class="share-brand share-bar__back" @click="gotoBack">
        <UIcon name="i-lucide-arrow-left" class="size-4" />
        {{ t('返回') }}
      </button>
      <div class="share-bar__title">
        <h1>{{ data?.work.title || t('制作过程') }}</h1>
        <p v-if="data">{{ t('来自画布「{name}」，共 {n} 个节点', { name: data.canvas.name, n: data.nodes.length }) }}</p>
        <p v-else>{{ t('作者在画布里的节点与提示词') }}</p>
      </div>
      <div class="share-bar__actions">
        <span class="share-bar__readonly">
          <UIcon name="i-lucide-eye" class="size-3.5" />
          {{ t('只读') }}
        </span>
      </div>
    </header>

    <div class="share-stage">
      <div v-if="loading" class="share-state">{{ t('加载中…') }}</div>
      <div v-else-if="error" class="share-state">
        <UIcon name="i-lucide-eye-off" class="size-8" />
        <p>{{ error }}</p>
      </div>
      <div v-else-if="!graph.nodes.length" class="share-state">
        <UIcon name="i-lucide-layout-grid" class="size-8" />
        <p>{{ t('画布里还没有节点') }}</p>
      </div>
      <ClientOnly v-else>
        <ShareCanvasViewer :graph="graph" />
      </ClientOnly>
    </div>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio.css';
</style>
