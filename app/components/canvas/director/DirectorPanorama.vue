<script setup lang="ts">
/**
 * 全景背景（复刻自 open-director 的 ViewportBackground.tsx，MIT）。
 *
 * 两种投影方式：
 * - equirectangular：直接设成场景的 background，球面映射交给渲染器，
 *   角色和道具都被它包住，像真的在那个环境里。
 * - backdrop：自己画一个内翻的大球，只当远景板，不参与环境光。
 *
 * 纹理参数和朝向换算在 panorama-texture.ts 里单独测过。
 */
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { Color, TextureLoader, type Texture } from 'three'
import { useTres } from '@tresjs/core'
import { useDirectorStore } from '~/utils/director/use-director-store'
import {
  BackSide,
  configurePanoramaTexture,
  getPanoramaRadius,
  getPanoramaRotationRadians,
} from '~/utils/director/panorama-texture'
import { resolveDirectorStudioLook } from '~/utils/director/studio-look'

const store = useDirectorStore()
const { isDark } = useTheme()
const { scene } = useTres()

const skyColor = computed(() =>
  resolveDirectorStudioLook(isDark.value, store.project.value.scene.backgroundColor).sky)

const asset = computed(() => {
  const id = store.project.value.panoramaAssetId
  return id ? store.project.value.assets.find(item => item.id === id) ?? null : null
})

const projectionMode = computed(() => asset.value?.projectionMode ?? 'equirectangular')
const sceneSettings = computed(() => store.project.value.scene)
const radius = computed(() => getPanoramaRadius(sceneSettings.value.panoramaRadius))
const rotationY = computed(() => getPanoramaRotationRadians(sceneSettings.value.panoramaYaw))

// three 对象一律 shallowRef
const texture = shallowRef<Texture | null>(null)
const failed = ref(false)

function disposeTexture() {
  texture.value?.dispose()
  texture.value = null
}

watch(() => asset.value?.url ?? null, (url) => {
  disposeTexture()
  failed.value = false
  if (!url)
    return

  // 加载是异步的，中途换图要认出「回来的是上一张」并丢掉
  const requested = url
  new TextureLoader().load(
    url,
    (loaded) => {
      if (asset.value?.url !== requested) {
        loaded.dispose()
        return
      }
      texture.value = configurePanoramaTexture(loaded, projectionMode.value)
    },
    undefined,
    () => {
      failed.value = true
    },
  )
}, { immediate: true })

/** 把 equirectangular 的贴图挂到场景背景上；backdrop 模式只留纯色底 */
watch([texture, projectionMode, rotationY, skyColor], () => {
  const target = scene.value
  if (!target)
    return

  const useAsBackground = Boolean(texture.value) && projectionMode.value === 'equirectangular'
  target.background = useAsBackground ? texture.value : new Color(skyColor.value)
  target.backgroundRotation.set(0, useAsBackground ? rotationY.value : 0, 0)
}, { immediate: true })

onBeforeUnmount(() => {
  // 卸载时把场景背景还原，不然换掉导演台之后天空还留在那
  if (scene.value)
    scene.value.background = new Color(skyColor.value)
  disposeTexture()
})
</script>

<template>
  <!-- backdrop 模式：内翻的大球，renderOrder 压到最底，永远在所有东西后面 -->
  <TresMesh
    v-if="texture && projectionMode === 'backdrop'"
    name="preview-omit"
    :frustum-culled="false"
    :render-order="-1000"
    :rotation="[0, rotationY, 0]"
  >
    <TresSphereGeometry :args="[radius, 96, 64]" />
    <TresMeshBasicMaterial
      :map="texture"
      :side="BackSide"
      :depth-write="false"
      :tone-mapped="false"
    />
  </TresMesh>
</template>
