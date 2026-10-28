<script setup lang="ts">
/** 面板里的一组字段，带小标题（复刻自 open-director 的 InspectorSection，MIT） */
defineProps<{ title: string }>()
</script>

<template>
  <section class="director-section">
    <h3 class="director-section__title">{{ title }}</h3>
    <div class="director-section__body">
      <slot />
    </div>
  </section>
</template>
