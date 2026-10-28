<script setup lang="ts">
/**
 * 位置 / 旋转 / 缩放 / 统一缩放四组字段。
 *
 * 上游在 PropPanel 和 CharacterPanel 里各铺了一遍（每个轴一个对象字面量，
 * 两处加起来两百多行），改一个 step 要改六处。这里抽成一个组件，
 * 两个面板都用它，群众组和单个对象的区别由父组件在事件里决定。
 *
 * 旋转显示成度，store 里存的仍是弧度 —— 让用户在输入框里看 0.785 不合适。
 */
import { computed } from 'vue'
import type { DirectorTransform } from '~/utils/director/schema'
import { degreesToRadians, radiansToDegrees } from '~/utils/director/number-field'
import DirectorAxisGroup from './DirectorAxisGroup.vue'
import DirectorRangeField from './DirectorRangeField.vue'

const props = defineProps<{
  transform: DirectorTransform
  /** 读屏标签前缀，比如「角色」「模型」；命名理由见 DirectorNumberInput */
  srPrefix: string
}>()

const emit = defineEmits<{
  update: [patch: Partial<DirectorTransform>]
  /** 统一缩放走单独的 store 动作，不能当成普通的 scale 改动 */
  'uniform-scale': [value: number]
}>()

const { t } = useI18n()

const UNIFORM_SCALE = { min: 0.2, max: 3, step: 0.01 } as const

const rotationInDegrees = computed<[number, number, number]>(() => [
  radiansToDegrees(props.transform.rotation[0]),
  radiansToDegrees(props.transform.rotation[1]),
  radiansToDegrees(props.transform.rotation[2]),
])

function onRotationChange(degrees: [number, number, number]) {
  emit('update', {
    rotation: [
      degreesToRadians(degrees[0]),
      degreesToRadians(degrees[1]),
      degreesToRadians(degrees[2]),
    ],
  })
}
</script>

<template>
  <DirectorAxisGroup
    :label="t('位置')"
    :sr-prefix="`${srPrefix} ${t('位置')}`"
    :model-value="transform.position"
    :step="0.1"
    @update:model-value="emit('update', { position: $event })"
  />

  <DirectorAxisGroup
    :label="t('旋转')"
    :sr-prefix="`${srPrefix} ${t('旋转')}`"
    :model-value="rotationInDegrees"
    :step="1"
    @update:model-value="onRotationChange"
  />

  <DirectorAxisGroup
    :label="t('缩放')"
    :sr-prefix="`${srPrefix} ${t('缩放')}`"
    :model-value="transform.scale"
    :step="0.01"
    :min="0.01"
    @update:model-value="emit('update', { scale: $event })"
  />

  <DirectorRangeField
    :label="t('统一缩放')"
    :sr-label="`${srPrefix} ${t('统一缩放')}`"
    :model-value="transform.scale[0]"
    :min="UNIFORM_SCALE.min"
    :max="UNIFORM_SCALE.max"
    :step="UNIFORM_SCALE.step"
    @update:model-value="emit('uniform-scale', $event)"
  />
</template>
