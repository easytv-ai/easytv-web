<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: () => t('auth.tabLogin'),
})

definePageMeta({
  layout: 'auth',
  pageTransition: false,
})
</script>

<template>
  <div hidden />
</template>
