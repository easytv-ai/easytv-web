<script setup lang="ts">
import assetApi from '~/api/asset'
import canvasApi from '~/api/canvas'
import { composeApi, timelineApi } from '~/api/screenplay'
import type { Asset, ComposeJob, NodeCandidate, Shot, ShotReviewReason, Timeline, TimelineClip, TimelineEstimate } from '~/types/creative'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import { candidateReviewState, clipEffectiveAssetId, clipSourceDuration, clipUsesRejected, duplicateClip, ensureClipIds, estimateTimeline, moveClip, selectableCandidates, subtitleSourceNodes, timelineSaveOutcome, trimmedDuration, unusableClips } from '~/utils/timeline'

/**
 * 成片时间线（API.md 12.2）：镜头排序 / 启用 / 换候选 / 入出点 / 配音方式与音量 / 逐镜字幕 / 画幅与分辨率 / BGM。
 * 时间线单独存服务端（乐观锁），改动 800ms 防抖保存；合成前父组件调用 flush() 拿最终时间线。
 * 片段按 id 区分（API.md 24.3），同一镜头可以复制成多条片段；保存失败保留本地草稿，冲突时由用户选（API.md 24.4）。
 * 第二批（API.md 25.4 ~ 25.6）：候选审片（通过 / 退回）、定版锁、预计时长（含配音延长）、整段低清试听。
 */
const props = defineProps<{
  canvasId: number
  /** 策划案 / 字幕语种，时间线首次创建时沿用 */
  lang: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:lang': [lang: string]
}>()

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { langs, load: loadLangs } = useLangs()

const loading = ref(false)
const timeline = ref<Timeline | null>(null)
const shots = ref<Shot[]>([])
const version = ref(0)
const bgmAssets = ref<Asset[]>([])
/** 字幕来源候选（API.md 35.4）：画布里装着 SRT 的文本节点 */
const subtitleNodes = ref<Array<{ id: string, label: string }>>([])
/** 正在预览的片段 id */
const previewClip = ref('')
/** 制片报表折叠面板（API.md 26.3）：默认收起，展开时组件自己拉数据 */
const reportOpen = ref(false)
/** 服务端算的预计时长（API.md 25.4）；本地一改就清掉，用前端同规则算，保存后再取服务端的 */
const serverEstimate = ref<TimelineEstimate | null>(null)
/** 定版锁（API.md 25.6） */
const locked = ref(false)
const lockedAt = ref(0)
const lockBusy = ref(false)

const shotByNode = computed(() => new Map(shots.value.map(shot => [shot.video.node_id, shot])))
const enabledCount = computed(() => timeline.value?.clips.filter(clip => clip.enabled).length ?? 0)
const estimate = computed<TimelineEstimate>(() => serverEstimate.value ?? (timeline.value ? estimateTimeline(timeline.value, shots.value) : { total: 0, clips: [] }))
const estimateByClip = computed(() => new Map(estimate.value.clips.map(item => [item.id, item])))
const unusable = computed(() => (timeline.value ? unusableClips(timeline.value, shots.value) : []))
/** 合成中（父组件）或已定版：所有控件只读 */
const readOnly = computed(() => !!props.disabled || locked.value)

const ASPECTS = ['16:9', '9:16', '1:1'] as const
const RESOLUTIONS = [{ id: '720p', label: '720P' }, { id: '1080p', label: '1080P' }] as const

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

async function load() {
  if (!props.canvasId)
    return
  loading.value = true
  try {
    const res = await timelineApi.get(props.canvasId)
    if (!res?.success || !res.data) {
      notify(res?.message || t('create.timeline.status.loadFail'), 'error')
      return
    }
    shots.value = res.data.shots
    version.value = res.data.version
    serverEstimate.value = res.data.estimate ?? null
    applyLock(res.data)
    const tl = res.data.timeline
    tl.clips = ensureClipIds(tl.clips ?? [])
    if (!res.data.version && props.lang)
      tl.lang = props.lang
    timeline.value = tl
    dirty = false
    saveError.value = ''
    conflict.value = false
    if (tl.lang && tl.lang !== props.lang)
      emit('update:lang', tl.lang)
  }
  finally {
    loading.value = false
  }
}

/** 画布上的字幕节点：语音转字幕的产物才有，多数画布是空的，选项就只有「策划案台词」 */
async function loadSubtitleNodes() {
  if (!props.canvasId)
    return
  try {
    const res = await canvasApi.get(props.canvasId)
    if (!res?.success || !res.data) {
      if (!subtitleNodes.value.length)
        notify(res?.message || t('加载失败，请稍后重试'), 'error')
      return
    }
    subtitleNodes.value = subtitleSourceNodes(res.data.graph?.nodes ?? [])
  }
  catch {
    if (!subtitleNodes.value.length)
      notify(t('加载失败，请稍后重试'), 'error')
  }
}

async function loadBgm() {
  try {
    const res = await assetApi.list({ type: 'audio', page: 1, page_size: 50 })
    if (!res?.success || !res.data) {
      if (!bgmAssets.value.length)
        notify(res?.message || t('资产加载失败'), 'error')
      return
    }
    bgmAssets.value = res.data.items
  }
  catch {
    if (!bgmAssets.value.length)
      notify(t('资产加载失败'), 'error')
  }
}

// ---- 保存：防抖 + 串行；失败保留草稿与 dirty，冲突时停下等用户选（API.md 24.4）----
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving: Promise<boolean> | null = null
let dirty = false
/** 最近一次保存失败的原因（非冲突），本地改动仍在，可重试 */
const saveError = ref('')
/** 服务端版本已被别处推进：自动保存暂停，等用户选「用服务端版本」或「保留我的修改并覆盖」 */
const conflict = ref(false)

function markDirty() {
  dirty = true
  serverEstimate.value = null
  if (saveTimer)
    clearTimeout(saveTimer)
  if (conflict.value || locked.value)
    return
  saveTimer = setTimeout(() => void save(), 800)
}

async function save(): Promise<boolean> {
  if (saving)
    await saving
  if (!dirty || !timeline.value)
    return true
  if (conflict.value)
    return false
  dirty = false
  const snapshot = JSON.parse(JSON.stringify(timeline.value)) as Timeline
  saving = (async () => {
    const res = await timelineApi.save(props.canvasId, version.value, snapshot)
    const outcome = timelineSaveOutcome(res)
    if (outcome === 'ok' && res?.data) {
      version.value = res.data.version
      saveError.value = ''
      void refreshEstimate()
      return true
    }
    // 失败：本地草稿与 dirty 标志都保留，不自动重载覆盖用户的剪辑
    dirty = true
    if (outcome === 'conflict') {
      conflict.value = true
      saveError.value = ''
    }
    else if (outcome === 'locked') {
      // 别处已定版：切到锁定态，本地改动留着，解锁后再存（API.md 25.6）
      locked.value = true
      saveError.value = ''
    }
    else {
      saveError.value = res?.message || t('create.timeline.status.saveFail')
    }
    notify(res?.message || t('create.timeline.status.saveFail'), 'error')
    return false
  })()
  try {
    return await saving
  }
  finally {
    saving = null
  }
}

/** 普通失败后手动重试 */
function retrySave() {
  dirty = true
  void save()
}

/** 冲突：丢掉本地改动，用服务端版本 */
async function useServerVersion() {
  conflict.value = false
  dirty = false
  await load()
}

/** 冲突：拿到服务端最新 version，再用本地时间线覆盖 */
async function keepMine() {
  const res = await timelineApi.get(props.canvasId)
  if (!res?.success || !res.data) {
    notify(res?.message || t('create.timeline.status.loadFail'), 'error')
    return
  }
  version.value = res.data.version
  shots.value = res.data.shots
  conflict.value = false
  dirty = true
  await save()
}

/** 保存成功后取一次服务端的 estimate / 锁状态（PUT 只回 version，API.md 25.4 的 estimate 只在 GET 里）；期间又改了就不覆盖 */
async function refreshEstimate() {
  const res = await timelineApi.get(props.canvasId)
  if (!res?.success || !res.data || dirty)
    return
  serverEstimate.value = res.data.estimate ?? null
  shots.value = res.data.shots
  applyLock(res.data)
}

/** 合成前调用：把没保存的改动存上，返回要合成的时间线（保存失败返回 null） */
async function flush(): Promise<Timeline | null> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!timeline.value)
    return null
  const ok = await save()
  return ok ? timeline.value : null
}

defineExpose({ flush, enabledCount, reload: load })

// ---- 定版锁（API.md 25.6）----
function applyLock(data: { locked?: boolean, locked_at?: number }) {
  locked.value = !!data.locked
  lockedAt.value = Number(data.locked_at) || 0
}

const lockedAtLabel = computed(() => lockedAt.value ? formatTime(lockedAt.value) : '')

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 定版：先把没保存的改动存上再上锁；解锁要确认。没保存过时间线时后端会说「先保存一次再定版」，原样提示 */
async function setLock(next: boolean) {
  if (lockBusy.value || !props.canvasId)
    return
  if (!next) {
    const ok = await confirm({ title: t('create.timeline.lock.unlockTitle'), message: t('create.timeline.lock.unlockConfirm'), confirmText: t('create.timeline.lock.unlock'), danger: true })
    if (!ok)
      return
  }
  else if (saveTimer || dirty) {
    if (saveTimer)
      clearTimeout(saveTimer)
    saveTimer = null
    if (!(await save()))
      return
  }
  lockBusy.value = true
  try {
    const res = await timelineApi.lock(props.canvasId, next)
    if (!res?.success || !res.data) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    applyLock(res.data)
    if (res.data.version)
      version.value = res.data.version
    notify(locked.value ? t('create.timeline.lock.locked') : t('create.timeline.lock.unlocked'))
    // 锁着的时候攒下的改动（比如别处定版时本地还没存上），解锁后接着存
    if (!locked.value && dirty)
      markDirty()
  }
  finally {
    lockBusy.value = false
  }
}

// ---- 候选审片（API.md 25.5）----
const REVIEW_REASONS: ShotReviewReason[] = ['identity', 'performance', 'lipsync', 'composition', 'continuity', 'duration', 'technical']
const reasonLabels = computed<Record<ShotReviewReason, string>>(() => ({
  identity: t('create.timeline.reason.identity'),
  performance: t('create.timeline.reason.performance'),
  lipsync: t('create.timeline.reason.lipsync'),
  composition: t('create.timeline.reason.composition'),
  continuity: t('create.timeline.reason.continuity'),
  duration: t('时长'),
  technical: t('create.timeline.reason.technical'),
}))
const reasonOptions = computed(() => REVIEW_REASONS.map(value => ({ value, label: reasonLabels.value[value] })))
/** 展开了候选面板的片段 id */
const reviewOpen = ref(new Set<string>())
/** 展开了「已退回」列表的片段 id */
const rejectedOpen = ref(new Set<string>())
/** 正在填退回原因的候选 */
const rejectForm = ref<{ clipId: string, assetId: number, reason: ShotReviewReason, note: string } | null>(null)
/** 正在提交结论的候选 asset_id */
const reviewBusy = ref(0)

function toggleOpen(which: 'review' | 'rejected', id: string) {
  const target = which === 'review' ? reviewOpen : rejectedOpen
  const next = new Set(target.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  target.value = next
}

function candidatesOf(clip: TimelineClip) {
  return shotOf(clip)?.video.candidates ?? []
}

function activeCandidates(clip: TimelineClip) {
  return candidatesOf(clip).filter(cand => candidateReviewState(cand) !== 'rejected')
}

function rejectedCandidates(clip: TimelineClip) {
  return candidatesOf(clip).filter(cand => candidateReviewState(cand) === 'rejected')
}

/** 候选序号按服务端顺序（新的在前）固定，退回收起后序号不变 */
function candidateNo(clip: TimelineClip, cand: NodeCandidate) {
  return candidatesOf(clip).indexOf(cand) + 1
}

function isCurrentCandidate(clip: TimelineClip, cand: NodeCandidate) {
  return clipEffectiveAssetId(clip, shotOf(clip)) === cand.asset_id
}

function usesRejected(clip: TimelineClip) {
  return clipUsesRejected(clip, shotOf(clip))
}

function reasonText(reason: string) {
  return (reasonLabels.value as Record<string, string>)[reason] || reason
}

function openReject(clip: TimelineClip, cand: NodeCandidate) {
  if (readOnly.value)
    return
  rejectForm.value = { clipId: clip.id, assetId: cand.asset_id, reason: 'identity', note: '' }
}

async function submitReview(cand: NodeCandidate, status: 'approved' | 'rejected' | 'clear', reason: ShotReviewReason | '' = '', note = '') {
  if (readOnly.value || reviewBusy.value || !props.canvasId)
    return
  reviewBusy.value = cand.asset_id
  try {
    const res = await timelineApi.review(props.canvasId, { node_id: cand.node_id, asset_id: cand.asset_id, status, reason, note: note.trim().slice(0, 500) })
    if (!res?.success || !res.data) {
      notify(res?.message || t('审片失败'), 'error')
      return
    }
    // 就地更新：同一资产可能出现在多个镜头的候选里，全部对齐
    for (const shot of shots.value) {
      for (const item of shot.video.candidates) {
        if (item.asset_id === res.data.asset_id)
          item.review = res.data.review
      }
    }
    if (rejectForm.value?.assetId === cand.asset_id)
      rejectForm.value = null
  }
  finally {
    reviewBusy.value = 0
  }
}

function confirmReject() {
  const form = rejectForm.value
  if (!form)
    return
  const cand = shots.value.flatMap(shot => shot.video.candidates).find(item => item.asset_id === form.assetId)
  if (cand)
    void submitReview(cand, 'rejected', form.reason, form.note)
}

// ---- 整段低清试听（API.md 25.4）：走合成接口 preview=true，与正式合成互不影响 ----
const PREVIEW_POLL_MS = 3000
const previewJob = ref<ComposeJob | null>(null)
const previewBusy = ref(false)
const previewError = ref('')
let stopPreviewPoll = () => {}
const previewActive = computed(() => previewJob.value ? previewJob.value.status === 0 || previewJob.value.status === 1 : false)
const previewProgress = computed(() => Math.min(100, Math.max(previewJob.value?.status === 2 ? 100 : 2, Number(previewJob.value?.progress) || 0)))
const previewUrl = computed(() => previewJob.value?.status === 2 && previewJob.value.output_url ? resolveMediaUrl(previewJob.value.output_url) : '')
const canPreview = computed(() => !!timeline.value && enabledCount.value > 0 && !unusable.value.length && !previewBusy.value && !previewActive.value && !conflict.value)

async function generatePreview() {
  if (!props.canvasId || !canPreview.value)
    return
  previewError.value = ''
  previewBusy.value = true
  try {
    const tl = await flush()
    if (!tl) {
      previewError.value = t('时间线保存失败，请稍后重试')
      return
    }
    const res = await composeApi.create(props.canvasId, { timeline: tl, preview: true })
    if (!res?.success || !res.data) {
      previewError.value = res?.message || t('提交失败')
      return
    }
    previewJob.value = res.data
    if (res.message)
      notify(res.message)
    stopPreviewPolling()
    stopPreviewPoll = startHiddenAwarePoll(() => pollPreview(), PREVIEW_POLL_MS)
  }
  finally {
    previewBusy.value = false
  }
}

function stopPreviewPolling() {
  stopPreviewPoll()
  stopPreviewPoll = () => {}
}

async function pollPreview() {
  const job = previewJob.value
  if (!job)
    return
  const res = await composeApi.get(job.id)
  if (!res?.success || !res.data)
    return
  previewJob.value = res.data
  if (res.data.status === 2) {
    stopPreviewPolling()
  }
  else if (res.data.status === -1) {
    stopPreviewPolling()
    previewError.value = res.data.error || t('create.timeline.preview.fail')
  }
}

function update(patch: Partial<Timeline>) {
  if (!timeline.value)
    return
  timeline.value = { ...timeline.value, ...patch }
  if (patch.lang !== undefined)
    emit('update:lang', patch.lang)
  markDirty()
}

function updateClip(index: number, patch: Partial<TimelineClip>) {
  if (!timeline.value)
    return
  const clips = timeline.value.clips.slice()
  clips[index] = { ...clips[index]!, ...patch }
  timeline.value = { ...timeline.value, clips }
  markDirty()
}

/** 复制片段（API.md 24.3）：同一镜头再插一条，入出点独立，用于正反打 / 反应镜头 */
function duplicate(index: number) {
  if (!timeline.value || timeline.value.clips.length >= 60)
    return
  timeline.value = { ...timeline.value, clips: duplicateClip(timeline.value.clips, index) }
  markDirty()
}

/** 删掉复制出来的片段（同一镜头至少留一条，单独的镜头用「启用」开关） */
function removeClip(index: number) {
  if (!timeline.value)
    return
  const clip = timeline.value.clips[index]
  if (!clip || timeline.value.clips.filter(item => item.node_id === clip.node_id).length <= 1)
    return
  const clips = timeline.value.clips.slice()
  clips.splice(index, 1)
  timeline.value = { ...timeline.value, clips }
  markDirty()
}

function isDuplicate(clip: TimelineClip) {
  return (timeline.value?.clips.filter(item => item.node_id === clip.node_id).length ?? 0) > 1
}

function move(index: number, delta: number) {
  if (!timeline.value)
    return
  timeline.value = { ...timeline.value, clips: moveClip(timeline.value.clips, index, index + delta) }
  markDirty()
}

// 拖拽排序（原生 HTML5 拖拽）
const dragIndex = ref(-1)
function onDragStart(index: number) {
  dragIndex.value = index
}
function onDrop(index: number) {
  if (dragIndex.value >= 0 && timeline.value) {
    timeline.value = { ...timeline.value, clips: moveClip(timeline.value.clips, dragIndex.value, index) }
    markDirty()
  }
  dragIndex.value = -1
}

function shotOf(clip: TimelineClip) {
  return shotByNode.value.get(clip.node_id)
}

function sourceDuration(clip: TimelineClip) {
  return clipSourceDuration(clip, shotOf(clip))
}

function clipVideoUrl(clip: TimelineClip) {
  const shot = shotOf(clip)
  if (!shot)
    return ''
  if (clip.asset_id) {
    const cand = shot.video.candidates.find(item => item.asset_id === clip.asset_id)
    if (cand)
      return resolveMediaUrl(cand.url)
  }
  return shot.video.url ? resolveMediaUrl(shot.video.url) : ''
}

function clipCover(clip: TimelineClip) {
  const shot = shotOf(clip)
  const cand = clip.asset_id ? shot?.video.candidates.find(item => item.asset_id === clip.asset_id) : null
  const cover = cand?.cover_url || shot?.video.cover_url || shot?.image?.url || ''
  return cover ? resolveMediaUrl(cover) : ''
}

/** 预览：媒体片段只播入出点之间 */
function previewSrc(clip: TimelineClip) {
  const url = clipVideoUrl(clip)
  if (!url)
    return ''
  const end = clip.out > clip.in ? clip.out : ''
  return `${url}#t=${clip.in || 0}${end ? `,${end}` : ''}`
}

function candidateLabel(index: number, created: number, model: string) {
  const time = created ? formatTime(created) : ''
  return `${t('create.timeline.review.candidate', { n: index + 1 })} · ${model}${time ? ` · ${time}` : ''}`
}

function candidateMeta(cand: NodeCandidate) {
  const parts = [t('create.timeline.clip.seconds', { s: Number(cand.duration) || '?' }), cand.model]
  if (cand.created_at)
    parts.push(formatTime(cand.created_at))
  return parts.join(' · ')
}

/** 片段行的时长说明：启用的片段用预计时长（含配音延长），停用的只显示裁切后的段长 */
function clipEstimate(clip: TimelineClip) {
  return clip.enabled ? estimateByClip.value.get(clip.id) ?? null : null
}

const aspectOptions = ASPECTS.map(item => ({ value: item, label: item }))
const resolutionOptions = RESOLUTIONS.map(item => ({ value: item.id, label: item.label }))
const langOptions = computed(() => langs.value.map(item => ({ value: item.code, label: item.label })))
const subtitleSourceOptions = computed(() => {
  const list = [{ value: '', label: t('create.timeline.subtitle.fromPlan') }, ...subtitleNodes.value.map(item => ({ value: item.id, label: item.label }))]
  const current = timeline.value?.subtitle_node_id || ''
  if (current && !subtitleNodes.value.some(item => item.id === current))
    list.push({ value: current, label: t('create.timeline.subtitle.missingNode') })
  return list
})
const bgmOptions = computed(() => [
  { value: 0, label: t('create.timeline.audio.noBgm') },
  ...bgmAssets.value.map(item => ({ value: item.id, label: item.name })),
])
const voiceModeOptions = computed(() => [
  { value: 'mix', label: t('create.timeline.audio.mix') },
  { value: 'replace', label: t('create.timeline.audio.voiceOnly') },
  { value: 'off', label: t('create.timeline.audio.voiceOff') },
])

/** 选用下拉：退回的不可选（API.md 25.5），已通过的排前面带 ✓；当前选中的恰好被退回时保留一条禁用项让它能显示 */
function clipAssetOptions(clip: TimelineClip) {
  const all = candidatesOf(clip)
  const options: Array<{ value: number, label: string, disabled?: boolean }> = [
    { value: 0, label: t('create.timeline.clip.currentVideo') },
    ...selectableCandidates(all).map(cand => ({
      value: cand.asset_id,
      label: `${candidateReviewState(cand) === 'approved' ? '✓ ' : ''}${candidateLabel(all.indexOf(cand), cand.created_at, cand.model)}`,
    })),
  ]
  if (clip.asset_id && !options.some(item => item.value === clip.asset_id)) {
    const cand = all.find(item => item.asset_id === clip.asset_id)
    if (cand)
      options.push({ value: cand.asset_id, label: `${candidateLabel(all.indexOf(cand), cand.created_at, cand.model)} · ${t('已退回')}`, disabled: true })
  }
  return options
}

function onNumber(index: number, key: 'in' | 'out', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  updateClip(index, { [key]: Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : 0 })
}

function onVolume(index: number, key: 'orig_volume' | 'voice_volume', event: Event) {
  updateClip(index, { [key]: Number((event.target as HTMLInputElement).value) })
}

function onSubtitle(index: number, event: Event) {
  updateClip(index, { subtitle: (event.target as HTMLInputElement).value })
}

watch(() => props.canvasId, () => void load(), { immediate: true })
onMounted(() => {
  void loadLangs()
  void loadBgm()
  void loadSubtitleNodes()
})
onBeforeUnmount(() => {
  stopPreviewPolling()
  if (saveTimer) {
    clearTimeout(saveTimer)
    void save()
  }
})
</script>

<template>
  <div class="ctl">
    <p v-if="loading && !timeline" class="create-hint">{{ t('create.timeline.status.loading') }}</p>
    <template v-if="timeline">
      <div class="ctl-bar">
        <div class="ctl-lock" :class="{ 'is-locked': locked }">
          <template v-if="locked">
            <UIcon name="i-lucide-lock" class="size-3.5" />
            <span>{{ lockedAtLabel ? t('create.timeline.lock.lockedAt', { time: lockedAtLabel }) : t('已定版') }}</span>
            <button type="button" class="studio-chip" :disabled="lockBusy || disabled" @click="setLock(false)">{{ t('create.timeline.lock.unlock') }}</button>
          </template>
          <button v-else type="button" class="studio-chip" :disabled="lockBusy || disabled || conflict" :title="t('create.timeline.lock.lockHint')" @click="setLock(true)">
            <UIcon name="i-lucide-lock" class="size-3.5" />
            {{ t('create.timeline.lock.lock') }}
          </button>
        </div>
        <span class="ctl-clip__spacer" />
        <button type="button" class="studio-chip" :class="{ 'is-on': reportOpen }" :aria-expanded="reportOpen" :title="t('create.timeline.report.hint')" @click="reportOpen = !reportOpen">
          <UIcon name="i-lucide-clipboard-list" class="size-3.5" />
          {{ t('制片报表') }}
        </button>
        <button type="button" class="studio-chip" :disabled="!canPreview" :title="t('create.timeline.preview.hint')" @click="generatePreview">
          <UIcon name="i-lucide-play-circle" class="size-3.5" />
          {{ previewBusy || previewActive ? t('create.timeline.preview.busy') : previewJob ? t('create.timeline.preview.again') : t('create.timeline.preview.generate') }}
        </button>
      </div>
      <p v-if="locked" class="create-hint">{{ t('create.timeline.lock.readonly') }}</p>

      <div v-if="reportOpen" class="ctl-report">
        <CreateProductionReport :canvas-id="canvasId" />
      </div>

      <div v-if="previewJob || previewError" class="ctl-preview">
        <div v-if="previewActive" class="create-progress">
          <div class="create-progress__bar"><i :style="{ width: `${previewProgress}%` }" /></div>
          <span>{{ previewJob?.status === 0 ? t('create.timeline.preview.queued') : t('create.timeline.preview.progress', { n: previewProgress }) }}</span>
        </div>
        <template v-else-if="previewUrl">
          <video class="ctl-preview__video" :src="previewUrl" controls playsinline preload="metadata" />
          <p class="create-hint">{{ t('create.timeline.preview.note') }}</p>
          <p v-if="previewJob?.warning" class="create-hint">{{ previewJob.warning }}</p>
        </template>
        <p v-if="previewError" class="publish-error">{{ t('create.timeline.preview.failMsg', { msg: previewError }) }}</p>
      </div>

      <div class="ctl-settings">
        <label class="ctl-field">
          <span>{{ t('画幅') }}</span>
          <StudioSelect
            size="compact"
            :model-value="timeline.aspect"
            :options="aspectOptions"
            :disabled="readOnly"
            :sr-label="t('画幅')"
            @update:model-value="update({ aspect: $event as Timeline['aspect'] })"
          />
        </label>
        <label class="ctl-field">
          <span>{{ t('分辨率') }}</span>
          <StudioSelect
            size="compact"
            :model-value="timeline.resolution"
            :options="resolutionOptions"
            :disabled="readOnly"
            :sr-label="t('分辨率')"
            @update:model-value="update({ resolution: $event as Timeline['resolution'] })"
          />
        </label>
        <label class="ctl-field">
          <span>{{ t('语言') }}</span>
          <StudioSelect
            size="compact"
            :model-value="timeline.lang"
            :options="langOptions"
            :disabled="readOnly"
            :sr-label="t('语言')"
            @update:model-value="update({ lang: String($event) })"
          />
        </label>
        <div class="ctl-toggles">
          <label class="ctl-toggle">
            <input type="checkbox" :checked="timeline.subtitles" :disabled="readOnly" @change="update({ subtitles: ($event.target as HTMLInputElement).checked })">
            {{ t('字幕') }}
          </label>
          <label class="ctl-toggle">
            <input type="checkbox" :checked="timeline.voice" :disabled="readOnly" @change="update({ voice: ($event.target as HTMLInputElement).checked })">
            {{ t('配音') }}
          </label>
        </div>
        <label v-if="timeline.subtitles && subtitleSourceOptions.length > 1" class="ctl-field ctl-field--subsrc" :title="t('create.timeline.subtitle.sourceHint')">
          <span>{{ t('create.timeline.subtitle.source') }}</span>
          <StudioSelect
            size="compact"
            :model-value="timeline.subtitle_node_id || ''"
            :options="subtitleSourceOptions"
            :disabled="readOnly"
            :sr-label="t('create.timeline.subtitle.source')"
            @update:model-value="update({ subtitle_node_id: String($event) })"
          />
        </label>
        <label class="ctl-field ctl-field--bgm">
          <span>{{ t('create.timeline.audio.bgm') }}</span>
          <StudioSelect
            size="compact"
            :model-value="timeline.bgm_asset_id"
            :options="bgmOptions"
            :disabled="readOnly"
            :sr-label="t('create.timeline.audio.bgm')"
            @update:model-value="update({ bgm_asset_id: Number($event) })"
          />
        </label>
        <label v-if="timeline.bgm_asset_id" class="ctl-field">
          <span>{{ t('create.timeline.audio.bgmVolume') }} {{ Math.round(timeline.bgm_volume * 100) }}%</span>
          <input type="range" min="0" max="1" step="0.05" :value="timeline.bgm_volume" :disabled="readOnly" @change="update({ bgm_volume: Number(($event.target as HTMLInputElement).value) })">
        </label>
      </div>

      <p class="create-hint">
        {{ t('create.timeline.clip.enabledSummary', { n: enabledCount, s: estimate.total }) }}
      </p>
      <div v-if="conflict" class="ctl-alert" role="alert">
        <p>{{ t('create.timeline.status.conflict') }}</p>
        <div class="ctl-alert__actions">
          <button type="button" class="studio-chip" @click="useServerVersion">{{ t('create.timeline.status.useServer') }}</button>
          <button type="button" class="studio-chip" @click="keepMine">{{ t('create.timeline.status.keepMine') }}</button>
        </div>
      </div>
      <div v-else-if="saveError" class="ctl-alert" role="alert">
        <p>{{ t('create.timeline.status.saveFailKept', { msg: saveError }) }}</p>
        <div class="ctl-alert__actions">
          <button type="button" class="studio-chip" @click="retrySave">{{ t('create.timeline.status.retry') }}</button>
        </div>
      </div>
      <p v-if="unusable.length" class="publish-error">
        {{ t('create.timeline.clip.missingVideo', { n: unusable.length }) }}
      </p>

      <ol class="ctl-list">
        <li
          v-for="(clip, index) in timeline.clips"
          :key="clip.id"
          class="ctl-clip"
          :class="{ 'is-off': !clip.enabled, 'is-drag': dragIndex === index, 'is-rejected': usesRejected(clip) }"
          :draggable="!readOnly"
          @dragstart="onDragStart(index)"
          @dragover.prevent
          @drop.prevent="onDrop(index)"
        >
          <div class="ctl-clip__head">
            <span class="ctl-clip__grip" :title="t('create.timeline.clip.drag')">⋮⋮</span>
            <input type="checkbox" :checked="clip.enabled" :disabled="readOnly" :aria-label="t('create.timeline.clip.enable')" @change="updateClip(index, { enabled: ($event.target as HTMLInputElement).checked })">
            <strong>{{ t('create.timeline.clip.shot', { n: shotOf(clip)?.no ?? index + 1 }) }}</strong>
            <small v-if="isDuplicate(clip)" class="ctl-clip__dup">{{ t('create.timeline.clip.fragment') }}</small>
            <template v-if="clipEstimate(clip)">
              <small>{{ t('create.timeline.clip.estimate', { s: clipEstimate(clip)!.duration }) }}</small>
              <small v-if="clipEstimate(clip)!.voice_extended > 0" class="ctl-clip__ext" :title="t('create.timeline.clip.voiceExtendHint')">{{ t('create.timeline.clip.voiceExtend', { s: clipEstimate(clip)!.voice_extended }) }}</small>
            </template>
            <small v-else>{{ t('create.timeline.clip.seconds', { s: trimmedDuration(clip, sourceDuration(clip)) }) }}</small>
            <span class="ctl-clip__spacer" />
            <button type="button" :disabled="readOnly || timeline.clips.length >= 60" :title="t('create.timeline.clip.duplicate')" :aria-label="t('create.timeline.clip.duplicate')" @click="duplicate(index)">
              <UIcon name="i-lucide-copy" class="size-3.5" />
            </button>
            <button v-if="isDuplicate(clip)" type="button" :disabled="readOnly" :title="t('create.timeline.clip.remove')" :aria-label="t('create.timeline.clip.remove')" @click="removeClip(index)">
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
            <button type="button" :disabled="readOnly || index === 0" :aria-label="t('上移')" @click="move(index, -1)">
              <UIcon name="i-lucide-arrow-up" class="size-3.5" />
            </button>
            <button type="button" :disabled="readOnly || index === timeline.clips.length - 1" :aria-label="t('下移')" @click="move(index, 1)">
              <UIcon name="i-lucide-arrow-down" class="size-3.5" />
            </button>
          </div>

          <div class="ctl-clip__body">
            <button type="button" class="ctl-clip__thumb" :aria-label="t('create.timeline.clip.preview')" @click="previewClip = previewClip === clip.id ? '' : clip.id">
              <video v-if="previewClip === clip.id && clipVideoUrl(clip)" :src="previewSrc(clip)" autoplay muted playsinline controls />
              <img v-else-if="clipCover(clip)" :src="clipCover(clip)" alt="">
              <span v-else>{{ t('未生成') }}</span>
            </button>

            <div class="ctl-clip__controls">
              <div v-if="candidatesOf(clip).length" class="ctl-cands">
                <div class="ctl-row">
                  <label v-if="candidatesOf(clip).length > 1" class="ctl-field">
                    <span>{{ t('create.timeline.review.label') }}</span>
                    <StudioSelect
                      size="compact"
                      :model-value="clip.asset_id"
                      :options="clipAssetOptions(clip)"
                      :disabled="readOnly"
                      :sr-label="t('create.timeline.review.label')"
                      @update:model-value="updateClip(index, { asset_id: Number($event) })"
                    />
                  </label>
                  <button type="button" class="plan-editor__link ctl-cands__toggle" :aria-expanded="reviewOpen.has(clip.id)" @click="toggleOpen('review', clip.id)">
                    <UIcon :name="reviewOpen.has(clip.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3.5" />
                    {{ reviewOpen.has(clip.id) ? t('create.timeline.review.collapse') : t('create.timeline.review.count', { n: candidatesOf(clip).length }) }}
                  </button>
                </div>
                <p v-if="usesRejected(clip)" class="ctl-clip__warn" role="alert">
                  <UIcon name="i-lucide-triangle-alert" class="size-3.5" />
                  {{ t('create.timeline.review.currentRejected') }}
                </p>

                <ul v-if="reviewOpen.has(clip.id)" class="ctl-cand-list">
                  <li
                    v-for="cand in activeCandidates(clip)"
                    :key="cand.asset_id"
                    class="ctl-cand"
                    :class="{ 'is-approved': candidateReviewState(cand) === 'approved', 'is-current': isCurrentCandidate(clip, cand) }"
                  >
                    <div class="ctl-cand__thumb">
                      <img v-if="cand.cover_url" :src="resolveMediaUrl(cand.cover_url)" alt="">
                      <span v-else>{{ t('create.timeline.review.noCover') }}</span>
                    </div>
                    <div class="ctl-cand__meta">
                      <div class="ctl-cand__title">
                        <strong>{{ t('create.timeline.review.candidate', { n: candidateNo(clip, cand) }) }}</strong>
                        <span v-if="isCurrentCandidate(clip, cand)" class="ctl-cand__badge">{{ t('create.timeline.review.selected') }}</span>
                        <span v-if="candidateReviewState(cand) === 'approved'" class="ctl-cand__badge is-ok">{{ t('已通过') }}</span>
                      </div>
                      <small>{{ candidateMeta(cand) }}</small>
                      <small v-if="cand.review?.note" class="ctl-cand__note">{{ cand.review.note }}</small>
                    </div>
                    <div class="ctl-cand__actions">
                      <button
                        v-if="!isCurrentCandidate(clip, cand)"
                        type="button"
                        class="studio-chip"
                        :disabled="readOnly"
                        @click="updateClip(index, { asset_id: cand.asset_id === shotOf(clip)?.video.asset_id ? 0 : cand.asset_id })"
                      >{{ t('create.timeline.review.pick') }}</button>
                      <template v-if="candidateReviewState(cand) === 'pending'">
                        <button type="button" class="studio-chip is-ok" :disabled="readOnly || reviewBusy === cand.asset_id" @click="submitReview(cand, 'approved')">{{ t('通过') }}</button>
                        <button type="button" class="studio-chip is-bad" :disabled="readOnly || reviewBusy === cand.asset_id" @click="openReject(clip, cand)">{{ t('退回') }}</button>
                      </template>
                      <button v-else type="button" class="studio-chip" :disabled="readOnly || reviewBusy === cand.asset_id" @click="submitReview(cand, 'clear')">{{ t('撤销') }}</button>
                    </div>
                    <div v-if="rejectForm?.assetId === cand.asset_id" class="ctl-cand__reject">
                      <label class="ctl-field">
                        <span>{{ t('退回原因') }}</span>
                        <StudioSelect
                          size="compact"
                          :model-value="rejectForm.reason"
                          :options="reasonOptions"
                          :sr-label="t('退回原因')"
                          @update:model-value="rejectForm && (rejectForm.reason = $event as ShotReviewReason)"
                        />
                      </label>
                      <label class="ctl-field ctl-field--wide">
                        <span>{{ t('备注') }} <small>{{ rejectForm.note.length }}/500</small></span>
                        <textarea v-model="rejectForm.note" class="create-select ctl-cand__textarea" rows="2" maxlength="500" :placeholder="t('给这条候选的具体意见（可选）')" />
                      </label>
                      <div class="ctl-alert__actions">
                        <button type="button" class="studio-chip is-bad" :disabled="reviewBusy === cand.asset_id" @click="confirmReject">{{ t('确认退回') }}</button>
                        <button type="button" class="studio-chip" @click="rejectForm = null">{{ t('取消') }}</button>
                      </div>
                    </div>
                  </li>

                  <li v-if="rejectedCandidates(clip).length" class="ctl-cand-list__rejected">
                    <button type="button" class="plan-editor__link" @click="toggleOpen('rejected', clip.id)">
                      {{ rejectedOpen.has(clip.id) ? t('create.timeline.review.collapseRejected') : t('create.timeline.review.showRejected', { n: rejectedCandidates(clip).length }) }}
                    </button>
                  </li>
                  <template v-if="rejectedOpen.has(clip.id)">
                    <li
                      v-for="cand in rejectedCandidates(clip)"
                      :key="cand.asset_id"
                      class="ctl-cand is-rejected"
                      :class="{ 'is-current': isCurrentCandidate(clip, cand) }"
                    >
                      <div class="ctl-cand__thumb">
                        <img v-if="cand.cover_url" :src="resolveMediaUrl(cand.cover_url)" alt="">
                        <span v-else>{{ t('create.timeline.review.noCover') }}</span>
                      </div>
                      <div class="ctl-cand__meta">
                        <div class="ctl-cand__title">
                          <strong>{{ t('create.timeline.review.candidate', { n: candidateNo(clip, cand) }) }}</strong>
                          <span v-if="isCurrentCandidate(clip, cand)" class="ctl-cand__badge is-bad">{{ t('create.timeline.review.selected') }}</span>
                          <span class="ctl-cand__badge is-bad">{{ cand.review?.reason ? t('已退回 · {reason}', { reason: reasonText(cand.review.reason) }) : t('已退回') }}</span>
                        </div>
                        <small>{{ candidateMeta(cand) }}</small>
                        <small v-if="cand.review?.note" class="ctl-cand__note">{{ cand.review.note }}</small>
                      </div>
                      <div class="ctl-cand__actions">
                        <button type="button" class="studio-chip" :disabled="readOnly || reviewBusy === cand.asset_id" @click="submitReview(cand, 'clear')">{{ t('撤销') }}</button>
                      </div>
                    </li>
                  </template>
                </ul>
              </div>
              <div class="ctl-row">
                <label class="ctl-field ctl-field--num">
                  <span>{{ t('create.timeline.clip.in') }}</span>
                  <input type="number" min="0" step="0.1" :max="sourceDuration(clip)" :value="clip.in || ''" :placeholder="t('create.timeline.clip.inPh')" :disabled="readOnly" @change="onNumber(index, 'in', $event)">
                </label>
                <label class="ctl-field ctl-field--num">
                  <span>{{ t('create.timeline.clip.out') }}</span>
                  <input type="number" min="0" step="0.1" :max="sourceDuration(clip)" :value="clip.out || ''" :placeholder="t('create.timeline.clip.outPh')" :disabled="readOnly" @change="onNumber(index, 'out', $event)">
                </label>
                <small class="create-compose__hint">{{ t('create.timeline.clip.sourceSeconds', { s: sourceDuration(clip) || '?' }) }}</small>
              </div>
              <div v-if="timeline.voice && shotOf(clip)?.voice?.asset_id" class="ctl-row">
                <label class="ctl-field">
                  <span>{{ t('配音') }}</span>
                  <StudioSelect
                    size="compact"
                    :model-value="clip.voice_mode"
                    :options="voiceModeOptions"
                    :disabled="readOnly"
                    :sr-label="t('配音')"
                    @update:model-value="updateClip(index, { voice_mode: String($event) as TimelineClip['voice_mode'] })"
                  />
                </label>
                <label v-if="clip.voice_mode !== 'off'" class="ctl-field">
                  <span>{{ t('create.timeline.audio.voiceVolume') }} {{ Math.round(clip.voice_volume * 100) }}%</span>
                  <input type="range" min="0" max="2" step="0.05" :value="clip.voice_volume" :disabled="readOnly" @change="onVolume(index, 'voice_volume', $event)">
                </label>
              </div>
              <label v-if="!(timeline.voice && shotOf(clip)?.voice?.asset_id && clip.voice_mode === 'replace')" class="ctl-field">
                <span>{{ t('create.timeline.audio.origVolume') }} {{ Math.round(clip.orig_volume * 100) }}%</span>
                <input type="range" min="0" max="2" step="0.05" :value="clip.orig_volume" :disabled="readOnly" @change="onVolume(index, 'orig_volume', $event)">
              </label>
              <label v-if="timeline.subtitles" class="ctl-field ctl-field--wide">
                <span>
                  {{ t('字幕') }}
                  <button v-if="clip.subtitle !== null" type="button" class="plan-editor__link" :disabled="readOnly" @click.prevent="updateClip(index, { subtitle: null })">{{ t('create.timeline.subtitle.restore') }}</button>
                </span>
                <input
                  class="create-select"
                  maxlength="200"
                  :value="clip.subtitle ?? shotOf(clip)?.line ?? ''"
                  :placeholder="t('create.timeline.subtitle.emptyPh')"
                  :disabled="readOnly"
                  @change="onSubtitle(index, $event)"
                >
              </label>
            </div>
          </div>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.ctl {
  display: flex;
  flex-direction: column;
  gap: 12px;
  accent-color: var(--st-on);
}

.ctl-settings {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px 16px;
}

.ctl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--st-text-soft);
}

.ctl-field :deep(.studio-select) {
  flex: none;
  width: 148px;
  min-width: 148px;
  max-width: 220px;
  height: auto;
  align-self: stretch;
}

.ctl-field--bgm :deep(.studio-select),
.ctl-clip__controls :deep(.studio-select) {
  width: 220px;
  min-width: 180px;
  max-width: 280px;
}

.ctl-field--num input {
  width: 88px;
  padding: 6px 8px;
  border: 1px solid var(--st-border);
  border-radius: 10px;
  font: inherit;
  color: inherit;
  background: var(--st-elevated);
}

.ctl-field--wide {
  flex: 1 1 100%;
}

.ctl-field--wide .create-select {
  width: 100%;
}

.ctl-field--subsrc {
  min-width: 180px;
  max-width: 240px;
}

.ctl-toggles {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  height: 36px;
}

.ctl-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--st-text);
  cursor: pointer;
  user-select: none;
}

.ctl-toggle input {
  width: 14px;
  height: 14px;
  margin: 0;
}

.ctl-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ctl-clip {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-elevated);
}

.ctl-clip.is-off {
  opacity: 0.55;
}

.ctl-clip.is-drag {
  border-style: dashed;
}

.ctl-clip__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.ctl-clip__head small {
  color: var(--st-muted);
}

.ctl-clip__head button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--st-border);
  border-radius: 8px;
  color: inherit;
  background: transparent;
}

.ctl-clip__head button:disabled {
  opacity: 0.35;
}

.ctl-clip__dup {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--st-text-soft);
  background: var(--st-hover);
}

.ctl-alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  font-size: 13px;
  background: var(--st-elevated);
}

.ctl-alert p {
  margin: 0;
}

.ctl-alert__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ctl-clip__grip {
  cursor: grab;
  color: var(--st-muted);
  letter-spacing: -2px;
}

.ctl-clip__spacer {
  flex: 1;
}

.ctl-clip__body {
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  gap: 12px 16px;
  align-items: start;
}

.ctl-clip__thumb {
  display: flex;
  width: 176px;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 10px;
  font-size: 12px;
  color: var(--st-muted);
  background: var(--st-hover);
}

.ctl-clip__thumb img,
.ctl-clip__thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ctl-clip__controls {
  display: flex;
  flex: 1 1 280px;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.ctl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.ctl-field input[type='range'] {
  width: 160px;
  height: 36px;
  margin: 0;
}

.ctl-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.ctl-bar .studio-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctl-lock {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.ctl-lock.is-locked {
  color: #16a34a;
}

.ctl-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-elevated);
}

.ctl-report {
  padding: 12px;
  border: 1px solid var(--st-border);
  border-radius: 14px;
  background: var(--st-elevated);
}

.ctl-preview__video {
  width: 100%;
  max-height: 360px;
  border-radius: 10px;
  background: #000;
}

.ctl-clip.is-rejected {
  border-color: rgba(239, 68, 68, 0.6);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.25);
}

.ctl-clip__ext {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: #b45309;
  background: rgba(245, 158, 11, 0.14);
}

.ctl-clip__warn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: #ef4444;
}

.ctl-cands {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ctl-cands__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-end;
  height: 36px;
}

.ctl-cand-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ctl-cand {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 6px 10px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--st-border);
  border-radius: 10px;
  font-size: 12px;
  background: var(--st-hover);
}

.ctl-cand.is-approved {
  border-color: rgba(22, 163, 74, 0.45);
}

.ctl-cand.is-rejected {
  opacity: 0.7;
  border-color: rgba(239, 68, 68, 0.35);
}

.ctl-cand.is-current {
  background: var(--st-elevated);
}

.ctl-cand__thumb {
  display: flex;
  width: 96px;
  aspect-ratio: 16 / 9;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  font-size: 11px;
  color: var(--st-muted);
  background: var(--st-elevated);
}

.ctl-cand__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ctl-cand__meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  color: var(--st-text-soft);
}

.ctl-cand__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--st-text);
}

.ctl-cand__note {
  white-space: pre-wrap;
  word-break: break-word;
}

.ctl-cand__badge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--st-text-soft);
  background: var(--st-elevated);
}

.ctl-cand__badge.is-ok {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}

.ctl-cand__badge.is-bad {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
}

.ctl-cand__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.ctl-cand__actions .studio-chip,
.ctl-cand__reject .studio-chip {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
}

.ctl-cand .studio-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ctl-cand .studio-chip.is-ok {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.35);
}

.ctl-cand .studio-chip.is-bad {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.35);
}

.ctl-cand__reject {
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  align-items: flex-end;
  gap: 8px 12px;
  padding-top: 6px;
  border-top: 1px dashed var(--st-border);
}

.ctl-cand__textarea {
  width: 100%;
  min-width: 0;
  resize: vertical;
}

.ctl-cand-list__rejected {
  padding: 2px 0;
}

@media (max-width: 640px) {
  .ctl-clip__body {
    grid-template-columns: 1fr;
  }

  .ctl-cand {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .ctl-cand__actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .ctl-clip__thumb {
    width: 100%;
  }

  .ctl-field :deep(.studio-select),
  .ctl-field--bgm :deep(.studio-select),
  .ctl-clip__controls :deep(.studio-select) {
    width: 100%;
    max-width: none;
  }
}
</style>
