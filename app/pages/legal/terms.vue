<script setup lang="ts">
import { termsDocument } from '~/content/legal/zh'

definePageMeta({
  layout: 'simple',
})

useHead({ title: termsDocument.title })
</script>

<template>
  <LegalArticle
    :title="termsDocument.title"
    :updated-at="termsDocument.updatedAt"
    :intro="termsDocument.intro"
    :sections="termsDocument.sections"
  />
</template>
