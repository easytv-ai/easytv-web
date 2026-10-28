<script setup lang="ts">
import {
  COMPOSE_ASPECTS,
  COMPOSE_MAX,
  COMPOSE_MIN,
  COMPOSE_RESOLUTIONS,
  composeClipSeconds,
  composeEstimateSeconds,
  composeGuessAspect,
  type ComposeAspect,
  type ComposeAudioSource,
  type ComposeOptions,
  type ComposeResolution,
  type ComposeSource,
  type ComposeSubtitleSource,
} from '~/utils/canvas-compose'
import { pickComposeBgmId } from '~/utils/canvas-audio'
import type { ComposeRunState } from '~/composables/useCanvasCompose'

/**
 * 画布多段合成：选中的视频已按阅读顺序排好，这里定画幅 / 字幕 / 原声 / BGM，
 * 确认后由工作区存画布并提交 compose（不计积分）。
 */
const props = withDefaults(defineProps<{
  open: boolean
  items: ComposeSource[]
  audios?: ComposeAudioSource[]
  subtitles?: ComposeSubtitleSource[]
  run?: ComposeRunState | null
}>(), {
  audios: () => [],
  subtitles: () => [],
  run: null,
})

const emit = defineEmits<{
  close: []
  persist: [ordered: ComposeSource[]]
  confirm: [opts: ComposeOptions, ordered: ComposeSource[]]
}>()

const { t, locale } = useI18n()

const orderedIds = ref<string[]>([])
const aspect = ref<ComposeAspect>('16:9')
const resolution = ref<ComposeResolution>('1080p')
const subtitlesOn = ref(false)
const voiceOn = ref(true)
const bgmId = ref(0)
const subtitleNodeId = ref('')
const preview = ref(false)
const pack = ref(false)
const trims = ref<Record<string, { in: number, out: number }>>({})

const ordered = computed(() => {
  const byId = new Map(props.items.map(item => [item.id, item]))
  const picked = orderedIds.value.map(id => byId.get(id)).filter((item): item is ComposeSource => Boolean(item))
  const seen = new Set(picked.map(item => item.id))
  for (const item of props.items) {
    if (!seen.has(item.id))
      picked.push(item)
  }
  return picked.map((item) => {
    const trim = trims.value[item.id]
    return {
      ...item,
      trimIn: trim?.in || 0,
      trimOut: trim?.out || 0,
    }
  })
})

const count = computed(() => ordered.value.length)
const seconds = computed(() => composeEstimateSeconds(ordered.value))
const overLimit = computed(() => count.value > COMPOSE_MAX)
const canSubmit = computed(() => count.value >= COMPOSE_MIN && !overLimit.value && !props.run?.busy)
const job = computed(() => props.run?.job ?? null)
const running = computed(() => {
  const status = job.value?.status
  return Boolean(props.run?.busy || status === 0 || status === 1)
})
const progress = computed(() => Math.min(100, Math.max(0, Number(job.value?.progress) || 0)))

function resetFromItems() {
  orderedIds.value = props.items.map(item => item.id)
  aspect.value = composeGuessAspect(props.items[0]?.ratio)
  resolution.value = '1080p'
  subtitlesOn.value = false
  voiceOn.value = true
  bgmId.value = pickComposeBgmId(props.audios)
  subtitleNodeId.value = ''
  preview.value = false
  pack.value = false
  trims.value = Object.fromEntries(props.items.map(item => [item.id, {
    in: Number(item.trimIn) > 0 ? Number(item.trimIn) : 0,
    out: Number(item.trimOut) > 0 ? Number(item.trimOut) : 0,
  }]))
}

function setTrim(id: string, which: 'in' | 'out', event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  const current = trims.value[id] ?? { in: 0, out: 0 }
  trims.value = {
    ...trims.value,
    [id]: {
      in: which === 'in' ? (Number.isFinite(raw) && raw > 0 ? raw : 0) : current.in,
      out: which === 'out' ? (Number.isFinite(raw) && raw > 0 ? raw : 0) : current.out,
    },
  }
}

function clipSeconds(item: ComposeSource) {
  return composeClipSeconds(item)
}

function move(index: number, delta: number) {
  const next = ordered.value.map(item => item.id)
  const to = index + delta
  if (to < 0 || to >= next.length)
    return
  const [item] = next.splice(index, 1)
  if (!item)
    return
  next.splice(to, 0, item)
  orderedIds.value = next
}

function onConfirm() {
  if (!canSubmit.value)
    return
  emit('confirm', {
    aspect: aspect.value,
    resolution: resolution.value,
    subtitles: subtitlesOn.value,
    voice: voiceOn.value,
    lang: String(locale.value || 'zh').startsWith('zh') ? 'zh' : 'en',
    bgmAssetId: bgmId.value,
    bgmVolume: 0.2,
    subtitleNodeId: subtitleNodeId.value || undefined,
    preview: preview.value,
    package: !preview.value && pack.value,
  }, ordered.value)
}

function closePanel() {
  emit('persist', ordered.value)
  emit('close')
}

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    closePanel()
  }
}

watch(() => props.open, (open) => {
  if (open)
    resetFromItems()
  else
    emit('persist', ordered.value)
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="closePanel" @pointerdown.stop>
      <div class="studio-modal canvas-presets canvas-montage canvas-compose" role="dialog" aria-modal="true" aria-labelledby="canvas-compose-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="canvas-compose-title">{{ t('canvas.compose.title') }}</h2>
            <p>{{ t('canvas.compose.lead', { n: count, s: seconds }) }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="closePanel">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <p v-if="count < COMPOSE_MIN" class="canvas-compose__hint is-warn">{{ t('canvas.compose.needTwo') }}</p>
        <p v-else-if="overLimit" class="canvas-compose__hint is-warn">{{ t('canvas.compose.tooMany', { n: COMPOSE_MAX }) }}</p>

        <ol class="canvas-compose__clips">
          <li v-for="(item, i) in ordered" :key="item.id">
            <b>{{ i + 1 }}</b>
            <video v-if="item.url" :src="item.url" muted playsinline preload="metadata" />
            <span v-else class="canvas-compose__ph" />
            <em>
              {{ item.label }}
              <small>{{ clipSeconds(item) }}s</small>
            </em>
            <div class="canvas-compose__trim">
              <label>
                {{ t('canvas.compose.trimIn') }}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  :max="item.duration || undefined"
                  :value="item.trimIn || ''"
                  @change="setTrim(item.id, 'in', $event)"
                >
              </label>
              <label>
                {{ t('canvas.compose.trimOut') }}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  :max="item.duration || undefined"
                  :value="item.trimOut || ''"
                  @change="setTrim(item.id, 'out', $event)"
                >
              </label>
            </div>
            <div class="canvas-compose__move">
              <button type="button" :disabled="i === 0" :aria-label="t('canvas.compose.moveUp')" @click="move(i, -1)">↑</button>
              <button type="button" :disabled="i === ordered.length - 1" :aria-label="t('canvas.compose.moveDown')" @click="move(i, 1)">↓</button>
            </div>
          </li>
        </ol>

        <div class="canvas-montage__row">
          <span>{{ t('canvas.compose.aspect') }}</span>
          <div class="canvas-presets__picks canvas-montage__picks">
            <button
              v-for="item in COMPOSE_ASPECTS"
              :key="item"
              type="button"
              :class="{ 'is-on': aspect === item }"
              @click="aspect = item"
            >
              <strong>{{ item }}</strong>
            </button>
          </div>
        </div>

        <div class="canvas-montage__row">
          <span>{{ t('canvas.compose.resolution') }}</span>
          <div class="canvas-presets__picks canvas-montage__picks">
            <button
              v-for="item in COMPOSE_RESOLUTIONS"
              :key="item"
              type="button"
              :class="{ 'is-on': resolution === item }"
              @click="resolution = item"
            >
              <strong>{{ item }}</strong>
            </button>
          </div>
        </div>

        <div class="canvas-montage__row">
          <label class="canvas-montage__check">
            <input v-model="subtitlesOn" type="checkbox">
            <span>{{ t('canvas.compose.subtitles') }}</span>
          </label>
          <label class="canvas-montage__check">
            <input v-model="voiceOn" type="checkbox">
            <span>{{ t('canvas.compose.voice') }}</span>
          </label>
        </div>

        <div v-if="subtitlesOn && subtitles.length" class="canvas-montage__row">
          <span>{{ t('canvas.compose.subtitleSource') }}</span>
          <select v-model="subtitleNodeId" class="canvas-compose__select">
            <option value="">{{ t('canvas.compose.subtitleNone') }}</option>
            <option v-for="item in subtitles" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </div>

        <div v-if="audios.length" class="canvas-montage__row">
          <span>{{ t('canvas.compose.bgm') }}</span>
          <select v-model.number="bgmId" class="canvas-compose__select">
            <option :value="0">{{ t('canvas.compose.bgmNone') }}</option>
            <option v-for="item in audios" :key="item.id" :value="item.assetId">{{ item.label }}</option>
          </select>
        </div>

        <div class="canvas-montage__row">
          <label class="canvas-montage__check">
            <input v-model="preview" type="checkbox">
            <span>{{ t('canvas.compose.preview') }}</span>
          </label>
          <label v-if="!preview" class="canvas-montage__check">
            <input v-model="pack" type="checkbox">
            <span>{{ t('canvas.compose.package') }}</span>
          </label>
        </div>
        <p class="canvas-compose__hint">{{ preview ? t('canvas.compose.previewHint') : t('canvas.compose.free') }}</p>
        <p v-if="!preview && pack" class="canvas-compose__hint">{{ t('canvas.compose.packageHint') }}</p>
        <p v-if="run?.error" class="canvas-compose__hint is-warn">{{ run.error }}</p>
        <p v-if="running" class="canvas-compose__hint">{{ t('canvas.compose.running', { n: progress }) }}</p>

        <div class="canvas-montage__row">
          <button type="button" class="canvas-montage__go" :disabled="!canSubmit" @click="onConfirm">
            {{ preview ? t('canvas.compose.previewSubmit') : t('canvas.compose.submit') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
