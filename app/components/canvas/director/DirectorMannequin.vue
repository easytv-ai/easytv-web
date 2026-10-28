<script setup lang="ts">
/**
 * 角色素体（复刻自 open-director 的 runtime/UE4MannequinModel.tsx，MIT）。
 *
 * 模型加载一次，每个角色克隆一套自己的骨架 —— 共用实例的话，
 * 一个角色摆姿势会把所有角色一起带动。
 *
 * 姿势每次都从静止姿态重新算，所以克隆之后要先把静止姿态记下来。
 */
import { onBeforeUnmount, shallowRef, watch, watchEffect } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import type { Group, Texture } from 'three'
import type { CharacterBodyType, CharacterRigState } from '~/utils/director/schema'
import { applyPose, captureRestPose, type RestPose } from '~/utils/director/mannequin-rig'
import {
  alignMannequinToGround,
  cloneMannequin,
  getMannequinScale,
  MANNEQUIN_MODEL_URL,
  setMannequinLookPlate,
  tintMannequin,
} from '~/utils/director/mannequin'
import { loadLookTexture } from '~/utils/director/look-texture'

const props = defineProps<{
  bodyType?: CharacterBodyType
  color?: string
  /** 骨骼控制量，来自姿势预设或用户微调 */
  rig?: CharacterRigState
  /** 投到素体上半身的形象图地址 */
  lookUrl?: string
}>()

// three 对象一律 shallowRef：普通 ref 会包成 Proxy，骨架和射线检测都会出问题
const model = shallowRef<Group | null>(null)
const lookTexture = shallowRef<Texture | null>(null)
/** 克隆出来那一刻的骨骼姿态，摆姿势的基准 */
let restPose: RestPose | null = null
let lookRequest = 0

const scale = computed(() => getMannequinScale(props.bodyType))

const { state: gltf } = await useGLTF(MANNEQUIN_MODEL_URL)

function disposeLookTexture() {
  lookTexture.value?.dispose()
  lookTexture.value = null
}

watch(() => props.lookUrl, async (url) => {
  const request = ++lookRequest
  disposeLookTexture()
  const src = String(url || '').trim()
  if (!src)
    return
  try {
    const texture = await loadLookTexture(src)
    if (lookRequest !== request || props.lookUrl !== src) {
      texture.dispose()
      return
    }
    lookTexture.value = texture
  }
  catch {}
}, { immediate: true })

onBeforeUnmount(() => {
  disposeLookTexture()
})

watchEffect(() => {
  const source = gltf.value?.scene as Group | undefined
  if (!source)
    return

  // 换颜色或姿势都不必重新克隆骨架，克隆一次就够
  if (!model.value) {
    model.value = cloneMannequin(source)
    restPose = captureRestPose(model.value)
  }

  tintMannequin(model.value, props.color ?? '#f3f5f7')

  if (restPose) {
    applyPose(model.value, {
      bodyType: props.bodyType,
      controls: props.rig?.controls ?? {},
      restPose,
    })
  }

  // 落地要放在摆完姿势之后：抬腿、下蹲都会改变模型的最低点
  alignMannequinToGround(model.value)
  // 形象按落地后的包围盒投到网格上，不要再单独挂牌
  setMannequinLookPlate(model.value, lookTexture.value)
})
</script>

<template>
  <TresGroup :scale="scale">
    <primitive v-if="model" :object="model" />
  </TresGroup>
</template>
