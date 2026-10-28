<script setup lang="ts">
const { t } = useI18n()

</script>

<template>
  <section class="plan-enterprise">
    <div>
      <UIcon name="i-lucide-building-2" class="size-5" />
      <div>
        <h2>{{ t('企业版') }}</h2>
        <p>{{ t('需要更多席位、集中采购或专属配额，可以联系我们定制。') }}</p>
      </div>
    </div>
    <a class="plan-btn plan-btn--ghost plan-enterprise__cta" href="mailto:hello@easytv.com">
      {{ t('联系我们') }}
    </a>
  </section>
</template>
