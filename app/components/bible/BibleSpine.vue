<script setup lang="ts">
import type { BibleThread, Episode, ScreenplayPlan } from '~/types/creative'
import { buildSpine, FILM_COLORS, laneRuns, type SpineLane } from '~/utils/spine'

const props = defineProps<{
  episodes: Episode[]
  plans: Record<number, ScreenplayPlan | null>
  threads: BibleThread[]
  loading: boolean
}>()

const { t } = useI18n()
const localePath = useLocalePath()
const picked = ref('')

const spine = computed(() => buildSpine(
  props.episodes.map(episode => ({
    id: episode.id,
    episode_no: episode.episode_no,
    canvas_id: episode.canvas_id,
    status: episode.status,
    plan: props.plans[episode.id] ?? null,
  })),
  props.threads,
))

const width = 1080
const filmTop = 8
const cellH = 72
const laneTop = 118
const laneGap = 36

const nameW = 76
const layout = computed(() => {
  const count = Math.max(spine.value.episodes.length, 1)
  const cellW = (width - nameW - 16) / count
  return {
    cellW,
    height: laneTop + (spine.value.lanes.length + (spine.value.clues.length ? 1 : 0)) * laneGap + 28,
    x: (index: number) => nameW + cellW * index + cellW / 2,
  }
})

function stroke(lane: SpineLane) {
  const max = Math.max(...lane.weights, 1)
  return 2.5 + Math.min(max, 6) * 1.1
}

function shown(name: string) {
  return !picked.value || picked.value === name
}

function episodeHref(id: number) {
  return localePath({ path: '/create', query: { screenplay: String(id) } })
}

/** 左键走路由，好弹出未保存确认；Ctrl/中键仍用原生链接开新标签。 */
function openEpisode(event: MouseEvent, id: number) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return
  event.preventDefault()
  void navigateTo(episodeHref(id))
}

function filmTitle(title: string, cellW: number) {
  const label = title.trim() || t('未命名')
  const max = Math.max(2, Math.floor((cellW - 20) / 14))
  return label.length > max ? `${label.slice(0, max)}…` : label
}
</script>

<template>
  <section v-if="episodes.length" class="spine">
    <header class="spine__head">
      <div>
        <h2>{{ t('季轴') }}</h2>
        <p>{{ t('线越粗，这一集里这个人的镜头越多。线断开，是后面没有再出场。线索来自剧集设定，关系说明不画成交叉。') }}</p>
      </div>
    </header>

    <p v-if="loading" class="spine__wait">{{ t('正在读取各集策划案…') }}</p>
    <div v-else class="spine__poster">
      <svg
        class="spine__svg"
        :viewBox="`0 0 ${width} ${layout.height}`"
        role="img"
        :aria-label="t('季轴')"
      >
        <g v-for="(episode, index) in spine.episodes" :key="episode.id">
          <a :href="episodeHref(episode.id)" @click="openEpisode($event, episode.id)">
            <title>{{ episode.title.trim() || t('未命名') }}</title>
            <rect
              :x="layout.x(index) - layout.cellW / 2 + 6"
              :y="filmTop"
              :width="layout.cellW - 12"
              :height="cellH"
              rx="10"
              :fill="FILM_COLORS[index % FILM_COLORS.length]"
            />
            <text :x="layout.x(index)" :y="filmTop + 22" text-anchor="middle" fill="#dbeafe" font-size="11">{{ String(episode.no).padStart(2, '0') }}</text>
            <text :x="layout.x(index)" :y="filmTop + 46" text-anchor="middle" fill="#fff" font-size="14">{{ filmTitle(episode.title, layout.cellW) }}</text>
          </a>
          <text :x="layout.x(index)" :y="filmTop + cellH + 18" text-anchor="middle" fill="#93a3b8" font-size="11">{{ t('第 {n} 集', { n: episode.no }) }}</text>
        </g>

        <g v-for="(lane, laneIndex) in spine.lanes" :key="lane.name" :opacity="shown(lane.name) ? 1 : 0.15">
          <template v-for="run in laneRuns(lane.weights)" :key="`${lane.name}-${run[0]}`">
            <line
              :x1="layout.x(run[0])"
              :x2="layout.x(run[1])"
              :y1="laneTop + laneIndex * laneGap"
              :y2="laneTop + laneIndex * laneGap"
              :stroke="lane.color"
              :stroke-width="stroke(lane)"
              stroke-linecap="round"
            />
          </template>
          <text
            v-if="lane.exitAt != null"
            :x="layout.x(lane.exitAt)"
            :y="laneTop + laneIndex * laneGap - 10"
            text-anchor="middle"
            :fill="lane.color"
            font-size="11"
          >{{ t('退场') }}</text>
          <circle
            :cx="12"
            :cy="laneTop + laneIndex * laneGap"
            r="5"
            :fill="lane.color"
            class="spine__dot"
            @click="picked = picked === lane.name ? '' : lane.name"
          />
          <text
            :x="22"
            :y="laneTop + laneIndex * laneGap + 4"
            fill="#e8eef6"
            font-size="13"
            class="spine__name"
            @click="picked = picked === lane.name ? '' : lane.name"
          >{{ lane.name }}</text>
        </g>

        <g v-for="clue in spine.clues" :key="clue.title">
          <line
            :x1="layout.x(clue.from)"
            :x2="layout.x(clue.to)"
            :y1="laneTop + spine.lanes.length * laneGap"
            :y2="laneTop + spine.lanes.length * laneGap"
            stroke="#e2b15a"
            stroke-width="2"
            stroke-dasharray="5 5"
          />
          <text
            v-if="clue.open"
            :x="layout.x(clue.to)"
            :y="laneTop + spine.lanes.length * laneGap - 8"
            text-anchor="middle"
            fill="#e2b15a"
            font-size="11"
          >{{ t('没接上') }}</text>
        </g>
      </svg>
      <ul class="spine__legend">
        <li v-for="lane in spine.lanes" :key="lane.name">
          <button type="button" :class="{ 'is-on': picked === lane.name }" @click="picked = picked === lane.name ? '' : lane.name">
            <i :style="{ background: lane.color }" />
            {{ lane.name }}
          </button>
        </li>
        <li v-for="clue in spine.clues" :key="clue.title">
          <span class="spine__clue">{{ clue.title }}</span>
        </li>
      </ul>
      <p v-if="!spine.lanes.length" class="spine__empty">{{ t('这几集的策划案里还没有人物出场，线画不出来。') }}</p>
    </div>
  </section>
</template>

<style scoped>
.spine { margin: 8px 0 28px; }
.spine__head h2 { margin: 0; font-size: 18px; }
.spine__head p, .spine__wait, .spine__empty { margin: 6px 0 0; color: var(--st-text-soft, #3f3f46); font-size: 13px; line-height: 1.5; }
.spine__poster { margin-top: 14px; padding: 16px 8px 12px; border-radius: 18px; background: #12161e; }
.spine__svg { display: block; width: 100%; height: auto; }
.spine__svg a { text-decoration: none; }
.spine__name, .spine__dot { cursor: pointer; }
.spine__legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 8px 12px 0; padding: 0; list-style: none; }
.spine__legend button, .spine__clue { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: #e8eef6; font: inherit; font-size: 13px; cursor: pointer; }
.spine__legend i { width: 8px; height: 8px; border-radius: 99px; }
.spine__legend button.is-on { color: #fff; font-weight: 600; }
.spine__clue { color: #e2b15a; }
</style>
