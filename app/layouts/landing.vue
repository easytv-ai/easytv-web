<script setup lang="ts">
const { applyThemeToDocument } = useTheme()

onMounted(() => {
  applyThemeToDocument()
})
</script>

<template>
  <div class="lp-root">
    <slot />
    <StudioPricingModal />
  </div>
</template>
