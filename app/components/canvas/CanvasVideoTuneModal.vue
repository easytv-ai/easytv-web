<script setup lang="ts">
import taskApi from '~/api/task'
import type { GenerationModel } from '~/types/creative'
import { buildCanvasTuningMessages, canvasTuningMode, flattenTuningMessages, introducedReferenceTokens, isWanVideoModel, type CanvasTuningDomain, type CanvasTuningMode } from '~/utils/canvas-video-tune'
import { canvasRefSupport } from '~/utils/canvas-reference-support'
import { pickVisionTextModel } from '~/utils/image-input'
import { shortModelName } from '~/utils/model-name'
import { loadKnowledge, parseTuningResult } from '~/utils/wan-tuner/wan-tuner-core.js'

const props = defineProps<{
  open: boolean
  prompt: string
  targetModel: string
  videoMode: string
  params?: Record<string, unknown>
  media?: Array<{ id: string, kind: 'image' | 'video' | 'audio', role: string, url?: string, name?: string, assetId?: number }>
  confirmSpend?: (model: string) => Promise<boolean>
}>()

const emit = defineEmits<{
  close: []
  apply: [prompt: string]
}>()

const { t, locale } = useI18n()
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
const { growth } = useStudioAppConfig()
const { load: loadModelDetail } = useGenerationModelDetail()

const draft = ref(props.prompt)
const domain = ref<CanvasTuningDomain>('general')
const mode = ref<CanvasTuningMode>(canvasTuningMode(props.videoMode))
const output = ref<'quick' | 'full' | 'diagnose'>('quick')
const analyze = ref(true)
const issue = ref('')
const modelId = ref('')
const busy = ref(false)
const error = ref('')
const suggestion = ref('')
const analysis = ref('')
let seq = 0

const textModels = computed(() => {
  const text = generationModels.value.filter(item => item.type === 'text' && item.priced && !/tts|audio|transcribe|realtime|embedding/i.test(item.model))
  return text.length ? text : generationModels.value.filter(item => item.type === 'text')
})
const modeOptions: Array<{ id: CanvasTuningMode, label: string }> = [
  { id: 'text-to-video', label: t('文生视频') },
  { id: 'first-frame', label: t('首帧') },
  { id: 'first-last-frame', label: t('首尾帧') },
  { id: 'reference', label: t('参考素材') },
  { id: 'v2v', label: t('视频编辑') },
]
const readyMedia = computed(() => (props.media || []).filter(item => item.url))

watch(() => props.open, (open) => {
  if (!open)
    return
  draft.value = props.prompt
  mode.value = canvasTuningMode(props.videoMode)
  suggestion.value = ''
  analysis.value = ''
  error.value = ''
  if (!modelId.value)
    modelId.value = pickVisionTextModel(generationModels.value, growth.value?.vision_text_model) || textModels.value[0]?.model || ''
})

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))

async function waitText(taskId: number, current: number) {
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (current !== seq)
      throw new Error('cancelled')
    const res = await taskApi.get(taskId)
    const task = res?.data
    if (!res?.success || !task)
      continue
    if (task.status === 'succeeded')
      return String(task.result_text || '')
    if (task.status === 'failed' || task.status === 'cancelled')
      throw new Error(task.error_msg || t('调优失败'))
  }
  throw new Error(t('调优超时，请稍后再试'))
}

async function run() {
  const prompt = draft.value.trim()
  if (!prompt || busy.value)
    return
  if (output.value === 'diagnose' && !issue.value.trim()) {
    error.value = t('先写一下成片哪里有问题')
    return
  }
  const model = modelId.value
  if (!model) {
    error.value = t('暂无可用的文本模型，请联系运营开通')
    return
  }
  if (props.confirmSpend && !await props.confirmSpend(model))
    return
  const current = ++seq
  busy.value = true
  error.value = ''
  suggestion.value = ''
  analysis.value = ''
  try {
    const knowledge = await loadKnowledge()
    const detail = props.targetModel ? await loadModelDetail(props.targetModel) : null
    const support = canvasRefSupport({ kind: 'video', detail: detail || undefined })
    const context = {
      domain: domain.value,
      mode: mode.value,
      output: output.value,
      prompt,
      targetModel: props.targetModel,
      params: props.params || {},
      media: analyze.value ? readyMedia.value.map(item => ({ ...item, ready: true })) : [],
      locale: locale.value || 'zh-CN',
      capabilities: {
        known: support.known,
        roles: [...support.roles],
        maxCount: support.maxCount,
      },
      ...(output.value === 'diagnose' ? { issue: { description: issue.value.trim() } } : {}),
    }
    const instruction = flattenTuningMessages(buildCanvasTuningMessages(context, knowledge))
    const inputs = analyze.value
      ? readyMedia.value.filter(item => item.kind === 'image' && item.assetId).map(item => ({ asset_id: item.assetId!, role: 'image' as const }))
      : []
    const res = await taskApi.create({
      type: 'text',
      model,
      prompt: instruction,
      params: { optimize: 'video-tune', output: output.value },
      inputs,
    })
    if (current !== seq)
      return
    if (!res?.success || !res.data)
      throw new Error(res?.message || t('提交失败'))
    const text = res.data.status === 'succeeded' ? String(res.data.result_text || '') : await waitText(res.data.id, current)
    if (current !== seq)
      return
    const wan = isWanVideoModel(props.targetModel)
    try {
      const parsed = parseTuningResult(text, { requireDiagnosis: output.value === 'diagnose', ...(wan ? { context } : {}) })
      const fresh = wan ? [] : introducedReferenceTokens(prompt, parsed.prompt)
      if (fresh.length)
        throw new Error(t('调优结果写了这个模型不支持的引用写法，请再试一次'))
      suggestion.value = parsed.prompt
      analysis.value = [parsed.analysis, ...parsed.changes, ...parsed.risks].filter(Boolean).join('\n')
    }
    catch (reason) {
      if (reason instanceof Error && reason.message === t('调优结果写了这个模型不支持的引用写法，请再试一次'))
        throw reason
      const raw = text.trim()
      if (!raw)
        throw new Error(t('模型没有返回内容'))
      if (!wan && introducedReferenceTokens(prompt, raw).length)
        throw new Error(t('调优结果写了这个模型不支持的引用写法，请再试一次'))
      suggestion.value = raw
    }
  }
  catch (reason) {
    if (current !== seq || (reason instanceof Error && reason.message === 'cancelled'))
      return
    error.value = reason instanceof Error ? reason.message : t('调优失败')
  }
  finally {
    if (current === seq)
      busy.value = false
  }
}

function apply() {
  const next = suggestion.value.trim()
  if (!next || busy.value)
    return
  emit('apply', next)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal canvas-presets canvas-optimize is-tune" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ t('视频提示词调优') }}</h2>
            <p>{{ targetModel || t('当前视频模型') }} · {{ t('结合素材和参数改写提示词，原文先留着，确认后再用') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-tune">
          <label class="canvas-tune__field">
            <span>{{ t('原始提示词') }}</span>
            <textarea v-model="draft" rows="4" :disabled="busy" />
          </label>
          <div class="canvas-tune__grid">
            <label class="canvas-tune__field">
              <span>{{ t('内容场景') }}</span>
              <select v-model="domain" :disabled="busy">
                <option value="general">{{ t('通用') }}</option>
                <option value="drama">{{ t('短剧') }}</option>
                <option value="ecommerce">{{ t('电商') }}</option>
              </select>
            </label>
            <label class="canvas-tune__field">
              <span>{{ t('主体形式') }}</span>
              <select v-model="mode" :disabled="busy">
                <option v-for="item in modeOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
              </select>
            </label>
            <label class="canvas-tune__field">
              <span>{{ t('调优方式') }}</span>
              <select v-model="output" :disabled="busy">
                <option value="quick">{{ t('快速优化') }}</option>
                <option value="full">{{ t('完整分析') }}</option>
                <option value="diagnose">{{ t('问题诊断') }}</option>
              </select>
            </label>
          </div>
          <label class="canvas-tune__field">
            <span>{{ t('调优模型') }}</span>
            <select v-model="modelId" :disabled="busy">
              <option v-if="!textModels.length" value="">{{ t('暂无文本模型') }}</option>
              <option v-for="item in textModels" :key="item.model" :value="item.model">{{ shortModelName(item) }}</option>
            </select>
          </label>
          <label class="canvas-tune__check">
            <input v-model="analyze" type="checkbox" :disabled="busy">
            <span>{{ t('先分析已连接的图片或视频。没有可分析的素材时，只按提示词调优。') }}</span>
          </label>
          <p v-if="readyMedia.length" class="canvas-tune__media">
            <span v-for="item in readyMedia" :key="item.id">{{ item.name || item.role }}</span>
          </p>
          <label v-if="output === 'diagnose'" class="canvas-tune__field">
            <span>{{ t('成片问题') }}</span>
            <textarea v-model="issue" rows="3" :disabled="busy" :placeholder="t('例如：第 4 秒人物手部变形')" />
          </label>
          <p v-if="error" class="canvas-optimize__err">{{ error }}</p>
          <div v-if="busy || suggestion" class="canvas-optimize__cols">
            <section>
              <h3>{{ t('原文') }}</h3>
              <pre>{{ draft }}</pre>
            </section>
            <section :class="{ 'is-busy': busy }">
              <h3>{{ t('调优结果') }}</h3>
              <p v-if="busy" class="canvas-optimize__wait">
                <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
                {{ t('正在调优，一般需要十几秒') }}
              </p>
              <pre v-else>{{ suggestion }}</pre>
            </section>
          </div>
          <p v-if="analysis" class="canvas-tune__analysis">{{ analysis }}</p>
        </div>

        <div class="canvas-optimize__actions">
          <button type="button" class="canvas-optimize__ghost" @click="emit('close')">{{ t('关闭') }}</button>
          <button type="button" class="canvas-optimize__ghost" :disabled="busy || !draft.trim()" @click="run">
            {{ busy ? t('调优中') : t('开始优化') }}
          </button>
          <button type="button" class="canvas-optimize__go" :disabled="busy || !suggestion.trim()" @click="apply">
            {{ t('采用结果') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
