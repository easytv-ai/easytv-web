<script setup lang="ts">
import projectApi from '~/api/project'
import type { Project } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

/** 首页「最近项目」：新建入口 + 最近更新的几个项目，入口到项目页。未登录不请求、不展示，避免 401 弹出登录框。 */
const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { isLoggedIn } = useAuth()
const { openNewProject, openProject } = useStudioNav()

const LIMIT = 4
const projects = ref<Project[]>([])
const loaded = ref(false)
const failed = ref(false)

function reset() {
  projects.value = []
  loaded.value = false
  failed.value = false
}

async function load() {
  if (!isLoggedIn.value)
    return
  failed.value = false
  try {
    const res = await projectApi.list({ page: 1, page_size: LIMIT })
    if (!res?.success || !res.data) {
      failed.value = projects.value.length === 0
      toast.add({ title: res?.message || t('加载失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    projects.value = res.data.items
    failed.value = false
  }
  catch {
    failed.value = projects.value.length === 0
    toast.add({ title: t('加载失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
  }
  finally {
    loaded.value = true
  }
}

function fmtDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
  if (isLoggedIn.value)
    void load()
})

watch(isLoggedIn, (on) => {
  if (on)
    void load()
  else
    reset()
})

// 首页 keepalive：从画布回来时刷新最近项目
onActivated(() => {
  if (isLoggedIn.value && loaded.value)
    void load()
})
</script>

<template>
  <section v-if="isLoggedIn" class="recent" :aria-label="t('最近项目')">
    <header class="recent__head">
      <h2>{{ t('最近项目') }}</h2>
      <NuxtLink :to="localePath('/projects')" class="recent__all">
        {{ t('全部项目') }}
        <UIcon name="i-lucide-chevron-right" class="size-3.5" />
      </NuxtLink>
    </header>
    <div class="recent__grid">
      <button type="button" class="projects-card projects-card--create" @click="openNewProject">
        <span class="projects-card__thumb">
          <span class="projects-card__plus">
            <UIcon name="i-lucide-plus" class="size-7" />
          </span>
        </span>
        <span class="projects-card__meta">
          <span class="projects-card__title">{{ t('新建项目') }}</span>
        </span>
      </button>
      <template v-if="loaded">
        <button
          v-for="item in projects"
          :key="item.id"
          type="button"
          class="projects-card"
          @click="openProject(item)"
        >
          <span class="projects-card__thumb">
            <img v-if="item.cover_url" :src="resolveMediaUrl(item.cover_url)" :alt="item.name">
            <UIcon v-else name="i-lucide-workflow" class="projects-card__ph" />
          </span>
          <span class="projects-card__meta">
            <span class="projects-card__text">
              <span class="projects-card__title">{{ item.name }}</span>
              <span class="projects-card__sub">{{ fmtDate(item.updated_at) }}</span>
            </span>
          </span>
        </button>
        <p v-if="failed && !projects.length" class="recent__empty">
          {{ t('加载失败，请稍后重试') }}
          <button type="button" class="recent__all" @click="load">{{ t('重试') }}</button>
        </p>
        <p v-else-if="!projects.length" class="recent__empty">{{ t('还没有项目，从新建开始。') }}</p>
      </template>
      <template v-else>
        <article v-for="n in 4" :key="n" class="projects-card projects-card--skeleton" aria-hidden="true">
          <USkeleton class="projects-card__thumb" />
          <div class="projects-card__meta">
            <div class="projects-card__text">
              <USkeleton class="h-3.5 w-3/5" />
              <USkeleton class="mt-1.5 h-3 w-2/5" />
            </div>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>
