<script setup lang="ts">
import type { GenerationModel } from '~/types/creative'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import { listImageUpscaleModels, shownImageUpscaleModel } from '~/utils/image-input'
import { shortModelName } from '~/utils/model-name'

const { t } = useI18n()
const generationModels = useState<GenerationModel[]>('generation-models', () => [])

const props = withDefaults(defineProps<{
  open: boolean
  params?: CanvasNodeData['imageHdParams'] | null
  panelStyle?: Record<string, string> | null
  submitting?: boolean
  cost?: number | string
}>(), {
  params: null,
  panelStyle: null,
  submitting: false,
  cost: undefined,
})

const emit = defineEmits<{
  'update:params': [value: NonNullable<CanvasNodeData['imageHdParams']>]
  submit: []
}>()

const SCALES = [2, 4, 6] as const
const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const models = computed(() => listImageUpscaleModels(generationModels.value))

const draft = computed(() => {
  const scale = props.params?.scale
  return {
    model: shownImageUpscaleModel(generationModels.value, props.params?.model),
    scale: scale === 4 || scale === 6 ? scale : 2 as const,
  }
})

// 面板上看到的模型和倍数写回节点。报价、提交读的是节点，不能只在这里兜底显示。
watch(draft, (next) => {
  if (!props.open || !next.model)
    return
  const stored = String(props.params?.model || '')
  const storedScale = props.params?.scale === 4 || props.params?.scale === 6 ? props.params.scale : 2
  if (next.model === stored && next.scale === storedScale)
    return
  emit('update:params', { model: next.model, scale: next.scale })
})

function modelName(item?: GenerationModel) {
  if (!item)
    return t('通用')
  return shortModelName(item)
}

const modelLabel = computed(() => modelName(models.value.find(item => item.model === draft.value.model) || models.value[0]))

const currentModel = computed(() => models.value.find(item => item.model === draft.value.model))

const costLabel = computed(() => {
  const value = props.cost
  if (value === undefined || value === null || value === '' || value === 0)
    return t('未定价')
  return String(value)
})

function patch(partial: Partial<NonNullable<CanvasNodeData['imageHdParams']>>) {
  emit('update:params', { ...draft.value, ...partial })
}

function closeMenus() {
  menuOpen.value = false
}

/** 打开时把当前模型滚到列表中间。菜单每次都是新的，不滚就会从第一条开始。 */
function scrollMenuToSelected() {
  const container = menuRef.value
  if (!container)
    return
  const el = container.querySelector<HTMLElement>('button.is-on')
  if (!el)
    return
  const top = el.offsetTop
  const bottom = top + el.offsetHeight
  if (top >= container.scrollTop && bottom <= container.scrollTop + container.clientHeight)
    return
  container.scrollTop = top + el.offsetHeight / 2 - container.clientHeight / 2
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value)
    nextTick(scrollMenuToSelected)
}

function onPanelPointer(event: PointerEvent) {
  const el = event.target as HTMLElement
  if (!el.closest('.canvas-hd__ctrl'))
    closeMenus()
}

watch(() => props.open, (open) => {
  if (!open)
    closeMenus()
})
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
        <strong>{{ t('高清放大') }}</strong>
      </header>

      <div class="canvas-hd__rows">
        <div class="canvas-hd__row">
          <span class="canvas-hd__label">{{ t('模型选择') }}</span>
          <div class="canvas-hd__ctrl">
            <button type="button" class="canvas-hd__select" :class="{ 'is-on': menuOpen }" @click.stop="toggleMenu">
              <UIcon name="i-lucide-box" class="size-3.5" />
              <em>{{ modelLabel }}</em>
              <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-hd__chev" />
            </button>
            <div v-if="menuOpen" ref="menuRef" class="canvas-hd__pop canvas-hd__pop--up canvas-hd__pop--models nowheel" @pointerdown.stop @wheel.stop>
              <button
                v-for="item in models"
                :key="item.model"
                type="button"
                :class="{ 'is-on': item.model === draft.model }"
                :title="item.label || modelName(item)"
                @click="patch({ model: item.model }); menuOpen = false"
              >
                <UIcon name="i-lucide-box" class="size-3.5" />
                <span>{{ modelName(item) }}</span>
              </button>
            </div>
          </div>
        </div>

        <div class="canvas-hd__row">
          <span class="canvas-hd__label">{{ t('放大倍数') }}</span>
          <div class="canvas-hd__picks" role="group" :aria-label="t('放大倍数')">
            <button
              v-for="scale in SCALES"
              :key="scale"
              type="button"
              :class="{ 'is-on': draft.scale === scale }"
              @click="patch({ scale })"
            >
              {{ scale }}
            </button>
          </div>
        </div>
      </div>

      <footer class="canvas-hd__bar">
        <span class="canvas-smart__cost">
          <UIcon name="i-lucide-zap" class="size-3.5" />
          {{ costLabel }}
        </span>
        <button
          type="button"
          class="canvas-smart__send"
          :disabled="submitting || !currentModel"
          :aria-label="t('生成')"
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
