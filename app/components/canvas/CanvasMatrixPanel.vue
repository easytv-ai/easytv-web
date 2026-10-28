<script setup lang="ts">
import { subtitleApi } from '~/api/screenplay'
import {
  findMatrixPlatform,
  MATRIX_PLATFORMS,
  MATRIX_VERSION_MAX,
  matrixEligibility,
  matrixPlan,
  matrixPlatformSpec,
  matrixPoints,
  matrixSameLang,
  matrixTalkingScript,
  matrixVersionSpec,
  type MatrixLang,
  type MatrixPlan,
  type MatrixSource,
  type MatrixVersion,
} from '~/utils/canvas-matrix'
import type { MatrixRunState } from '~/composables/useCanvasMatrix'
import type { GenerationBatchItem } from '~/types/creative'

/**
 * 一稿多版矩阵面板：选一个已出片的节点 → 勾平台规格（9:16 / 16:9 / 1:1 / 3:4）→ 可选多语言 →
 * 预览要派生的 N 个版本与预计总点数 → 确认后落到画布并交给服务端批量生成。
 *
 * 外壳跟版本历史同一套居中弹窗（.canvas-wf），语言用 useLangs（GET /langs），
 * 估价走工作区传进来的 estimate（与 Inspector 同口径：图片按张、视频按秒）。
 * 面板只管选与算；落图 / 打组 / 提交 / 轮询 / 回滚在 useCanvasMatrix 里。
 */
const props = withDefaults(defineProps<{
  open: boolean
  /** 画布上的图片 / 视频节点（选源用；没出片的也会列出来，选中时说明为什么不能派生） */
  sources: MatrixSource[]
  /** 当前选中的节点 id：打开时默认拿它当源 */
  selectedId?: string
  /** 估价（与 Inspector 同口径）：模型 + 参数 → 点数 */
  estimate: (model: string, params: Record<string, unknown>) => number
  /** 目标模型声明的时长档（按模型查，与 Inspector 的时长下拉同源） */
  modelDurations?: (model: string) => number[]
  /** 目标模型声明的分辨率档（按模型查，与 Inspector 的分辨率下拉同源）；不含所选规格就回落第一档并注明 */
  modelResolutions?: (model: string) => string[]
  /** 定价清单是否已加载：没加载时估价一律不做数，别拿 0 当"免费" */
  priced?: boolean
  /** 钱包余额：余额不足要在确认前说清 */
  balance?: number
  /** 当前派生批次的状态（由工作区传回） */
  run?: MatrixRunState | null
  /** 正在提交（翻译 + 确认） */
  busy?: boolean
}>(), {
  selectedId: '',
  priced: true,
  balance: 0,
  run: null,
  busy: false,
})

const emit = defineEmits<{
  close: []
  /** 确认派生：plan 已算好（含多语言译文），points 是确认过的总点数 */
  derive: [plan: MatrixPlan, points: number]
  /** 提交失败后重试（派生节点还在画布上） */
  resubmit: [plan: MatrixPlan]
  /** 回滚这次派生的节点 */
  rollback: []
  /** 批次动作：取消 / 继续 / 重试失败 */
  action: [name: 'cancel' | 'resume' | 'retry-failed']
  /** 去充值 */
  recharge: []
}>()

const { t, locale } = useI18n()
const toast = useToast()
const { confirm, state: confirmState } = useConfirm()
const { langs, load: loadLangs, langLabel } = useLangs()

const sourceId = ref('')
const pickedPlatforms = ref<string[]>(['vertical-9x16', 'horizontal-16x9'])
const pickedLangs = ref<string[]>([])
const translating = ref(false)
/** 工作区没传 busy 时，也认这次派生 run 上的 busy，避免提交窗口里再点一次 */
const submitting = computed(() => props.busy || Boolean(props.run?.busy))
const batch = computed(() => props.run?.batch ?? null)
const batchActive = computed(() => batch.value?.status === 'running' || batch.value?.status === 'paused')
/** 节点已落画布但还没交上批次（失败 / 未提交）：不能再开一轮，只能重试或回滚 */
const placedPending = computed(() => Boolean(props.run?.nodeIds.length && (props.run.error || !props.run.batch)))
/** 选规格 / 语种 / 源：翻译、提交、批次还在跑、或这轮节点还没清掉时锁住 */
const pickingLocked = computed(() => submitting.value || translating.value || batchActive.value || placedPending.value)
const deriveLocked = computed(() => pickingLocked.value || !previewPlan.value || overLimit.value)
/** 多语言翻译的进度文案（哪几种语言在翻） */
const translateNote = ref('')
/** 关掉面板 / 重开翻译时作废进行中的请求，别在卸载后还 emit derive */
let translateSeq = 0

const source = computed(() => props.sources.find(item => item.id === sourceId.value) ?? null)
const eligibility = computed(() => (source.value ? matrixEligibility(source.value) : null))
const platforms = computed(() => pickedPlatforms.value.map(id => findMatrixPlatform(id)).filter((item): item is NonNullable<typeof item> => Boolean(item)))
const selectedLangs = computed<MatrixLang[]>(() => pickedLangs.value
  .map(code => ({ code, label: langLabel(code) }))
  .filter(item => item.code))
/** 要派生的版本数：规格 × 语种（没选语种就是规格数） */
const versionCount = computed(() => platforms.value.length * Math.max(1, pickedLangs.value.length))
const overLimit = computed(() => versionCount.value > MATRIX_VERSION_MAX)

/** 预览用的 plan（不翻译，只算结构与点数；确认时才带译文重建） */
const previewPlan = computed<MatrixPlan | null>(() => {
  const item = source.value
  if (!item || !eligibility.value?.ok || !platforms.value.length || overLimit.value)
    return null
  return matrixPlan({
    source: item,
    platforms: platforms.value,
    langs: selectedLangs.value,
    durations: durationsOf(item),
    resolutions: resolutionsOf(item),
    batchId: 'preview',
    labelOf: (platform, lang) => matrixLabelOf(platform.id, lang?.code || ''),
  })
})

const points = computed(() => (previewPlan.value ? matrixPoints(previewPlan.value, props.estimate) : { total: 0, byVersion: [] }))
/** 定价清单没加载 / 有未定价的模型时不能当真：估价显示成"待定"并拦住确认 */
const unpriced = computed(() => Boolean(previewPlan.value) && previewPlan.value!.versions.some(version => !Number(props.estimate(String(version.data.model || ''), version.params))))
const estimateReady = computed(() => props.priced && !unpriced.value)
const enough = computed(() => props.balance >= points.value.total)
/** 选中的源不能派生时的原因（空串 = 可以派生）：在脚本里收窄，模板不碰联合类型 */
const blockReason = computed(() => {
  const verdict = eligibility.value
  return verdict && !verdict.ok ? verdict.reason : ''
})
/** 口播源（data.talking 有台词）：多语言翻的是台词，提示词由台词拼出来 */
const talkingScript = computed(() => matrixTalkingScript(source.value ?? {}))
const isTalkingSource = computed(() => Boolean(talkingScript.value))

/** 视频源：目标模型声明的时长档（图片源用不到）；由工作区按模型清单查表 */
function durationsOf(item: MatrixSource) {
  return props.modelDurations?.(String(item.model || '')) ?? []
}

/** 视频源：目标模型声明的分辨率档；面板把它交给 matrixPlan 做回落并注明 */
function resolutionsOf(item: MatrixSource) {
  return props.modelResolutions?.(String(item.model || '')) ?? []
}

function matrixLabelOf(platformId: string, langCode: string) {
  const platform = findMatrixPlatform(platformId)
  const base = String(source.value?.label || t('版本'))
  const parts = [base, platform ? t(platform.label) : platformId]
  if (langCode)
    parts.push(langLabel(langCode))
  return parts.join(' · ')
}

/** 打开的默认源：优先当前选中的节点，其次第一个可派生的 */
function defaultSource() {
  const preferred = props.sources.find(item => item.id === props.selectedId && matrixEligibility(item).ok)
  return preferred?.id || props.sources.find(item => matrixEligibility(item).ok)?.id || props.sources[0]?.id || ''
}

function abortTranslate() {
  translateSeq += 1
  translating.value = false
  translateNote.value = ''
}

function closePanel() {
  abortTranslate()
  emit('close')
}

watch(() => props.open, (open) => {
  if (!open) {
    abortTranslate()
    return
  }
  void loadLangs()
  // 打开当下拍一份源，之后点画布不再改；用户要换源走下拉框
  sourceId.value = defaultSource()
}, { immediate: true })

function togglePlatform(id: string) {
  if (pickingLocked.value)
    return
  const has = pickedPlatforms.value.includes(id)
  pickedPlatforms.value = has ? pickedPlatforms.value.filter(item => item !== id) : [...pickedPlatforms.value, id]
}

function toggleLang(code: string) {
  if (pickingLocked.value)
    return
  const has = pickedLangs.value.includes(code)
  pickedLangs.value = has ? pickedLangs.value.filter(item => item !== code) : [...pickedLangs.value, code]
}

/** 运行中版本名：节点 data.label（刷新恢复也有）→ plan 同序标题 → 节点 id */
function runVersionLabel(nodeId: string, index: number) {
  const fromNode = props.run?.labels?.[nodeId]
  if (fromNode)
    return fromNode
  return props.run?.plan?.versions[index]?.label || nodeId
}

/** 版本行的批次条目状态（排队 / 生成中 / 成功 / 失败 / 被拦下…）：按节点 id 认 */
const itemStatusOf = computed(() => {
  const map = new Map<string, GenerationBatchItem>()
  for (const item of props.run?.batch?.items ?? [])
    map.set(item.node_id, item)
  return map
})

function statusText(nodeId: string) {
  const item = itemStatusOf.value.get(nodeId)
  if (!item)
    return ''
  switch (item.status) {
    case 'waiting': return t('排队中')
    case 'submitted': return t('生成中')
    case 'succeeded': return t('已完成')
    case 'failed': return t('失败')
    case 'skipped': return t('上游失败，已跳过')
    case 'blocked': return t('被门禁拦下')
    case 'cancelled': return t('已取消')
    default: return ''
  }
}

function versionPoints(version: MatrixVersion) {
  return props.estimate(String(version.data.model || ''), version.params)
}

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

/**
 * 多语言：把源节点的提示词翻成目标语种（POST /user/subtitle/translate，现有接口、30 次/分钟）。
 * 任何一种语言翻译失败就整体中止并报原因——不静默回落成原文，免得用户以为出的是外语版。
 */
async function translatePrompts(): Promise<{ prompts: Record<string, string>, scripts: Record<string, string> } | null> {
  const prompts: Record<string, string> = {}
  const scripts: Record<string, string> = {}
  const codes = [...pickedLangs.value]
  if (!codes.length)
    return { prompts, scripts }
  // 口播源翻的是台词（提示词由台词拼出来），其余翻节点提示词
  const talking = isTalkingSource.value
  const text = (talking ? talkingScript.value : String(source.value?.prompt || '')).trim()
  if (!text)
    return { prompts, scripts }
  const seq = ++translateSeq
  translating.value = true
  try {
    for (const code of codes) {
      if (seq !== translateSeq)
        return null
      if (matrixSameLang(code, String(locale.value || ''))) {
        if (talking)
          scripts[code] = text
        else
          prompts[code] = text
        continue
      }
      translateNote.value = t('正在翻译：{lang}', { lang: langLabel(code) })
      const res = await subtitleApi.translate(text, code)
      if (seq !== translateSeq)
        return null
      const translated = String(res?.data?.text || '').trim()
      if (!res?.success || !translated) {
        notify(res?.message || t('{lang} 的提示词翻译失败，这次没有派生任何版本', { lang: langLabel(code) }), 'error')
        return null
      }
      if (talking)
        scripts[code] = translated
      else
        prompts[code] = translated
    }
    return { prompts, scripts }
  }
  finally {
    if (seq === translateSeq) {
      translating.value = false
      translateNote.value = ''
    }
  }
}

/** 确认并派生：先确认点数与余额 → 再翻译（多语言时）→ 交出去。关掉面板会作废翻译。 */
async function submit() {
  const item = source.value
  if (!item || submitting.value || translating.value || batchActive.value || placedPending.value)
    return
  const issue = eligibility.value
  if (!issue?.ok) {
    notify(t(issue?.reason || '这个节点还不能派生'), 'error')
    return
  }
  if (!platforms.value.length) {
    notify(t('至少勾一条平台规格'), 'error')
    return
  }
  if (overLimit.value) {
    notify(t('一次最多派生 {n} 个版本：少勾几条规格或语种', { n: MATRIX_VERSION_MAX }), 'error')
    return
  }
  if (!estimateReady.value) {
    notify(props.priced ? t('有版本估不出点数（模型未定价），先换模型再派生') : t('定价清单还没加载好，稍后再试'), 'error')
    return
  }
  const batchId = `mx-${Date.now()}`
  const planOf = (extra: { prompts?: Record<string, string>, talkingScripts?: Record<string, string> }) => matrixPlan({
    source: item,
    platforms: platforms.value,
    langs: selectedLangs.value,
    durations: durationsOf(item),
    resolutions: resolutionsOf(item),
    batchId,
    ...extra,
    labelOf: (platform, lang) => matrixLabelOf(platform.id, lang?.code || ''),
  })
  const draft = planOf({})
  const total = matrixPoints(draft, props.estimate).total
  const ok = await confirm({
    title: t('一稿多版：确认派生并生成'),
    message: t('按 {n} 条平台规格派生 {count} 个版本落到画布（源节点 {source}），并交给服务端批量生成，预计消耗 {points} 积分，当前余额 {balance}。', {
      n: platforms.value.length,
      count: draft.versions.length,
      source: item.label,
      points: total,
      balance: props.balance,
    }),
    confirmText: t('确认并生成'),
  })
  if (!ok) {
    notify(t('已取消，没有派生任何版本'))
    return
  }
  const translated = await translatePrompts()
  if (!translated)
    return
  const plan = pickedLangs.value.length
    ? planOf({ prompts: translated.prompts, talkingScripts: translated.scripts })
    : draft
  emit('derive', plan, total)
}

function onResubmit() {
  const plan = props.run?.plan
  if (!plan) {
    notify(t('没有可重试的派生记录：重新选规格再派生一次'), 'error')
    return
  }
  emit('resubmit', plan)
}

async function onRollback() {
  if (submitting.value)
    return
  const ok = await confirm({
    title: t('回滚这次派生？'),
    message: t('会取消还在跑的批次，并从画布拿走这次派生的节点。已经生成完的版本也会一起删掉。'),
    confirmText: t('确认回滚'),
    danger: true,
  })
  if (!ok)
    return
  emit('rollback')
}

/** 版本行：预览里的 key（规格 + 语种），运行时按派生节点 id 找条目状态 */
function versionKey(version: MatrixVersion) {
  return `${version.platform.id}-${version.lang?.code || 'src'}`
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.open || confirmState.value.open)
    return
  event.stopPropagation()
  closePanel()
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  abortTranslate()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask canvas-wf-mask"
      @click.self="closePanel()"
      @pointerdown.stop
      @keydown.stop
    >
      <div
        class="canvas-wf canvas-matrix studio-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-matrix-title"
        @wheel.stop
      >
        <header class="canvas-wf__head">
          <h2 id="canvas-matrix-title">{{ t('一稿多版矩阵') }}</h2>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="closePanel()">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </header>

        <div class="canvas-wf__body">
    <section class="canvas-wf__section">
      <p class="canvas-wf__label">{{ t('源节点（选一个已出片的图片 / 视频节点）') }}</p>
      <select v-model="sourceId" class="canvas-matrix__select" :aria-label="t('源节点')" :disabled="pickingLocked">
        <option v-for="item in sources" :key="item.id" :value="item.id">{{ item.label }}（{{ item.kind === 'video' ? t('视频') : t('图片') }}）</option>
      </select>
      <p v-if="!sources.length" class="canvas-wf__empty">{{ t('画布上还没有出片的图片 / 视频节点：先生成一个再回来派生') }}</p>
      <p v-else-if="blockReason" class="canvas-matrix__hint is-warn">{{ t(blockReason) }}</p>
      <p v-else class="canvas-matrix__hint">{{ t('提示词与模型会沿用到每个版本；视频源沿用原节点的首帧图与参考素材。') }}</p>
      <p v-if="isTalkingSource" class="canvas-matrix__hint">{{ t('口播节点：派生版本带上同一份台词与口播预设，多语言时翻的是台词。') }}</p>
    </section>

    <section class="canvas-wf__section">
      <p class="canvas-wf__label">{{ t('平台规格（勾选即多一版）') }}</p>
      <ul class="canvas-matrix__list">
        <li v-for="platform in MATRIX_PLATFORMS" :key="platform.id">
          <label class="canvas-matrix__row" :class="{ 'is-on': pickedPlatforms.includes(platform.id) }">
            <input
              type="checkbox"
              :checked="pickedPlatforms.includes(platform.id)"
              :disabled="pickingLocked"
              @change="togglePlatform(platform.id)"
            >
            <span class="canvas-wf__meta">
              <span class="canvas-matrix__row-top">
                <strong>{{ t(platform.label) }}</strong>
                <span class="canvas-matrix__spec">{{ matrixPlatformSpec(platform, source?.kind || 'image') }}</span>
              </span>
              <em>{{ t(platform.hint) }}</em>
              <em v-if="platform.degraded" class="canvas-matrix__degraded">{{ t(platform.degraded) }}</em>
            </span>
          </label>
        </li>
      </ul>
    </section>

    <section class="canvas-wf__section">
      <p class="canvas-wf__label">{{ t('多语言（可选：把源提示词翻成目标语种，一版一份）') }}</p>
      <div class="canvas-matrix__chips">
        <button
          v-for="item in langs"
          :key="item.code"
          type="button"
          :class="{ 'is-on': pickedLangs.includes(item.code) }"
          :disabled="pickingLocked"
          @click="toggleLang(item.code)"
        >
          {{ item.label }}
        </button>
      </div>
      <p class="canvas-matrix__hint">{{ t('字幕 / 配音语种仍在成片时间线里选；这里只翻提示词。') }}</p>
    </section>

    <section class="canvas-wf__section canvas-matrix__preview">
      <p class="canvas-wf__label">
        {{ t('将派生 {n} 个版本', { n: previewPlan?.versions.length ?? versionCount }) }}
      </p>
      <p v-if="overLimit" class="canvas-matrix__hint is-warn">{{ t('一次最多派生 {n} 个版本：少勾几条规格或语种', { n: MATRIX_VERSION_MAX }) }}</p>
      <ul v-else-if="previewPlan" class="canvas-matrix__preview-list">
        <li v-for="version in previewPlan.versions" :key="versionKey(version)" class="canvas-matrix__version">
          <strong>{{ version.label }}</strong>
          <em>{{ matrixVersionSpec(version, previewPlan.sourceKind) }} · {{ t('预计 {n} 点', { n: estimateReady ? versionPoints(version) : '—' }) }}</em>
          <em v-for="(note, noteIndex) in version.notes" :key="noteIndex" class="canvas-matrix__degraded">{{ t(note.text, note.params || {}) }}</em>
        </li>
      </ul>
    </section>

    <template v-if="run">
      <span class="canvas-wf__sep" />
      <section class="canvas-wf__section">
        <p class="canvas-wf__label">
          {{ t('本次派生：{source} · {n} 个版本', { source: run.sourceLabel || t('源节点'), n: run.nodeIds.length }) }}
        </p>
        <p v-if="run.error" class="canvas-matrix__hint is-warn">{{ run.error }}</p>
        <p v-else-if="batch" class="canvas-matrix__hint">
          <template v-if="batchActive">{{ t('服务端生成中：成功 {ok} 个，失败 {failed} 个，共 {total} 个，已用 {spent} 点', { ok: batch.succeeded, failed: batch.failed, total: batch.total, spent: batch.spent_points }) }}</template>
          <template v-else-if="batch.status === 'cancelled'">{{ t('批次已取消') }}</template>
          <template v-else>{{ t('批次已完成：成功 {ok} 个，失败 {failed} 个', { ok: batch.succeeded, failed: batch.failed }) }}</template>
        </p>
        <p v-else class="canvas-matrix__hint">{{ t('正在提交服务端批量…') }}</p>
        <ul v-if="run.nodeIds.length && (batch || run.error)" class="canvas-matrix__list">
          <li v-for="(nodeId, index) in run.nodeIds" :key="nodeId" class="canvas-matrix__version">
            <span class="canvas-wf__meta">
              <strong>{{ runVersionLabel(nodeId, index) }}</strong>
              <em v-if="statusText(nodeId)">{{ statusText(nodeId) }}</em>
              <em v-if="itemStatusOf.get(nodeId)?.error" class="canvas-matrix__degraded">{{ itemStatusOf.get(nodeId)?.error }}</em>
            </span>
          </li>
        </ul>
        <p v-if="batch?.pause_reason" class="canvas-matrix__hint is-warn">{{ t('批次已暂停：{reason}', { reason: batch.pause_reason }) }}</p>
        <div class="canvas-matrix__ops">
          <button v-if="run.error" type="button" class="canvas-matrix__ghost" :disabled="submitting" @click="onResubmit()">{{ t('重试提交') }}</button>
          <button v-if="batch?.status === 'paused'" type="button" class="canvas-matrix__ghost" :disabled="submitting" @click="emit('action', 'resume')">{{ t('继续') }}</button>
          <button v-if="batchActive" type="button" class="canvas-matrix__ghost" :disabled="submitting" @click="emit('action', 'cancel')">{{ t('取消批次') }}</button>
          <button v-if="batch?.failed" type="button" class="canvas-matrix__ghost" :disabled="submitting" @click="emit('action', 'retry-failed')">{{ t('重试失败项') }}</button>
          <button type="button" class="canvas-matrix__ghost" :disabled="submitting" @click="onRollback()">{{ t('回滚派生节点') }}</button>
        </div>
      </section>
    </template>
        </div>

        <footer class="canvas-wf__foot">
          <section class="canvas-matrix__total">
            <span class="canvas-matrix__points">
              <template v-if="!priced">{{ t('定价清单还没加载好，暂不估价') }}</template>
              <template v-else-if="unpriced">{{ t('有版本估不出点数（模型未定价），先换模型再派生') }}</template>
              <template v-else>{{ t('预计总点数 {n}', { n: points.total }) }}</template>
            </span>
            <em>{{ t('余额 {n}', { n: balance }) }}</em>
          </section>
          <p v-if="estimateReady && !enough" class="canvas-matrix__hint is-warn">
            {{ t('余额不足：本次预计 {n} 点，先充值再派生', { n: points.total }) }}
          </p>
          <div class="canvas-matrix__ops">
            <button type="button" class="canvas-matrix__ghost" @click="closePanel()">{{ t('取消') }}</button>
            <button
              v-if="estimateReady && !enough"
              type="button"
              class="canvas-matrix__primary"
              @click="emit('recharge')"
            >
              {{ t('去充值') }}
            </button>
            <button
              v-else
              type="button"
              class="canvas-matrix__primary"
              :disabled="deriveLocked"
              @click="submit()"
            >
              {{ translating ? (translateNote || t('正在翻译…')) : (submitting ? t('提交中…') : (batchActive ? t('批次生成中…') : (placedPending ? t('先回滚或重试提交') : t('确认并派生生成')))) }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
