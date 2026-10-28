<script setup lang="ts">
/**
 * 场景属性面板（复刻自 open-director 的 ScenePanel.tsx，MIT）。
 *
 * 上游为四个数字框各维护了一份字符串草稿加一个 useEffect 同步（占了小一百行），
 * 那套活我们的 DirectorNumberInput 在组件内部已经做了，这里直接给数值。
 */
import { computed } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { degreesToRadians, radiansToDegrees } from '~/utils/director/number-field'
import { DIRECTOR_STUDIO_DARK, DIRECTOR_STUDIO_LIGHT, resolveDirectorStudioLook } from '~/utils/director/studio-look'
import DirectorPanelCard from './DirectorPanelCard.vue'
import DirectorSection from './DirectorSection.vue'
import DirectorAxisGroup from './DirectorAxisGroup.vue'
import DirectorRangeField from './DirectorRangeField.vue'
import DirectorColorField from './DirectorColorField.vue'
import DirectorToggleField from './DirectorToggleField.vue'

const { t } = useI18n()
const store = useDirectorStore()
const { isDark } = useTheme()

const SCENE_SCALE = { min: 0.1, max: 3, step: 0.01 } as const
const PANORAMA_YAW = { min: -180, max: 180, step: 1 } as const
const PANORAMA_RADIUS = { min: 10, max: 300, step: 1 } as const
const GROUND_OPACITY = { min: 0, max: 1, step: 0.01 } as const
const GROUND_HEIGHT = { min: -5, max: 5, step: 0.1 } as const

const scene = computed(() => store.project.value.scene)
const skyColor = computed(() => resolveDirectorStudioLook(isDark.value, scene.value.backgroundColor).sky)

function onSkyColorChange(color: string) {
  const themeSky = (isDark.value ? DIRECTOR_STUDIO_DARK : DIRECTOR_STUDIO_LIGHT).sky
  store.updateScene({
    backgroundColor: color.trim().toLowerCase() === themeSky ? '#000000' : color,
  })
}

const panoramaAsset = computed(() => {
  const id = store.project.value.panoramaAssetId
  return id ? store.project.value.assets.find(item => item.id === id) ?? null : null
})

const rotationInDegrees = computed<[number, number, number]>(() => [
  radiansToDegrees(scene.value.rotation[0]),
  radiansToDegrees(scene.value.rotation[1]),
  radiansToDegrees(scene.value.rotation[2]),
])

function onRotationChange(degrees: [number, number, number]) {
  store.updateScene({
    rotation: [
      degreesToRadians(degrees[0]),
      degreesToRadians(degrees[1]),
      degreesToRadians(degrees[2]),
    ],
  })
}
</script>

<template>
  <DirectorPanelCard :title="t('3D 场景')" :sr-label="t('场景属性面板')">
    <template #head-extra>
      <slot name="head-extra" />
    </template>
    <DirectorRangeField
      :label="t('场景缩放')"
      :sr-label="t('场景缩放')"
      :model-value="scene.scale"
      :min="SCENE_SCALE.min"
      :max="SCENE_SCALE.max"
      :step="SCENE_SCALE.step"
      @update:model-value="store.updateScene({ scale: $event })"
    />

    <DirectorAxisGroup
      :label="t('场景平移')"
      :sr-prefix="t('场景平移')"
      :model-value="scene.position"
      :step="0.1"
      @update:model-value="store.updateScene({ position: $event })"
    />

    <DirectorAxisGroup
      :label="t('场景旋转')"
      :sr-prefix="t('场景旋转')"
      :model-value="rotationInDegrees"
      :step="1"
      @update:model-value="onRotationChange"
    />

    <DirectorSection :title="t('全景背景')">
      <div v-if="panoramaAsset" class="director-pano" :aria-label="t('全景图')">
        <img :src="panoramaAsset.url" :alt="panoramaAsset.fileName">
        <span class="director-pano__name">{{ panoramaAsset.fileName }}</span>
        <button
          type="button"
          class="director-pano__delete"
          :aria-label="t('删除全景图')"
          @click="store.removePanoramaAsset()"
        >
          <UIcon name="i-lucide-trash-2" class="size-3.5" />
        </button>
      </div>
      <div v-else class="director-pano director-pano--empty">
        <UIcon name="i-lucide-image-off" class="size-4" />
        <span>{{ t('未连接全景图') }}</span>
      </div>

      <DirectorColorField
        :label="t('天空颜色')"
        :sr-label="t('天空颜色')"
        :model-value="skyColor"
        @update:model-value="onSkyColorChange"
      />
    </DirectorSection>

    <DirectorSection :title="t('全景球')">
      <DirectorRangeField
        :label="t('水平旋转')"
        :sr-label="t('全景球水平旋转')"
        :model-value="scene.panoramaYaw"
        :min="PANORAMA_YAW.min"
        :max="PANORAMA_YAW.max"
        :step="PANORAMA_YAW.step"
        suffix="°"
        @update:model-value="store.updateScene({ panoramaYaw: $event })"
      />
      <DirectorRangeField
        :label="t('球形半径')"
        :sr-label="t('全景球半径')"
        :model-value="scene.panoramaRadius"
        :min="PANORAMA_RADIUS.min"
        :max="PANORAMA_RADIUS.max"
        :step="PANORAMA_RADIUS.step"
        @update:model-value="store.updateScene({ panoramaRadius: $event })"
      />
    </DirectorSection>

    <DirectorSection :title="t('开关项')">
      <div class="director-toggle-row" role="group" :aria-label="t('开关项')">
        <DirectorToggleField
          :label="t('角色标签')"
          :model-value="scene.showLabels"
          @update:model-value="store.updateScene({ showLabels: $event })"
        />
        <DirectorToggleField
          :label="t('网格吸附')"
          :model-value="scene.snapToGrid"
          @update:model-value="store.updateScene({ snapToGrid: $event })"
        />
        <DirectorToggleField
          :label="t('地面')"
          :model-value="scene.showGround"
          @update:model-value="store.updateScene({ showGround: $event })"
        />
      </div>
    </DirectorSection>

    <!-- 地面关掉时这两个滑块没有意义，藏起来而不是置灰 -->
    <DirectorSection v-if="scene.showGround" :title="t('地面')">
      <DirectorRangeField
        :label="t('透明度')"
        :sr-label="t('地面透明度')"
        :model-value="scene.groundOpacity"
        :min="GROUND_OPACITY.min"
        :max="GROUND_OPACITY.max"
        :step="GROUND_OPACITY.step"
        @update:model-value="store.updateScene({ groundOpacity: $event })"
      />
      <DirectorRangeField
        :label="t('高度')"
        :sr-label="t('地面高度')"
        :model-value="scene.groundHeight"
        :min="GROUND_HEIGHT.min"
        :max="GROUND_HEIGHT.max"
        :step="GROUND_HEIGHT.step"
        @update:model-value="store.updateScene({ groundHeight: $event })"
      />
    </DirectorSection>
  </DirectorPanelCard>
</template>
