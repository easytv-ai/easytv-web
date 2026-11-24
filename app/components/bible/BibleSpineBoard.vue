<script setup lang="ts">
import bibleApi from '~/api/bible'
import screenplayApi from '~/api/screenplay'
import type { Episode, ScreenplayPlan, ScreenplayShot } from '~/types/creative'
import { isCatalogEpisode } from '~/utils/bible'
import { SPINE_COLORS } from '~/utils/spine'

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
const shots = computed(() => plan.value?.shots ?? [])
const cast = computed(() => (plan.value?.characters ?? []).filter(character => character.name))
const totalSeconds = computed(() => shots.value.reduce((sum, shot) => sum + (Number(shot.seconds) || 0), 0))

function laneColor(index: number) {
  return SPINE_COLORS[index % SPINE_COLORS.length] ?? SPINE_COLORS[0]
}

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
    <div v-else class="boards__sheet">
      <div class="boards__mast">
        <div>
          <h2>{{ plan?.title || episode.title }}</h2>
          <p>
            {{ t('第 {n} 集', { n: episode.episode_no }) }}
            · {{ t('bible.board.shots', { n: shots.length }) }}
            <template v-if="totalSeconds"> · {{ t('{n} 秒', { n: totalSeconds }) }}</template>
            <template v-if="plan?.aspect"> · {{ plan.aspect }}</template>
          </p>
        </div>
        <NuxtLink v-if="episode.canvas_id" :to="canvasTo(episode.canvas_id)" class="boards__open">{{ t('打开这一集的画布') }}</NuxtLink>
        <span v-else class="boards__pending">{{ t('尚未建画布') }}</span>
      </div>

      <section v-if="cast.length" class="boards__cast" :aria-label="t('bible.board.cast')">
        <h3>{{ t('bible.board.cast') }}</h3>
        <ul>
          <li v-for="(character, index) in cast" :key="character.key">
            <i :style="{ background: laneColor(index) }" />
            <div>
              <b>{{ character.name }}</b>
              <span>{{ character.look }}</span>
            </div>
          </li>
        </ul>
      </section>

      <ol v-if="shots.length" class="boards__shots">
        <li v-for="(shot, index) in shots" :key="shot.id || shot.no" class="boards__shot">
          <span class="boards__no">{{ String(shot.no || index + 1).padStart(2, '0') }}</span>
          <div class="boards__cols">
            <div class="boards__picture">
              <b v-if="names(shot.characters)">{{ names(shot.characters) }}</b>
              <p>{{ shot.prompt || t('bible.board.noPicture') }}</p>
            </div>
            <div class="boards__motion">
              <p>{{ shot.motion || '—' }}</p>
              <small v-if="shot.seconds">{{ t('{n} 秒', { n: shot.seconds }) }}</small>
            </div>
            <p class="boards__line" :class="{ 'is-quiet': !spoken(shot) }">{{ spoken(shot) || t('这一镜没有台词') }}</p>
          </div>
        </li>
      </ol>
      <p v-else class="boards__empty">{{ t('bible.board.noShots') }}</p>
    </div>
  </section>
</template>

<style scoped>
.boards {
  height: 100%;
  overflow: auto;
  padding: 72px 28px 32px 28px;
  background: var(--st-canvas);
  color: var(--st-text);
}

.boards__bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.boards__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.boards__tabs button,
.boards__back {
  border: 0;
  background: transparent;
  padding: 6px 0;
  font: inherit;
  font-size: 14px;
  color: var(--st-muted);
  cursor: pointer;
}

.boards__tabs button.is-on {
  color: var(--st-text);
  font-weight: 600;
}

.boards__tabs button:hover,
.boards__back:hover {
  color: var(--st-text);
}

.boards__tabs button:focus-visible,
.boards__back:focus-visible,
.boards__open:focus-visible {
  outline: 2px solid var(--st-text);
  outline-offset: 3px;
}

.boards__back {
  margin-left: auto;
  color: var(--st-text-soft);
}

.boards__empty {
  margin: 0;
  color: var(--st-text-soft);
  font-size: 14px;
  line-height: 1.5;
}

.boards__sheet {
  display: flex;
  flex-direction: column;
  gap: 28px;
  width: min(1120px, 100%);
}

.boards__mast {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.boards__mast h2 {
  margin: 0;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.boards__mast p {
  margin: 8px 0 0;
  color: var(--st-muted);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.boards__open {
  flex: none;
  padding: 7px 14px;
  border: 1px solid rgb(212 175 55 / 45%);
  border-radius: 999px;
  background: transparent;
  color: #d4af37;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.boards__open:hover {
  border-color: #d4af37;
  background: rgb(212 175 55 / 8%);
}

.boards__pending {
  flex: none;
  color: var(--st-muted);
  font-size: 14px;
}

.boards__cast h3 {
  margin: 0 0 12px;
  color: var(--st-muted);
  font-size: 13px;
  font-weight: 500;
}

.boards__cast ul {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.boards__cast li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: min(240px, 100%);
  padding: 14px 16px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 14px;
  background: rgb(14 14 16 / 72%);
  backdrop-filter: blur(16px);
}

.boards__cast i {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  flex: none;
  border-radius: 999px;
}

.boards__cast b {
  color: #fff;
  font-size: 15px;
  font-weight: 650;
}

.boards__cast span {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 4px;
  color: #a1a1aa;
  font-size: 13px;
  line-height: 1.45;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.boards__shots {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.boards__shot {
  padding: 18px 22px 20px;
  border: 0;
  border-top: 1px solid rgb(255 255 255 / 5%);
  border-radius: 16px;
  background: linear-gradient(180deg, #18181b 0%, #111111 100%);
  box-shadow: 0 8px 24px rgb(0 0 0 / 80%);
}

.boards__no {
  display: inline-flex;
  margin-bottom: 14px;
  padding: 2px 9px;
  border: 1px solid rgb(212 175 55 / 40%);
  border-radius: 999px;
  color: #d4af37;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.boards__cols {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(140px, 0.7fr) minmax(160px, 0.78fr);
  gap: 28px;
  align-items: start;
}

.boards__picture b {
  display: block;
  margin-bottom: 6px;
  color: #fff;
  font-size: 14px;
  font-weight: 650;
}

.boards__shot p {
  margin: 0;
  color: #a1a1aa;
  font-size: 14px;
  line-height: 1.6;
}

.boards__shot small {
  display: block;
  margin-top: 8px;
  color: #8a8a93;
  font-size: 12px;
}

.boards__shot .boards__line {
  color: #9fd4e8;
}

.boards__shot .boards__line.is-quiet {
  color: #6b6b73;
}

@media (max-width: 860px) {
  .boards {
    padding: 64px 16px 24px 16px;
  }

  .boards__mast {
    flex-direction: column;
    align-items: flex-start;
  }

  .boards__mast h2 {
    font-size: 26px;
  }

  .boards__cols {
    grid-template-columns: 1fr;
    gap: 14px;
  }
}
</style>
