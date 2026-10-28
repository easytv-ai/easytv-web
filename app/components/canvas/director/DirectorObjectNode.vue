<script setup lang="ts">
/**
 * 场景里的一个对象（复刻自 open-director 的 canvas/SceneRoot.tsx，MIT）。
 *
 * 几何体按类型换几何；角色默认是 UE4 素体；带 assetRefId 的走导入模型。
 * 选中时不换材质，而是叠一层线框轮廓：换材质会把用户配的颜色盖掉。
 *
 * 点击事件必须挂在各个 mesh 上，不能挂在外层 group —— group 自己没有几何体，
 * 拾取射线命中不了它。轮廓那层不挂，否则一次点击会触发两遍。
 */
import { shallowRef } from 'vue'
import { TransformControls } from '@tresjs/cientos'
import type { Group } from 'three'
import type { DirectorObject } from '~/utils/director/schema'
import type { TransformMode } from '~/utils/director/store/state'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { resolveMediaUrl } from '~/utils/media'
import DirectorMannequin from './DirectorMannequin.vue'
import DirectorImportedModel from './DirectorImportedModel.vue'

const props = defineProps<{
  object: DirectorObject
  selected: boolean
  showLabel: boolean
  transformMode: TransformMode
  /** 锁定的对象、机位视角下都不给拖 */
  transformable: boolean
  /** 开了网格吸附时传 1，否则 null */
  translationSnap: number | null
}>()

const emit = defineEmits<{
  select: [object: DirectorObject]
  transform: [id: string, patch: { position: [number, number, number], rotation: [number, number, number], scale: [number, number, number] }]
  'drag-change': [dragging: boolean]
}>()

/**
 * 指向场景里那个真实的 three.Group，变换控制器要挂在它上面。
 *
 * 必须用 shallowRef：普通 ref 会把 three 对象深度响应式化包成 Proxy，
 * 射线检测遍历场景图时拿到的是代理而不是原对象，点选会整个失效 ——
 * 表现是场景照常渲染、但点什么都选不中。
 */
const groupRef = shallowRef<Group | null>(null)

const showGizmo = computed(() => props.selected && props.transformable && groupRef.value)


/**
 * 拖拽过程中把 group 的当前变换读回 store。
 * 这里读的是 three 对象被 gizmo 改过的值，不是 props —— props 是上一帧的状态。
 */
function onObjectChange() {
  const group = groupRef.value
  if (!group)
    return
  emit('transform', props.object.id, {
    position: [group.position.x, group.position.y, group.position.z],
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  })
}

/** 各几何体的尺寸和落地高度，和上游对齐 —— 都以底面贴地为准 */
const GEOMETRY_SPEC = {
  box: { y: 0.5, args: [1, 1, 1] as const },
  sphere: { y: 0.55, args: [0.55, 32, 16] as const },
  cylinder: { y: 0.6, args: [0.45, 0.45, 1.2, 32] as const },
  torus: { y: 0.14, args: [0.45, 0.14, 16, 48] as const },
  cone: { y: 0.55, args: [0.5, 1.1, 32] as const },
  // 棱锥就是四个面的圆锥
  pyramid: { y: 0.55, args: [0.55, 1.1, 4] as const },
} as const

const geometry = computed(() => {
  const type = props.object.geometryType
  return type ? GEOMETRY_SPEC[type] : null
})

const color = computed(() => props.object.color ?? '#d7e7ff')

/** 角色占位胶囊的高度，大致对齐 UE4 素体 */
const CHARACTER_HEIGHT = 1.1
const CHARACTER_RADIUS = 0.34

const isCharacter = computed(() => props.object.kind === 'character')

const store = useDirectorStore()
const importedAsset = computed(() => {
  const id = props.object.assetRefId
  if (!id)
    return null
  const asset = store.project.value.assets.find(item => item.id === id)
  if (!asset || asset.sourceType !== 'model' || !asset.url)
    return null
  return asset
})

const lookUrl = computed(() => {
  const id = props.object.lookAssetId
  if (!id)
    return ''
  const asset = store.project.value.assets.find(item => item.id === id)
  return asset?.sourceType === 'image' ? resolveMediaUrl(asset.url) : ''
})
</script>

<template>
  <TresGroup
    ref="groupRef"
    :position="object.transform.position"
    :rotation="object.transform.rotation"
    :scale="object.transform.scale"
  >
    <!-- 几何体道具 -->
    <TresMesh v-if="geometry && object.geometryType === 'box'" :position="[0, geometry.y, 0]" @click="emit('select', object)">
      <TresBoxGeometry :args="geometry.args" />
      <TresMeshStandardMaterial :color="color" :metalness="0.02" :roughness="0.68" />
    </TresMesh>
    <TresMesh v-else-if="geometry && object.geometryType === 'sphere'" :position="[0, geometry.y, 0]" @click="emit('select', object)">
      <TresSphereGeometry :args="geometry.args" />
      <TresMeshStandardMaterial :color="color" :metalness="0.02" :roughness="0.68" />
    </TresMesh>
    <TresMesh v-else-if="geometry && object.geometryType === 'cylinder'" :position="[0, geometry.y, 0]" @click="emit('select', object)">
      <TresCylinderGeometry :args="geometry.args" />
      <TresMeshStandardMaterial :color="color" :metalness="0.02" :roughness="0.68" />
    </TresMesh>
    <TresMesh
      v-else-if="geometry && object.geometryType === 'torus'"
      :position="[0, geometry.y, 0]"
      :rotation="[Math.PI / 2, 0, 0]"
      @click="emit('select', object)"
    >
      <TresTorusGeometry :args="geometry.args" />
      <TresMeshStandardMaterial :color="color" :metalness="0.02" :roughness="0.68" />
    </TresMesh>
    <TresMesh
      v-else-if="geometry && (object.geometryType === 'cone' || object.geometryType === 'pyramid')"
      :position="[0, geometry.y, 0]"
      @click="emit('select', object)"
    >
      <TresConeGeometry :args="geometry.args" />
      <TresMeshStandardMaterial :color="color" :metalness="0.02" :roughness="0.68" />
    </TresMesh>

    <!--
      导入的 GLB。命中盒按拟合后约 2 米的体量给，模型异步加载期间先露占位盒。
    -->
    <template v-else-if="importedAsset">
      <TresMesh :position="[0, 1, 0]" @click="emit('select', object)">
        <TresBoxGeometry :args="[2, 2, 2]" />
        <TresMeshBasicMaterial :visible="false" />
      </TresMesh>
      <Suspense>
        <DirectorImportedModel
          :key="importedAsset.url"
          :url="importedAsset.url"
          :object-id="isCharacter ? object.id : undefined"
          :rig="isCharacter ? object.characterRig : undefined"
          :body-type="isCharacter ? object.bodyType : undefined"
          :look-url="isCharacter ? lookUrl : undefined"
        />
        <template #fallback>
          <TresMesh :position="[0, 1, 0]">
            <TresBoxGeometry :args="[1.2, 2, 1.2]" />
            <TresMeshStandardMaterial :color="color" :metalness="0.04" :roughness="0.7" :transparent="true" :opacity="0.35" />
          </TresMesh>
        </template>
      </Suspense>
    </template>

    <!--
      角色素体。模型是异步加载的，Suspense 的 fallback 期间先摆一个胶囊占位，
      免得加载那一瞬间场景里凭空少一个人。
      点击挂在外层的命中盒上：素体是 SkinnedMesh，骨骼动起来之后
      逐面命中不稳，拿一个规整的盒子接点击可靠得多。
    -->
    <template v-else-if="isCharacter">
      <TresMesh
        :position="[0, CHARACTER_HEIGHT * 0.5 + CHARACTER_RADIUS, 0]"
        @click="emit('select', object)"
      >
        <TresCapsuleGeometry :args="[CHARACTER_RADIUS, CHARACTER_HEIGHT, 8, 16]" />
        <TresMeshBasicMaterial :visible="false" />
      </TresMesh>
      <Suspense>
        <DirectorMannequin :body-type="object.bodyType" :color="color" :rig="object.characterRig" :look-url="lookUrl" />
        <template #fallback>
          <TresMesh :position="[0, CHARACTER_HEIGHT * 0.5 + CHARACTER_RADIUS, 0]">
            <TresCapsuleGeometry :args="[CHARACTER_RADIUS, CHARACTER_HEIGHT, 8, 16]" />
            <TresMeshStandardMaterial :color="color" :metalness="0.05" :roughness="0.55" />
          </TresMesh>
        </template>
      </Suspense>
    </template>

    <!-- 选中轮廓：叠一层线框而不是换材质，免得盖掉用户配的颜色 -->
    <TresMesh
      v-if="selected && geometry"
      :position="[0, geometry.y, 0]"
      :rotation="object.geometryType === 'torus' ? [Math.PI / 2, 0, 0] : [0, 0, 0]"
      :scale="[1.06, 1.06, 1.06]"
    >
      <TresBoxGeometry v-if="object.geometryType === 'box'" :args="GEOMETRY_SPEC.box.args" />
      <TresSphereGeometry v-else-if="object.geometryType === 'sphere'" :args="GEOMETRY_SPEC.sphere.args" />
      <TresCylinderGeometry v-else-if="object.geometryType === 'cylinder'" :args="GEOMETRY_SPEC.cylinder.args" />
      <TresTorusGeometry v-else-if="object.geometryType === 'torus'" :args="GEOMETRY_SPEC.torus.args" />
      <TresConeGeometry v-else :args="GEOMETRY_SPEC.cone.args" />
      <TresMeshBasicMaterial color="#4f8eff" wireframe :transparent="true" :opacity="0.75" />
    </TresMesh>
    <TresMesh
      v-else-if="selected && importedAsset"
      :position="[0, 1, 0]"
      :scale="[1.04, 1.04, 1.04]"
    >
      <TresBoxGeometry :args="[2, 2, 2]" />
      <TresMeshBasicMaterial color="#4f8eff" wireframe :transparent="true" :opacity="0.75" />
    </TresMesh>
    <TresMesh
      v-else-if="selected && isCharacter"
      :position="[0, CHARACTER_HEIGHT * 0.5 + CHARACTER_RADIUS, 0]"
      :scale="[1.08, 1.05, 1.08]"
    >
      <TresCapsuleGeometry :args="[CHARACTER_RADIUS, CHARACTER_HEIGHT, 8, 16]" />
      <TresMeshBasicMaterial color="#4f8eff" wireframe :transparent="true" :opacity="0.75" />
    </TresMesh>
  </TresGroup>

  <!--
    gizmo 放在 group 外面：它是独立的一套控件，塞进 group 会跟着对象一起缩放旋转。
    dragging 事件负责开关撤销批量 —— 一次拖拽合成一步撤销，否则每帧都进栈。
  -->
  <TransformControls
    v-if="showGizmo"
    :object="groupRef!"
    :mode="transformMode"
    :translation-snap="translationSnap ?? undefined"
    @object-change="onObjectChange"
    @dragging="(value: boolean) => emit('drag-change', value)"
  />
</template>
