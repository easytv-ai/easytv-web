<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  x: number
  y: number
  canUndo?: boolean
  canRedo?: boolean
  canPaste?: boolean
  isMac?: boolean
}>(), {
  canUndo: false,
  canRedo: false,
  canPaste: false,
  isMac: false,
})

const emit = defineEmits<{
  upload: []
  add: []
  undo: []
  redo: []
  paste: []
}>()

const keys = computed(() => {
  const cmd = props.isMac ? '⌘' : 'Ctrl+'
  const shift = props.isMac ? '⇧' : 'Shift+'
  return {
    undo: `${cmd}Z`,
    redo: props.isMac ? `${shift}${cmd}Z` : 'Ctrl+Shift+Z',
    paste: `${cmd}V`,
  }
})
</script>

<template>
  <div
    class="canvas-ctx nodrag nopan"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
    @dblclick.stop
    @contextmenu.prevent
  >
    <button type="button" @click="emit('upload')">
      {{ t('上传') }}
    </button>
    <button type="button" @click="emit('add')">
      {{ t('添加节点') }}
    </button>
    <i class="canvas-ctx__line" />
    <button type="button" :disabled="!canUndo" @click="emit('undo')">
      {{ t('撤销') }}
      <kbd>{{ keys.undo }}</kbd>
    </button>
    <button type="button" :disabled="!canRedo" @click="emit('redo')">
      {{ t('重做') }}
      <kbd>{{ keys.redo }}</kbd>
    </button>
    <i class="canvas-ctx__line" />
    <button type="button" :disabled="!canPaste" @click="emit('paste')">
      {{ t('粘贴') }}
      <kbd>{{ keys.paste }}</kbd>
    </button>
  </div>
</template>
