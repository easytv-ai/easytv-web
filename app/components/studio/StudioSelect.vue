<script setup lang="ts">
/**
 * 站点下拉。原生 option 在 Windows 上是系统蓝条，跟黑色主题对不上，
 * 所以用手搓一层：按钮 + 浮层，点外面和 Esc 关掉。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type StudioSelectOption = {
  value: string | number
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string | number | null | undefined
  options: StudioSelectOption[]
  srLabel: string
  disabled?: boolean
  /** default 跟设置页输入框齐高；compact 跟创作台圆角选择框齐高 */
  size?: 'default' | 'compact'
  /** 贴底的工具条菜单往上翻，避免被裁掉 */
  placement?: 'down' | 'up'
}>(), {
  disabled: false,
  size: 'default',
  placement: 'down',
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const currentLabel = computed(() =>
  props.options.find(item => item.value === props.modelValue)?.label ?? (props.modelValue == null ? '' : String(props.modelValue)),
)

function toggle() {
  if (props.disabled)
    return
  open.value = !open.value
}

const menuBox = ref<Record<string, string>>({})

function placeMenu() {
  const el = triggerRef.value || rootRef.value
  if (!el)
    return
  const rect = el.getBoundingClientRect()
  const width = `${Math.max(rect.width, 148)}px`
  menuBox.value = props.placement === 'up'
    ? {
        position: 'fixed',
        left: `${rect.left}px`,
        width,
        bottom: `${window.innerHeight - rect.top + 6}px`,
        top: 'auto',
      }
    : {
        position: 'fixed',
        left: `${rect.left}px`,
        width,
        top: `${rect.bottom + 6}px`,
      }
}


function onDocPointer(event: PointerEvent) {
  if (!open.value)
    return
  const target = event.target as Node
  if (rootRef.value?.contains(target) || listRef.value?.contains(target))
    return
  open.value = false
}

function onReposition(event?: Event) {
  if (!open.value)
    return
  const target = event?.target
  if (target instanceof Node && listRef.value?.contains(target))
    return
  open.value = false
}

const listbox = useSelectListbox({
  items: () => props.options,
  modelValue: () => props.modelValue,
  open,
  disabled: () => props.disabled,
  trigger: triggerRef,
  list: listRef,
  commit: value => emit('update:modelValue', value),
})

/** 焦点不在触发器上时（Safari 点按钮不给焦点）兜底：Esc 仍能关掉 */
function onKey(event: KeyboardEvent) {
  if (!open.value || event.key !== 'Escape' || event.target === triggerRef.value)
    return
  event.preventDefault()
  open.value = false
}

watch(() => props.disabled, (off) => {
  if (off)
    open.value = false
})

watch(open, async (isOpen) => {
  if (!isOpen)
    return
  await nextTick()
  placeMenu()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKey)
  window.addEventListener('scroll', onReposition, true)
  window.addEventListener('resize', onReposition)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', onReposition, true)
  window.removeEventListener('resize', onReposition)
})
</script>

<template>
  <div
    ref="rootRef"
    class="studio-select"
    :class="{
      'is-open': open,
      'is-compact': size === 'compact',
      'is-up': placement === 'up',
      'is-disabled': disabled,
    }"
  >
    <button
      ref="triggerRef"
      type="button"
      class="studio-select__trigger"
      :aria-label="srLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-activedescendant="listbox.activeId.value"
      :disabled="disabled"
      @click="toggle"
      @keydown="listbox.onTriggerKeydown"
    >
      <span>{{ currentLabel }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4 studio-select__chevron" />
    </button>
    <Teleport to="body">
      <ul
        v-if="open"
        ref="listRef"
        class="studio-select__menu is-portal"
        role="listbox"
        :aria-label="srLabel"
        :style="menuBox"
        @wheel.stop
      >
        <li v-for="(option, index) in options" :key="String(option.value)">
          <button
            :id="listbox.optionId(index)"
            type="button"
            tabindex="-1"
            class="studio-select__option"
            :class="{ 'is-on': option.value === modelValue, 'is-active': index === listbox.activeIndex.value }"
            role="option"
            :aria-selected="option.value === modelValue"
            :disabled="option.disabled"
            @click="listbox.onPick(option.value, option.disabled)"
          >
            <span>{{ option.label }}</span>
            <UIcon v-if="option.value === modelValue" name="i-lucide-check" class="size-3.5" />
          </button>
        </li>
      </ul>
    </Teleport>
  </div>
</template>
