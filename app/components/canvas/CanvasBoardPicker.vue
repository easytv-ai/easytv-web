<script setup lang="ts">
const { t } = useI18n()

export type BoardPickItem = {
  id: string
  label: string
  url: string
  kind: 'image' | 'video' | 'audio'
}

const props = defineProps<{
  open: boolean
  items: BoardPickItem[]
}>()

const emit = defineEmits<{
  close: []
  pick: [id: string]
}>()

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
      class="studio-modal-mask"
      @click.self="emit('close')"
      @pointerdown.stop
    >
      <div class="studio-modal canvas-board-pick" role="dialog" aria-modal="true" aria-labelledby="board-pick-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="board-pick-title">{{ t('从画布选择') }}</h2>
            <p>{{ t('选择当前画布上的节点作为参考') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="canvas-board-pick__body">
          <div v-if="!items.length" class="asset-picker__empty">
            <span class="asset-picker__empty-mark">
              <UIcon name="i-lucide-layout-grid" class="size-8" />
            </span>
            <strong>{{ t('画布上还没有可用节点') }}</strong>
            <p>{{ t('先生成或上传素材到画布，再从这里引用') }}</p>
          </div>
          <div v-else class="asset-picker__grid">
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="asset-picker__item"
              :title="item.label"
              @click="emit('pick', item.id)"
            >
              <span class="asset-picker__thumb">
                <img v-if="item.kind === 'image'" :src="item.url" :alt="item.label" loading="lazy">
                <video v-else-if="item.kind === 'video'" :src="item.url" muted preload="metadata" />
                <UIcon v-else name="i-lucide-music" class="size-8" />
              </span>
              <span class="asset-picker__name">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
