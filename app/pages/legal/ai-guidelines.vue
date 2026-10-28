<script setup lang="ts">
import { aiGuidelinesDocument } from '~/content/legal/zh'

definePageMeta({
  layout: 'simple',
})

useHead({ title: aiGuidelinesDocument.title })
</script>

<template>
  <LegalArticle
    :title="aiGuidelinesDocument.title"
    :updated-at="aiGuidelinesDocument.updatedAt"
    :intro="aiGuidelinesDocument.intro"
    :sections="aiGuidelinesDocument.sections"
  />
</template>
