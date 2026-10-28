<script setup lang="ts">
import type { GenerationModel } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'
import {
  LIGHT_BRIGHTNESS_MAX,
  LIGHT_BRIGHTNESS_MIN,
  LIGHT_KELVIN_MAX,
  LIGHT_KELVIN_MIN,
  LIGHT_PRESETS,
  buildLightPrompt,
  lightOverlay,
  type LightPreset,
} from '~/utils/canvas-light'
import { effectiveUnitPrice, estimateTaskPoints } from '~/utils/model-price'
import { pickImageEditModel } from '~/utils/image-input'

const { t } = useI18n()
const { isMember } = useWallet()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  submitting?: boolean
  panelStyle?: Record<string, string> | null
  /** 实际提交用的模型（画布按默认图片模型挑的编辑模型），报价跟它走，否则显示的价和实扣对不上 */
  model?: string
}>(), {
  submitting: false,
  panelStyle: null,
  model: '',
})

const emit = defineEmits<{
  close: []
  submit: [payload: { prompt: string }]
}>()

const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const presetId = ref(LIGHT_PRESETS[0]!.id)
const brightness = ref(LIGHT_PRESETS[0]!.brightness)
const kelvin = ref(LIGHT_PRESETS[0]!.kelvin)
// 预设说明是中文原文作 key：填进输入框时按当前语言翻译（用户会看到并可修改，提交时作为提示词）
const note = ref(t(LIGHT_PRESETS[0]!.note))
const current = computed(() => LIGHT_PRESETS.find(item => item.id === presetId.value) || LIGHT_PRESETS[0]!)
const previewStyle = computed(() => lightOverlay(kelvin.value, brightness.value, current.value.lx, current.value.ly))
const brightnessLabel = computed(() => `${brightness.value > 0 ? '+' : ''}${brightness.value}°`)
const kelvinLabel = computed(() => `${kelvin.value}K`)
const zapCost = computed(() => {
  const modelId = props.model || pickImageEditModel(generationModels.value, '', false)
  const model = generationModels.value.find(item => item.model === modelId)
  if (!model?.priced)
    return ''
  return estimateTaskPoints(effectiveUnitPrice(model, isMember.value), model.unit, 1)
})

watch(() => props.open, (open) => {
  if (!open)
    return
  pickPreset(LIGHT_PRESETS[0]!)
}, { immediate: true })

function pickPreset(item: LightPreset) {
  presetId.value = item.id
  brightness.value = item.brightness
  kelvin.value = item.kelvin
  note.value = t(item.note)
}

function submit() {
  emit('submit', {
    prompt: buildLightPrompt({
      preset: current.value,
      brightness: brightness.value,
      kelvin: kelvin.value,
      note: note.value,
    }),
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && panelStyle"
      class="canvas-light nodrag nopan nowheel"
      :style="panelStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <header class="canvas-light__head">
        <strong>{{ t('打光') }}</strong>
        <button type="button" :aria-label="t('关闭')" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </header>
      <div class="canvas-light__body">
        <div class="canvas-light__side">
          <div class="canvas-light__preview">
            <img :src="resolveMediaUrl(src)" alt="" :style="{ filter: previewStyle.filter }">
            <i :style="previewStyle" />
          </div>
          <label class="canvas-light__field">
            <span>{{ t('亮度') }}</span>
            <b>{{ brightnessLabel }}</b>
            <input
              v-model.number="brightness"
              type="range"
              :min="LIGHT_BRIGHTNESS_MIN"
              :max="LIGHT_BRIGHTNESS_MAX"
              :aria-label="t('亮度')"
            >
          </label>
          <label class="canvas-light__field">
            <span>{{ t('色温') }}</span>
            <b>{{ kelvinLabel }}</b>
            <input
              v-model.number="kelvin"
              type="range"
              class="is-kelvin"
              :min="LIGHT_KELVIN_MIN"
              :max="LIGHT_KELVIN_MAX"
              step="50"
              :aria-label="t('色温')"
            >
          </label>
        </div>
        <div class="canvas-light__main">
          <p class="canvas-light__label">{{ t('预设风格') }}</p>
          <div class="canvas-light__grid">
            <button
              v-for="item in LIGHT_PRESETS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': presetId === item.id }"
              @click="pickPreset(item)"
            >
              <img :src="item.cover" alt="">
              <em>{{ t(item.label) }}</em>
            </button>
          </div>
          <textarea
            v-model="note"
            rows="2"
            :placeholder="t('简单描述你想要的打光效果')"
          />
          <div class="canvas-light__bar">
            <span v-if="zapCost !== ''" class="canvas-smart__cost">
              <UIcon name="i-lucide-zap" class="size-3.5" />
              {{ zapCost }}
            </span>
            <button
              type="button"
              class="canvas-smart__send"
              :disabled="submitting"
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
      </div>
    </div>
  </Teleport>
</template>
