<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  compact?: boolean
}>()
</script>

<template>
  <div class="studio-empty" :class="{ 'is-compact': compact }">
    <svg
      class="studio-empty__art"
      viewBox="0 0 220 168"
      width="220"
      height="168"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="110" cy="148" rx="72" ry="10" fill="currentColor" opacity=".08" />
      <rect width="128" height="88" x="46" y="42" fill="currentColor" opacity=".06" rx="16" />
      <rect width="128" height="88" x="46" y="42" stroke="currentColor" stroke-opacity=".22" stroke-width="1.5" rx="16" />
      <rect width="40" height="28" x="58" y="56" fill="currentColor" opacity=".1" rx="6" />
      <path stroke="currentColor" stroke-linecap="round" stroke-opacity=".28" stroke-width="1.5" d="M108 70h50M108 80h36" />
      <circle cx="156" cy="108" r="18" fill="currentColor" opacity=".1" />
      <path fill="currentColor" fill-opacity=".45" d="M152.2 101.6a1.2 1.2 0 0 1 2.1 0l10.2 17.4a1.2 1.2 0 0 1-1.05 1.8H143a1.2 1.2 0 0 1-1.04-1.8z" />
      <circle cx="154.2" cy="116.2" r="1.3" fill="currentColor" opacity=".55" />
      <path stroke="currentColor" stroke-linecap="round" stroke-opacity=".45" stroke-width="1.4" d="M154.2 108.4v4.6" />
      <rect width="22" height="16" x="86" y="28" fill="currentColor" opacity=".12" rx="4" />
      <rect width="5" height="5" x="89" y="24" fill="currentColor" opacity=".28" rx="1" />
      <rect width="5" height="5" x="97" y="24" fill="currentColor" opacity=".28" rx="1" />
      <path fill="currentColor" fill-opacity=".5" d="M92.8 32.2 99 36.2a.8.8 0 0 1 0 1.36L92.8 41.5a.8.8 0 0 1-1.2-.68v-8a.8.8 0 0 1 1.2-.68Z" />
      <path stroke="currentColor" stroke-linecap="round" stroke-opacity=".3" stroke-width="1.4" d="m168 36 6-8m8 14 8-4" />
      <circle cx="174" cy="28" r="2" fill="currentColor" opacity=".28" />
    </svg>
    <strong>{{ title }}</strong>
    <p v-if="description">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="studio-empty__action">
      <slot />
    </div>
  </div>
</template>
