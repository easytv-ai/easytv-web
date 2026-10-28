<script setup lang="ts">
import { filterFindableNodes, type CanvasFindItem } from '~/utils/canvas-find'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  items: CanvasFindItem[]
  query: string
  activeId?: string
}>()

const emit = defineEmits<{
  close: []
  pick: [id: string]
  'update:query': [value: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const hits = computed(() => filterFindableNodes(props.items, props.query))
const activeIndex = computed(() => {
  const idx = hits.value.findIndex(item => item.id === props.activeId)
  return idx >= 0 ? idx : 0
})

watch(() => props.open, (open) => {
  if (open)
    nextTick(() => inputRef.value?.focus())
})

watch(activeIndex, () => {
  nextTick(() => {
    const el = listRef.value?.querySelector<HTMLElement>('.is-on')
    el?.scrollIntoView({ block: 'nearest' })
  })
})

function pickAt(index: number) {
  const hit = hits.value[index] ?? hits.value[0]
  if (!hit)
    return
  emit('pick', hit.id)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'F3' && !event.shiftKey) {
    event.preventDefault()
    event.stopPropagation()
    const next = hits.value.length ? (activeIndex.value + 1) % hits.value.length : 0
    if (event.key === 'F3')
      pickAt(next)
    else
      pickAt(next)
    return
  }
  if (event.key === 'ArrowUp' || (event.key === 'F3' && event.shiftKey)) {
    event.preventDefault()
    event.stopPropagation()
    const next = hits.value.length ? (activeIndex.value - 1 + hits.value.length) % hits.value.length : 0
    pickAt(next)
    return
  }
  if (event.key === 'Enter' && hits.value.length) {
    event.preventDefault()
    pickAt(activeIndex.value)
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="canvas-find-layer"
      @pointerdown.self="emit('close')"
    >
      <div class="canvas-find" role="dialog" aria-modal="true" aria-labelledby="canvas-find-title">
        <header class="canvas-find__head">
          <h2 id="canvas-find-title">{{ t('canvas.find.title') }}</h2>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <input
          ref="inputRef"
          class="canvas-find__input"
          type="search"
          :value="query"
          :placeholder="t('canvas.find.placeholder')"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          @keydown="onKeydown"
        >
        <p v-if="!hits.length" class="canvas-find__empty">{{ t('canvas.find.empty') }}</p>
        <ul v-else ref="listRef" class="canvas-find__list">
          <li v-for="(item, index) in hits" :key="item.id">
            <button
              type="button"
              :class="{ 'is-on': index === activeIndex }"
              @click="emit('pick', item.id)"
            >
              <strong>{{ item.label || item.id }}</strong>
              <small>{{ item.kindLabel || item.kind }}</small>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>
