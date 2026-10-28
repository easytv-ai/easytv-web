<script setup lang="ts">
const { hydrate } = useAuth()

onMounted(() => {
  hydrate()
})
</script>

<template>
  <div class="min-h-dvh bg-[var(--ea-bg)] text-[color:var(--ea-text)]">
    <slot />
  </div>
</template>
