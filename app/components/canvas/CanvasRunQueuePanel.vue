<script setup lang="ts">
import type { GenerationTask } from '~/types/creative'
import { prettyModelSlug } from '~/utils/model-name'
import {
  runQueueAction,
  runQueueClock,
  runQueueError,
  runQueueLocate,
  runQueuePoints,
  runQueueProgress,
  runQueueSections,
  runQueueStatusKey,
  runQueueTypeKey,
  type RunQueueAction,
  type RunQueuePoints,
} from '~/utils/canvas-run-queue'

/**
 * 画布「运行队列」面板：这幅画布正在跑（排队 / 生成中，带进度）和刚跑完（成功 / 失败，失败带原因）的任务。
 * 点一条 → 选中并居中它挂的节点；能取消 / 重试的走既有端点（POST /user/task/:id/cancel|retry）。
 *
 * 外壳跟版本历史同一套居中弹窗（.canvas-wf，跟工作流 / 一稿多版同一套皮），
 * 状态、类型、点数文案跟任务中心同一套措辞。分组 / 判断全在 utils/canvas-run-queue.ts 里，这里是渲染。
 */
const props = withDefaults(defineProps<{
  open: boolean
  tasks: GenerationTask[]
  /** 画布上还在的节点 id：任务挂的节点被删了，那条只能看不能点 */
  nodeIds: string[]
  loading?: boolean
  /** 加载失败的原因（空串 = 没失败） */
  error?: string
  /** 正在取消 / 重试的任务 id */
  busyId?: number | null
  /** 画布还没保存（没有 id）：任务列表要等保存后才有 */
  unsaved?: boolean
  /** 最近一次查成功的时刻：算「刚结束」的时间窗与刷新按钮的转圈 */
  refreshedAt?: number
}>(), {
  loading: false,
  error: '',
  busyId: null,
  unsaved: false,
  refreshedAt: 0,
})

const emit = defineEmits<{
  close: []
  refresh: []
  locate: [task: GenerationTask]
  cancel: [task: GenerationTask]
  retry: [task: GenerationTask]
}>()

const { t } = useI18n()
const localePath = useLocalePath()

const TYPE_ICON: Record<string, string> = {
  text: 'i-lucide-file-text',
  image: 'i-lucide-image',
  video: 'i-lucide-play',
  audio: 'i-lucide-music',
}

type Row = {
  task: GenerationTask
  active: boolean
  statusKey: string
  typeKey: string
  icon: string
  model: string
  clock: string
  progress: number
  points: RunQueuePoints
  error: string
  action: RunQueueAction
  /** 能不能点这条定位（节点还在才行） */
  canLocate: boolean
  /** 不能定位的原因（已翻译） */
  reason: string
  busy: boolean
}

function toRow(task: GenerationTask, active: boolean, nodeIds: Set<string>): Row {
  const verdict = runQueueLocate(task, id => nodeIds.has(id))
  return {
    task,
    active,
    statusKey: runQueueStatusKey(task.status),
    typeKey: runQueueTypeKey(task.type),
    icon: TYPE_ICON[task.type] || 'i-lucide-box',
    model: prettyModelSlug(task.model),
    clock: runQueueClock(task.created_at, props.refreshedAt || Date.now()),
    progress: runQueueProgress(task),
    points: runQueuePoints(task),
    error: runQueueError(task),
    action: runQueueAction(task.status),
    canLocate: verdict.ok,
    reason: verdict.ok ? '' : t(verdict.reason),
    busy: props.busyId === task.id,
  }
}

/** 进行中一段 + 刚结束一段；顺序与过滤在 utils 里（进行中先提交的靠上，刚结束的按结束时间倒序） */
const rows = computed(() => {
  const at = props.refreshedAt || Date.now()
  const nodeIds = new Set(props.nodeIds)
  const { active, done } = runQueueSections(props.tasks, at)
  return [
    ...active.map(task => toRow(task, true, nodeIds)),
    ...done.map(task => toRow(task, false, nodeIds)),
  ]
})
const activeRows = computed(() => rows.value.filter(row => row.active))
const doneRows = computed(() => rows.value.filter(row => !row.active))
/** 第一次加载还没有结果：显示「加载中…」而不是空态 */
const firstLoading = computed(() => props.loading && !props.tasks.length)

function pointsLabel(row: Row) {
  if (row.points.kind === 'frozen')
    return t('预扣 {n} 积分', { n: row.points.points })
  if (row.points.kind === 'cost')
    return t('消耗 {n} 积分', { n: row.points.points })
  return t('积分已退回')
}

function openTaskCenter() {
  emit('close')
  void navigateTo(localePath('/tasks'))
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask canvas-wf-mask"
      @click.self="emit('close')"
      @pointerdown.stop
      @keydown.stop
    >
      <div
        class="canvas-wf canvas-queue studio-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-queue-title"
        @wheel.stop
      >
        <header class="canvas-wf__head">
          <h2 id="canvas-queue-title">
            {{ t('运行队列') }}
            <b v-if="activeRows.length" class="canvas-queue__count">{{ activeRows.length }}</b>
          </h2>
          <span class="canvas-queue__head-ops">
            <button type="button" class="trash-modal__close" :aria-label="t('刷新')" :disabled="loading" @click="emit('refresh')">
              <UIcon name="i-lucide-refresh-cw" class="size-4" :class="{ 'animate-spin': loading }" />
            </button>
            <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
          </span>
        </header>

        <div class="canvas-wf__body">
    <div v-if="unsaved" class="canvas-queue__empty">
      <UIcon name="i-lucide-save" class="size-7" />
      <p>{{ t('画布还没保存：保存后这里会列出这张画布的任务') }}</p>
    </div>
    <div v-else-if="error && !rows.length" class="canvas-queue__empty is-error">
      <span><UIcon name="i-lucide-circle-alert" class="size-3.5" />{{ error }}</span>
      <button type="button" @click="emit('refresh')">{{ t('刷新') }}</button>
    </div>
    <div v-else-if="firstLoading" class="canvas-queue__empty">{{ t('加载中…') }}</div>
    <div v-else-if="!rows.length && tasks.length" class="canvas-queue__empty">
      <UIcon name="i-lucide-history" class="size-7" />
      <p>{{ t('最近半小时没有进行中或刚结束的任务，更早的在任务中心。') }}</p>
    </div>
    <div v-else-if="!rows.length" class="canvas-queue__empty">
      <UIcon name="i-lucide-list-checks" class="size-7" />
      <p>{{ t('这张画布还没有跑过任务：选中节点点「生成」，任务会出现在这里。') }}</p>
    </div>
    <template v-else>
      <!-- 已经有列表时不再用整屏错误态盖住：取消失败一次也要能取消正在跑的任务 -->
      <p v-if="error" class="canvas-queue__error-line">
        <UIcon name="i-lucide-circle-alert" class="size-3.5" />{{ error }}
      </p>
      <section v-if="activeRows.length" class="canvas-queue__section">
        <p class="canvas-queue__label">{{ t('进行中') }}<em>{{ activeRows.length }}</em></p>
        <ul class="canvas-queue__list">
          <li v-for="row in activeRows" :key="row.task.id">
            <button
              type="button"
              class="canvas-queue__row"
              :disabled="!row.canLocate"
              :title="row.canLocate ? t('定位到节点') : row.reason"
              @click="emit('locate', row.task)"
            >
              <span class="canvas-queue__icon"><UIcon :name="row.icon" class="size-3.5" /></span>
              <span class="canvas-queue__meta">
                <span class="canvas-queue__head">
                  <b class="canvas-queue__status" :class="`is-${row.task.status}`">
                    <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
                    {{ t(row.statusKey) }}<template v-if="row.progress"> {{ row.progress }}%</template>
                  </b>
                  <em>{{ row.model }}</em>
                </span>
                <span class="canvas-queue__line">
                  <span>{{ t(row.typeKey) }}</span>
                  <span v-if="row.clock">{{ row.clock }}</span>
                  <span v-if="row.points.kind !== 'none'">{{ pointsLabel(row) }}</span>
                </span>
                <span v-if="!row.canLocate && row.reason" class="canvas-queue__note">
                  <UIcon name="i-lucide-unlink" class="size-3" />{{ row.reason }}
                </span>
              </span>
            </button>
            <span v-if="row.action" class="canvas-queue__acts">
              <button
                v-if="row.action === 'cancel'"
                type="button"
                :disabled="row.busy"
                :aria-label="t('取消任务')"
                :title="t('取消任务')"
                @click.stop="emit('cancel', row.task)"
              >
                <UIcon name="i-lucide-x" class="size-3.5" />
              </button>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="doneRows.length" class="canvas-queue__section">
        <p class="canvas-queue__label">{{ t('刚结束') }}<em>{{ doneRows.length }}</em></p>
        <ul class="canvas-queue__list">
          <li v-for="row in doneRows" :key="row.task.id">
            <button
              type="button"
              class="canvas-queue__row"
              :disabled="!row.canLocate"
              :title="row.canLocate ? t('定位到节点') : row.reason"
              @click="emit('locate', row.task)"
            >
              <span class="canvas-queue__icon"><UIcon :name="row.icon" class="size-3.5" /></span>
              <span class="canvas-queue__meta">
                <span class="canvas-queue__head">
                  <b class="canvas-queue__status" :class="`is-${row.task.status}`">{{ t(row.statusKey) }}</b>
                  <em>{{ row.model }}</em>
                </span>
                <span class="canvas-queue__line">
                  <span>{{ t(row.typeKey) }}</span>
                  <span v-if="row.clock">{{ row.clock }}</span>
                  <span v-if="row.points.kind !== 'none'">{{ pointsLabel(row) }}</span>
                </span>
                <span v-if="row.error" class="canvas-queue__error" :title="row.error">
                  <UIcon name="i-lucide-circle-alert" class="size-3" />{{ row.error }}
                </span>
                <span v-else-if="!row.canLocate && row.reason" class="canvas-queue__note">
                  <UIcon name="i-lucide-unlink" class="size-3" />{{ row.reason }}
                </span>
              </span>
            </button>
            <span v-if="row.action" class="canvas-queue__acts">
              <button
                type="button"
                :disabled="row.busy"
                :aria-label="t('重试')"
                :title="t('重试')"
                @click.stop="emit('retry', row.task)"
              >
                <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{ 'animate-spin': row.busy }" />
              </button>
            </span>
          </li>
        </ul>
      </section>
    </template>
        </div>

        <footer class="canvas-wf__foot">
          <button type="button" class="canvas-queue__more" @click="openTaskCenter">
            {{ t('去任务中心看全部') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
