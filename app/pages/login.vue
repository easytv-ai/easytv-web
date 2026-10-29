<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: () => t('auth.tabLogin'),
})

definePageMeta({
  layout: false,
  middleware: 'open-login-modal',
  pageTransition: false,
})
</script>

<template>
  <div hidden />
</template>
