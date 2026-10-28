<script setup lang="ts">
/**
 * 道具 / 模型属性面板（复刻自 open-director 的 PropPanel.tsx，MIT）。
 * 判定哪个对象归这个面板管在 panel-selection.ts 里，这里只管画。
 */
import { computed } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { DEFAULT_PROP_COLOR, resolvePropSelection } from '~/utils/director/panel-selection'
import DirectorPanelCard from './DirectorPanelCard.vue'
import DirectorTextField from './DirectorTextField.vue'
import DirectorTransformFields from './DirectorTransformFields.vue'
import DirectorColorField from './DirectorColorField.vue'

const { t } = useI18n()
const store = useDirectorStore()

const prop = computed(() => resolvePropSelection(store.state.value))
const writeBlocked = computed(() => store.readonly.value || Boolean(prop.value?.locked))

function onName(name: string) {
  if (writeBlocked.value || !prop.value)
    return
  store.updateObjectName(prop.value.id, name)
}

function onTransform(patch: Parameters<typeof store.updateObjectTransform>[1]) {
  if (writeBlocked.value || !prop.value)
    return
  store.updateObjectTransform(prop.value.id, patch)
}

function onUniformScale(value: number) {
  if (writeBlocked.value || !prop.value)
    return
  store.updateUniformScale(prop.value.id, value)
}

function onColor(color: string) {
  if (writeBlocked.value || !prop.value)
    return
  store.updateObjectColor(prop.value.id, color)
}
</script>

<template>
  <DirectorPanelCard v-if="prop" :title="t('模型')" :sr-label="t('模型属性面板')" :disabled="writeBlocked">
    <template #head-extra>
      <slot name="head-extra" />
    </template>
    <DirectorTextField
      :label="t('名称')"
      :sr-label="t('模型名称')"
      :model-value="prop.name"
      @update:model-value="onName"
    />

    <DirectorTransformFields
      :transform="prop.transform"
      :sr-prefix="t('模型')"
      @update="onTransform"
      @uniform-scale="onUniformScale"
    />

    <DirectorColorField
      :label="t('颜色')"
      :sr-label="t('模型颜色')"
      :model-value="prop.color ?? DEFAULT_PROP_COLOR"
      @update:model-value="onColor"
    />
  </DirectorPanelCard>
</template>
