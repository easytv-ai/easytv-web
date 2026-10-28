<script setup lang="ts">
/**
 * 机位属性面板（复刻自 open-director 的 CameraPanel.tsx，MIT）。
 *
 * 「截当前机位」和视口工具条走同一条通道：读视口画布像素，记到当前机位上。
 * 离开导演台时由会话把这些截图送回画布节点。
 */
import { computed, ref } from 'vue'
import { captureActiveCameraShot } from '~/utils/director/capture-shot'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { isCameraFocusableObject, isLinkedCameraLocked, getDirectorObjectFocusTarget } from '~/utils/director/object-focus'
import { labelYOf } from '~/utils/director/body-types'
import type { DirectorCameraCapture } from '~/utils/director/schema'
import DirectorPanelCard from './DirectorPanelCard.vue'
import DirectorTextField from './DirectorTextField.vue'
import DirectorSelectField from './DirectorSelectField.vue'
import DirectorAxisGroup from './DirectorAxisGroup.vue'
import DirectorRangeField from './DirectorRangeField.vue'
import DirectorSection from './DirectorSection.vue'
import DirectorCaptureViewer from './DirectorCaptureViewer.vue'

const { t } = useI18n()
const store = useDirectorStore()
const playback = useCameraPlaybackStore()
const captureError = ref('')

const FOV = { min: 10, max: 120, step: 0.1 } as const
/** 注视目标下拉里「手动坐标」那一项的取值 */
const MANUAL_TARGET = 'manual'

const activeTab = ref('properties')
const viewerCapture = ref<DirectorCameraCapture | null>(null)

const tabs = computed(() => [
  { id: 'properties', label: t('属性') },
  { id: 'captures', label: t('机位截图') },
])

const cameras = computed(() => store.project.value.cameras)

const camera = computed(() =>
  cameras.value.find(item => item.id === store.project.value.activeCameraId) ?? null,
)

const writeBlocked = computed(() =>
  store.readonly.value || isLinkedCameraLocked(store.project.value.objects, camera.value?.id),
)

const cameraOptions = computed(() => cameras.value.map(item => ({ value: item.id, label: item.name })))

/** 能当注视目标的对象：机位不能看自己，空的占位对象也排掉 */
const focusableObjects = computed(() => store.project.value.objects.filter(isCameraFocusableObject))

const targetOptions = computed(() => [
  { value: MANUAL_TARGET, label: t('手动坐标') },
  ...focusableObjects.value.map(item => ({ value: `object:${item.id}`, label: item.name })),
])

const targetValue = computed(() => {
  const current = camera.value
  return current?.targetMode === 'object' && current.targetObjectId
    ? `object:${current.targetObjectId}`
    : MANUAL_TARGET
})

/** 每个机位一组，只留有截图的 */
const captureGroups = computed(() =>
  cameras.value
    .map(item => ({ camera: item, captures: item.captures ?? [] }))
    .filter(group => group.captures.length > 0),
)

const currentCaptures = computed(() => camera.value?.captures ?? [])

function onTargetChange(value: string) {
  const current = camera.value
  if (!current || writeBlocked.value)
    return

  if (value === MANUAL_TARGET) {
    store.updateCamera(current.id, { targetMode: 'manual', targetObjectId: null })
    return
  }

  const object = focusableObjects.value.find(item => `object:${item.id}` === value)
  // 选中的对象刚好被删了：退回手动，不要把机位锁在一个不存在的目标上
  if (!object) {
    store.updateCamera(current.id, { targetMode: 'manual', targetObjectId: null })
    return
  }

  store.updateCamera(current.id, {
    targetMode: 'object',
    targetObjectId: object.id,
    target: getDirectorObjectFocusTarget(object, labelYOf),
  })
}

/** 手动改注视坐标就意味着脱离锁定对象 */
function onTargetCoordinate(target: [number, number, number]) {
  const current = camera.value
  if (!current || writeBlocked.value)
    return
  store.updateCamera(current.id, { targetMode: 'manual', targetObjectId: null, target })
}

function onName(name: string) {
  const current = camera.value
  if (!current || writeBlocked.value)
    return
  store.updateCamera(current.id, { name })
}

function onFov(fov: number) {
  const current = camera.value
  if (!current || writeBlocked.value)
    return
  store.updateCamera(current.id, { fov })
}

function onPosition(position: [number, number, number]) {
  const current = camera.value
  if (!current || writeBlocked.value)
    return
  store.updateCamera(current.id, { transform: { ...current.transform, position } })
}

function onCaptureShot() {
  if (writeBlocked.value) {
    captureError.value = t(store.readonly.value ? '只读画布不能修改' : 'canvas.lock.lock')
    return
  }
  captureError.value = ''
  const result = captureActiveCameraShot({
    canvas: playback.canvas.value,
    cameraId: camera.value?.id,
    addCaptures: (cameraId, dataUrls) => store.addCameraCaptures(cameraId, dataUrls),
  })
  if (result === 'viewport-not-ready')
    captureError.value = t('视口还没准备好')
  else if (result === 'no-camera')
    captureError.value = t('没有可用机位')
  else if (result === 'tainted')
    captureError.value = t('截图失败，画面里可能有跨域素材')
  else if (result === 'rejected' && store.readonly.value)
    captureError.value = t('只读画布不能修改')
}

function onDeleteCapture(captureId: string) {
  if (writeBlocked.value)
    return
  if (viewerCapture.value?.id === captureId)
    viewerCapture.value = null
  store.deleteCameraCapture(captureId)
}

function onClearCaptures() {
  if (writeBlocked.value)
    return
  viewerCapture.value = null
  store.clearCameraCaptures()
}
</script>

<template>
  <DirectorPanelCard
    v-if="camera"
    :title="t('摄像机')"
    :sr-label="t('机位属性面板')"
    :tabs="tabs"
    :active-tab="activeTab"
    @update:active-tab="activeTab = $event"
  >
    <template #head-extra>
      <slot name="head-extra" />
    </template>
    <template v-if="activeTab === 'properties'">
      <DirectorSelectField
        :label="t('切换机位')"
        :sr-label="t('切换机位')"
        :model-value="camera.id"
        :options="cameraOptions"
        @update:model-value="store.setActiveCamera($event)"
      />

      <div class="director-camera-edits" :class="{ 'is-write-blocked': writeBlocked }">
        <DirectorTextField
          :label="t('名称')"
          :sr-label="t('机位名称')"
          :model-value="camera.name"
          @update:model-value="onName"
        />

        <DirectorAxisGroup
          :label="t('位置')"
          :sr-prefix="t('机位位置')"
          :model-value="camera.transform.position"
          :step="0.1"
          @update:model-value="onPosition"
        />

        <DirectorSelectField
          :label="t('注视目标')"
          :sr-label="t('注视目标')"
          :model-value="targetValue"
          :options="targetOptions"
          @update:model-value="onTargetChange"
        />

        <DirectorAxisGroup
          :label="t('注视坐标')"
          :sr-prefix="t('注视坐标')"
          :model-value="camera.target"
          :step="0.1"
          @update:model-value="onTargetCoordinate"
        />

        <DirectorRangeField
          :label="t('视野角度')"
          :sr-label="t('视野角度')"
          :model-value="camera.fov"
          :min="FOV.min"
          :max="FOV.max"
          :step="FOV.step"
          suffix="°"
          @update:model-value="onFov"
        />

        <DirectorSection :title="t('机位截图')">
          <button type="button" class="director-capture-shoot" :disabled="writeBlocked" @click="onCaptureShot()">
            <UIcon name="i-lucide-camera" class="size-3.5" />
            <span>{{ t('截当前机位') }}</span>
          </button>
          <p v-if="captureError" class="director-capture-error" role="status">{{ captureError }}</p>
          <div v-if="!currentCaptures.length" class="director-capture-empty">
            {{ t('这个机位还没有截图。') }}
          </div>
          <div v-else class="director-capture-grid" :aria-label="t('机位截图')">
            <figure v-for="capture in currentCaptures" :key="capture.id" class="director-capture">
              <button type="button" class="director-capture__hit" @click="viewerCapture = capture">
                <img :src="capture.dataUrl" :alt="capture.name">
              </button>
              <button
                type="button"
                class="director-capture__delete"
                :disabled="writeBlocked"
                :aria-label="`${t('删除截图')} ${capture.name}`"
                @click="onDeleteCapture(capture.id)"
              >
                <UIcon name="i-lucide-trash-2" class="size-3.5" />
              </button>
              <figcaption>{{ capture.name }}</figcaption>
            </figure>
          </div>
        </DirectorSection>
      </div>
    </template>

    <template v-else>
      <button type="button" class="director-capture-shoot" :disabled="writeBlocked" @click="onCaptureShot()">
        <UIcon name="i-lucide-camera" class="size-3.5" />
        <span>{{ t('截当前机位') }}</span>
      </button>
      <p v-if="captureError" class="director-capture-error" role="status">{{ captureError }}</p>
      <div v-if="!captureGroups.length" class="director-capture-empty" role="status">
        <UIcon name="i-lucide-images" class="size-4" />
        <span>{{ t('还没有任何机位截图。') }}</span>
      </div>

      <section
        v-for="group in captureGroups"
        :key="group.camera.id"
        class="director-capture-group"
        :aria-label="group.camera.name"
      >
        <h4>{{ group.camera.name }}</h4>
        <div class="director-capture-grid">
          <figure v-for="capture in group.captures" :key="capture.id" class="director-capture">
            <button type="button" class="director-capture__hit" @click="viewerCapture = capture">
              <img :src="capture.dataUrl" :alt="capture.name">
            </button>
            <button
              type="button"
              class="director-capture__delete"
              :disabled="writeBlocked"
              :aria-label="`${t('删除截图')} ${capture.name}`"
              @click="onDeleteCapture(capture.id)"
            >
              <UIcon name="i-lucide-trash-2" class="size-3.5" />
            </button>
            <figcaption>{{ capture.name }}</figcaption>
          </figure>
        </div>
      </section>
    </template>

    <template v-if="activeTab === 'captures' && captureGroups.length" #footer>
      <button type="button" class="director-capture-clear" :disabled="writeBlocked" @click="onClearCaptures()">
        <UIcon name="i-lucide-trash-2" class="size-3.5" />
        <span>{{ t('清空全部') }}</span>
      </button>
    </template>
  </DirectorPanelCard>

  <DirectorCaptureViewer
    v-if="viewerCapture"
    :capture="viewerCapture"
    @close="viewerCapture = null"
  />
</template>
