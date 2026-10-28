<script setup lang="ts">
const { t } = useI18n()

useHead({
  title: () => t('auth.resetPasswordPageTitle'),
})

definePageMeta({
  layout: 'simple',
})
</script>

<template>
  <AuthResetPasswordCard />
</template>
