<script setup lang="ts">
/**
 * 设置页骨架。占住标题、数字条和列表的位置，不出现「加载中」文案。
 * variant: board 整页（标题 + 数字 + 行），list 只有行，fields 两行表单。
 */
withDefaults(defineProps<{
  variant?: 'board' | 'list' | 'fields'
  rows?: number
}>(), {
  variant: 'board',
  rows: 4,
})

const { t } = useI18n()
</script>

<template>
  <div class="set-skel" :class="`is-${variant}`" aria-busy="true">
    <span class="set-skel__sr">{{ t('加载中…') }}</span>
    <div v-if="variant === 'board'" class="set-skel__head">
      <i class="set-skel__title" />
      <i class="set-skel__sub" />
    </div>
    <div v-if="variant === 'board'" class="set-skel__stats">
      <span v-for="n in 4" :key="n">
        <i />
        <b />
      </span>
    </div>
    <div v-if="variant === 'fields'" class="set-skel__fields">
      <i />
      <i />
    </div>
    <div v-else class="set-skel__list">
      <i v-for="n in rows" :key="n" />
    </div>
  </div>
</template>
