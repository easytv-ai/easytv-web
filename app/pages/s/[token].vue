<script setup lang="ts">
/**
 * 旧短链兼容：/s/:token 在 2026-09-18 改成了 /share/:token。
 * 已经发出去的链接（分享过的画布、分享海报）还是旧路径，这里 301 到新地址，查询参数与语言前缀原样带上。
 */
definePageMeta({
  layout: false,
})

const route = useRoute()
const localePath = useLocalePath()
const raw = route.params.token
const value = String(Array.isArray(raw) ? raw[0] : raw ?? '').trim()

await navigateTo(
  { path: localePath(value ? `/share/${encodeURIComponent(value)}` : '/'), query: route.query, hash: route.hash },
  { redirectCode: 301, replace: true },
)
</script>

<template>
  <div />
</template>
