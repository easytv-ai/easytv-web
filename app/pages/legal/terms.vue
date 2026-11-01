<script setup lang="ts">
import { buildLegalDocuments } from '~/content/legal/zh'

definePageMeta({
  layout: 'simple',
})

const { termsDocument } = buildLegalDocuments(String(useRuntimeConfig().public.contactEmail || ''))

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
