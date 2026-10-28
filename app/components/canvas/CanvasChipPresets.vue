<script setup lang="ts">
export type ChipPresetItem = { id: string, label: string, hint?: string, meta?: string }

const PRESET_ICON: Record<string, string> = {
  'multi-cam-9': 'i-lucide-layout-grid',
  'story-4': 'i-lucide-clapperboard',
  'storyboard-25': 'i-lucide-grid-3x3',
  'cine-light': 'i-lucide-sun',
  'before-5s': 'i-lucide-skip-back',
  'after-3s': 'i-lucide-skip-forward',
  'character-sheet': 'i-lucide-person-standing',
  'storyboard': 'i-lucide-panels-top-left',
  'blocking-board': 'i-lucide-map',
}

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  title: string
  hint?: string
  items: ChipPresetItem[]
  value?: string
}>()

const emit = defineEmits<{
  close: []
  pick: [id: string]
}>()

function presetIcon(id: string) {
  return PRESET_ICON[id] || 'i-lucide-sparkles'
}

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask canvas-presets-mask"
      @click.self="emit('close')"
      @pointerdown.stop
    >
      <div class="studio-modal canvas-presets" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ title }}</h2>
            <p v-if="hint">{{ hint }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="canvas-presets__picks">
          <button
            v-for="item in items"
            :key="item.id"
            type="button"
            :class="{ 'is-on': value === item.id, 'has-hint': !!item.hint }"
            @click="emit('pick', item.id)"
          >
            <template v-if="item.hint">
              <span class="canvas-presets__mark" aria-hidden="true">
                <UIcon :name="presetIcon(item.id)" class="size-4" />
              </span>
              <span class="canvas-presets__copy">
                <strong>{{ item.label }}</strong>
                <em>{{ item.hint }}</em>
              </span>
              <span v-if="item.meta" class="canvas-presets__meta">{{ item.meta }}</span>
            </template>
            <strong v-else>{{ item.label }}</strong>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
