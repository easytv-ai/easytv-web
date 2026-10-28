<script setup lang="ts">
/**
 * 视口工具条（对应 open-director 的 ViewportToolbar.tsx，MIT）。
 *
 * 只做视口里的：变换模式、截图、取景比例与三分线、撤销 / 重做。
 * 加角色 / 几何体 / 机位在左侧目录里。
 *
 * 截图直接读画布的像素：TresCanvas 开了 preserveDrawingBuffer，
 * 所以 toDataURL 拿到的是上一帧的画面，不用自己插进渲染循环。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { captureActiveCameraShot } from '~/utils/director/capture-shot'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import type { ViewportAspectRatio } from '~/utils/director/schema'
import type { TransformMode } from '~/utils/director/store/state'
import DirectorAspectRatioPicker from './DirectorAspectRatioPicker.vue'
import { dispatchDirectorShortcut } from '~/utils/director/director-shortcuts'

const { t } = useI18n()
const store = useDirectorStore()
const playback = useCameraPlaybackStore()

const TRANSFORM_MODES: { mode: TransformMode, icon: string, label: string }[] = [
  { mode: 'translate', icon: 'i-lucide-move', label: '移动' },
  { mode: 'rotate', icon: 'i-lucide-rotate-3d', label: '旋转' },
  { mode: 'scale', icon: 'i-lucide-scaling', label: '缩放' },
]

const captureError = ref('')

const viewportAspectRatio = computed({
  get: () => store.state.value.viewportAspectRatio,
  set: (value: ViewportAspectRatio) => store.setViewportAspectRatio(value),
})

function onKey(event: KeyboardEvent) {
  dispatchDirectorShortcut(event, {
    undo: () => store.undo(),
    redo: () => store.redo(),
    copy: () => { store.copySelectedObjects() },
    paste: () => { store.pasteClipboardObjects() },
  })
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function captureCurrentShot() {
  captureError.value = ''
  const result = captureActiveCameraShot({
    canvas: playback.canvas.value,
    cameraId: store.project.value.activeCameraId,
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
</script>

<template>
  <div class="director-toolbar">
    <div class="director-toolbar__group">
      <button
        v-for="item in TRANSFORM_MODES"
        :key="item.mode"
        type="button"
        :class="{ 'is-on': store.state.value.transformMode === item.mode }"
        :aria-label="t(item.label)"
        @click="store.setTransformMode(item.mode)"
      >
        <UIcon :name="item.icon" class="size-3.5" />
        <span class="canvas-tip canvas-tip--up">{{ t(item.label) }}</span>
      </button>
    </div>

    <div class="director-toolbar__group">
      <button type="button" :disabled="store.readonly.value" :aria-label="t('截图')" @click="captureCurrentShot()">
        <UIcon name="i-lucide-camera" class="size-3.5" />
        <span class="canvas-tip canvas-tip--up">{{ t('截图') }}</span>
      </button>
    </div>

    <div class="director-toolbar__group">
      <DirectorAspectRatioPicker v-model="viewportAspectRatio" />
      <button
        type="button"
        :class="{ 'is-on': store.state.value.viewportRuleOfThirdsEnabled }"
        :aria-label="t('三分线')"
        @click="store.setViewportRuleOfThirds(!store.state.value.viewportRuleOfThirdsEnabled)"
      >
        <UIcon name="i-lucide-grid-3x3" class="size-3.5" />
        <span class="canvas-tip canvas-tip--up">{{ t('三分线') }}</span>
      </button>
    </div>

    <div class="director-toolbar__group">
      <button
        type="button"
        :disabled="!store.canUndo.value"
        :aria-label="t('撤销')"
        @click="store.undo()"
      >
        <UIcon name="i-lucide-undo-2" class="size-3.5" />
        <span class="canvas-tip canvas-tip--up">{{ t('撤销') }}</span>
      </button>
      <button
        type="button"
        :disabled="!store.canRedo.value"
        :aria-label="t('重做')"
        @click="store.redo()"
      >
        <UIcon name="i-lucide-redo-2" class="size-3.5" />
        <span class="canvas-tip canvas-tip--up">{{ t('重做') }}</span>
      </button>
    </div>

    <span v-if="captureError" class="director-toolbar__error">{{ captureError }}</span>
  </div>
</template>
