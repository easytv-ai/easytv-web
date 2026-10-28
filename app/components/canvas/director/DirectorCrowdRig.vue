<script setup lang="ts">
/**
 * 群众组的整体变换控件（复刻自 open-director 的 canvas/SceneRoot.tsx，MIT）。
 *
 * 群众本身是一个个独立对象，整组拖动靠的是这里：一个空 group 放在全组的锚点上，
 * gizmo 挂在它身上，拖完把这个 group 的变换交给 updateCrowdTransform，
 * 由它按相对偏移分发给每个成员（那套绕锚点旋转的数学在阶段 1 已经写好并测过）。
 */
import { shallowRef } from 'vue'
import { TransformControls } from '@tresjs/cientos'
import type { Group } from 'three'
import type { DirectorObject, DirectorTransform } from '~/utils/director/schema'
import type { TransformMode } from '~/utils/director/store/state'
import { getCrowdAnchorTransform } from '~/utils/director/store/objects'

const props = defineProps<{
  crowdId: string
  objects: DirectorObject[]
  selected: boolean
  transformable: boolean
  transformMode: TransformMode
  translationSnap: number | null
}>()

const emit = defineEmits<{
  transform: [crowdId: string, patch: Partial<DirectorTransform>]
  'drag-change': [dragging: boolean]
}>()

// three 对象一律 shallowRef：普通 ref 会包成 Proxy，射线检测和 gizmo 都会失灵
const anchorRef = shallowRef<Group | null>(null)

const anchor = computed(() => getCrowdAnchorTransform(props.objects, props.crowdId))

const active = computed(() => props.selected && props.transformable && Boolean(anchor.value))

function onObjectChange() {
  const group = anchorRef.value
  if (!group)
    return
  emit('transform', props.crowdId, {
    position: [group.position.x, group.position.y, group.position.z],
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
    scale: [group.scale.x, group.scale.y, group.scale.z],
  })
}
</script>

<template>
  <template v-if="active && anchor">
    <!-- 空 group：只是给 gizmo 一个可以抓的把手，本身不画任何东西 -->
    <TresGroup
      ref="anchorRef"
      :position="anchor.position"
      :rotation="anchor.rotation"
      :scale="anchor.scale"
    />
    <TransformControls
      v-if="anchorRef"
      :object="anchorRef"
      :mode="transformMode"
      :translation-snap="translationSnap ?? undefined"
      @object-change="onObjectChange"
      @dragging="(value: boolean) => emit('drag-change', value)"
    />
  </template>
</template>
