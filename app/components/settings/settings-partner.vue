<script setup lang="ts">
/**
 * 设置 · 创作伙伴计划（UGC 投稿）
 *
 * - GET /user/ugc：本月积分进度、投稿记录
 * - POST /user/ugc：提交站外平台投稿链接，可选关联自己的作品
 * - 关联作品下拉：GET /user/work 前 50 条
 */
import { useI18n } from 'vue-i18n'
import ugcApi from '~/api/ugc'
import workApi from '~/api/work'
import type { UgcList, UgcPlatform, UgcStatus, Work } from '~/types/creative'
import { fillI18n } from '~/utils/i18n-fill'

const { t } = useI18n()
const toast = useToast()
const { growth } = useStudioAppConfig()

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function fmt(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const UGC_PLATFORMS: { id: UgcPlatform, label: string }[] = [
  { id: 'douyin', label: t('抖音') },
  { id: 'xiaohongshu', label: t('小红书') },
  { id: 'bilibili', label: t('B站') },
  { id: 'other', label: t('其他') },
]
/** 投稿状态（0 待审 1 通过 2 驳回） */
const UGC_STATUS_LABEL: Record<UgcStatus, { label: string, cls: string }> = {
  0: { label: t('待审'), cls: 'is-pending' },
  1: { label: t('已通过'), cls: 'is-published' },
  2: { label: t('已驳回'), cls: 'is-rejected' },
}
const ugc = ref<UgcList | null>(null)
const ugcLoading = ref(false)
const ugcError = ref('')
const ugcWorks = ref<Work[]>([])
const ugcWorksLoaded = ref(false)
const ugcForm = reactive<{ platform: UgcPlatform, url: string, work_id: number }>({ platform: 'douyin', url: '', work_id: 0 })
const ugcSubmitting = ref(false)

const ugcMonthCap = computed(() => ugc.value?.month_cap || growth.value?.ugc_monthly_cap || 0)
const ugcEntriesCap = computed(() => ugc.value?.month_entries_cap || growth.value?.ugc_monthly_entries || 0)
const ugcMonthPoints = computed(() => ugc.value?.month_points ?? 0)
const ugcPct = computed(() => pct(ugcMonthPoints.value, ugcMonthCap.value))

function ugcText(key: string, vars: Record<string, string | number>) {
  return fillI18n(t(key, vars), vars)
}

const ugcTierLine = computed(() => ugcText(
  '按视频时长分档：30 秒内 {a} 积分、60 秒 {b} 积分、120 秒及以上 {c} 积分',
  {
    a: growth.value?.ugc_points_30 ?? 0,
    b: growth.value?.ugc_points_60 ?? 0,
    c: growth.value?.ugc_points_120 ?? 0,
  },
))
const ugcViralLine = computed(() => {
  const likes = growth.value?.ugc_viral_likes
  if (!likes)
    return ''
  return ugcText('点赞达到 {n} 积分翻倍', { n: likes.toLocaleString() })
})
const ugcCapLine = computed(() => {
  if (!ugcMonthCap.value && !ugcEntriesCap.value)
    return ''
  return ugcText('每月最多提交 {n} 条，返积分上限 {cap} 积分', {
    n: ugcEntriesCap.value,
    cap: ugcMonthCap.value.toLocaleString(),
  })
})
const ugcMonthLine = computed(() => ugcText('本月已获得 {n} / {cap} 积分', {
  n: ugcMonthPoints.value.toLocaleString(),
  cap: ugcMonthCap.value.toLocaleString(),
}))
const ugcEntriesLine = computed(() => {
  if (!ugcEntriesCap.value || ugc.value?.month_entries == null)
    return ''
  return ugcText('已提交 {n} / {cap} 条', {
    n: ugc.value.month_entries,
    cap: ugcEntriesCap.value,
  })
})

function pct(used: number, limit: number) {
  if (!limit)
    return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

function ugcPlatformLabel(platform: UgcPlatform) {
  return UGC_PLATFORMS.find(item => item.id === platform)?.label ?? platform
}

function ugcStatusBadge(status: UgcStatus) {
  return UGC_STATUS_LABEL[status] ?? UGC_STATUS_LABEL[0]
}

/** 表格里只显示域名 + 路径前缀 */
function ugcShortUrl(url: string) {
  try {
    const u = new URL(url)
    const path = u.pathname.length > 18 ? `${u.pathname.slice(0, 18)}…` : u.pathname
    return `${u.host}${path === '/' ? '' : path}`
  }
  catch {
    return url.length > 40 ? `${url.slice(0, 40)}…` : url
  }
}

async function loadUgc() {
  if (ugcLoading.value)
    return
  ugcLoading.value = true
  ugcError.value = ''
  try {
    const res = await ugcApi.list()
    if (!res?.success || !res.data) {
      ugcError.value = res?.message || t('加载失败，请稍后重试')
      return
    }
    ugc.value = { ...res.data, items: res.data.items ?? [] }
  }
  finally {
    ugcLoading.value = false
  }
}

const ugcWorkOptions = computed(() => [
  { value: 0, label: t('不关联（选填）') },
  ...ugcWorks.value.map(item => ({ value: item.id, label: item.title })),
])

/** 关联作品下拉：我的作品前 50 条 */
async function loadUgcWorks() {
  if (ugcWorksLoaded.value)
    return
  const res = await workApi.mine({ page: 1, page_size: 50 })
  if (!res?.success || !res.data)
    return
  ugcWorks.value = res.data.items ?? []
  ugcWorksLoaded.value = true
}

function isValidUgcUrl(url: string) {
  return /^https?:\/\/\S+$/i.test(url) && url.length <= 500
}

async function submitUgc() {
  if (ugcSubmitting.value)
    return
  const url = ugcForm.url.trim()
  if (!isValidUgcUrl(url)) {
    notify(t('请输入以 http 开头的作品链接'), 'error')
    return
  }
  ugcSubmitting.value = true
  try {
    const res = await ugcApi.submit({ platform: ugcForm.platform, url, work_id: ugcForm.work_id || undefined })
    if (!res?.success) {
      notify(res?.message || t('提交失败'), 'error')
      return
    }
    notify(t('已提交，审核通过后积分自动到账'), 'success')
    ugcForm.url = ''
    ugcForm.work_id = 0
    await loadUgc()
  }
  finally {
    ugcSubmitting.value = false
  }
}

onMounted(() => {
  void loadUgc()
  void loadUgcWorks()
})
</script>

<template>
  <section class="wallet-card">
    <h3>
      {{ t('创作伙伴计划') }}
      <small>{{ t('把 EasyTV 作品发到站外平台，审核通过即得积分') }}</small>
    </h3>
    <ul class="wallet-card__meta invite-rules">
      <li>{{ ugcTierLine }}</li>
      <li v-if="ugcViralLine">{{ ugcViralLine }}</li>
      <li v-if="ugcCapLine">{{ ugcCapLine }}</li>
      <li>{{ t('同一链接只能提交一次，审核通过后积分自动到账') }}</li>
    </ul>
    <div class="partner-progress">
      <div class="partner-progress__text">
        <span>{{ ugcMonthLine }}</span>
        <span v-if="ugcEntriesLine">{{ ugcEntriesLine }}</span>
      </div>
      <i class="partner-progress__bar"><b :style="{ width: `${ugcPct}%` }" /></i>
    </div>
  </section>

  <section class="wallet-card">
    <h3>{{ t('提交投稿') }}</h3>
    <form class="partner-form" @submit.prevent="submitUgc">
      <div class="settings-row">
        <span class="settings-row__label">{{ t('平台') }}</span>
        <div class="settings-row__field">
          <div class="publish-tags partner-platforms">
            <button
              v-for="pf in UGC_PLATFORMS"
              :key="pf.id"
              type="button"
              :class="{ 'is-on': ugcForm.platform === pf.id }"
              @click="ugcForm.platform = pf.id"
            >
              {{ pf.label }}
            </button>
          </div>
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('作品链接') }}</span>
        <div class="settings-row__field">
          <input v-model="ugcForm.url" type="url" class="settings-input" maxlength="500" :placeholder="t('粘贴站外视频链接')">
        </div>
      </div>
      <div class="settings-row">
        <span class="settings-row__label">{{ t('关联作品') }}</span>
        <div class="settings-row__field">
          <StudioSelect
            v-model="ugcForm.work_id"
            :options="ugcWorkOptions"
            :sr-label="t('关联作品')"
          />
          <button type="submit" class="plan-btn plan-btn--solid" :disabled="ugcSubmitting">{{ ugcSubmitting ? t('提交中…') : t('提交') }}</button>
        </div>
      </div>
    </form>
  </section>

  <section class="wallet-card" :class="{ 'settings-empty-card': !ugcLoading && !ugc?.items.length }">
    <h3>{{ t('投稿记录') }}</h3>
    <p v-if="ugcLoading && !ugc" class="settings-lead">{{ t('加载中…') }}</p>
    <p v-else-if="!ugc" class="settings-lead">
      {{ ugcError || t('加载失败，请稍后重试') }}
      <button type="button" class="settings-link" @click="loadUgc">{{ t('重试') }}</button>
    </p>
    <StudioEmpty
      v-else-if="!ugc.items.length"
      compact
      :title="t('还没有投稿')"
      :description="t('把作品发到抖音 / 小红书后回来提交链接')"
    />
    <div v-else class="creator-table-wrap">
      <table class="creator-table">
        <thead>
          <tr>
            <th>{{ t('平台') }}</th>
            <th>{{ t('链接') }}</th>
            <th>{{ t('作品') }}</th>
            <th>{{ t('状态') }}</th>
            <th>{{ t('积分') }}</th>
            <th>{{ t('时间') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in ugc.items" :key="r.id">
            <td><i class="invite-badge">{{ ugcPlatformLabel(r.platform) }}</i></td>
            <td class="creator-table__title"><a :href="r.url" target="_blank" rel="noopener noreferrer">{{ ugcShortUrl(r.url) }}</a></td>
            <td class="creator-table__title">{{ r.work_title || '—' }}</td>
            <td>
              <i class="skill-review-badge" :class="ugcStatusBadge(r.status).cls" :title="r.status === 2 && r.remark ? r.remark : undefined">
                {{ ugcStatusBadge(r.status).label }}
                <UIcon v-if="r.status === 2 && r.remark" name="i-lucide-info" class="size-3" />
              </i>
            </td>
            <td class="creator-table__num">
              {{ r.status === 1 && r.points > 0 ? `+${r.points.toLocaleString()}` : '—' }}
              <small v-if="r.status === 1 && r.viral">{{ t('翻倍') }}</small>
            </td>
            <td class="creator-table__time">{{ fmt(r.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
