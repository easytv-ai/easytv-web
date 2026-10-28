<script setup lang="ts">
import {
  isDiarizeModel,
  normalizeTranscribeLanguage,
  pickTranscribeModel,
  TRANSCRIBE_LANG_STORAGE_KEY,
  TRANSCRIBE_LANGUAGES,
  type TranscribeLanguage,
} from '~/utils/canvas-transcribe'

/**
 * 语音转字幕（API.md 35.2）提交前的小弹窗：选语种、可选区分说话人，显示预估积分。
 * 语种记在本机（下次打开沿用）；确认后 emit confirm，由工作区派生文本节点并提交作业。
 */
const props = withDefaults(defineProps<{
  open: boolean
  /** 源节点名，只做标题展示 */
  sourceLabel?: string
  /** 源时长（秒），0 = 探测不到 */
  duration?: number
  /** 媒体动作清单里的转写模型 */
  models?: string[]
  /** 按模型估积分（0 = 没定价 / 估不出） */
  estimate?: (model: string) => number
}>(), {
  sourceLabel: '',
  duration: 0,
  models: () => [],
  estimate: () => 0,
})

const emit = defineEmits<{
  close: []
  confirm: [opts: { language: TranscribeLanguage, diarize: boolean, model: string }]
}>()

const { t } = useI18n()

const language = ref<TranscribeLanguage>('auto')
const diarize = ref(false)

const canDiarize = computed(() => props.models.some(isDiarizeModel))
const model = computed(() => pickTranscribeModel(props.models, diarize.value && canDiarize.value))
const points = computed(() => props.estimate(model.value))
const durationLabel = computed(() => {
  const sec = Math.ceil(props.duration)
  return sec > 0 ? t('{n} 秒', { n: sec }) : ''
})

watch(() => props.open, (open) => {
  if (!open)
    return
  diarize.value = false
  try {
    language.value = normalizeTranscribeLanguage(localStorage.getItem(TRANSCRIBE_LANG_STORAGE_KEY))
  }
  catch {
    language.value = 'auto'
  }
}, { immediate: true })

function onConfirm() {
  try {
    localStorage.setItem(TRANSCRIBE_LANG_STORAGE_KEY, language.value)
  }
  catch {}
  emit('confirm', { language: language.value, diarize: diarize.value && canDiarize.value, model: model.value })
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
  else if (event.key === 'Enter' && !(event.target as HTMLElement | null)?.closest?.('button')) {
    event.preventDefault()
    onConfirm()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal publish-modal transcribe-modal" role="dialog" aria-modal="true" aria-labelledby="transcribe-modal-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="transcribe-modal-title">{{ t('语音转字幕') }}</h2>
            <p>
              {{ sourceLabel }}<template v-if="durationLabel"> · {{ durationLabel }}</template>
            </p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="publish-modal__form transcribe-modal__form">
          <div class="publish-field">
            <span>{{ t('说话语种') }}</span>
            <div class="publish-tags">
              <button
                v-for="item in TRANSCRIBE_LANGUAGES"
                :key="item.id"
                type="button"
                :class="{ 'is-on': language === item.id }"
                @click="language = item.id"
              >
                {{ t(item.label) }}
              </button>
            </div>
            <small class="skill-editor__hint">{{ t('知道是哪种语言就选上，识别更准；混合语种选自动识别') }}</small>
          </div>
          <label v-if="canDiarize" class="transcribe-modal__check">
            <input v-model="diarize" type="checkbox">
            <span>{{ t('区分说话人') }}</span>
            <small>{{ t('每句字幕前标「说话人 N：」，适合访谈、对话') }}</small>
          </label>
          <p v-if="points > 0" class="transcribe-modal__cost">{{ t('预计 {n} 积分，按实际时长退差价', { n: points }) }}</p>
          <p v-else-if="!duration" class="transcribe-modal__cost">{{ t('按音频时长计费，转写完按实际时长结算') }}</p>
        </div>

        <footer class="publish-modal__foot transcribe-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" @click="emit('close')">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid" @click="onConfirm">{{ t('开始转写') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.transcribe-modal {
  width: min(92vw, 460px);
}

.transcribe-modal__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 20px;
}

.transcribe-modal__check {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  column-gap: 8px;
  row-gap: 2px;
  font-size: 13px;
  color: var(--st-text);
  cursor: pointer;
}

.transcribe-modal__check input {
  width: 14px;
  height: 14px;
  margin: 0;
}

.transcribe-modal__check small {
  grid-column: 2;
  font-size: 12px;
  color: var(--st-text-soft);
}

.transcribe-modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.transcribe-modal__foot .plan-btn {
  flex: none;
  width: auto;
  min-width: 96px;
  padding: 0 18px;
}

.transcribe-modal__cost {
  margin: 0;
  font-size: 12px;
  color: var(--st-text-soft);
}
</style>
