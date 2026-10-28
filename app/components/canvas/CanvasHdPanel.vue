<script setup lang="ts">
import {
  HD_DEFAULT_PARAMS,
  HD_RESOLUTION_ITEMS,
  type CanvasNodeData,
} from '~/utils/canvas-node-kinds'
import type { MediaAction } from '~/types/creative'

const { t } = useI18n()
/** 媒体工具清单：upscale 动作的 models 就是可选的高清模型（API.md 23.4） */
const mediaActions = useState<MediaAction[]>('media-actions', () => [])

const props = withDefaults(defineProps<{
  open: boolean
  params?: CanvasNodeData['hdParams'] | null
  panelStyle?: Record<string, string> | null
  submitting?: boolean
  /** 工作区有单价再传；默认不写假数字 */
  cost?: number | string
}>(), {
  params: null,
  panelStyle: null,
  submitting: false,
  cost: undefined,
})

const emit = defineEmits<{
  'update:params': [value: NonNullable<CanvasNodeData['hdParams']>]
  submit: []
}>()

const modelMenu = ref(false)

const draft = computed(() => ({
  ...HD_DEFAULT_PARAMS,
  ...(props.params || {}),
}))

/** 留空 = 后端按能力位自动挑；清单里的模型才可选，老画布存的假模型名不认 */
const modelItems = computed(() => {
  const upscale = mediaActions.value.find(item => item.action === 'upscale')
  const models = upscale?.models || []
  return [{ id: '', label: t('自动选择') }, ...models.map(id => ({ id, label: id }))]
})
const modelLabel = computed(() => {
  const found = modelItems.value.find(item => item.id === draft.value.model)
  return found ? found.label : t('自动选择')
})
const upscaleState = computed(() => {
  const upscale = mediaActions.value.find(item => item.action === 'upscale')
  if (!mediaActions.value.length || !upscale)
    return { available: true, reason: '' }
  return { available: upscale.available !== false, reason: upscale.reason || '' }
})

function patch(partial: Partial<NonNullable<CanvasNodeData['hdParams']>>) {
  emit('update:params', { ...draft.value, ...partial })
}

function closeMenus() {
  modelMenu.value = false
}

function toggleModel() {
  modelMenu.value = !modelMenu.value
}

watch(() => props.open, (open) => {
  if (!open)
    closeMenus()
})

function onPanelPointer(event: PointerEvent) {
  const el = event.target as HTMLElement
  if (!el.closest('.canvas-hd__ctrl'))
    closeMenus()
}

const costLabel = computed(() => {
  const value = props.cost
  if (value === undefined || value === null || value === '' || value === 0)
    return t('未定价')
  return String(value)
})

function onEsc(event: KeyboardEvent) {
  if (event.key !== 'Escape')
    return
  if (!modelMenu.value)
    return
  event.stopPropagation()
  closeMenus()
}

onMounted(() => window.addEventListener('keydown', onEsc, true))
onUnmounted(() => window.removeEventListener('keydown', onEsc, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && panelStyle"
      class="canvas-hd nodrag nopan nowheel"
      :style="panelStyle"
      @pointerdown.stop="onPanelPointer"
      @dblclick.stop
    >
      <header class="canvas-hd__head">
        <strong>{{ t('视频高清') }}</strong>
      </header>

      <div class="canvas-hd__rows">
        <div class="canvas-hd__row">
          <span class="canvas-hd__label">{{ t('模型选择') }}</span>
          <div class="canvas-hd__ctrl">
            <button type="button" class="canvas-hd__select" :class="{ 'is-on': modelMenu }" @click.stop="toggleModel">
              <UIcon name="i-lucide-box" class="size-3.5" />
              <em>{{ modelLabel }}</em>
              <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-hd__chev" />
            </button>
            <div v-if="modelMenu" class="canvas-hd__pop" @pointerdown.stop>
              <button
                v-for="item in modelItems"
                :key="item.id || 'auto'"
                type="button"
                :class="{ 'is-on': draft.model === item.id }"
                @click="patch({ model: item.id }); modelMenu = false"
              >
                <UIcon name="i-lucide-box" class="size-3.5" />
                {{ item.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="canvas-hd__row">
          <span class="canvas-hd__label">{{ t('分辨率') }}</span>
          <div class="canvas-hd__picks" role="group" :aria-label="t('分辨率')">
            <button
              v-for="item in HD_RESOLUTION_ITEMS"
              :key="item"
              type="button"
              :class="{ 'is-on': draft.resolution === item }"
              @click="patch({ resolution: item })"
            >
              {{ item }}
            </button>
          </div>
        </div>
      </div>

      <footer class="canvas-hd__bar">
        <span class="canvas-smart__cost">
          <UIcon name="i-lucide-zap" class="size-3.5" />
          {{ costLabel }}
        </span>
        <span v-if="!upscaleState.available" class="canvas-hd__reason" :title="upscaleState.reason">{{ upscaleState.reason }}</span>
        <button
          type="button"
          class="canvas-smart__send"
          :disabled="submitting || !upscaleState.available"
          :aria-label="t('生成')"
          :title="upscaleState.reason || undefined"
          @click="emit('submit')"
        >
          <UIcon
            :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'"
            class="size-3.5"
            :class="{ 'animate-spin': submitting }"
          />
        </button>
      </footer>
    </div>
  </Teleport>
</template>
