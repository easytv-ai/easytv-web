<script setup lang="ts">
/** 检查器底栏里代替模型下拉的空清单提示：管理员多一个去运营后台的入口 */
const { t } = useI18n()
const hint = useNoModelsHint()
</script>

<template>
  <p class="canvas-inspector__empty-models" role="status">
    <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
    <template v-if="hint.audience === 'admin'">
      <span>{{ t('canvas.noModels.adminTitle') }}</span>
      <a
        v-if="hint.manageUrl"
        :href="hint.manageUrl"
        target="_blank"
        rel="noopener"
        class="canvas-inspector__empty-models-link"
        @pointerdown.stop
      >{{ t('canvas.noModels.adminLink') }}</a>
    </template>
    <span v-else>{{ t('canvas.noModels.userHint') }}</span>
  </p>
</template>
