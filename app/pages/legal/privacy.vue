<script setup lang="ts">
import { buildLegalDocuments } from '~/content/legal/zh'

definePageMeta({
  layout: 'simple',
})

const { privacyDocument } = buildLegalDocuments(String(useRuntimeConfig().public.contactEmail || ''))

useHead({ title: privacyDocument.title })
</script>

<template>
  <LegalArticle
    :title="privacyDocument.title"
    :updated-at="privacyDocument.updatedAt"
    :intro="privacyDocument.intro"
    :sections="privacyDocument.sections"
  />
</template>
