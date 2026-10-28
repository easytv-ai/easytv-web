<script setup lang="ts">
const { t } = useI18n()

export interface LegalSection {
  title: string
  paragraphs?: string[]
  items?: string[]
  subsections?: {
    title: string
    paragraphs?: string[]
    items?: string[]
  }[]
}

defineProps<{
  title: string
  updatedAt: string
  intro?: string[]
  sections: LegalSection[]
}>()
</script>

<template>
  <article class="legal-article mx-auto w-full min-w-0 max-w-3xl self-start">
    <header class="legal-article__header mb-8 border-b pb-6">
      <h1 class="legal-article__title text-2xl font-bold sm:text-3xl">
        {{ title }}
      </h1>
      <p class="legal-article__meta mt-2 text-sm">
        {{ t('最后更新：') }}{{ updatedAt }}
      </p>
    </header>

    <div
      v-if="intro?.length"
      class="legal-article__intro mb-8 space-y-3 text-sm leading-7"
    >
      <p v-for="(paragraph, index) in intro" :key="`intro-${index}`">
        {{ paragraph }}
      </p>
    </div>

    <div class="space-y-8">
      <section
        v-for="(section, sectionIndex) in sections"
        :key="`${section.title}-${sectionIndex}`"
        class="legal-article__section min-w-0"
      >
        <h2 class="legal-article__heading mb-3 text-lg font-semibold">
          {{ section.title }}
        </h2>

        <div
          v-if="section.paragraphs?.length"
          class="space-y-3 text-sm leading-7"
        >
          <p v-for="(paragraph, index) in section.paragraphs" :key="`${sectionIndex}-p-${index}`">
            {{ paragraph }}
          </p>
        </div>

        <ul
          v-if="section.items?.length"
          class="legal-article__list mt-3 list-disc space-y-2 pl-5 text-sm leading-7"
        >
          <li v-for="(item, index) in section.items" :key="`${sectionIndex}-i-${index}`">
            {{ item }}
          </li>
        </ul>

        <div v-if="section.subsections?.length" class="mt-4 space-y-5">
          <div
            v-for="(subsection, subIndex) in section.subsections"
            :key="`${sectionIndex}-sub-${subIndex}`"
            class="min-w-0"
          >
            <h3 class="legal-article__subheading mb-2 text-base font-medium">
              {{ subsection.title }}
            </h3>
            <div
              v-if="subsection.paragraphs?.length"
              class="space-y-3 text-sm leading-7"
            >
              <p v-for="(paragraph, index) in subsection.paragraphs" :key="`${sectionIndex}-sub-${subIndex}-p-${index}`">
                {{ paragraph }}
              </p>
            </div>
            <ul
              v-if="subsection.items?.length"
              class="legal-article__list mt-3 list-disc space-y-2 pl-5 text-sm leading-7"
            >
              <li v-for="(item, index) in subsection.items" :key="`${sectionIndex}-sub-${subIndex}-i-${index}`">
                {{ item }}
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  </article>
</template>
