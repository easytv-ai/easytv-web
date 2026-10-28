<script setup lang="ts">
/**
 * 下拉选择。原生 option 列表在 Windows 上是系统蓝条，跟站点黑色主题对不上，
 * 所以用手搓一层：按钮 + 浮层，点外面和 Esc 关掉。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** 不传就只画触发器，工具条这种没空写标签的地方用 */
  label?: string
  modelValue: string
  /** 读屏标签，命名理由见 DirectorNumberInput */
  srLabel: string
  options: { value: string, label: string, title?: string, disabled?: boolean }[]
  /** 工具条贴底，菜单得往上翻，不然会被视口 overflow 裁掉 */
  placement?: 'down' | 'up'
}>(), {
  label: '',
  placement: 'down',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const currentLabel = computed(() =>
  props.options.find(item => item.value === props.modelValue)?.label ?? (props.modelValue ?? ''),
)


function onDocPointer(event: PointerEvent) {
  if (!open.value || !rootRef.value)
    return
  if (!rootRef.value.contains(event.target as Node))
    open.value = false
}

const triggerRef = ref<HTMLElement | null>(null)
const listbox = useSelectListbox({
  items: () => props.options,
  modelValue: () => props.modelValue,
  open,
  trigger: triggerRef,
  list: listRef,
  commit: value => emit('update:modelValue', String(value)),
})

/** 焦点不在触发器上时（Safari 点按钮不给焦点）兜底：Esc 仍能关掉 */
function onKey(event: KeyboardEvent) {
  if (!open.value || event.key !== 'Escape' || event.target === triggerRef.value)
    return
  event.preventDefault()
  open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div
    ref="rootRef"
    class="director-field director-field--select"
    :class="{ 'director-field--bare': !label }"
  >
    <span v-if="label" class="director-field__label">{{ label }}</span>
    <div
      class="director-select"
      :class="{ 'is-open': open, 'director-select--up': placement === 'up' }"
    >
      <button
        ref="triggerRef"
        type="button"
        class="director-select__trigger"
        :aria-label="srLabel"
        :aria-expanded="open"
        aria-haspopup="listbox"
        :aria-activedescendant="listbox.activeId.value"
        @click="open = !open"
        @keydown="listbox.onTriggerKeydown"
      >
        <span>{{ currentLabel }}</span>
        <UIcon name="i-lucide-chevron-down" class="size-3.5 director-select__chevron" />
      </button>
      <ul
        v-if="open"
        ref="listRef"
        class="director-select__menu"
        role="listbox"
        :aria-label="srLabel"
      >
        <li v-for="(option, index) in options" :key="option.value">
          <button
            :id="listbox.optionId(index)"
            type="button"
            tabindex="-1"
            class="director-select__option"
            :class="{ 'is-on': option.value === modelValue, 'is-active': index === listbox.activeIndex.value }"
            role="option"
            :aria-selected="option.value === modelValue"
            :disabled="option.disabled"
            :title="option.title || option.label"
            @click="listbox.onPick(option.value, option.disabled)"
          >
            <span>{{ option.label }}</span>
            <UIcon v-if="option.value === modelValue" name="i-lucide-check" class="size-3.5" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
