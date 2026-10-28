<script setup lang="ts">
/**
 * 导演台 3D 视口。
 *
 * three 会碰 window，整块必须 client-only —— 调用方用 <ClientOnly> 包住，
 * 别直接挂在 SSR 页面里。
 *
 * 场景内容来自注入的 store（阶段 1 搬好的数据层），这里只负责画。
 */
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import type { PerspectiveCamera } from 'three'
import { Grid, OrbitControls } from '@tresjs/cientos'
import { TresCanvas } from '@tresjs/core'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { getCameraViewSnapshotFromShot } from '~/utils/director/camera-geometry'
import { resolveDirectorStudioLook } from '~/utils/director/studio-look'
import { getSceneOverviewPose } from '~/utils/director/scene-overview'
import DirectorScene from './DirectorScene.vue'
import DirectorViewportToolbar from './DirectorViewportToolbar.vue'
import DirectorAspectFrame from './DirectorAspectFrame.vue'
import DirectorPlaybackController from './DirectorPlaybackController.vue'

const store = useDirectorStore()
const playback = useCameraPlaybackStore()

/** 机位视角：用当前机位的取景参数驱动这台相机 */
const activeShot = computed(() => {
  const id = store.project.value.activeCameraId
  return store.project.value.cameras.find(item => item.id === id) ?? null
})

const inCameraView = computed(() => store.state.value.viewMode === 'camera' && Boolean(activeShot.value))

/** 离开截封面时拉远看全场，不跟手势里的轨道相机走 */
const overviewPose = ref<{ position: [number, number, number], target: [number, number, number], fov: number } | null>(null)

const viewPose = computed(() => {
  if (!inCameraView.value || !activeShot.value)
    return overviewPose.value ?? { position: CAMERA_POSITION, target: CAMERA_TARGET, fov: 45 }
  const snapshot = getCameraViewSnapshotFromShot(activeShot.value)
  return { position: snapshot.position, target: snapshot.target, fov: snapshot.fov }
})

const props = defineProps<{
  /** 不传则跟着站点亮/暗主题走 */
  clearColor?: string
}>()

const { isDark } = useTheme()

const studioLook = computed(() =>
  resolveDirectorStudioLook(isDark.value, store.project.value.scene.backgroundColor))

const sceneClearColor = computed(() => props.clearColor ?? studioLook.value.sky)

/*
 * 导演视角的初始位置。要能同时看到原点的角色和默认机位（在 z≈7.2 处）——
 * 之前用 [4.5, 3.2, 5.5] 看向原点，机位和视线夹角约 68 度、远在 45 度视场之外，
 * 场景里明明有机位却一个都看不见。
 */
const CAMERA_POSITION: [number, number, number] = [9, 5.5, 11]
const CAMERA_TARGET: [number, number, number] = [0, 1, 3]

const ready = ref(false)

/**
 * 把画布登记到 playback store，导出录制要对着它开 captureStream。
 *
 * 从自己的根节点里找 canvas，不用全局选择器：一张画布上可以有好几个导演台，
 * 全局选择器会抓到第一个，录出来是别人的镜头。
 */
const rootRef = ref<HTMLElement | null>(null)

function onCanvasReady() {
  ready.value = true
  playback.setCanvas(rootRef.value?.querySelector('canvas') ?? null)
}

onBeforeUnmount(() => playback.setCanvas(null))

/**
 * OrbitControls 是直接改相机 position 的，切到机位视角时光改模板绑定没用 ——
 * 相机还停在轨道控制留下的位置上，画面里什么都看不到。
 * 所以这里拿着相机引用，视角一变就手动把它放到机位的取景点上。
 */
const cameraRef = shallowRef<PerspectiveCamera | null>(null)

function applyViewPose() {
  const camera = cameraRef.value
  if (!camera)
    return
  camera.position.set(...viewPose.value.position)
  camera.fov = viewPose.value.fov
  camera.lookAt(...viewPose.value.target)
  camera.updateProjectionMatrix()
}

watch([() => viewPose.value, () => inCameraView.value], () => {
  if (!inCameraView.value && !overviewPose.value)
    return
  applyViewPose()
}, { immediate: true })

/** 把导演视角拉到能看见场上所有人，给卡片封面用 */
function frameOverview() {
  store.setViewMode('director')
  overviewPose.value = getSceneOverviewPose(store.project.value.objects)
  applyViewPose()
}

defineExpose({ frameOverview })
</script>

<template>
  <div ref="rootRef" class="director-viewport">
    <!-- 不要加 window-size：那会让画布铺满整个窗口盖住外层 UI，这里跟着容器走 -->
    <!--
      preserve-drawing-buffer：工具条的截图直接读画布像素，不开的话
      toDataURL 拿到的是一张空白图（绘制完就被清掉了）
    -->
    <TresCanvas
      :preserve-drawing-buffer="true"
      :clear-color="sceneClearColor"
      class="director-viewport__canvas"
      @ready="onCanvasReady"
      @pointermissed="store.openSceneInspector()"
    >
      <TresPerspectiveCamera ref="cameraRef" :position="viewPose.position" :fov="viewPose.fov" />
      <!-- 机位视角下关掉轨道控制：这时画面属于那台机位，不该被拖动 -->
      <OrbitControls :target="viewPose.target" :enabled="!inCameraView && !overviewPose" make-default />

      <!-- 地面网格：大格 5 米、小格 1 米，和上游的场景尺度对齐 -->
      <Grid
        name="preview-omit"
        :args="[40, 40]"
        :cell-size="1"
        :cell-thickness="0.6"
        :cell-color="studioLook.gridCell"
        :section-size="5"
        :section-thickness="1.1"
        :section-color="studioLook.gridSection"
        :infinite-grid="true"
        :fade-distance="45"
        :fade-strength="1.4"
      />

      <DirectorScene />

      <!-- 播放引擎要用 useLoop，必须挂在画布子树里 -->
      <DirectorPlaybackController />

      <TresAmbientLight :intensity="isDark ? 1.1 : 0.95" />
      <TresDirectionalLight :position="[4, 8, 5]" :intensity="isDark ? 2.2 : 1.7" />
    </TresCanvas>

    <DirectorAspectFrame />

    <div class="director-view-switch" role="group" :aria-label="$t('视角')">
      <button
        type="button"
        :class="{ 'is-on': !inCameraView }"
        @click="store.setViewMode('director')"
      >
        {{ $t('导演视角') }}
      </button>
      <button
        type="button"
        :class="{ 'is-on': inCameraView }"
        :disabled="!activeShot"
        @click="store.setViewMode('camera')"
      >
        {{ $t('机位视角') }}
      </button>
    </div>

    <DirectorViewportToolbar />

    <p v-if="!ready" class="director-viewport__tip">{{ $t('视口加载中…') }}</p>
  </div>
</template>
