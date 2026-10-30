<script setup lang="ts">
/**
 * 设置已改为弹窗（StudioSettingsModal）。保留 /settings?tab= 兼容旧链接、站外通知与登录回跳：
 * 打开对应标签的设置弹窗，再回到首页。
 */
import { resolveSettingsTab } from '~/composables/useSettingsModal'

const { t } = useI18n()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
})

useHead({ title: t('设置') })

const route = useRoute()
const localePath = useLocalePath()
const { openSettings } = useSettingsModal()

onMounted(async () => {
  const tab = resolveSettingsTab(route.query.tab)
  await navigateTo(localePath('/agent'), { replace: true })
  openSettings(tab)
})
</script>

<template>
  <StudioLoading />
</template>
