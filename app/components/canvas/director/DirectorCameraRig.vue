<script setup lang="ts">
/**
 * 导演视角里的机位（复刻自 open-director 的 canvas/SceneRoot.tsx，MIT）。
 *
 * 机位本身不可见，画成线框：机身 + 镜头 + 胶片盘，再加一个视锥表示取景范围。
 * 亮色背景下浅色 1px 线几乎隐掉，所以机身铺实心、取景框铺半透明面，颜色跟主题走。
 */
import { shallowRef, watchEffect } from 'vue'
import { TransformControls } from '@tresjs/cientos'
import { BufferAttribute, BufferGeometry, DoubleSide, Euler, LineBasicMaterial, LineSegments, Matrix4, Quaternion, Vector3 } from 'three'
import type { Group } from 'three'
import type { DirectorCameraShot, DirectorObject, DirectorTransform } from '~/utils/director/schema'
import type { TransformMode } from '~/utils/director/store/state'
import {
  getCameraBodySolid,
  getCameraBodyWireframe,
  getCameraFrustumFarPlane,
  getCameraFrustumWireframe,
  getCameraHitBox,
  getCameraLensSolid,
  toLineSegmentPositions,
} from '~/utils/director/camera-wireframe'
import { resolveDirectorStudioLook } from '~/utils/director/studio-look'

const props = defineProps<{
  camera: DirectorCameraShot
  /** 场景树里那个对应的机位对象，可能不存在（数据不一致时） */
  object?: DirectorObject
  selected: boolean
  transformable: boolean
  transformMode: TransformMode
  translationSnap: number | null
}>()

const emit = defineEmits<{
  select: [objectId: string]
  transform: [id: string, patch: Partial<DirectorTransform>]
  'drag-change': [dragging: boolean]
}>()

const groupRef = shallowRef<Group | null>(null)
const showGizmo = computed(() => props.selected && props.transformable && Boolean(groupRef.value) && Boolean(props.object))
/** 机位没有缩放意义，缩放模式仍给位移，免得选中后控件突然没了 */
const gizmoMode = computed(() => props.transformMode === 'scale' ? 'translate' : props.transformMode)

function onObjectChange() {
  const group = groupRef.value
  if (!group || !props.object)
    return

  const position: DirectorTransform['position'] = [group.position.x, group.position.y, group.position.z]
  if (gizmoMode.value === 'rotate') {
    emit('transform', props.object.id, {
      position,
      rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    })
    return
  }
  emit('transform', props.object.id, { position })
}

function onSelect() {
  if (props.object)
    emit('select', props.object.id)
}

const { isDark } = useTheme()
const look = computed(() => resolveDirectorStudioLook(isDark.value))
const lineColor = computed(() => props.selected ? look.value.cameraSelected : look.value.cameraLine)

const bodySolid = getCameraBodySolid()
const lensSolid = getCameraLensSolid()
const hitBox = getCameraHitBox()
const farPlane = computed(() => getCameraFrustumFarPlane(props.camera.fov))

function buildLineSegments(positions: Float32Array, color: string, opacity: number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const material = new LineBasicMaterial({ color, transparent: opacity < 1, opacity })
  return new LineSegments(geometry, material)
}

function dispose(item: LineSegments | null) {
  if (!item)
    return
  item.geometry.dispose()
  ;(item.material as LineBasicMaterial).dispose()
}

const bodyLines = shallowRef<LineSegments | null>(null)
const frustumLines = shallowRef<LineSegments | null>(null)

watchEffect(() => {
  dispose(bodyLines.value)
  dispose(frustumLines.value)
  bodyLines.value = buildLineSegments(
    toLineSegmentPositions(getCameraBodyWireframe()),
    lineColor.value,
    1,
  )
  frustumLines.value = buildLineSegments(
    toLineSegmentPositions(getCameraFrustumWireframe(props.camera.fov)),
    lineColor.value,
    0.92,
  )
})

/**
 * 机位朝向：由机身位置看向注视点。用欧拉角而不是四元数传给 TresGroup，
 * 两者等价 —— 视线垂直时的 up 共线已经在下面处理过，碰不到万向锁。
 * three 的 lookAt 让物体的 -Z 对准目标，而线框是照着 +Z 画的，
 * 所以这里对准的是「反方向」，正好把线框转到朝向目标。
 */
const rotation = computed<[number, number, number]>(() => {
  const origin = new Vector3(...props.camera.transform.position)
  const direction = new Vector3(...props.camera.target).sub(origin)
  if (direction.lengthSq() === 0)
    return [0, 0, 0]

  const forward = direction.normalize()
  // 视线几乎垂直时 up 会和它共线，换一根参考轴
  const up = Math.abs(forward.y) > 0.999 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const matrix = new Matrix4().lookAt(origin, origin.clone().sub(forward), up)
  const euler = new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(matrix))
  return [euler.x, euler.y, euler.z]
})

onBeforeUnmount(() => {
  dispose(bodyLines.value)
  dispose(frustumLines.value)
})
</script>

<template>
  <TresGroup ref="groupRef" :position="camera.transform.position" :rotation="rotation">
    <TresMesh :position="bodySolid.center" @click.stop="onSelect()">
      <TresBoxGeometry :args="bodySolid.size" />
      <TresMeshBasicMaterial :color="look.cameraFill" />
    </TresMesh>

    <!-- 锥体默认朝 +Y，转成朝 +Z，和线框镜头尖对齐 -->
    <TresMesh
      :position="lensSolid.position"
      :rotation="[-Math.PI / 2, 0, 0]"
      @click.stop="onSelect()"
    >
      <TresConeGeometry :args="[lensSolid.radius, lensSolid.length, 4]" />
      <TresMeshBasicMaterial :color="look.cameraFill" />
    </TresMesh>

    <TresMesh :position="farPlane.position" @click.stop="onSelect()">
      <TresPlaneGeometry :args="farPlane.size" />
      <TresMeshBasicMaterial
        :color="look.cameraFrustumFill"
        :transparent="true"
        :opacity="selected ? 0.22 : 0.14"
        :side="DoubleSide"
        :depth-write="false"
      />
    </TresMesh>

    <primitive v-if="bodyLines" :object="bodyLines" />
    <primitive v-if="frustumLines" :object="frustumLines" />

    <!-- 命中区：线框太细，射线几乎点不中，套一个看不见的盒子接点击 -->
    <TresMesh :position="hitBox.center" @click.stop="onSelect()">
      <TresBoxGeometry :args="hitBox.size" />
      <TresMeshBasicMaterial :visible="false" />
    </TresMesh>
  </TresGroup>

  <TransformControls
    v-if="showGizmo"
    :object="groupRef!"
    :mode="gizmoMode"
    :translation-snap="translationSnap ?? undefined"
    @object-change="onObjectChange"
    @dragging="(value: boolean) => emit('drag-change', value)"
  />
</template>
