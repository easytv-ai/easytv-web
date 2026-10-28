<script setup lang="ts">
import { privacyDocument } from '~/content/legal/zh'

definePageMeta({
  layout: 'simple',
})

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
