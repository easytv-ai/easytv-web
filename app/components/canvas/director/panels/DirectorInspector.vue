<script setup lang="ts">
/**
 * 右侧面板的分发（复刻自 open-director 的 RightPanel.tsx，MIT）。
 * 显示哪一个由 selectRightPanelKind 判定，判定规则在 panel-selection.ts 里测过。
 */
import { computed } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { selectRightPanelKind } from '~/utils/director/panel-selection'
import DirectorScenePanel from './DirectorScenePanel.vue'
import DirectorCharacterPanel from './DirectorCharacterPanel.vue'
import DirectorPropPanel from './DirectorPropPanel.vue'
import DirectorCameraPanel from './DirectorCameraPanel.vue'

const store = useDirectorStore()

const kind = computed(() => selectRightPanelKind(store.state.value))
</script>

<template>
  <div class="director-inspector">
    <!-- 选不出具体对象时（比如群众组刚被删空）kind 会退回 scene，见 panel-selection -->
    <DirectorCharacterPanel v-if="kind === 'character'">
      <template #head-extra><slot name="head-extra" /></template>
    </DirectorCharacterPanel>
    <DirectorPropPanel v-else-if="kind === 'prop'">
      <template #head-extra><slot name="head-extra" /></template>
    </DirectorPropPanel>
    <DirectorCameraPanel v-else-if="kind === 'camera'">
      <template #head-extra><slot name="head-extra" /></template>
    </DirectorCameraPanel>
    <DirectorScenePanel v-else>
      <template #head-extra><slot name="head-extra" /></template>
    </DirectorScenePanel>
  </div>
</template>
