<script setup lang="ts">
/**
 * 时间轴工具条中间那段：选中节点或运动段之后在这里改它的设置
 * （复刻自 open-director 的 DirectorTimeline.tsx 里的 timeline-inspector 部分，MIT）。
 *
 * 没选东西时显示一句提示，不留空白 —— 这块位置固定，空着会让工具条看起来缺了一截。
 */
import { computed } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { formatPlayheadTime, getNodeLabel } from '~/utils/director/playback/timeline-layout'
import { MIN_SEGMENT_DURATION } from '~/utils/director/camera-path'
import type { CameraSegment, CameraSegmentEasing } from '~/utils/director/schema'

const props = defineProps<{
  segments: CameraSegment[]
  startTimes: number[]
  writeBlocked?: boolean
}>()

const { t } = useI18n()
const store = useDirectorStore()
const playback = useCameraPlaybackStore()

const EASING_OPTIONS: { value: CameraSegmentEasing, label: string }[] = [
  { value: 'linear', label: '匀速' },
  { value: 'ease-in', label: '缓入' },
  { value: 'ease-out', label: '缓出' },
  { value: 'ease-in-out', label: '缓入缓出' },
]

const camera = computed(() => {
  const project = store.project.value
  return project.cameras.find(item => item.id === project.activeCameraId) ?? null
})

const selectedNodeIndex = computed(() => {
  const selection = playback.selectedNode.value
  if (!selection)
    return -1
  return camera.value?.nodes?.findIndex(node => node.id === selection.nodeId) ?? -1
})

const selectedSegment = computed(() => {
  const selection = playback.selectedSegment.value
  if (!selection)
    return null
  return props.segments.find(segment => segment.id === selection.segmentId) ?? null
})

function patchSegment(patch: Partial<Pick<CameraSegment, 'duration' | 'holdAfter' | 'easing'>>) {
  const current = camera.value
  const segment = selectedSegment.value
  if (props.writeBlocked || !current || !segment)
    return
  store.updateCameraSegment(current.id, segment.id, patch)
}

function onDuration(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value))
    patchSegment({ duration: Math.max(value, MIN_SEGMENT_DURATION) })
}

function onHold(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  // 停顿可以是 0，但不能是负数 —— 负停顿会让这一段的时间倒着走
  if (Number.isFinite(value) && value >= 0)
    patchSegment({ holdAfter: value })
}

function toggleCurve() {
  const current = camera.value
  const segment = selectedSegment.value
  if (props.writeBlocked || !current || !segment)
    return

  const wasLinear = segment.curveMode === 'linear'
  store.setSegmentCurveMode(current.id, segment.id, wasLinear ? 'bezier' : 'linear')
  // 刚转成曲线：顺手选中起点手柄，视口里立刻知道该拖哪个
  if (wasLinear)
    playback.selectHandle({ cameraId: current.id, segmentId: segment.id, handle: 'out' })
}

function insertNode() {
  const current = camera.value
  const selection = playback.selectedNode.value
  if (!props.writeBlocked && current && selection)
    store.addCameraNode(current.id, selection.nodeId)
}

function deleteNode() {
  const current = camera.value
  const selection = playback.selectedNode.value
  if (props.writeBlocked || !current || !selection)
    return
  store.deleteCameraNode(current.id, selection.nodeId)
  playback.clearSelection()
}
</script>

<template>
  <div class="director-timeline__inspector" :class="{ 'is-write-blocked': writeBlocked }">
    <template v-if="playback.selectedHandle.value">
      <span class="director-timeline__hint">{{ t('在 3D 视口里拖手柄调曲线') }}</span>
    </template>

    <template v-else-if="selectedNodeIndex >= 0">
      <span class="director-timeline__hint">
        {{ getNodeLabel(selectedNodeIndex) }} · {{ formatPlayheadTime(startTimes[selectedNodeIndex] ?? 0) }}
      </span>
      <button type="button" class="director-timeline__button" :disabled="writeBlocked" @click="insertNode()">
        <UIcon name="i-lucide-plus" class="size-3.5" />
        <span>{{ t('在其后插入') }}</span>
      </button>
      <button type="button" class="director-timeline__button" :disabled="writeBlocked" @click="deleteNode()">
        <UIcon name="i-lucide-trash-2" class="size-3.5" />
        <span>{{ t('删除节点') }}</span>
      </button>
    </template>

    <template v-else-if="selectedSegment">
      <label class="director-timeline__field">
        <span>{{ t('时长') }}</span>
        <input
          type="number"
          :aria-label="t('时长')"
          :value="selectedSegment.duration"
          :disabled="writeBlocked"
          :min="MIN_SEGMENT_DURATION"
          step="0.1"
          @change="onDuration"
        >
        <span>{{ t('秒') }}</span>
      </label>

      <label class="director-timeline__field">
        <span>{{ t('缓动') }}</span>
        <StudioSelect
          size="compact"
          placement="up"
          :model-value="selectedSegment.easing"
          :options="EASING_OPTIONS.map(item => ({ value: item.value, label: t(item.label) }))"
          :disabled="writeBlocked"
          :sr-label="t('缓动')"
          @update:model-value="patchSegment({ easing: $event as CameraSegmentEasing })"
        />
      </label>

      <label class="director-timeline__field">
        <span>{{ t('停顿') }}</span>
        <input
          type="number"
          :aria-label="t('停顿')"
          :value="selectedSegment.holdAfter"
          :disabled="writeBlocked"
          min="0"
          step="0.1"
          @change="onHold"
        >
        <span>{{ t('秒') }}</span>
      </label>

      <button type="button" class="director-timeline__button" :disabled="writeBlocked" @click="toggleCurve()">
        {{ selectedSegment.curveMode === 'bezier' ? t('转回直线') : t('转为曲线') }}
      </button>
    </template>

    <span v-else class="director-timeline__hint">{{ t('点节点调时间，点运动段改时长和缓动') }}</span>
  </div>
</template>
