<script setup lang="ts">
import type { GenerationModel } from '~/types/creative'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'
import { listImageUpscaleModels } from '~/utils/image-input'
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

const models = computed(() => listImageUpscaleModels(generationModels.value))

const draft = computed(() => {
  const picked = String(props.params?.model || '')
  const model = models.value.some(item => item.model === picked)
    ? picked
    : (models.value[0]?.model || '')
  const scale = props.params?.scale
  return {
    model,
    scale: scale === 4 || scale === 6 ? scale : 2 as const,
  }
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
            <button type="button" class="canvas-hd__select" :class="{ 'is-on': menuOpen }" @click.stop="menuOpen = !menuOpen">
              <UIcon name="i-lucide-box" class="size-3.5" />
              <em>{{ modelLabel }}</em>
              <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-hd__chev" />
            </button>
            <div v-if="menuOpen" class="canvas-hd__pop canvas-hd__pop--up canvas-hd__pop--models nowheel" @pointerdown.stop @wheel.stop>
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
