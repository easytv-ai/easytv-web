<script setup lang="ts">
import taskApi from '~/api/task'
import type { GenerationModel } from '~/types/creative'
import { outpaintFrameSize } from '~/utils/canvas-image-edit'
import { listImageEditModels } from '~/utils/image-input'
import { effectiveUnitPrice, estimateTaskPoints, modelPromoDisplay } from '~/utils/model-price'
import { shortModelName } from '~/utils/model-name'

const { t } = useI18n()
const { isMember } = useWallet()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  submitting?: boolean
  box?: { left: number, top: number, width: number, height: number } | null
}>(), {
  submitting: false,
  box: null,
})

const emit = defineEmits<{
  close: []
  submit: [payload: { model: string, ratio: string }]
}>()

type OutpaintRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3'

const RATIO_ITEMS: { id: OutpaintRatio, label: string, icon: string }[] = [
  { id: '1:1', label: '1:1', icon: 'i-lucide-square' },
  { id: '16:9', label: '16:9', icon: 'i-lucide-rectangle-horizontal' },
  { id: '9:16', label: '9:16', icon: 'i-lucide-smartphone' },
  { id: '4:3', label: '4:3', icon: 'i-lucide-monitor' },
  { id: '3:4', label: '3:4', icon: 'i-lucide-smartphone' },
  { id: '3:2', label: '3:2', icon: 'i-lucide-rectangle-horizontal' },
  { id: '2:3', label: '2:3', icon: 'i-lucide-rectangle-vertical' },
]

const UNIT_LABEL: Record<string, string> = { second: '秒', image: '张', call: '次' }
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const generationModelsLoaded = useState('generation-models-loaded', () => false)
const ratio = ref<OutpaintRatio>('16:9')
const ratioOpen = ref(false)
const modelId = ref('')
const modelMenu = ref(false)

const editModels = computed(() => listImageEditModels(generationModels.value, false))
const pickerModels = computed(() => editModels.value.map((item) => {
  const name = shortModelName(item)
  const label = String(item.label || '').trim()
  const desc = label && label !== name ? label : (item.provider || '')
  const promo = item.priced ? modelPromoDisplay(item, isMember.value) : null
  return {
    id: item.model,
    name,
    desc,
    ...(promo ? { promo: { ...promo, unit: UNIT_LABEL[item.unit] || '次' } } : {}),
  }
}))
const currentPicker = computed(() => pickerModels.value.find(item => item.id === modelId.value) || pickerModels.value[0] || null)
const currentApiModel = computed(() => editModels.value.find(item => item.model === modelId.value) || editModels.value[0] || null)
const zapCost = computed<number | string>(() => {
  const m = currentApiModel.value
  if (!m)
    return ''
  if (!m.priced)
    return t('未定价')
  return estimateTaskPoints(effectiveUnitPrice(m, isMember.value), m.unit, 1)
})

const frameStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  const size = outpaintFrameSize(box.width, box.height, ratio.value)
  return {
    left: `${box.left + (box.width - size.w) / 2}px`,
    top: `${box.top + (box.height - size.h) / 2}px`,
    width: `${size.w}px`,
    height: `${size.h}px`,
  }
})

const photoStyle = computed(() => {
  const box = props.box
  const frame = frameStyle.value
  if (!box || !frame)
    return null
  const w = Number.parseFloat(frame.width)
  const h = Number.parseFloat(frame.height)
  return {
    width: `${box.width}px`,
    height: `${box.height}px`,
    left: `${(w - box.width) / 2}px`,
    top: `${(h - box.height) / 2}px`,
  }
})

function syncModel() {
  if (!editModels.value.some(item => item.model === modelId.value))
    modelId.value = editModels.value[0]?.model || ''
}

function pickModel(id: string) {
  modelId.value = id
  modelMenu.value = false
}

function pickRatio(id: OutpaintRatio) {
  ratio.value = id
  ratioOpen.value = false
}

function toggleModel() {
  ratioOpen.value = false
  modelMenu.value = !modelMenu.value
}

function toggleRatio() {
  modelMenu.value = false
  ratioOpen.value = !ratioOpen.value
}

function submit() {
  const model = currentPicker.value?.id
  if (!model || props.submitting)
    return
  emit('submit', { model, ratio: ratio.value })
}

function onDocPointer(event: PointerEvent) {
  if (!modelMenu.value && !ratioOpen.value)
    return
  const el = event.target as HTMLElement | null
  if (el?.closest('.canvas-outpaint__model, .canvas-outpaint__ratio'))
    return
  modelMenu.value = false
  ratioOpen.value = false
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    if (modelMenu.value || ratioOpen.value) {
      modelMenu.value = false
      ratioOpen.value = false
      return
    }
    emit('close')
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    submit()
  }
}

watch(() => props.open, (on) => {
  if (!on) {
    ratioOpen.value = false
    modelMenu.value = false
    return
  }
  ratio.value = '16:9'
  syncModel()
}, { immediate: true })

watch(editModels, syncModel, { immediate: true })

onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onDocPointer, true)
  if (!generationModelsLoaded.value) {
    generationModelsLoaded.value = true
    void taskApi.models().then((res) => {
      if (res?.success && Array.isArray(res.data))
        generationModels.value = res.data
    })
  }
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('pointerdown', onDocPointer, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && frameStyle"
      class="canvas-outpaint-layer nodrag nopan"
      :style="frameStyle"
    >
      <div class="canvas-outpaint__stage">
        <i class="canvas-outpaint__check" />
        <img
          v-if="photoStyle"
          class="canvas-outpaint__photo"
          :src="src"
          alt=""
          :style="photoStyle"
        >
        <i class="canvas-outpaint__corner is-nw" />
        <i class="canvas-outpaint__corner is-ne" />
        <i class="canvas-outpaint__corner is-sw" />
        <i class="canvas-outpaint__corner is-se" />
      </div>
      <div class="canvas-outpaint__tools nodrag nopan nowheel" @pointerdown.stop>
        <button type="button" class="canvas-outpaint__close" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-3.5" />
          <span>{{ t('AI图像扩展') }}</span>
        </button>
        <span class="canvas-smart__split" />
        <div v-if="currentPicker" class="canvas-outpaint__model canvas-inspector__model">
          <button
            type="button"
            class="canvas-inspector__model-btn"
            :class="{ 'is-on': modelMenu }"
            :title="currentPicker.desc || currentPicker.name"
            :aria-expanded="modelMenu"
            :aria-label="t('模型')"
            @click="toggleModel"
          >
            <UIcon name="i-lucide-sparkles" class="size-3.5" />
            <span class="canvas-inspector__model-name">{{ currentPicker.name }}</span>
            <UIcon name="i-lucide-chevron-down" class="size-3.5" />
          </button>
          <div v-if="modelMenu" class="canvas-inspector__models nowheel" @pointerdown.stop @wheel.stop>
            <button
              v-for="item in pickerModels"
              :key="item.id"
              type="button"
              :class="{ 'is-on': modelId === item.id }"
              @click="pickModel(item.id)"
            >
              <span class="canvas-inspector__model-mark" />
              <span>
                <strong>{{ item.name }}</strong>
                <em v-if="item.desc" :title="item.desc">{{ item.desc }}</em>
                <small v-if="item.promo" class="canvas-promo">
                  <s>{{ item.promo.origin }}</s>
                  {{ t('{n} 积分/{unit}', { n: item.promo.price, unit: t(item.promo.unit) }) }}
                  <i class="canvas-promo__chip">{{ item.promo.label || t('促销') }}</i>
                </small>
              </span>
            </button>
          </div>
        </div>
        <div class="canvas-outpaint__ratio">
          <button type="button" :class="{ 'is-on': ratioOpen }" @click="toggleRatio">
            <UIcon name="i-lucide-rectangle-horizontal" class="size-3.5" />
            <span>{{ ratio }}</span>
            <UIcon name="i-lucide-chevron-down" class="size-3.5" />
          </button>
          <div v-if="ratioOpen" class="canvas-crop__ratios">
            <button
              v-for="item in RATIO_ITEMS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': ratio === item.id }"
              @click="pickRatio(item.id)"
            >
              <UIcon :name="item.icon" class="size-4" />
              <span>{{ t(item.label) }}</span>
            </button>
          </div>
        </div>
        <span v-if="zapCost !== ''" class="canvas-smart__cost">
          <UIcon name="i-lucide-zap" class="size-3.5" />
          {{ zapCost }}
        </span>
        <button
          type="button"
          class="canvas-smart__send"
          :disabled="submitting || !currentPicker"
          :aria-label="t('生成')"
          @click="submit"
        >
          <UIcon
            :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'"
            class="size-3.5"
            :class="{ 'animate-spin': submitting }"
          />
        </button>
      </div>
    </div>
  </Teleport>
</template>
