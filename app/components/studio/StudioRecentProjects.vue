<script setup lang="ts">
import projectApi from '~/api/project'
import type { Project } from '~/types/creative'

/** 首页「最近项目」：新建入口 + 最近更新的几个项目，入口到项目页。 */
const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { openNewProject, openProject } = useStudioNav()

const LIMIT = 5
const projects = ref<Project[]>([])
const loaded = ref(false)
const failed = ref(false)

async function load() {
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
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(load)
// 首页 keepalive：从画布回来时刷新最近项目
onActivated(() => {
  if (loaded.value)
    void load()
})
</script>

<template>
  <section class="recent" :aria-label="t('最近项目')">
    <header class="recent__head">
      <h2>{{ t('最近项目') }}</h2>
      <NuxtLink :to="localePath('/projects')" class="recent__all">
        {{ t('全部项目') }}
        <UIcon name="i-lucide-chevron-right" class="size-4" />
      </NuxtLink>
    </header>
    <div class="recent__grid">
      <button type="button" class="recent-card recent-card--create" @click="openNewProject">
        <span class="recent-card__thumb">
          <i class="recent-card__plus"><UIcon name="i-lucide-plus" class="size-5" /></i>
        </span>
        <span class="recent-card__title">{{ t('新建项目') }}</span>
      </button>
      <template v-if="loaded">
        <button
          v-for="item in projects"
          :key="item.id"
          type="button"
          class="recent-card"
          @click="openProject(item)"
        >
          <span class="recent-card__thumb">
            <img v-if="item.cover_url" :src="item.cover_url" :alt="item.name">
            <UIcon v-else name="i-lucide-workflow" class="size-6 recent-card__ph" />
            <i class="show-card__play" aria-hidden="true">
              <span><UIcon name="i-lucide-play" class="size-4" /></span>
            </i>
          </span>
          <span class="recent-card__title">{{ item.name }}</span>
          <span class="recent-card__sub">{{ fmtDate(item.updated_at) }}</span>
        </button>
        <p v-if="failed && !projects.length" class="recent__empty">
          {{ t('加载失败，请稍后重试') }}
          <button type="button" class="recent__all" @click="load">{{ t('重试') }}</button>
        </p>
        <p v-else-if="!projects.length" class="recent__empty">{{ t('还没有项目，从新建开始。') }}</p>
      </template>
      <template v-else>
        <div v-for="n in 3" :key="n" class="recent-card recent-card--skeleton" aria-hidden="true">
          <USkeleton class="recent-card__thumb" />
          <USkeleton class="h-3.5 w-3/5" />
          <USkeleton class="h-3 w-2/5" />
        </div>
      </template>
    </div>
  </section>
</template>
