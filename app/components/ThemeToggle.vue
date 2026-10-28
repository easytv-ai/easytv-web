<script setup lang="ts">
const { t } = useI18n()
withDefaults(
  defineProps<{
    /** 窄屏底栏用更紧凑的尺寸 */
    compact?: boolean
  }>(),
  { compact: false },
)

const { isDark, toggleTheme } = useTheme()

// 主题只有客户端才知道（localStorage + prefers-color-scheme），服务端与客户端首帧统一按浅色渲染，挂载后再切换，避免 hydration 不一致
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const shownDark = computed(() => mounted.value && isDark.value)

const ariaLabel = computed(() =>
  shownDark.value ? t('theme.toLight') : t('theme.toDark'),
)
</script>

<template>
  <button
    type="button"
    class="ea-icon-btn theme-toggle-btn shrink-0"
    :class="compact ? 'h-8 w-8' : 'h-9 w-9'"
    :aria-label="ariaLabel"
    :aria-pressed="shownDark"
    @click="toggleTheme($event)"
  >
    <svg
      v-if="shownDark"
      class="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.75"
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
    <svg
      v-else
      class="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.75"
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
    <span class="canvas-tip canvas-tip--down">{{ ariaLabel }}</span>
  </button>
</template>
