<script setup lang="ts">
/**
 * 取景框与三分线（复刻自 open-director 的 ViewportAspectOverlay.tsx，MIT）。
 *
 * 画在画布上面的一层普通 DOM，不进 3D 场景 —— 它是构图辅助线，
 * 不该被透视、被遮挡，也不该出现在导出的视频里。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { getViewportFrameRect } from '~/utils/director/viewport-frame'

const props = withDefaults(defineProps<{
  /** 底部被工具条压住的高度 */
  bottomPadding?: number
}>(), { bottomPadding: 56 })

const store = useDirectorStore()

const hostRef = ref<HTMLElement | null>(null)
const size = ref({ width: 0, height: 0 })

let observer: ResizeObserver | null = null

onMounted(() => {
  if (!hostRef.value)
    return
  // 视口大小跟着弹窗和窗口变，监听尺寸而不是只在挂载时量一次
  observer = new ResizeObserver(([entry]) => {
    if (entry)
      size.value = { width: entry.contentRect.width, height: entry.contentRect.height }
  })
  observer.observe(hostRef.value as unknown as Element)
})

onBeforeUnmount(() => observer?.disconnect())

const frame = computed(() => getViewportFrameRect(
  store.state.value.viewportAspectRatio,
  size.value.width,
  size.value.height,
  props.bottomPadding,
))

const showThirds = computed(() => store.state.value.viewportRuleOfThirdsEnabled)
</script>

<template>
  <div ref="hostRef" class="director-frame" aria-hidden="true">
    <div
      v-if="frame && frame.width > 0"
      class="director-frame__box"
      :style="{
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        left: `${frame.left}px`,
        top: `${frame.top}px`,
      }"
    >
      <template v-if="showThirds">
        <span class="director-frame__line is-v" style="left: 33.333%" />
        <span class="director-frame__line is-v" style="left: 66.667%" />
        <span class="director-frame__line is-h" style="top: 33.333%" />
        <span class="director-frame__line is-h" style="top: 66.667%" />
      </template>
    </div>
  </div>
</template>
