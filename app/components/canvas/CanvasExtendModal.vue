<script setup lang="ts">
/**
 * 续写弹窗（API.md 10.3 POST /user/task/:id/extend）：
 * 提示词默认沿用源节点的提示词，时长选项与 CanvasInspector 的「时长」一致。
 */
const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  /** 源节点提示词，作为默认值 */
  prompt?: string
  submitting?: boolean
}>(), {
  prompt: '',
  submitting: false,
})

const emit = defineEmits<{
  close: []
  submit: [payload: { prompt: string, seconds: number }]
}>()

const SECONDS_ITEMS = [5, 10] as const

const draft = ref('')
const seconds = ref<number>(SECONDS_ITEMS[0])

watch(() => props.open, (open) => {
  if (!open)
    return
  draft.value = props.prompt || ''
  seconds.value = SECONDS_ITEMS[0]
}, { immediate: true })

function onSubmit() {
  if (props.submitting)
    return
  emit('submit', { prompt: draft.value.trim(), seconds: seconds.value })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal canvas-presets canvas-extend" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ t('续写') }}</h2>
            <p>{{ t('以这段视频的末帧作首帧继续生成，会再次消耗积分') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-extend__body">
          <label class="canvas-extend__label" for="canvas-extend-prompt">{{ t('提示词') }}</label>
          <textarea
            id="canvas-extend-prompt"
            v-model="draft"
            class="canvas-extend__input"
            rows="4"
            :placeholder="t('描述接下来要发生什么，留空则沿用原提示词')"
          />
          <p class="canvas-extend__label">{{ t('时长') }}</p>
          <div class="canvas-presets__picks">
            <button
              v-for="item in SECONDS_ITEMS"
              :key="item"
              type="button"
              :class="{ 'is-on': seconds === item }"
              @click="seconds = item"
            >
              {{ item }}s
            </button>
          </div>
        </div>

        <div class="canvas-extend__actions">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="submitting" @click="emit('close')">
            {{ t('取消') }}
          </button>
          <button type="button" class="plan-btn plan-btn--solid" :disabled="submitting" @click="onSubmit">
            {{ submitting ? t('提交中…') : t('开始续写') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
