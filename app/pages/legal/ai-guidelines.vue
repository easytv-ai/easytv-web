<script setup lang="ts">
import { buildLegalDocuments } from '~/content/legal/zh'

definePageMeta({
  layout: 'simple',
})

const { aiGuidelinesDocument } = buildLegalDocuments(String(useRuntimeConfig().public.contactEmail || ''))

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
