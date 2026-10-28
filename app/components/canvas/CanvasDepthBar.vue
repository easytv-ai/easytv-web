<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  submitting?: boolean
  resolution: '480p' | '720p'
  model?: string
  models?: string[]
  panelStyle?: Record<string, string> | null
}>(), {
  submitting: false,
  model: '',
  models: () => [],
  panelStyle: null,
})

const emit = defineEmits<{
  close: []
  'update:resolution': [value: '480p' | '720p']
  'update:model': [value: string]
  submit: []
}>()

const menuOpen = ref(false)

const modelOptions = computed(() => (props.models || []).map(String).filter(Boolean))
const modelLabel = computed(() => props.model || modelOptions.value[0] || t('模型'))

function toggleMenu() {
  if (!modelOptions.value.length)
    return
  menuOpen.value = !menuOpen.value
}

function pickModel(id: string) {
  emit('update:model', id)
  menuOpen.value = false
}

function onDocPointerDown(event: PointerEvent) {
  if (!menuOpen.value)
    return
  const target = event.target as HTMLElement | null
  if (!target?.closest)
    return
  if (target.closest('.canvas-depth__menu') || target.closest('[data-pop="depth-model"]'))
    return
  menuOpen.value = false
}

watch(() => props.open, (on) => {
  if (!import.meta.client)
    return
  if (on) {
    window.addEventListener('pointerdown', onDocPointerDown, true)
    return
  }
  menuOpen.value = false
  window.removeEventListener('pointerdown', onDocPointerDown, true)
}, { immediate: true })

onBeforeUnmount(() => {
  if (import.meta.client)
    window.removeEventListener('pointerdown', onDocPointerDown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && panelStyle"
      class="canvas-depth nodrag nopan nowheel"
      :style="panelStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <button type="button" class="canvas-depth__back" :aria-label="t('关闭')" @click="emit('close')">
        <UIcon name="i-lucide-x" class="size-3.5" />
        {{ t('深度提取') }}
      </button>
      <span class="canvas-depth__split" />
      <div class="canvas-depth__picks" role="group" :aria-label="t('分辨率')">
        <button type="button" :class="{ 'is-on': resolution === '480p' }" @click="emit('update:resolution', '480p')">480p</button>
        <button type="button" :class="{ 'is-on': resolution === '720p' }" @click="emit('update:resolution', '720p')">720p</button>
      </div>
      <div v-if="modelOptions.length" class="canvas-depth__model">
        <button
          type="button"
          class="canvas-depth__model-btn"
          data-pop="depth-model"
          :class="{ 'is-on': menuOpen }"
          :aria-expanded="menuOpen"
          @click="toggleMenu"
        >
          <UIcon name="i-lucide-hexagon" class="size-3.5" />
          {{ modelLabel }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5" />
        </button>
        <div v-if="menuOpen" class="canvas-depth__menu" role="listbox" :aria-label="t('模型')">
          <button
            v-for="item in modelOptions"
            :key="item"
            type="button"
            role="option"
            :aria-selected="item === model"
            :class="{ 'is-on': item === model }"
            @click="pickModel(item)"
          >
            <UIcon name="i-lucide-hexagon" class="size-3.5" />
            {{ item }}
          </button>
        </div>
      </div>
      <button
        type="button"
        class="canvas-depth__send"
        :disabled="submitting"
        :aria-label="t('生成')"
        @click="emit('submit')"
      >
        <UIcon
          :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'"
          class="size-3.5"
          :class="{ 'animate-spin': submitting }"
        />
      </button>
    </div>
  </Teleport>
</template>
