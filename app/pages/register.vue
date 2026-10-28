<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: () => t('auth.tabRegister'),
})

definePageMeta({
  layout: 'auth',
  pageTransition: false,
})
</script>

<template>
  <div hidden />
</template>
