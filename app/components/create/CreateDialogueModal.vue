<script setup lang="ts">
import type { DialogueShotsRequest, ScreenplayPlan } from '~/types/creative'
import { MAX_EMOTION, MAX_LINE_TEXT } from '~/utils/plan-dialogue'

const { t } = useI18n()

/**
 * 正反打模板弹窗（API.md 25.3）：场景、人物 A / B、每镜秒数、台词（说话人只能是 A / B，≤ 10 句）、插入位置。
 * 只收集表单并 emit submit，接口调用与「先保存再插入」在父组件；后端报错通过 error 回显。
 */
const props = defineProps<{
  open: boolean
  plan: ScreenplayPlan
  submitting?: boolean
  error?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [body: DialogueShotsRequest]
}>()

const MAX_LINES = 10
const MIN_SECONDS = 3
const MAX_SECONDS = 10
const MAX_SHOTS = 12

type LineForm = { speaker: string, text: string, emotion: string }
const form = reactive({ scene: '', a: '', b: '', seconds: 4, insertAt: 0, lines: [] as LineForm[] })
const localError = ref('')

watch(() => props.open, (open) => {
  if (!open)
    return
  const [first, second] = props.plan.characters
  form.scene = props.plan.scenes[0]?.key ?? ''
  form.a = first?.key ?? ''
  form.b = second?.key ?? ''
  form.seconds = 4
  form.insertAt = 0
  form.lines = [
    { speaker: form.a, text: '', emotion: '' },
    { speaker: form.b, text: '', emotion: '' },
  ]
  localError.value = ''
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !props.submitting) {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

function characterName(key: string) {
  const item = props.plan.characters.find(c => c.key === key)
  return item?.name || key
}

const sceneOptions = computed(() => [
  { value: '', label: t('未指定场景') },
  ...props.plan.scenes.map(item => ({ value: item.key, label: item.name || item.key })),
])
const characterOptions = computed(() => props.plan.characters.map(item => ({ value: item.key, label: item.name || item.key })))
/** 台词说话人只能是 A / B */
const speakerOptions = computed(() => [form.a, form.b].filter(Boolean).map(key => ({ value: key, label: characterName(key) })))

const shownError = computed(() => localError.value || props.error || '')

/** 换 A / B 后，原本指向旧人物的台词跟着改到新人物，避免说话人不在 A / B 里 */
function setSide(side: 'a' | 'b', value: string | number) {
  const prev = form[side]
  form[side] = String(value)
  for (const line of form.lines) {
    if (line.speaker === prev || !line.speaker)
      line.speaker = form[side]
  }
  localError.value = ''
}

function addLine() {
  if (form.lines.length >= MAX_LINES)
    return
  const prev = form.lines[form.lines.length - 1]?.speaker
  form.lines.push({ speaker: prev === form.a ? form.b : form.a, text: '', emotion: '' })
}

function removeLine(index: number) {
  form.lines.splice(index, 1)
}

function onSeconds(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  form.seconds = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(raw) || MIN_SECONDS))
}

const insertOptions = computed(() => [
  { value: 0, label: t('末尾') },
  ...props.plan.shots.map((shot, i) => ({ value: i + 1, label: t('第 {n} 镜之前', { n: shot.no }) })),
])

function submit() {
  if (props.submitting)
    return
  if (!form.a || !form.b || form.a === form.b) {
    localError.value = t('请选择两个不同的人物')
    return
  }
  const lines = form.lines
    .map(line => ({ speaker: line.speaker, text: line.text.trim(), emotion: line.emotion.trim() || undefined }))
    .filter(line => line.text)
  if (!lines.length) {
    localError.value = t('至少写一句台词')
    return
  }
  if (lines.some(line => line.speaker !== form.a && line.speaker !== form.b)) {
    localError.value = t('台词的说话人只能是这两个人物')
    return
  }
  localError.value = ''
  emit('submit', { scene: form.scene, a: form.a, b: form.b, seconds: form.seconds, insert_at: form.insertAt, lines })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="!submitting && emit('close')">
      <div class="studio-modal publish-modal dialogue-modal" role="dialog" aria-modal="true" aria-labelledby="dialogue-modal-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="dialogue-modal-title">{{ t('插入双人对白') }}</h2>
            <p>{{ t('按台词生成正反打镜头：全景建立 → 每句一个过肩近景 → 收尾双人中景') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="publish-modal__form dialogue-modal__form">
          <div class="plan-editor__grid">
            <label class="publish-field">
              <span>{{ t('场景') }}</span>
              <StudioSelect
                size="compact"
                :model-value="form.scene"
                :options="sceneOptions"
                :disabled="submitting"
                :sr-label="t('场景')"
                @update:model-value="form.scene = String($event)"
              />
            </label>
            <label class="publish-field">
              <span>{{ t('人物 A（画左）') }}</span>
              <StudioSelect
                size="compact"
                :model-value="form.a"
                :options="characterOptions"
                :disabled="submitting"
                :sr-label="t('人物 A（画左）')"
                @update:model-value="setSide('a', $event)"
              />
            </label>
            <label class="publish-field">
              <span>{{ t('人物 B（画右）') }}</span>
              <StudioSelect
                size="compact"
                :model-value="form.b"
                :options="characterOptions"
                :disabled="submitting"
                :sr-label="t('人物 B（画右）')"
                @update:model-value="setSide('b', $event)"
              />
            </label>
            <label class="publish-field">
              <span>{{ t('每镜秒数') }}</span>
              <input type="number" :min="MIN_SECONDS" :max="MAX_SECONDS" :value="form.seconds" :disabled="submitting" @change="onSeconds">
            </label>
            <label class="publish-field">
              <span>{{ t('插入位置') }}</span>
              <StudioSelect
                size="compact"
                :model-value="form.insertAt"
                :options="insertOptions"
                :disabled="submitting"
                :sr-label="t('插入位置')"
                @update:model-value="form.insertAt = Number($event)"
              />
            </label>
          </div>

          <div class="plan-dialogue">
            <div class="plan-dialogue__head">
              <span>{{ t('台词') }} <small>{{ form.lines.length }}/{{ MAX_LINES }}</small></span>
              <button type="button" class="studio-chip" :disabled="submitting || form.lines.length >= MAX_LINES" @click="addLine">
                <UIcon name="i-lucide-plus" class="size-4" />
                {{ t('添加对白') }}
              </button>
            </div>
            <div v-for="(line, i) in form.lines" :key="i" class="plan-dialogue__row">
              <StudioSelect
                size="compact"
                :model-value="line.speaker"
                :options="speakerOptions"
                :disabled="submitting"
                :sr-label="t('说话人')"
                @update:model-value="line.speaker = String($event)"
              />
              <input
                v-model="line.text"
                class="plan-dialogue__text"
                :maxlength="MAX_LINE_TEXT"
                :disabled="submitting"
                :placeholder="t('台词正文')"
                @keydown.enter.prevent="addLine"
              >
              <input
                v-model="line.emotion"
                class="plan-dialogue__emotion"
                :maxlength="MAX_EMOTION"
                :disabled="submitting"
                :placeholder="t('情绪')"
              >
              <button type="button" class="plan-editor__remove" :aria-label="t('删除')" :disabled="submitting || form.lines.length <= 1" @click="removeLine(i)">
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </div>
          </div>
          <small class="dialogue-modal__hint">{{ t('当前已有 {n} 镜，加上生成的镜头不能超过 {max} 镜', { n: plan.shots.length, max: MAX_SHOTS }) }}</small>
          <p v-if="shownError" class="publish-error">{{ shownError }}</p>
        </div>

        <footer class="plan-confirm__actions publish-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="submitting" @click="emit('close')">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid" :disabled="submitting" @click="submit">
            {{ submitting ? t('插入中…') : t('插入镜头') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
