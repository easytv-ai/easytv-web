<script setup lang="ts">
import {
  CANVAS_ASSET_ITEMS,
  type CanvasMenuKind,
} from '~/utils/canvas-node-kinds'

const { t } = useI18n()
const { canvasNodeItems, load } = useStudioAppConfig()
onMounted(() => { void load() })

defineProps<{
  x: number
  y: number
  bottom?: number
}>()

const emit = defineEmits<{
  pick: [kind: CanvasMenuKind]
}>()
</script>

<template>
  <div
    class="canvas-menu"
    :style="bottom == null
      ? { left: `${x}px`, top: `${y}px` }
      : { left: `${x}px`, top: 'auto', bottom: `${bottom}px`, maxHeight: `calc(100dvh - ${bottom + 16}px)` }"
    @pointerdown.stop
    @dblclick.stop
  >
    <p>{{ t('添加节点') }}</p>
    <button
      v-for="item in canvasNodeItems"
      :key="item.kind"
      type="button"
      @click="emit('pick', item.kind)"
    >
      <UIcon :name="item.icon" class="size-4" />
      <span>{{ t(item.label) }}</span>
      <i v-if="item.badge">{{ item.badge }}</i>
    </button>
    <p>{{ t('添加资源') }}</p>
    <button
      v-for="item in CANVAS_ASSET_ITEMS"
      :key="item.kind"
      type="button"
      @click="emit('pick', item.kind)"
    >
      <UIcon :name="item.icon" class="size-4" />
      <span>{{ t(item.label) }}</span>
    </button>
  </div>
</template>
