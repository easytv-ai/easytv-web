<script setup lang="ts">
import type { GenerationModel } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'
import {
  ANGLE_PRESETS,
  ANGLE_ROTATE_MAX,
  ANGLE_ROTATE_MIN,
  ANGLE_TILT_MAX,
  ANGLE_TILT_MIN,
  buildAnglePrompt,
  cubeTransform,
  dragCube,
  type AnglePreset,
} from '~/utils/canvas-angle'
import { effectiveUnitPrice, estimateTaskPoints } from '~/utils/model-price'

const { t } = useI18n()
const { isMember } = useWallet()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  submitting?: boolean
  panelStyle?: Record<string, string> | null
  /** 和工作区提交用的同一条图片编辑模型，报价跟它走 */
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
const presetId = ref(ANGLE_PRESETS[0]!.id)
const rotate = ref(ANGLE_PRESETS[0]!.rotate)
const tilt = ref(ANGLE_PRESETS[0]!.tilt)
const note = ref(t(ANGLE_PRESETS[0]!.note))
const dragging = ref(false)
const lastPtr = { x: 0, y: 0 }
const current = computed(() => ANGLE_PRESETS.find(item => item.id === presetId.value) || ANGLE_PRESETS[0]!)
const photo = computed(() => resolveMediaUrl(props.src))
const cubeStyle = computed(() => ({
  transform: cubeTransform(rotate.value, tilt.value),
}))
const zapCost = computed(() => {
  const model = generationModels.value.find(item => item.model === props.model)
  if (!model?.priced)
    return ''
  return estimateTaskPoints(effectiveUnitPrice(model, isMember.value), model.unit, 1)
})

watch(() => props.open, (open) => {
  if (!open) {
    dragging.value = false
    return
  }
  pickPreset(ANGLE_PRESETS[0]!)
}, { immediate: true })

function pickPreset(item: AnglePreset) {
  presetId.value = item.id
  rotate.value = item.rotate
  tilt.value = item.tilt
  note.value = t(item.note)
}

function onCubePointerDown(event: PointerEvent) {
  if (event.button !== 0)
    return
  event.preventDefault()
  dragging.value = true
  lastPtr.x = event.clientX
  lastPtr.y = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onCubePointerMove(event: PointerEvent) {
  if (!dragging.value)
    return
  const next = dragCube(rotate.value, tilt.value, event.clientX - lastPtr.x, event.clientY - lastPtr.y)
  lastPtr.x = event.clientX
  lastPtr.y = event.clientY
  rotate.value = next.rotate
  tilt.value = next.tilt
}

function onCubePointerUp() {
  dragging.value = false
}

function submit() {
  emit('submit', {
    prompt: buildAnglePrompt({
      preset: current.value,
      rotate: rotate.value,
      tilt: tilt.value,
      note: note.value,
    }),
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && panelStyle"
      class="canvas-angle nodrag nopan nowheel"
      :style="panelStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <header class="canvas-angle__head">
        <strong>{{ t('角度') }}</strong>
        <button type="button" :aria-label="t('关闭')" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-3.5" />
        </button>
      </header>
      <div class="canvas-angle__body">
        <div class="canvas-angle__side">
          <div
            class="canvas-angle__stage"
            :class="{ 'is-drag': dragging }"
            @pointerdown="onCubePointerDown"
            @pointermove="onCubePointerMove"
            @pointerup="onCubePointerUp"
            @pointercancel="onCubePointerUp"
          >
            <div class="canvas-angle__cube" :class="{ 'is-drag': dragging }" :style="cubeStyle">
              <div class="canvas-angle__face is-front">
                <img :src="photo" alt="">
              </div>
              <div class="canvas-angle__face is-right">
                <i>R</i>
              </div>
              <div class="canvas-angle__face is-back">
                <i>B</i>
              </div>
              <div class="canvas-angle__face is-left">
                <i>L</i>
              </div>
              <div class="canvas-angle__face is-top">
                <i>T</i>
              </div>
              <div class="canvas-angle__face is-bottom">
                <i>D</i>
              </div>
            </div>
          </div>
          <label class="canvas-angle__field">
            <span>{{ t('旋转') }}</span>
            <b>{{ Math.round(rotate) }}°</b>
            <input
              v-model.number="rotate"
              type="range"
              :min="ANGLE_ROTATE_MIN"
              :max="ANGLE_ROTATE_MAX"
              :aria-label="t('旋转')"
            >
          </label>
          <label class="canvas-angle__field">
            <span>{{ t('倾斜') }}</span>
            <b>{{ Math.round(tilt) }}°</b>
            <input
              v-model.number="tilt"
              type="range"
              :min="ANGLE_TILT_MIN"
              :max="ANGLE_TILT_MAX"
              :aria-label="t('倾斜')"
            >
          </label>
        </div>
        <div class="canvas-angle__main">
          <p class="canvas-angle__label">{{ t('摄像机') }}</p>
          <div class="canvas-angle__grid">
            <button
              v-for="item in ANGLE_PRESETS"
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
            :placeholder="t('简单描述你想要的镜头效果')"
          />
          <div class="canvas-angle__bar">
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
