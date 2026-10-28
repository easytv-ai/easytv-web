<script setup lang="ts">
import {
  DEPTH_MOTION_DEFAULT_PARAMS,
  DEPTH_MOTION_RESOLUTION_ITEMS,
  type CanvasNodeData,
} from '~/utils/canvas-node-kinds'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  params?: CanvasNodeData['depthMotionParams'] | null
  panelStyle?: Record<string, string> | null
  submitting?: boolean
}>(), {
  params: null,
  panelStyle: null,
  submitting: false,
})

const emit = defineEmits<{
  'update:params': [value: NonNullable<CanvasNodeData['depthMotionParams']>]
  submit: []
}>()

const draft = computed(() => ({
  sourceId: props.params?.sourceId || '',
  sourceLabel: props.params?.sourceLabel || '',
  resolution: props.params?.resolution || DEPTH_MOTION_DEFAULT_PARAMS.resolution,
}))

function pickResolution(resolution: typeof DEPTH_MOTION_RESOLUTION_ITEMS[number]) {
  emit('update:params', { ...draft.value, resolution })
}

function onSubmit() {
  if (props.submitting)
    return
  emit('submit')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && panelStyle"
      class="canvas-depth-motion nodrag nopan nowheel"
      :style="panelStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <header class="canvas-depth-motion__head">
        <strong>{{ t('深度动作捕捉') }}</strong>
      </header>

      <div class="canvas-depth-motion__row">
        <span class="canvas-depth-motion__label">{{ t('清晰度') }}</span>
        <div class="canvas-depth-motion__picks">
          <button
            v-for="item in DEPTH_MOTION_RESOLUTION_ITEMS"
            :key="item"
            type="button"
            :class="{ 'is-on': draft.resolution === item }"
            @click="pickResolution(item)"
          >
            {{ item.replace('P', ' P') }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="canvas-depth-motion__go"
        :disabled="submitting"
        @click="onSubmit"
      >
        {{ submitting ? t('提取中…') : t('确认提取') }}
      </button>
    </div>
  </Teleport>
</template>
