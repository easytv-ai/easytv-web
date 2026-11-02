<script setup lang="ts">
/**
 * 创作台二级页返回：有站内来路就走历史（列表保留滚动），否则落到 fallback。
 * text：纯文字链；icon：导航里的箭头；overlay：叠在封面上的圆形箭头。
 */
const props = withDefaults(defineProps<{
  fallback: string
  variant?: 'text' | 'icon' | 'overlay'
}>(), {
  variant: 'text',
})

const { t } = useI18n()
const router = useRouter()
const localePath = useLocalePath()

function gotoBack() {
  if (import.meta.client && window.history.state?.back)
    router.back()
  else
    void navigateTo(localePath(props.fallback))
}
</script>

<template>
  <button
    type="button"
    class="studio-back"
    :class="`is-${variant}`"
    :aria-label="t('返回')"
    @click="gotoBack"
  >
    <UIcon name="i-lucide-chevron-left" class="size-4" />
    <span v-if="variant === 'text'">{{ t('返回') }}</span>
  </button>
</template>
