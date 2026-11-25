<script setup lang="ts">
/**
 * 设置 · 团队
 *
 * - 已加入：额度条（积分池 / 席位 / 并发生成 / 云存储）、邀请码、充值、近 30 天、成员
 * - 未加入：输入邀请码加入 / 开通团队版会员创建
 *
 * 加入 / 退出 / 团队充值成功会通知父页刷新钱包（团队积分池变化）。
 */
import teamApi, { type TeamMember, type TeamPermission, type TeamView } from '~/api/team'
import usageApi, { type TeamUsageView } from '~/api/usage'
import TeamRecharge from './team-recharge.vue'

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { gotoPricing, pricingOpen } = usePricingModal()

const emit = defineEmits<{ teamChanged: [] }>()

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

// ===== 团队 =====
const team = ref<TeamView | null>(null)
const teamLoading = ref(false)
const joinCode = ref('')
const teamBusy = ref(false)
const teamName = ref('')

async function loadTeam() {
  teamLoading.value = true
  try {
    const res = await teamApi.mine()
    team.value = res?.success ? (res.data ?? null) : null
    teamName.value = team.value?.name ?? ''
  }
  finally {
    teamLoading.value = false
  }
}

async function joinTeam() {
  const code = joinCode.value.trim().toUpperCase()
  if (!code) {
    notify(t('请输入邀请码'), 'error')
    return
  }
  teamBusy.value = true
  try {
    const res = await teamApi.join(code)
    if (!res?.success) {
      notify(res?.message || t('加入失败'), 'error')
      return
    }
    notify(t('已加入「{name}」', { name: res.data?.name }), 'success')
    joinCode.value = ''
    await Promise.all([loadTeam(), loadTeamUsage()])
    emit('teamChanged')
  }
  finally {
    teamBusy.value = false
  }
}

async function quitTeam() {
  if (!(await confirm({
    title: t('退出团队'),
    message: t('退出后将不再共享团队积分，确定退出？'),
    confirmText: t('退出团队'),
    danger: true,
  })))
    return
  teamBusy.value = true
  try {
    const res = await teamApi.quit()
    if (!res?.success) {
      notify(res?.message || t('退出失败'), 'error')
      return
    }
    notify(t('已退出团队'), 'success')
    await Promise.all([loadTeam(), loadTeamUsage()])
    emit('teamChanged')
  }
  finally {
    teamBusy.value = false
  }
}

// ---- 成员权限 ----
const canManageTeam = computed(() => team.value?.permission === 'admin' || team.value?.role === 'owner')
const PERMISSION_LABELS = computed<Record<TeamPermission, string>>(() => ({
  admin: t('管理员'),
  editor: t('编辑者'),
  viewer: t('查看者'),
}))
const PERMISSION_HINTS = computed<Record<TeamPermission, string>>(() => ({
  admin: t('可编辑队友画布、管理成员权限与额度、删除项目'),
  editor: t('可编辑队友画布并用团队积分生成'),
  viewer: t('只能查看队友画布和批注，不能用团队积分生成'),
}))

function memberPermission(m: TeamMember): TeamPermission {
  return m.role === 'owner' ? 'admin' : (m.permission ?? 'editor')
}

function memberPermOptions(m: TeamMember) {
  const labels = PERMISSION_LABELS.value
  const options = [
    { value: 'editor', label: labels.editor },
    { value: 'viewer', label: labels.viewer },
  ]
  if (team.value?.role === 'owner' || memberPermission(m) === 'admin')
    return [{ value: 'admin', label: labels.admin }, ...options]
  return options
}

function canManageMember(m: TeamMember) {
  if (!canManageTeam.value || m.role === 'owner')
    return false
  return team.value?.role === 'owner' || memberPermission(m) !== 'admin'
}

const permBusy = ref(0)

async function changePermission(m: TeamMember, permission: TeamPermission) {
  if (permission === memberPermission(m) || permBusy.value)
    return
  const ok = await confirm({
    title: t('account.team.permissionTitle'),
    message: t('account.team.permissionMessage', {
      name: m.nickname || `#${m.user_id}`,
      perm: PERMISSION_LABELS.value[permission],
    }),
    confirmText: t('保存'),
  })
  if (!ok)
    return
  permBusy.value = m.user_id
  try {
    const res = await teamApi.setMemberPermission(m.user_id, permission)
    if (!res?.success) {
      notify(res?.message || t('保存失败'), 'error')
      await loadTeam()
      return
    }
    m.permission = permission
    notify(t('已把「{name}」设为{perm}', { name: m.nickname || `#${m.user_id}`, perm: PERMISSION_LABELS.value[permission] }), 'success')
  }
  finally {
    permBusy.value = 0
  }
}

async function kick(userId: number, name: string) {
  if (!(await confirm({
    title: t('移除成员'),
    message: t('移除成员「{name}」？', { name }),
    confirmText: t('移除'),
    danger: true,
  })))
    return
  const res = await teamApi.kick(userId)
  if (!res?.success) {
    notify(res?.message || t('移除失败'), 'error')
    return
  }
  await loadTeam()
}

const inviteBusy = ref(false)

async function regenerateInvite() {
  if (inviteBusy.value)
    return
  if (team.value?.invite_code) {
    const ok = await confirm({
      title: t('account.team.regenerateTitle'),
      message: t('account.team.regenerateMessage'),
      confirmText: t('重新生成'),
      danger: true,
    })
    if (!ok)
      return
  }
  inviteBusy.value = true
  try {
    const res = await teamApi.regenerateInvite()
    if (!res?.success) {
      notify(res?.message || t('生成失败'), 'error')
      return
    }
    await loadTeam()
    notify(t('已生成新邀请码，旧邀请码失效'), 'success')
  }
  finally {
    inviteBusy.value = false
  }
}

function copyBySelection(text: string, host: HTMLElement) {
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true
  area.setAttribute('aria-hidden', 'true')
  area.tabIndex = -1
  area.style.position = 'fixed'
  area.style.left = '0'
  area.style.top = '0'
  area.style.width = '2em'
  area.style.height = '2em'
  area.style.padding = '0'
  area.style.border = 'none'
  area.style.outline = 'none'
  area.style.opacity = '0'
  host.appendChild(area)
  try {
    area.focus({ preventScroll: true })
    area.select()
    area.setSelectionRange(0, area.value.length)
    return document.execCommand('copy')
  }
  catch {
    return false
  }
  finally {
    area.remove()
  }
}

async function copyInvite(event: MouseEvent) {
  const code = team.value?.invite_code
  if (!code)
    return
  const host = (event.currentTarget as HTMLElement | null)?.closest('.team-panel') as HTMLElement | null
  if (host && copyBySelection(code, host)) {
    notify(t('邀请码已复制'), 'success')
    return
  }
  try {
    await navigator.clipboard.writeText(code)
    notify(t('邀请码已复制'), 'success')
  }
  catch {
    notify(code)
  }
}

async function onTeamRecharged() {
  await Promise.all([loadTeam(), loadTeamUsage()])
  emit('teamChanged')
}

async function renameTeam() {
  const name = teamName.value.trim()
  if (!name || name === team.value?.name)
    return
  const res = await teamApi.rename(name)
  if (!res?.success) {
    notify(res?.message || t('改名失败'), 'error')
    return
  }
  await loadTeam()
  notify(t('团队名已更新'), 'success')
}

// ---- 成员月度积分额度 ----
const LIMIT_PRESETS = [0, 2000, 5000, 10000]
const limitEditing = ref(0)
const limitInput = ref(0)
const limitSaving = ref(false)

function memberLimit(m: TeamMember) {
  const raw = Number(m.points_limit ?? 0)
  return raw > 0 ? raw : 0
}

function memberLimitText(m: TeamMember) {
  const limit = memberLimit(m)
  if (!limit)
    return t('不限')
  return t('已用 {used} / {limit}', { used: Number(m.points_used ?? 0).toLocaleString(), limit: limit.toLocaleString() })
}

function openLimitEditor(m: TeamMember) {
  limitEditing.value = m.user_id
  limitInput.value = memberLimit(m)
}

function closeLimitEditor() {
  limitEditing.value = 0
}

async function saveMemberLimit(m: TeamMember) {
  if (limitSaving.value)
    return
  const next = Math.max(0, Math.floor(Number(limitInput.value) || 0))
  limitSaving.value = true
  try {
    const res = await teamApi.setMemberLimit(m.user_id, next)
    if (!res?.success) {
      notify(res?.message || t('额度保存失败'), 'error')
      return
    }
    closeLimitEditor()
    await loadTeam()
    notify(next ? t('额度已更新') : t('已设为不限'), 'success')
  }
  finally {
    limitSaving.value = false
  }
}

// ---- 团队用量 ----
const teamUsage = ref<TeamUsageView | null>(null)
const teamUsageLoading = ref(false)

async function loadTeamUsage() {
  teamUsageLoading.value = true
  try {
    const res = await usageApi.team()
    teamUsage.value = res?.success && res.data ? res.data : null
  }
  finally {
    teamUsageLoading.value = false
  }
}

function formatCount(n: number) {
  return Math.round(Number(n) || 0).toLocaleString()
}

function formatBytes(n: number) {
  if (!n)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function pct(used: number, limit: number) {
  if (!limit)
    return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

/** 成员头像只作身份，色相彼此至少隔 60°，不进入额度的颜色。 */
const MEMBER_HUES = [18, 152, 200, 332, 48, 168]

function memberHue(id: number) {
  return MEMBER_HUES[Math.abs(id) % MEMBER_HUES.length]
}

function memberInitial(name: string) {
  const text = name.trim()
  return text ? text.slice(0, 1).toUpperCase() : '?'
}

function countMarks(limit: number) {
  return limit > 0 && limit <= 16
}

function meterHot(used: number, limit: number) {
  return limit > 0 && used / limit >= 0.9
}

const seatsLeft = computed(() => {
  if (!team.value)
    return 0
  return Math.max(0, Number(team.value.seats) - Number(team.value.used_seats))
})

const myRoleLabel = computed(() => {
  if (!team.value)
    return ''
  if (team.value.role === 'owner')
    return t('所有者')
  return PERMISSION_LABELS.value[team.value.permission ?? 'editor']
})

const teamFinding = computed(() => {
  const current = team.value
  if (!current)
    return ''
  if (!current.active)
    return t('团队版会员已过期，成员暂不共享积分')
  const plan = current.plan_name ? ` · ${current.plan_name}` : ''
  const date = current.expires_at ? fmt(current.expires_at).slice(0, 10) : ''
  const head = date
    ? `${t('团队版')}${plan}，${t('有效期至')} ${date}`
    : `${t('团队版')}${plan}`
  const seat = seatsLeft.value === 0
    ? t('席位已满，新成员要等有人退出')
    : `${t('还可邀请')} ${seatsLeft.value} ${t('人')}`
  return `${head}。${seat}`
})

const usageSum = computed(() => {
  const rows = teamUsage.value?.members ?? []
  return rows.reduce((sum, row) => {
    sum.tasks_30d += Math.round(Number(row.tasks_30d) || 0)
    sum.points_30d += Math.round(Number(row.points_30d) || 0)
    sum.storage_bytes += Number(row.storage_bytes) || 0
    sum.active_tasks += Math.round(Number(row.active_tasks) || 0)
    return sum
  }, { tasks_30d: 0, points_30d: 0, storage_bytes: 0, active_tasks: 0 })
})

async function refreshTeamView() {
  await Promise.all([loadTeam(), loadTeamUsage()])
}

// 面板被 KeepAlive 留着：第一次挂载走 onMounted，再切回「团队」标签走 onActivated。
let skipActivate = false
onMounted(() => {
  skipActivate = true
  void refreshTeamView()
})
onActivated(() => {
  if (skipActivate) {
    skipActivate = false
    return
  }
  void refreshTeamView()
})

// 从套餐弹窗回来（开通 / 续费团队版）时，席位、有效期和积分池要重拉。
watch(pricingOpen, (open, wasOpen) => {
  if (!wasOpen || open)
    return
  void refreshTeamView()
})
</script>

<template>
  <div class="team-board">
  <div v-if="teamLoading && !team" class="team-board__loading" aria-busy="true">
    <div class="team-skel team-skel--title" />
    <div class="team-skel team-skel--line" />
    <div class="team-meter" aria-hidden="true">
      <div v-for="n in 4" :key="n" class="team-meter__cell">
        <div class="team-skel team-skel--label" />
        <div class="team-skel team-skel--value" />
      </div>
    </div>
  </div>
  <template v-else-if="team">
    <header class="team-board__head">
      <div class="team-board__title">
        <h1>
          <span class="team-board__name">{{ team.name }}</span>
          <span class="team-chip">{{ myRoleLabel }}</span>
          <span v-if="!team.active" class="team-chip team-chip--bad">{{ t('已过期') }}</span>
        </h1>
        <p>{{ teamFinding }}</p>
      </div>
    </header>

    <section class="team-meter" :aria-label="t('团队额度')">
      <div class="team-meter__cell team-meter__cell--lead">
        <span class="team-meter__label">{{ t('积分池') }}</span>
        <strong class="team-num team-num--lead">{{ Number(team.pool_balance || 0).toLocaleString() }}<small>{{ t('积分') }}</small></strong>
        <p>{{ t('生成任务从这里扣') }}</p>
      </div>
      <div class="team-meter__cell">
        <span class="team-meter__label">{{ t('席位') }}</span>
        <strong class="team-num">{{ team.used_seats }}<small>/ {{ team.seats }}</small></strong>
        <div v-if="countMarks(team.seats)" class="team-marks team-marks--seats" aria-hidden="true">
          <i v-for="n in team.seats" :key="n" :class="{ 'is-on': n <= team.used_seats, 'is-hot': seatsLeft === 0 }" />
        </div>
        <div v-else class="team-track" :class="{ 'is-hot': meterHot(team.used_seats, team.seats) }">
          <i :style="{ width: `${pct(team.used_seats, team.seats)}%` }" />
        </div>
      </div>
      <div class="team-meter__cell">
        <span class="team-meter__label">{{ t('并发生成') }}</span>
        <template v-if="teamUsage">
          <strong class="team-num">{{ teamUsage.concurrent.used }}<small>/ {{ teamUsage.concurrent.limit }} {{ t('路') }}</small></strong>
          <div v-if="countMarks(teamUsage.concurrent.limit)" class="team-marks" aria-hidden="true">
            <i
              v-for="n in teamUsage.concurrent.limit"
              :key="n"
              :class="{ 'is-on': n <= teamUsage.concurrent.used, 'is-hot': meterHot(teamUsage.concurrent.used, teamUsage.concurrent.limit) }"
            />
          </div>
          <div v-else class="team-track" :class="{ 'is-hot': meterHot(teamUsage.concurrent.used, teamUsage.concurrent.limit) }">
            <i :style="{ width: teamUsage.concurrent.limit ? `${pct(teamUsage.concurrent.used, teamUsage.concurrent.limit)}%` : '0%' }" />
          </div>
        </template>
        <strong v-else class="team-miss">—</strong>
      </div>
      <div class="team-meter__cell">
        <span class="team-meter__label">{{ t('云存储') }}</span>
        <template v-if="teamUsage">
          <strong class="team-num">{{ formatBytes(teamUsage.storage.used_bytes) }}<small>/ {{ formatBytes(teamUsage.storage.limit_bytes) }}</small></strong>
          <div
            class="team-track"
            role="meter"
            :aria-valuenow="teamUsage.storage.used_bytes"
            :aria-valuemin="0"
            :aria-valuemax="teamUsage.storage.limit_bytes"
            :aria-label="t('云存储')"
            :class="{ 'is-hot': meterHot(teamUsage.storage.used_bytes, teamUsage.storage.limit_bytes) }"
          >
            <i :style="{ width: `${pct(teamUsage.storage.used_bytes, teamUsage.storage.limit_bytes)}%` }" />
          </div>
        </template>
        <strong v-else class="team-miss">—</strong>
      </div>
    </section>

    <div v-if="canManageTeam || team.role === 'owner'" class="team-work">
      <section v-if="canManageTeam" class="team-panel">
        <h2>{{ t('邀请') }}</h2>
        <p class="team-panel__lead">{{ t('成员在「设置 · 团队」输入邀请码即可加入。') }}</p>
        <p v-if="team.invite_code" class="team-code">{{ team.invite_code }}</p>
        <p v-else class="team-miss">—</p>
        <p v-if="team.role === 'owner' && team.invite_expiry" class="team-panel__meta">{{ t('邀请码 {date} 前有效，成员在「设置 · 团队」输入即可加入', { date: fmt(team.invite_expiry).slice(0, 10) }) }}</p>
        <form v-if="team.role === 'owner'" class="team-field" @submit.prevent="renameTeam">
          <span>{{ t('团队名') }}</span>
          <div class="team-field__row">
            <input v-model="teamName" maxlength="50" class="settings-input" :aria-label="t('团队名')">
            <button type="submit" class="plan-btn plan-btn--ghost">{{ t('保存') }}</button>
          </div>
        </form>
        <div class="team-panel__actions">
          <button v-if="team.invite_code" type="button" class="plan-btn plan-btn--ghost" @click="copyInvite">{{ t('复制') }}</button>
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="inviteBusy" @click="regenerateInvite">{{ inviteBusy ? t('生成中…') : (team.invite_code ? t('重新生成') : t('生成邀请码')) }}</button>
        </div>
      </section>
      <TeamRecharge
        v-if="team.role === 'owner'"
        :team-id="team.id"
        @paid="onTeamRecharged"
      />
    </div>

    <section class="team-panel">
      <header class="team-panel__head">
        <h2>{{ t('近 30 天') }}</h2>
        <span>{{ t('按成员统计') }}</span>
      </header>
      <SettingsSkel v-if="teamUsageLoading && !teamUsage" variant="list" :rows="3" />
      <p v-else-if="!teamUsage" class="team-empty">{{ t('团队版会员生效后显示用量') }}</p>
      <p v-else-if="!teamUsage.members.length" class="team-empty">{{ t('这段时间还没有成员用量') }}</p>
      <div v-else class="team-usage">
        <table>
          <thead>
            <tr>
              <th>{{ t('成员') }}</th>
              <th class="team-num">{{ t('任务数') }}</th>
              <th class="team-num">{{ t('消耗积分') }}</th>
              <th class="team-num">{{ t('存储') }}</th>
              <th class="team-num">{{ t('进行中') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in teamUsage.members" :key="m.user_id">
              <td>
                {{ m.nickname || `#${m.user_id}` }}
                <span v-if="m.role === 'owner'" class="team-chip">{{ t('所有者') }}</span>
              </td>
              <td class="team-num" :data-label="t('任务数')">{{ formatCount(m.tasks_30d) }}</td>
              <td class="team-num team-usage__key">{{ formatCount(m.points_30d) }}</td>
              <td class="team-num" :data-label="t('存储')">{{ formatBytes(m.storage_bytes) }}</td>
              <td class="team-num" :data-label="t('进行中')">{{ formatCount(m.active_tasks) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>{{ t('合计') }}</td>
              <td class="team-num" :data-label="t('任务数')">{{ formatCount(usageSum.tasks_30d) }}</td>
              <td class="team-num team-usage__key">{{ formatCount(usageSum.points_30d) }}</td>
              <td class="team-num" :data-label="t('存储')">{{ formatBytes(usageSum.storage_bytes) }}</td>
              <td class="team-num" :data-label="t('进行中')">{{ formatCount(usageSum.active_tasks) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <section class="team-panel">
      <header class="team-panel__head">
        <h2>{{ t('成员') }}</h2>
        <span class="team-num">{{ team.members.length }}</span>
      </header>
      <p class="team-panel__lead">{{ t('给成员设每月积分上限，用完后成员当月无法再发起生成，每月 1 日自动重置') }}</p>
      <ul class="team-people">
        <li v-for="m in team.members" :key="m.user_id" class="team-person">
          <span class="team-avatar" :style="{ '--hue': memberHue(m.user_id) }" aria-hidden="true">{{ memberInitial(m.nickname || '') }}</span>
          <div class="team-person__id">
            <strong>{{ m.nickname || `#${m.user_id}` }}</strong>
            <span>{{ fmt(m.joined_at) }} {{ t('加入') }}</span>
          </div>
          <div class="team-person__tools">
            <div class="team-perm">
              <StudioSelect
                v-if="canManageMember(m)"
                size="compact"
                :model-value="memberPermission(m)"
                :options="memberPermOptions(m)"
                :disabled="permBusy === m.user_id"
                :sr-label="t('权限')"
                @update:model-value="changePermission(m, $event as TeamPermission)"
              />
              <strong v-else>{{ m.role === 'owner' ? t('所有者') : PERMISSION_LABELS[memberPermission(m)] }}</strong>
            </div>
            <button v-if="canManageMember(m)" type="button" class="team-textbtn is-danger" @click="kick(m.user_id, m.nickname || `#${m.user_id}`)">{{ t('移除') }}</button>
          </div>
          <p class="team-person__hint">{{ PERMISSION_HINTS[memberPermission(m)] }}</p>
          <div v-if="m.role !== 'owner'" class="team-limit">
            <div class="team-limit__head">
              <span>{{ t('本月额度') }}</span>
              <strong class="team-num">{{ memberLimitText(m) }}</strong>
              <button
                v-if="canManageMember(m)"
                type="button"
                class="team-textbtn"
                @click="limitEditing === m.user_id ? closeLimitEditor() : openLimitEditor(m)"
              >
                {{ limitEditing === m.user_id ? t('收起') : t('编辑') }}
              </button>
            </div>
            <div
              v-if="memberLimit(m)"
              class="team-track team-track--quiet"
              :class="{ 'is-hot': pct(Number(m.points_used ?? 0), memberLimit(m)) >= 100 }"
            >
              <i :style="{ width: `${pct(Number(m.points_used ?? 0), memberLimit(m))}%` }" />
            </div>
            <form v-if="canManageMember(m) && limitEditing === m.user_id" class="team-limit__form" @submit.prevent="saveMemberLimit(m)">
              <div class="team-choices">
                <button
                  v-for="p in LIMIT_PRESETS"
                  :key="p"
                  type="button"
                  class="team-choice"
                  :class="{ 'is-on': limitInput === p }"
                  @click="limitInput = p"
                >
                  {{ p === 0 ? t('不限') : p.toLocaleString() }}
                </button>
              </div>
              <div class="team-limit__row">
                <input
                  v-model.number="limitInput"
                  type="number"
                  min="0"
                  step="100"
                  class="settings-input settings-input--short"
                  :aria-label="t('本月额度')"
                  @wheel="holdNumberWheel"
                >
                <button type="submit" class="plan-btn plan-btn--ghost" :disabled="limitSaving">{{ limitSaving ? t('保存中…') : t('保存') }}</button>
                <button type="button" class="plan-btn plan-btn--ghost" @click="closeLimitEditor">{{ t('取消') }}</button>
              </div>
              <p class="team-panel__meta">{{ t('填 0 表示不限') }}</p>
            </form>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="team.role === 'member'" class="team-panel team-panel--quit">
      <h2>{{ t('退出团队') }}</h2>
      <p class="team-panel__lead">{{ t('退出后将不再共享团队积分，确定退出？') }}</p>
      <div class="team-panel__actions">
        <button type="button" class="team-textbtn is-danger" :disabled="teamBusy" @click="quitTeam">{{ t('退出团队') }}</button>
      </div>
    </section>
  </template>
  <template v-else>
    <header class="team-board__head">
      <div class="team-board__title">
        <h1>{{ t('还没有团队') }}</h1>
        <p>{{ t('加入已有团队，或开通团队版新建一个。') }}</p>
      </div>
    </header>
    <div class="team-work">
      <section class="team-panel">
        <h2>{{ t('加入团队') }}</h2>
        <p class="team-panel__lead">{{ t('输入团队所有者给你的邀请码。加入后，生成从团队积分池扣，并按会员价计费。') }}</p>
        <label class="team-field">
          <span>{{ t('邀请码') }}</span>
          <input v-model="joinCode" maxlength="16" class="settings-input" :placeholder="t('例如 7K3QX9AB')" @keydown.enter="joinTeam">
        </label>
        <div class="team-panel__actions">
          <button type="button" class="plan-btn plan-btn--solid" :disabled="teamBusy" @click="joinTeam">{{ teamBusy ? t('加入中…') : t('加入') }}</button>
        </div>
      </section>
      <section class="team-panel">
        <h2>{{ t('创建团队') }}</h2>
        <p class="team-panel__lead">{{ t('开通团队版会员就会有自己的团队。') }}</p>
        <ul class="team-points">
          <li>{{ t('席位数即会员席位') }}</li>
          <li>{{ t('成员共享一个积分池') }}</li>
          <li>{{ t('生成按会员价计费') }}</li>
        </ul>
        <div class="team-panel__actions">
          <button type="button" class="plan-btn plan-btn--ghost" @click="gotoPricing('membership')">{{ t('开通团队版会员') }}</button>
        </div>
      </section>
    </div>
  </template>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/team.css';
</style>
