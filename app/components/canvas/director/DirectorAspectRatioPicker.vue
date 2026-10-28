<script setup lang="ts">
/**
 * 视口取景比例。圆角浮层 + 画幅形状，不用系统下拉。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { VIEWPORT_ASPECT_RATIO_OPTIONS } from '~/utils/director/schema'
import type { ViewportAspectRatio } from '~/utils/director/schema'

const { t } = useI18n()

const props = defineProps<{
  modelValue: ViewportAspectRatio
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ViewportAspectRatio]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

/** 画幅画在 20 的格子里，细线描边，比 CSS border 盒更匀 */
const ICON_BOX = 20
const ICON_MAX = 12

const options = computed(() =>
  VIEWPORT_ASPECT_RATIO_OPTIONS.map(item => ({
    ...item,
    text: t(item.label),
    icon: iconRect(item.id, item.value),
  })),
)

const currentLabel = computed(() =>
  options.value.find(item => item.id === props.modelValue)?.text ?? props.modelValue,
)

function iconRect(id: ViewportAspectRatio, value: number | null) {
  if (id === 'auto' || value == null) {
    return { x: 5, y: 5, w: 10, h: 10, r: 2.4 }
  }
  const w = value >= 1 ? ICON_MAX : ICON_MAX * value
  const h = value >= 1 ? ICON_MAX / value : ICON_MAX
  return {
    x: (ICON_BOX - w) / 2,
    y: (ICON_BOX - h) / 2,
    w,
    h,
    r: Math.min(2.2, Math.min(w, h) / 2),
  }
}

function pick(id: ViewportAspectRatio) {
  emit('update:modelValue', id)
  open.value = false
}

function onDocPointer(event: PointerEvent) {
  if (!open.value || !rootRef.value)
    return
  if (!rootRef.value.contains(event.target as Node))
    open.value = false
}

function onKey(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    event.preventDefault()
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="rootRef" class="director-aspect" :class="{ 'is-open': open }">
    <button
      type="button"
      class="director-aspect__trigger"
      :aria-label="t('取景比例')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span>{{ currentLabel }}</span>
      <span class="canvas-tip canvas-tip--up">{{ t('取景比例') }}</span>
    </button>

    <div
      v-if="open"
      class="director-aspect__panel"
      role="dialog"
      :aria-label="t('比例')"
    >
      <p class="director-aspect__title">{{ t('比例') }}</p>
      <div class="director-aspect__grid" role="listbox" :aria-label="t('取景比例')">
        <button
          v-for="item in options"
          :key="item.id"
          type="button"
          class="director-aspect__item"
          :class="{ 'is-on': item.id === modelValue }"
          role="option"
          :aria-selected="item.id === modelValue"
          @click="pick(item.id)"
        >
          <svg class="director-aspect__glyph" viewBox="0 0 20 20" aria-hidden="true">
            <rect
              :x="item.icon.x"
              :y="item.icon.y"
              :width="item.icon.w"
              :height="item.icon.h"
              :rx="item.icon.r"
              fill="none"
              stroke="currentColor"
              stroke-width="1.35"
            />
          </svg>
          <span>{{ item.text }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
