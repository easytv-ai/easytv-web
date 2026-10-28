<script setup lang="ts">
/**
 * 运镜播放引擎（复刻自 open-director 的 CameraPlaybackController.tsx，MIT）。
 *
 * 播放时按真实时间推进播放头，把求值出来的姿态写进当前机位；不播放时
 * 播放头一变（拖时间轴）也立即求值一次，机位跟着跳过去。
 *
 * 不渲染任何东西，只是挂在 TresCanvas 里蹭帧循环 —— useLoop 必须在画布
 * 子树里调用，所以这个组件不能提到视口外面去。
 */
import { onBeforeUnmount, watch } from 'vue'
import { useLoop, useTres } from '@tresjs/core'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { evaluateCameraPath, getCameraPathDuration } from '~/utils/director/camera-path'
import { renderPreviewPass, type PreviewControlOutput } from '~/utils/director/export/preview-pass'

const store = useDirectorStore()
const playback = useCameraPlaybackStore()
const { scene, camera, renderer } = useTres()

function renderControlPass(output: PreviewControlOutput) {
  const currentScene = scene.value
  const currentCamera = camera.value
  if (!currentScene || !currentCamera)
    throw new Error('视口还没准备好')
  return renderPreviewPass({
    renderer,
    scene: currentScene,
    camera: currentCamera,
    output,
  })
}

playback.setControlPass(renderControlPass)
onBeforeUnmount(() => playback.setControlPass(null))

function activeCamera() {
  const project = store.project.value
  return project.cameras.find(item => item.id === project.activeCameraId) ?? null
}

/** 当前机位路径的总时长；没有节点就是 0 */
function pathDuration() {
  const camera = activeCamera()
  if (!camera?.nodes?.length)
    return 0
  return getCameraPathDuration(camera.nodes, camera.segments ?? [])
}

/** 把某个时刻的姿态写进机位。写的是 commitUi，不占撤销步数 */
function applyPoseAt(time: number) {
  const camera = activeCamera()
  if (!camera?.nodes?.length)
    return

  const pose = evaluateCameraPath(camera.nodes, camera.segments ?? [], time)
  if (!pose)
    return

  store.syncCameraPose(camera.id, {
    position: [pose.position.x, pose.position.y, pose.position.z],
    rotation: [pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w],
    fov: pose.fov,
  })
}

// 不播放时拖时间轴：播放头一变就求值一次
watch(() => playback.playheadTime.value, (time) => {
  if (playback.isPlaying.value)
    return
  applyPoseAt(time)
})

const { onBeforeRender } = useLoop()

onBeforeRender(({ delta }: { delta: number }) => {
  // 帧循环里一律现读状态，不要闭包捕获：回调注册一次就长期存在，
  // 捕获到的是注册那一刻的值，「停了还在动」「重播直接跳到末尾」都是这么来的
  if (!playback.isPlaying.value)
    return

  const total = pathDuration()
  if (total <= 0) {
    playback.pause()
    return
  }

  const next = Math.min(playback.playheadTime.value + delta, total)
  applyPoseAt(next)
  playback.setPlayheadTime(next)

  // 走到头就停在末尾，不循环 —— 导出录制靠这一下判断录完了
  if (next >= total)
    playback.pause()
})
</script>

<template>
  <!-- 只跑逻辑，不画东西 -->
</template>
