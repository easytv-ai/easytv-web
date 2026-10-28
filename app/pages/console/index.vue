<script setup lang="ts">
/**
 * /console?ticket= 入口（后台用户列表「控制台」代登，API.md 第 19 节）：全屏 loading。
 * 兑换与跳转由 middleware/console-auth.global.ts 处理，成功后进工作室。
 */
definePageMeta({
  layout: false,
})

const { t } = useI18n()
</script>

<template>
  <div class="console-access-page">
    <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" />
    <p>{{ t('正在进入控制台…') }}</p>
  </div>
</template>

<style scoped>
.console-access-page {
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: var(--st-bg);
  color: var(--st-muted);
  font-size: 14px;
}
</style>
