<script setup lang="ts">
import { reportApi } from '~/api/screenplay'
import type { ProductionReport } from '~/types/creative'
import { formatCostPerSecond, formatReportPoints, formatReportSeconds, imageStatusLabel, rejectReasonsText, reviewGateLabel, reviewTone, selectedStatusLabel, sortedReportShots } from '~/utils/production-report'

/**
 * 制片报表（API.md 26.3）：每镜候选 / 审片 / 成本 / 预计秒数，汇总数字、「距离定版还缺」、合成统计与门禁 / 定版状态。
 * 只读展示，数据全部来自 GET /user/canvas/:id/production-report；父组件挂上就加载，「刷新」重新拉。
 */
const props = defineProps<{
  canvasId: number
}>()

const { t } = useI18n()

const report = ref<ProductionReport | null>(null)
const loading = ref(false)
const error = ref('')

const shots = computed(() => sortedReportShots(report.value))
const missing = computed(() => report.value?.missing ?? [])
const totals = computed(() => report.value?.totals)
const composes = computed(() => report.value?.composes)

async function load() {
  if (!props.canvasId || loading.value)
    return
  loading.value = true
  error.value = ''
  try {
    const res = await reportApi.production(props.canvasId)
    if (!res?.success || !res.data) {
      error.value = res?.message || t('报表加载失败')
      return
    }
    report.value = res.data
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : t('报表加载失败')
  }
  finally {
    loading.value = false
  }
}

watch(() => props.canvasId, () => {
  report.value = null
  void load()
}, { immediate: true })

defineExpose({ reload: load })
</script>

<template>
  <div class="cpr">
    <div class="cpr-bar">
      <h3>{{ t('制片报表') }}</h3>
      <template v-if="report">
        <span class="cpr-badge" :class="report.locked ? 'is-ok' : 'is-wait'">
          <UIcon :name="report.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" class="size-3" />
          {{ report.locked ? t('已定版') : t('未定版') }}
        </span>
        <span class="cpr-badge" :class="report.review_gate ? 'is-ok' : 'is-wait'">{{ t('门禁：{mode}', { mode: reviewGateLabel(report.review_gate, t) }) }}</span>
      </template>
      <span class="cpr-bar__spacer" />
      <button type="button" class="studio-chip" :disabled="loading || !canvasId" @click="load">
        <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="{ 'animate-spin': loading }" />
        {{ loading ? t('刷新中…') : t('刷新') }}
      </button>
    </div>

    <p v-if="error" class="publish-error">{{ error }}</p>
    <p v-else-if="loading && !report" class="create-hint">{{ t('正在加载报表…') }}</p>

    <template v-if="report && totals && composes">
      <div class="cpr-stats">
        <div class="cpr-stat">
          <b>{{ totals.shots_enabled }} <i>/</i> {{ totals.shots_approved }}</b>
          <span>{{ t('启用镜头 / 已通过镜头') }}</span>
          <small>{{ t('共 {n} 镜', { n: totals.shots }) }}</small>
        </div>
        <div class="cpr-stat">
          <b>{{ totals.candidates }} <i>/</i> {{ totals.reworks }}</b>
          <span>{{ t('候选总数 / 返工次数') }}</span>
        </div>
        <div class="cpr-stat">
          <b>{{ formatReportPoints(totals.cost_points) }}</b>
          <span>{{ t('净结算积分') }}</span>
          <small v-if="totals.failed_tasks">{{ t('失败 {n} 个任务已退回，不计成本', { n: totals.failed_tasks }) }}</small>
        </div>
        <div class="cpr-stat">
          <b>{{ formatCostPerSecond(totals.cost_per_second, totals.effective_seconds) }}</b>
          <span>{{ t('每有效秒成本（积分）') }}</span>
          <small>{{ t('有效时长 {s} 秒', { s: formatReportSeconds(totals.effective_seconds) }) }}</small>
        </div>
      </div>

      <div class="cpr-table-wrap">
        <table class="cpr-table">
          <thead>
            <tr>
              <th>{{ t('镜号') }}</th>
              <th class="cpr-table__line">{{ t('台词摘要') }}</th>
              <th>{{ t('候选 / 通过 / 退回') }}</th>
              <th>{{ t('选用状态') }}</th>
              <th>{{ t('分镜图') }}</th>
              <th>{{ t('成本') }}</th>
              <th>{{ t('预计秒数') }}</th>
              <th class="cpr-table__reason">{{ t('退回原因') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="shot in shots" :key="shot.node_id" :class="{ 'is-disabled': !shot.enabled }">
              <td>
                #{{ shot.no }}
                <em v-if="!shot.enabled">{{ t('未启用') }}</em>
              </td>
              <td class="cpr-table__line" :title="shot.line">{{ shot.line || '—' }}</td>
              <td>{{ shot.candidates }} / {{ shot.approved }} / {{ shot.rejected }}<small v-if="shot.reworks"> · {{ t('返工 {n}', { n: shot.reworks }) }}</small></td>
              <td><span class="cpr-status" :class="`is-${reviewTone(shot.selected_status)}`">{{ selectedStatusLabel(shot.selected_status, t) }}</span></td>
              <td><span class="cpr-status" :class="`is-${reviewTone(shot.image_status)}`">{{ imageStatusLabel(shot.image_status, t) }}</span></td>
              <td>{{ formatReportPoints(shot.cost_points) }}</td>
              <td>{{ formatReportSeconds(shot.effective_seconds) }}</td>
              <td class="cpr-table__reason">{{ rejectReasonsText(shot.reject_reasons, t) || '—' }}</td>
            </tr>
            <tr v-if="!shots.length">
              <td colspan="8" class="cpr-table__empty">{{ t('还没有镜头') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="cpr-missing" :class="{ 'is-clear': !missing.length }">
        <h4>
          <UIcon :name="missing.length ? 'i-lucide-alert-circle' : 'i-lucide-check-circle-2'" class="size-4" />
          {{ missing.length ? t('距离定版还缺 {n} 项', { n: missing.length }) : t('启用的镜头都已通过审片，可以定版') }}
        </h4>
        <ul v-if="missing.length">
          <li v-for="item in missing" :key="`${item.node_id}-${item.what}`"><b>#{{ item.no }}</b> {{ item.what }}</li>
        </ul>
      </div>

      <p class="create-hint cpr-composes">
        {{ t('合成 {total} 次 · 成功 {done} · 预览 {previews} · 交付包 {packages}', { total: composes.total, done: composes.done, previews: composes.previews, packages: composes.packages }) }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.cpr {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  text-align: left;
}

.cpr-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.cpr-bar h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cpr-bar__spacer {
  flex: 1;
}

.cpr-bar .studio-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cpr-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: var(--st-hover);
  color: var(--st-text-soft);
}

.cpr-badge.is-ok {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}

.cpr-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.cpr-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-elevated);
}

.cpr-stat b {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.cpr-stat b i {
  font-style: normal;
  font-weight: 400;
  color: var(--st-muted);
}

.cpr-stat span {
  font-size: 12px;
  color: var(--st-text-soft);
}

.cpr-stat small {
  font-size: 11px;
  color: var(--st-muted);
}

.cpr-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--st-border);
  border-radius: 12px;
}

.cpr-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.cpr-table th,
.cpr-table td {
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--st-border);
  vertical-align: top;
}

.cpr-table th {
  font-weight: 500;
  color: var(--st-text-soft);
  background: var(--st-hover);
}

.cpr-table tbody tr:last-child td {
  border-bottom: 0;
}

.cpr-table tr.is-disabled td {
  color: var(--st-muted);
}

.cpr-table td em {
  margin-left: 4px;
  font-style: normal;
  font-size: 11px;
  color: var(--st-muted);
}

.cpr-table td small {
  color: var(--st-muted);
}

.cpr-table__line {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cpr-table__reason {
  white-space: normal;
  min-width: 120px;
}

.cpr-table__empty {
  text-align: center;
  color: var(--st-muted);
}

.cpr-status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--st-text-soft);
  background: var(--st-hover);
}

.cpr-status.is-ok {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}

.cpr-status.is-bad {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.12);
}

.cpr-status.is-none {
  color: var(--st-muted);
  background: transparent;
  border: 1px dashed var(--st-border);
}

.cpr-missing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
  font-size: 13px;
}

.cpr-missing.is-clear {
  background: rgba(22, 163, 74, 0.1);
  color: #15803d;
}

.cpr-missing h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.cpr-missing ul {
  margin: 0;
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cpr-missing li b {
  font-weight: 600;
  margin-right: 4px;
}

.cpr-composes {
  margin: 0;
}
</style>
