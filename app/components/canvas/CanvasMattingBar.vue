<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  cost?: number | string
  box?: { left: number, top: number, width: number, height: number } | null
  submitting?: boolean
}>(), {
  cost: 2,
  box: null,
  submitting: false,
})

const emit = defineEmits<{
  close: []
  submit: []
}>()

const barStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  return {
    left: `${box.left + box.width / 2}px`,
    top: `${box.top + box.height + 14}px`,
  }
})

function onSubmit() {
  if (props.submitting)
    return
  emit('submit')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && barStyle"
      class="canvas-matting-bar nodrag nopan nowheel"
      :style="barStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <button type="button" class="canvas-matting__x" :aria-label="t('关闭')" @click="emit('close')">
        <UIcon name="i-lucide-x" class="size-4" />
        <span class="canvas-tip canvas-tip--up">{{ t('关闭') }}</span>
      </button>
      <span class="canvas-matting__title">{{ t('智能抠像') }}</span>
      <span class="canvas-matting__cost" :aria-label="t('积分')">
        <UIcon name="i-lucide-zap" class="size-3.5" />
        {{ cost }}
      </span>
      <button
        type="button"
        class="canvas-matting__send"
        :aria-label="t('确认抠像')"
        :disabled="submitting"
        @click="onSubmit"
      >
        <UIcon
          :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'"
          class="size-4"
          :class="{ 'animate-spin': submitting }"
        />
        <span class="canvas-tip canvas-tip--up">{{ t('确认抠像') }}</span>
      </button>
    </div>
  </Teleport>
</template>
