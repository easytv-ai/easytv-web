<script setup lang="ts">
withDefaults(defineProps<{
  text?: string
}>(), {
  text: '',
})
</script>

<template>
  <div
    class="studio-loading"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <UIcon name="i-lucide-loader-circle" class="studio-loading__icon size-4 animate-spin" />
    <span v-if="text">{{ text }}</span>
  </div>
</template>
