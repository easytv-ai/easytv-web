<script setup lang="ts">
/**
 * 用户导入的 GLB / GLTF。
 *
 * useGLTF 按 URL 缓存，同一份文件进场景两次必须克隆，否则共用一份网格。
 * 缩放和贴地在克隆之后做：原文件可能是厘米单位，不压会把素体衬成蚂蚁。
 * 角色模型如果认出人形骨骼，就绑到姿势滑块上；道具只显示，不摆姿势。
 * 形象图和素体同一套投影：贴在正面上半身，背面不印。
 */
import { onBeforeUnmount, shallowRef, watch, watchEffect } from 'vue'
import { useGLTF } from '@tresjs/cientos'
import { Box3, Vector3 } from 'three'
import type { Group, Object3D, SkinnedMesh, Texture } from 'three'
import { alignMannequinToGround, cloneMannequin, setMannequinLookPlate } from '~/utils/director/mannequin'
import { fitImportedModelScale } from '~/utils/director/imported-model'
import { applyPose, captureRestPose, type RestPose } from '~/utils/director/mannequin-rig'
import { applyHumanoidPose, matchHumanoid, type HumanoidBinding } from '~/utils/director/humanoid-rig'
import { loadLookTexture } from '~/utils/director/look-texture'
import type { CharacterBodyType, CharacterRigState } from '~/utils/director/schema'
import { useDirectorStore } from '~/utils/director/use-director-store'

const props = defineProps<{
  url: string
  /** 只有角色才传。道具不绑骨骼，避免姿势写到没有角色面板的对象上 */
  objectId?: string
  rig?: CharacterRigState
  bodyType?: CharacterBodyType
  /** 投到正面上半身的形象图地址；道具不传 */
  lookUrl?: string
}>()

const store = useDirectorStore()
const model = shallowRef<Group | null>(null)
const failed = ref(false)
const restPose = shallowRef<RestPose | null>(null)
const humanoid = shallowRef<HumanoidBinding | null>(null)
const lookTexture = shallowRef<Texture | null>(null)
let lookRequest = 0

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

function refreshSkeletons(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as SkinnedMesh
    if (mesh.isSkinnedMesh)
      mesh.skeleton.update()
  })
}

try {
  const { state: gltf } = await useGLTF(props.url)

  watchEffect(() => {
    const source = gltf.value?.scene as Group | undefined
    if (!source || model.value)
      return

    const cloned = cloneMannequin(source)
    const size = new Box3().setFromObject(cloned, true).getSize(new Vector3())
    const scale = fitImportedModelScale(Math.max(size.x, size.y, size.z))
    if (scale !== 1)
      cloned.scale.multiplyScalar(scale)
    cloned.traverse((object) => {
      object.frustumCulled = false
    })
    restPose.value = captureRestPose(cloned)
    humanoid.value = matchHumanoid(cloned)
    model.value = cloned
  })

  watchEffect(() => {
    const current = model.value
    const rest = restPose.value
    const matched = humanoid.value
    if (!current || !rest)
      return

    if (matched && props.objectId) {
      if (!props.rig)
        store.bindImportedCharacterRig(props.objectId, matched.rigType)
      if (matched.rigType === 'ue4-mannequin') {
        applyPose(current, {
          bodyType: props.bodyType,
          controls: props.rig?.controls ?? {},
          restPose: rest,
        })
      }
      else {
        applyHumanoidPose(current, rest, matched, props.rig?.controls, props.bodyType)
      }
    }

    alignMannequinToGround(current)
    refreshSkeletons(current)
    if (props.objectId)
      setMannequinLookPlate(current, lookTexture.value)
  })
}
catch {
  failed.value = true
}
</script>

<template>
  <primitive v-if="model" :object="model" />
  <TresMesh v-else-if="failed" :position="[0, 0.6, 0]">
    <TresBoxGeometry :args="[0.8, 1.2, 0.8]" />
    <TresMeshStandardMaterial color="#7f1d1d" :metalness="0.05" :roughness="0.7" />
  </TresMesh>
</template>
