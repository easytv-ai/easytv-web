<script setup lang="ts">
import canvasApi from '~/api/canvas'
import type { SharedCanvas } from '~/types/creative'

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
const { requireLogin } = useRequireLogin()

const token = computed(() => String(Array.isArray(route.params.token) ? route.params.token[0] : route.params.token))
const loading = ref(true)
const error = ref('')
const data = ref<SharedCanvas | null>(null)
const copying = ref(false)

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
  if (!requireLogin())
    return
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
      <NuxtLink :to="localePath('/agent')" class="share-brand">
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
      <ClientOnly v-else-if="data">
        <ShareCanvasViewer :graph="data.graph" />
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
