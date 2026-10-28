<script setup lang="ts">
/**
 * 底部运镜时间轴（复刻自 open-director 的 DirectorTimeline.tsx，MIT）。
 *
 * 这里只管「什么时候」：播放、拖播放头、节点时间、段时长、停顿、缓动、
 * 直线还是曲线。「在哪里」是 3D 视口里拖节点和手柄的事。
 *
 * 刻度和坐标换算在 playback/timeline-layout.ts 里，已经单独测过。
 */
import { computed, onMounted, ref } from 'vue'
import taskApi from '~/api/task'
import type { GenerationModel } from '~/types/creative'
import { effectiveUnitPrice, estimateTaskPoints } from '~/utils/model-price'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { isLinkedCameraLocked } from '~/utils/director/object-focus'
import { buildCameraSegments, getCameraPathDuration, getNodeStartTimes } from '~/utils/director/camera-path'
import {
  formatPlayheadTime,
  getNodeLabel,
  getRulerTicks,
  getTrackContentWidth,
  timeFromTrackOffset,
  TRACK_GUTTER_WIDTH,
} from '~/utils/director/playback/timeline-layout'
import { startPointerDrag } from '~/utils/director/pointer-drag'
import { exportCameraPathVideo } from '~/utils/director/playback/video-export'
import { capturePreviewFrames } from '~/utils/director/export/preview-capture'
import { previewSamplingFromMode } from '~/utils/director/export/preview-frames'
import { previewOutputFromMode, type PreviewOutput } from '~/utils/director/export/preview-pass'
import { previewShotPromptsFromPath } from '~/utils/director/export/preview-move-classify'
import { pickPreviewVideoModel, previewExportPoints } from '~/utils/director/export/preview-clip-graph'
import DirectorTimelineInspector from './DirectorTimelineInspector.vue'

const { t } = useI18n()
const store = useDirectorStore()
const playback = useCameraPlaybackStore()
const { confirm } = useConfirm()
const { isMember, balance } = useWallet()
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const generationModelsLoaded = useState('generation-models-loaded', () => false)

const emit = defineEmits<{
  'export-video': [payload: { blob: Blob, fileName: string, duration?: number }]
  'export-preview': [payload: {
    frames: { dataUrl: string, fileName: string, shotIndex: number, time: number, label: string }[]
    prompts: string[]
    output: PreviewOutput
    /** 彩色且用户确认过积分：落图后接着交服务端批量 */
    generate?: boolean
  }]
}>()

/** 轨道行的高度与位置，和 CSS 里的一致 */
const RULER_HEIGHT = 22
const TRACK_TOP = RULER_HEIGHT + 8
const TRACK_HEIGHT = 34
const ZOOM_FACTOR = 1.5
/** 播放头落在末尾附近就算「播完了」，浮点时间对不上整数 */
const END_EPSILON = 0.001

const trackRef = ref<HTMLElement | null>(null)
/** 导出失败时的提示，成功就清空 */
const exportMessage = ref('')
const previewing = ref(false)
/** 导演台页上传落图期间也占着，避免截图一完按钮就松开 */
const previewPlacing = useState('director-preview-placing', () => false)
const previewAbort = useState<AbortController | null>('director-preview-abort', () => null)
const previewBusy = computed(() => previewing.value || previewPlacing.value)
/** 默认每镜首尾帧；间隔档固定 0.25 秒，一镜最多 6 帧 */
const samplingMode = ref<'shot-ends' | 'interval'>('shot-ends')
/** 彩色会排视频节点；深度和白模只落图像，不提交生成 */
const outputMode = ref<PreviewOutput>('color')

const camera = computed(() => {
  const project = store.project.value
  return project.cameras.find(item => item.id === project.activeCameraId) ?? project.cameras[0] ?? null
})

const writeBlocked = computed(() =>
  store.readonly.value || isLinkedCameraLocked(store.project.value.objects, camera.value?.id),
)

const nodes = computed(() => camera.value?.nodes ?? [])
const segments = computed(() => buildCameraSegments(nodes.value, camera.value?.segments))
const total = computed(() => getCameraPathDuration(nodes.value, segments.value))
const startTimes = computed(() => getNodeStartTimes(nodes.value, segments.value))

const zoom = computed(() => playback.timelineZoom.value)
const ticks = computed(() => getRulerTicks(total.value, zoom.value))
const contentWidth = computed(() => getTrackContentWidth(total.value, zoom.value))

/** 少于两个节点没有运动段，播放没有意义 */
const canPlay = computed(() => nodes.value.length >= 2)
/** 预演至少要有一个运镜节点；导出视频仍要两个 */
const canPreview = computed(() => nodes.value.length >= 1)

function quotePreviewModel(model: string, durationSeconds: number) {
  const found = generationModels.value.find(item => item.model === model)
  if (!found?.priced)
    return 0
  return estimateTaskPoints(effectiveUnitPrice(found, isMember.value), found.unit, 1, durationSeconds)
}

const previewVideoModel = computed(() => pickPreviewVideoModel(generationModels.value))

/** 导出前就标出大约多少点；深度和白模是 0，清单还没回来时也是 0 */
const previewPoints = computed(() => {
  if (!camera.value)
    return 0
  return previewExportPoints(
    camera.value,
    previewSamplingFromMode(samplingMode.value),
    previewOutputFromMode(outputMode.value),
    quotePreviewModel,
    previewVideoModel.value,
  )
})

onMounted(() => {
  if (generationModelsLoaded.value || generationModels.value.length)
    return
  void taskApi.models().then((res) => {
    if (res?.success && Array.isArray(res.data)) {
      generationModels.value = res.data
      generationModelsLoaded.value = true
    }
  })
})

const playheadLeft = computed(() =>
  TRACK_GUTTER_WIDTH + Math.min(playback.playheadTime.value, total.value) * zoom.value,
)

function timeAt(clientX: number) {
  const rect = trackRef.value?.getBoundingClientRect()
  if (!rect)
    return 0
  // 轨道可以横向滚动，要把滚动量算进去，否则滚过之后点哪都偏
  return timeFromTrackOffset(clientX - rect.left + (trackRef.value?.scrollLeft ?? 0), zoom.value, total.value)
}

/** 拖播放头 */
function onScrubDown(event: PointerEvent) {
  event.preventDefault()

  // 拖播放头等于要手动看某一帧，先把播放停掉
  playback.pause()
  playback.setPlayheadTime(timeAt(event.clientX))

  startPointerDrag({
    target: event.currentTarget as HTMLElement,
    pointerId: event.pointerId,
    fallback: window,
    handlers: {
      onMove: moveEvent => playback.setPlayheadTime(timeAt(moveEvent.clientX)),
    },
  })
}

/** 拖节点改它的时间；整段拖动合成一步撤销 */
function onNodeDown(event: PointerEvent, nodeId: string) {
  const current = camera.value
  if (!current || writeBlocked.value)
    return

  event.stopPropagation()
  event.preventDefault()

  playback.selectNode({ cameraId: current.id, nodeId })
  store.beginBatch()

  startPointerDrag({
    target: event.currentTarget as HTMLElement,
    pointerId: event.pointerId,
    fallback: window,
    handlers: {
      onMove: moveEvent => store.updateCameraNodeTime(current.id, nodeId, timeAt(moveEvent.clientX)),
      onEnd: () => store.endBatch(),
    },
  })
}

function onNodeClick(nodeId: string, index: number) {
  const current = camera.value
  if (!current)
    return
  playback.selectNode({ cameraId: current.id, nodeId })
  // 播放头跳到这个节点：机位视角里立刻能看到它的取景，方便接着调
  playback.setPlayheadTime(startTimes.value[index] ?? 0)
}

function onSegmentClick(segmentId: string) {
  const current = camera.value
  if (current)
    playback.selectSegment({ cameraId: current.id, segmentId })
}

function togglePlay() {
  if (playback.isPlaying.value) {
    playback.pause()
    return
  }
  // 播放就是要看镜头里的画面，自动切到机位视角
  store.setViewMode('camera')
  // 上一轮播完了播放头停在末尾，再点播放从头来
  if (playback.playheadTime.value >= total.value - END_EPSILON)
    playback.setPlayheadTime(0)
  playback.play()
}

async function onExport() {
  if (store.readonly.value)
    return
  exportMessage.value = ''
  const result = await exportCameraPathVideo({
    camera: camera.value,
    playback,
    setViewMode: mode => store.setViewMode(mode),
    previousViewMode: store.state.value.viewMode,
  })
  if (!result.ok || !result.blob?.size || !result.fileName) {
    exportMessage.value = t(result.ok ? '视频导出失败，再试一次' : result.message)
    return
  }
  emit('export-video', { blob: result.blob, fileName: result.fileName, duration: result.duration })
}

function onCancelPreview() {
  previewAbort.value?.abort()
}

async function onExportPreview() {
  if (store.readonly.value || previewBusy.value || playback.isExporting.value)
    return
  exportMessage.value = ''
  const generate = outputMode.value === 'color' && previewPoints.value > 0
  if (generate) {
    const ok = await confirm({
      title: t('canvas.director.preview.confirmTitle'),
      message: t('canvas.director.preview.confirm', { points: previewPoints.value, balance: balance.value }),
      confirmText: t('确认并生成'),
    })
    if (!ok)
      return
  }
  const ctrl = new AbortController()
  previewAbort.value = ctrl
  previewing.value = true
  try {
    const current = camera.value
    const output = previewOutputFromMode(outputMode.value)
    const result = await capturePreviewFrames({
      camera: current,
      playback,
      setViewMode: mode => store.setViewMode(mode),
      previousViewMode: store.state.value.viewMode,
      sampling: previewSamplingFromMode(samplingMode.value),
      output,
      readPass: output === 'color' ? undefined : playback.controlPass.value ?? undefined,
      signal: ctrl.signal,
    })
    if (!result.ok) {
      exportMessage.value = t(result.message)
      return
    }
    if (ctrl.signal.aborted) {
      exportMessage.value = t('已取消导出预演')
      return
    }
    emit('export-preview', {
      frames: result.frames.map(frame => ({
        dataUrl: frame.dataUrl,
        fileName: frame.label,
        shotIndex: frame.shotIndex,
        time: frame.time,
        label: frame.label,
      })),
      prompts: previewShotPromptsFromPath(current ?? { nodes: [] }),
      output,
      generate,
    })
  }
  finally {
    previewing.value = false
    if (!previewPlacing.value && previewAbort.value === ctrl)
      previewAbort.value = null
  }
}

function segmentStyle(index: number, segment: { duration: number, holdAfter: number }) {
  const motionWidth = segment.duration * zoom.value
  const holdWidth = segment.holdAfter * zoom.value
  return {
    left: `${TRACK_GUTTER_WIDTH + (startTimes.value[index] ?? 0) * zoom.value}px`,
    top: `${TRACK_TOP}px`,
    height: `${TRACK_HEIGHT}px`,
    // 段再短也留 3px，不然零时长的段在轨道上完全看不见
    width: `${Math.max(motionWidth + holdWidth, 3)}px`,
  }
}

function segmentTitle(index: number, segment: { duration: number, holdAfter: number }) {
  const span = `${getNodeLabel(index)}→${getNodeLabel(index + 1)}`
  const hold = segment.holdAfter > 0 ? ` + ${t('停顿')} ${segment.holdAfter.toFixed(1)}s` : ''
  return `${span}：${segment.duration.toFixed(1)}s${hold}`
}
</script>

<template>
  <section class="director-timeline" :aria-label="t('运镜时间轴')">
    <div class="director-timeline__bar">
      <div class="director-timeline__transport">
        <button
          type="button"
          class="director-timeline__button"
          :disabled="!canPlay"
          :aria-label="playback.isPlaying.value ? t('暂停') : t('播放')"
          @click="togglePlay()"
        >
          <UIcon :name="playback.isPlaying.value ? 'i-lucide-pause' : 'i-lucide-play'" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up">{{ playback.isPlaying.value ? t('暂停') : t('播放') }}</span>
        </button>
        <button
          type="button"
          class="director-timeline__button"
          :disabled="!canPlay"
          :aria-label="t('停止')"
          @click="playback.stop()"
        >
          <UIcon name="i-lucide-square" class="size-3" />
          <span class="canvas-tip canvas-tip--up">{{ t('停止') }}</span>
        </button>
        <span class="director-timeline__time">
          {{ formatPlayheadTime(playback.playheadTime.value) }} / {{ formatPlayheadTime(total) }}
        </span>
      </div>

      <div class="director-timeline__zoom">
        <button
          type="button"
          class="director-timeline__button"
          :aria-label="t('缩小时间轴')"
          @click="playback.setTimelineZoom(zoom / ZOOM_FACTOR)"
        >
          <UIcon name="i-lucide-minus" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up">{{ t('缩小时间轴') }}</span>
        </button>
        <button
          type="button"
          class="director-timeline__button"
          :aria-label="t('放大时间轴')"
          @click="playback.setTimelineZoom(zoom * ZOOM_FACTOR)"
        >
          <UIcon name="i-lucide-plus" class="size-3.5" />
          <span class="canvas-tip canvas-tip--up">{{ t('放大时间轴') }}</span>
        </button>
      </div>

      <div class="director-timeline__name">
        <template v-if="camera">{{ camera.name }} · {{ t('{n} 个节点', { n: nodes.length }) }}</template>
        <template v-else>{{ t('没有可用机位') }}</template>
      </div>

      <DirectorTimelineInspector :segments="segments" :start-times="startTimes" :write-blocked="writeBlocked" />

      <div class="director-timeline__actions">
        <button
          type="button"
          class="director-timeline__button"
          :disabled="writeBlocked || !camera || playback.isExporting.value"
          @click="camera && store.addCameraNode(camera.id)"
        >
          <UIcon name="i-lucide-plus" class="size-3.5" />
          <span>{{ t('添加节点') }}</span>
        </button>
        <button
          type="button"
          class="director-timeline__button"
          :disabled="store.readonly.value || !canPlay || playback.isExporting.value"
          :title="t('canvas.director.export.title')"
          @click="onExport()"
        >
          <UIcon name="i-lucide-video" class="size-3.5" />
          <span>{{ playback.isExporting.value ? t('导出中…') : t('canvas.director.export.refClip') }}</span>
        </button>
        <label class="director-timeline__field director-timeline__field--output" :title="t('canvas.director.preview.outputTitle')">
          <StudioSelect
            size="compact"
            placement="up"
            :model-value="outputMode"
            :disabled="previewBusy || playback.isExporting.value"
            :sr-label="t('预演输出')"
            :options="[
              { value: 'color', label: t('彩色') },
              { value: 'depth', label: t('深度') },
              { value: 'matte', label: t('白模') },
            ]"
            @update:model-value="outputMode = previewOutputFromMode(String($event))"
          />
        </label>
        <label class="director-timeline__field director-timeline__field--sampling" :title="t('首尾帧，或每 0.25 秒一帧（一镜最多 6 帧）')">
          <StudioSelect
            size="compact"
            placement="up"
            :model-value="samplingMode"
            :disabled="previewBusy || playback.isExporting.value"
            :sr-label="t('预演采样')"
            :options="[
              { value: 'shot-ends', label: t('首尾') },
              { value: 'interval', label: t('0.25秒') },
            ]"
            @update:model-value="samplingMode = $event === 'interval' ? 'interval' : 'shot-ends'"
          />
        </label>
        <button
          type="button"
          class="director-timeline__button"
          :disabled="store.readonly.value || !canPreview || previewBusy || playback.isExporting.value"
          :title="t('canvas.director.preview.tip')"
          @click="onExportPreview()"
        >
          <UIcon name="i-lucide-images" class="size-3.5" />
          <span>{{ previewBusy ? t('导出预演中…') : previewPoints > 0 ? t('导出预演 · 约 {points} 积分', { points: previewPoints }) : t('导出预演') }}</span>
        </button>
        <button
          v-if="previewBusy"
          type="button"
          class="director-timeline__button"
          @click="onCancelPreview()"
        >
          <UIcon name="i-lucide-x" class="size-3.5" />
          <span>{{ t('取消') }}</span>
        </button>
        <span v-if="exportMessage" class="director-timeline__error">{{ exportMessage }}</span>
        <slot name="actions" />
      </div>
    </div>

    <div
      ref="trackRef"
      class="director-timeline__track"
      @pointerdown="onScrubDown"
    >
      <div class="director-timeline__content" :style="{ width: `${contentWidth}px` }">
        <div class="director-timeline__ruler" :style="{ height: `${RULER_HEIGHT}px` }">
          <template v-if="nodes.length">
            <span
              v-for="tick in ticks"
              :key="tick.time"
              class="director-timeline__tick"
              :style="{ left: `${tick.left}px` }"
            >{{ tick.label }}</span>
          </template>
          <span v-else class="director-timeline__hint">
            {{ t('进机位视角掌镜，按 K 记一个运镜节点') }}
          </span>
        </div>

        <button
          v-for="(segment, index) in segments"
          :key="segment.id"
          type="button"
          class="director-timeline__segment"
          :class="{
            'is-selected': playback.selectedSegment.value?.segmentId === segment.id,
            'is-bezier': segment.curveMode === 'bezier',
          }"
          :style="segmentStyle(index, segment)"
          :aria-label="segmentTitle(index, segment)"
          @pointerdown.stop
          @click="onSegmentClick(segment.id)"
        >
          <span class="director-timeline__motion" :style="{ width: `${segment.duration * zoom}px` }" />
          <span
            v-if="segment.holdAfter > 0"
            class="director-timeline__hold"
            :style="{ width: `${segment.holdAfter * zoom}px` }"
          />
        </button>

        <button
          v-for="(node, index) in nodes"
          :key="node.id"
          type="button"
          class="director-timeline__node"
          :class="{ 'is-selected': playback.selectedNode.value?.nodeId === node.id }"
          :style="{ left: `${TRACK_GUTTER_WIDTH + (startTimes[index] ?? 0) * zoom}px`, top: `${TRACK_TOP - 5}px` }"
          :aria-label="`${getNodeLabel(index)} · ${formatPlayheadTime(startTimes[index] ?? 0)}`"
          @pointerdown="onNodeDown($event, node.id)"
          @click="onNodeClick(node.id, index)"
        >
          {{ getNodeLabel(index) }}
        </button>

        <div class="director-timeline__playhead" :style="{ left: `${playheadLeft}px` }">
          <span class="director-timeline__playhead-cap" />
        </div>
      </div>
    </div>
  </section>
</template>
