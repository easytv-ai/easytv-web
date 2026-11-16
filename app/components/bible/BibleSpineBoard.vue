<script setup lang="ts">
import bibleApi from '~/api/bible'
import screenplayApi from '~/api/screenplay'
import type { Episode, ScreenplayPlan, ScreenplayShot } from '~/types/creative'
import { isCatalogEpisode } from '~/utils/bible'
import { FILM_COLORS } from '~/utils/spine'

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const localePath = useLocalePath()
const episodes = ref<Episode[]>([])
const plans = ref<Record<number, ScreenplayPlan | null>>({})
const loading = ref(true)
const current = ref(0)

const catalog = computed(() => episodes.value.filter(episode => isCatalogEpisode(episode.status)))
const episode = computed(() => catalog.value[current.value] ?? null)
const plan = computed(() => episode.value ? plans.value[episode.value.id] ?? null : null)

const colors = ['#1e3a5f', '#8a5a2b', '#5b4b78', '#0f766e', '#9f1239', '#155e75']

function names(keys: string[]) {
  const characters = plan.value?.characters ?? []
  return keys
    .map(key => characters.find(character => character.key === key)?.name || key)
    .filter(Boolean)
    .join('、')
}

function spoken(shot: ScreenplayShot) {
  const dialogue = (shot.dialogue ?? []).map(line => line.text.trim()).filter(Boolean)
  if (dialogue.length)
    return dialogue.join(' / ')
  return shot.line?.trim() || ''
}

function canvasTo(id: number) {
  return localePath({ path: '/canvas', query: { id: String(id) } })
}

async function load() {
  if (!props.projectId) {
    episodes.value = []
    plans.value = {}
    loading.value = false
    return
  }
  loading.value = true
  current.value = 0
  try {
    const episodeRes = await bibleApi.episodes(props.projectId)
    episodes.value = episodeRes?.success
      ? [...(episodeRes.data?.episodes ?? [])].sort((a, b) => a.episode_no - b.episode_no)
      : []
    const rows = episodes.value.filter(row => isCatalogEpisode(row.status))
    const loaded = await Promise.all(rows.map(async (row) => {
      try {
        const res = await screenplayApi.get(row.id)
        return [row.id, res?.success ? res.data?.plan ?? null : null] as const
      }
      catch {
        return [row.id, null] as const
      }
    }))
    plans.value = Object.fromEntries(loaded)
  }
  finally {
    loading.value = false
  }
}

watch(() => props.projectId, () => { void load() }, { immediate: true })
</script>

<template>
  <section class="boards">
    <header class="boards__bar">
      <div class="boards__tabs">
        <button
          v-for="(item, index) in catalog"
          :key="item.id"
          type="button"
          :class="{ 'is-on': index === current }"
          @click="current = index"
        >
          {{ t('第 {n} 集', { n: item.episode_no }) }} {{ item.title }}
        </button>
      </div>
      <button type="button" class="boards__back" @click="emit('close')">{{ t('回到画布') }}</button>
    </header>

    <p v-if="loading" class="boards__empty">{{ t('正在读取各集策划案…') }}</p>
    <p v-else-if="!episode" class="boards__empty">{{ t('这个项目还没有集。先生成一集策划案，画布才排得出来。') }}</p>
    <div v-else class="boards__stage">
      <p class="boards__note">
        <NuxtLink v-if="episode.canvas_id" :to="canvasTo(episode.canvas_id)">{{ t('打开这一集的画布') }}</NuxtLink>
        <span v-else>{{ t('尚未建画布') }}</span>
        {{ t('下面是这一集生成后的节点，用的是策划案里的真人、真镜头。图和视频要在节点上跑完才填进去。') }}
      </p>
      <div class="boards__cols">
        <div>
          <div class="boards__col">{{ t('策划案') }}</div>
          <article class="boards__card boards__plan">
            <b>{{ plan?.title || episode.title }}</b>
            <p>{{ t('第 {n} 集', { n: episode.episode_no }) }} · {{ plan?.shots?.length ?? 0 }} {{ t('镜') }}</p>
            <p>{{ (plan?.characters ?? []).map(character => character.name).filter(Boolean).join('、') || t('无') }}</p>
          </article>
        </div>
        <div>
          <div class="boards__col">{{ t('角色') }}</div>
          <div class="boards__stack">
            <article v-for="(character, index) in plan?.characters ?? []" :key="character.key" class="boards__card">
              <div class="boards__well" :style="{ background: colors[index % colors.length] }">
                {{ character.name }}<small>{{ t('角色图') }}</small>
              </div>
              <div class="boards__body"><b>{{ t('角色') }} · {{ character.name }}</b><span>{{ character.look }}</span></div>
            </article>
          </div>
        </div>
        <div>
          <div class="boards__col">{{ t('分镜') }}</div>
          <div class="boards__stack">
            <article v-for="(shot, index) in plan?.shots ?? []" :key="shot.id || shot.no" class="boards__card">
              <div class="boards__well" :style="{ background: FILM_COLORS[index % FILM_COLORS.length] }">
                {{ t('分镜') }} {{ shot.no || index + 1 }}<small>{{ names(shot.characters) }}</small>
              </div>
              <div class="boards__body"><b>{{ t('分镜') }} {{ shot.no || index + 1 }}</b><span>{{ shot.prompt }}</span></div>
            </article>
          </div>
        </div>
        <div>
          <div class="boards__col">{{ t('镜头') }}</div>
          <div class="boards__stack">
            <article v-for="(shot, index) in plan?.shots ?? []" :key="`v-${shot.id || shot.no}`" class="boards__card">
              <div class="boards__well boards__well--video">
                {{ t('镜头') }} {{ shot.no || index + 1 }}<small>{{ shot.motion }}</small>
              </div>
              <div class="boards__body"><b>{{ t('镜头') }} {{ shot.no || index + 1 }}</b><span>{{ shot.prompt }}</span></div>
            </article>
          </div>
        </div>
        <div>
          <div class="boards__col">{{ t('配音') }}</div>
          <div class="boards__stack">
            <template v-for="(shot, index) in plan?.shots ?? []" :key="`a-${shot.id || shot.no}`">
              <article v-if="spoken(shot)" class="boards__card">
                <div class="boards__well boards__well--audio">
                  {{ t('配音') }} {{ shot.no || index + 1 }}<small>{{ t('有台词') }}</small>
                </div>
                <div class="boards__body"><b>{{ t('配音') }} {{ shot.no || index + 1 }}</b><span>{{ spoken(shot) }}</span></div>
              </article>
              <div v-else class="boards__miss">{{ t('这一镜没有台词') }}</div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.boards { height: 100%; overflow: auto; padding: 64px 20px 32px; background: #eef1f4; color: #1c1c1f; }
.boards__bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.boards__tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.boards__tabs button, .boards__back { border: 1px solid #e4e7eb; background: #fff; border-radius: 999px; padding: 5px 12px; font: inherit; cursor: pointer; color: #6b7280; }
.boards__tabs button.is-on { color: #1c1c1f; border-color: #1c1c1f; font-weight: 650; }
.boards__back { margin-left: auto; color: #18c1d6; border-color: transparent; background: transparent; font-weight: 650; }
.boards__empty, .boards__note { margin: 0 0 12px; color: #6b7280; font-size: 13px; }
.boards__note a { margin-right: 8px; font-weight: 650; }
.boards__stage {
  min-height: 640px;
  padding: 16px;
  border-radius: 16px;
  background-image: radial-gradient(#d5dbe1 1px, transparent 1px);
  background-size: 22px 22px;
}
.boards__cols { display: grid; grid-template-columns: 180px repeat(4, minmax(150px, 1fr)); gap: 18px; align-items: start; }
.boards__col { margin-bottom: 8px; font-size: 11px; letter-spacing: .08em; color: #6b7280; }
.boards__stack { display: flex; flex-direction: column; gap: 12px; }
.boards__card { background: #fff; border: 1px solid #e3e6ea; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 22px rgba(20, 24, 30, .06); }
.boards__plan { padding: 12px; }
.boards__plan b { font-size: 15px; }
.boards__plan p { margin: 6px 0 0; color: #3f3f46; font-size: 12px; }
.boards__well { min-height: 52px; display: grid; place-items: center; color: #fff; font-size: 12px; text-align: center; padding: 6px; }
.boards__well small { display: block; opacity: .85; }
.boards__well--video { background: #111827; }
.boards__well--audio { background: #f4efe4; color: #92400e; }
.boards__body { padding: 8px 10px 10px; }
.boards__body b { display: block; font-size: 12px; }
.boards__body span { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 3; -webkit-box-orient: vertical; color: #6b7280; font-size: 11px; }
.boards__miss { min-height: 74px; border: 1px dashed #d5dbe1; border-radius: 14px; color: #a1a8b0; display: grid; place-items: center; font-size: 11px; background: rgba(255, 255, 255, .55); }
</style>
