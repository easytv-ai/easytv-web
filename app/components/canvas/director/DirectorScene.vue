<script setup lang="ts">
/**
 * 场景根（复刻自 open-director 的 canvas/SceneRoot.tsx，MIT）。
 *
 * 整个场景挂在一个 group 下，场景设置里的位移、旋转、缩放作用在这个 group 上 ——
 * 这样"调整整个场景"就不用逐个改对象的 transform。
 */
import type { DirectorObject } from '~/utils/director/schema'
import { useDirectorStore } from '~/utils/director/use-director-store'
import DirectorObjectNode from './DirectorObjectNode.vue'
import DirectorCameraRig from './DirectorCameraRig.vue'
import DirectorCrowdRig from './DirectorCrowdRig.vue'
import DirectorCameraPath from './DirectorCameraPath.vue'
import DirectorPanorama from './DirectorPanorama.vue'
import { getEffectiveGroundOpacity } from '~/utils/director/panorama-texture'
import { resolveDirectorStudioLook } from '~/utils/director/studio-look'

const store = useDirectorStore()
const { isDark } = useTheme()

const scene = computed(() => store.project.value.scene)
const studioLook = computed(() => resolveDirectorStudioLook(isDark.value, scene.value.backgroundColor))
const objects = computed(() => store.project.value.objects)

/**
 * 有全景背景时地面透明度压到 0.1 以内。
 * 全景已经提供了地面，再叠一层不透明的灰面会把它盖住。
 */
const hasPanorama = computed(() => Boolean(store.project.value.panoramaAssetId))
const groundOpacity = computed(() => getEffectiveGroundOpacity(scene.value.groundOpacity, hasPanorama.value))

/** 机位在场景里另有线框表示，不走普通对象渲染 */
const renderableObjects = computed(() =>
  objects.value.filter(item => item.visible && item.kind !== 'camera'))

const sceneScale = computed<[number, number, number]>(() => [scene.value.scale, scene.value.scale, scene.value.scale])

/** 场景里所有群众组的 id */
const crowdIds = computed(() => [...new Set(
  objects.value.map(item => item.crowdId).filter((id): id is string => typeof id === 'string'),
)])

/** 组里只要有一个成员被锁，整组就不给拖 */
function crowdLocked(crowdId: string) {
  return objects.value.some(item => item.crowdId === crowdId && item.locked)
}

/**
 * 机位只在导演视角里画线框：切到机位视角时是「从这台机位看出去」，
 * 再把它自己画出来就会糊在镜头前面。
 */
const visibleCameras = computed(() => {
  if (store.state.value.viewMode !== 'director')
    return []
  const objectByCameraId = new Map(
    store.project.value.objects
      .filter(item => item.kind === 'camera' && item.linkedCameraId)
      .map(item => [item.linkedCameraId as string, item]),
  )
  return store.project.value.cameras
    .map(camera => ({ camera, object: objectByCameraId.get(camera.id) }))
    .filter(({ object }) => object?.visible ?? true)
})

/**
 * 拖拽期间把改动合成一步撤销：gizmo 每帧都在提交，不合并的话撤销栈会被
 * 同一次拖拽的中间态塞满，撤销一次只退一帧。
 */
function onDragChange(dragging: boolean) {
  if (dragging)
    store.beginBatch()
  else
    store.endBatch()
}

/** 点中群众里的任意一个就选中整组，单独调整成员要去场景树里点 */
function onSelect(object: DirectorObject) {
  if (object.kind === 'character' && object.crowdId) {
    store.selectCrowd(object.crowdId)
    return
  }
  store.selectObject(object.id)
}
</script>

<template>
  <TresGroup :position="scene.position" :rotation="scene.rotation" :scale="sceneScale">
    <!--
      地面用 BasicMaterial 不吃光照：它只是个参考平面，跟着灯光变明暗反而碍事。
      polygonOffset 把它往后推一点，免得和贴地的物体打架闪烁。

      点地面等于取消选中：地面铺满 200x200，视口里点"空白"其实都点在它上面，
      TresCanvas 的 pointermissed 基本不会触发。
    -->
    <DirectorPanorama />

    <TresMesh
      v-if="scene.showGround"
      name="preview-omit"
      :position="[0, scene.groundHeight, 0]"
      :rotation="[-Math.PI / 2, 0, 0]"
      @click="store.openSceneInspector()"
    >
      <TresPlaneGeometry :args="[200, 200]" />
      <TresMeshBasicMaterial
        :color="studioLook.ground"
        :opacity="groundOpacity"
        :transparent="true"
        :polygon-offset="true"
        :polygon-offset-factor="1"
        :polygon-offset-units="1"
      />
    </TresMesh>

    <!--
      群众成员不给单独的 gizmo（transformable 里排掉 crowdId）：整组的控件由
      DirectorCrowdRig 统一提供一个，否则组里每个人身上都会叠一套三轴控件。
      选中轮廓仍然全组亮着，作为"这一组被选中了"的反馈。
    -->
    <DirectorObjectNode
      v-for="item in renderableObjects"
      :key="item.id"
      :object="item"
      :selected="item.crowdId ? store.state.value.selectedCrowdId === item.crowdId : store.state.value.selectedObjectId === item.id"
      :show-label="scene.showLabels"
      :transform-mode="store.state.value.transformMode"
      :transformable="!item.locked && !item.crowdId && store.state.value.viewMode === 'director'"
      :translation-snap="scene.snapToGrid ? 1 : null"
      @select="onSelect"
      @transform="(id, patch) => store.updateObjectTransform(id, patch)"
      @drag-change="onDragChange"
    />

    <DirectorCrowdRig
      v-for="crowdId in crowdIds"
      :key="crowdId"
      :crowd-id="crowdId"
      :objects="objects"
      :selected="store.state.value.selectedCrowdId === crowdId"
      :transformable="!crowdLocked(crowdId) && store.state.value.viewMode === 'director'"
      :transform-mode="store.state.value.transformMode"
      :translation-snap="scene.snapToGrid ? 1 : null"
      @transform="(id, patch) => store.updateCrowdTransform(id, patch)"
      @drag-change="onDragChange"
    />

    <DirectorCameraRig
      v-for="{ camera, object } in visibleCameras"
      :key="camera.id"
      :camera="camera"
      :object="object"
      :selected="store.state.value.selectedObjectId === object?.id"
      :transformable="!!object && !object.locked && store.state.value.viewMode === 'director'"
      :transform-mode="store.state.value.transformMode"
      :translation-snap="scene.snapToGrid ? 1 : null"
      @select="store.selectObject($event)"
      @transform="(id, patch) => store.updateObjectTransform(id, patch)"
      @drag-change="onDragChange"
    />

    <!-- 运镜路径也只在导演视角画：机位视角下它会横在自己镜头前面 -->
    <DirectorCameraPath
      v-for="{ camera } in visibleCameras"
      :key="`path-${camera.id}`"
      :camera="camera"
      :active="store.project.value.activeCameraId === camera.id"
    />
  </TresGroup>
</template>
