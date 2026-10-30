<script setup lang="ts">
/**
 * 设置 · 团队
 *
 * - 已加入：团队信息 / 邀请码 / TeamRecharge / 团队用量 / 成员管理（权限 / 移除 / 月度额度）
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
const { gotoPricing } = usePricingModal()

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

async function copyInvite() {
  if (!team.value?.invite_code)
    return
  try {
    await navigator.clipboard.writeText(team.value.invite_code)
    notify(t('邀请码已复制'), 'success')
  }
  catch {
    notify(team.value.invite_code)
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

onMounted(() => {
  void loadTeam()
  void loadTeamUsage()
})
</script>

<template>
  <section v-if="teamLoading && !team" class="wallet-card">
    <p class="settings-lead">{{ t('加载中…') }}</p>
  </section>
  <template v-else-if="team">
    <section class="wallet-card">
      <h3>
        {{ team.name }}
        <small>{{ team.role === 'owner' ? t('所有者') : PERMISSION_LABELS[team.permission ?? 'editor'] }}</small>
      </h3>
      <ul class="wallet-card__meta">
        <li>{{ t('席位') }} {{ team.used_seats }} / {{ team.seats }}</li>
        <li v-if="team.active">{{ t('团队版') }}{{ team.plan_name ? ` · ${team.plan_name}` : '' }}，{{ t('有效期至') }} {{ fmt(team.expires_at).slice(0, 10) }}</li>
        <li v-else class="is-warn">{{ t('团队版会员已过期，成员暂不共享积分') }}</li>
        <li>{{ t('团队积分池') }} {{ team.pool_balance.toLocaleString() }} {{ t('积分') }}{{ team.role === 'member' ? t('（你的生成从这里扣）') : '' }}</li>
      </ul>
      <div v-if="team.role === 'owner'" class="settings-row settings-row--top">
        <span class="settings-row__label">{{ t('团队名') }}</span>
        <div class="settings-row__field">
          <input v-model="teamName" maxlength="50" class="settings-input">
          <button type="button" class="plan-btn plan-btn--ghost" @click="renameTeam">{{ t('保存') }}</button>
        </div>
      </div>
      <div v-if="canManageTeam" class="settings-row">
        <span class="settings-row__label">{{ t('邀请码') }}</span>
        <div class="settings-row__field">
          <code class="settings-code">{{ team.invite_code || '—' }}</code>
          <button v-if="team.invite_code" type="button" class="plan-btn plan-btn--ghost" @click="copyInvite">{{ t('复制') }}</button>
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="inviteBusy" @click="regenerateInvite">{{ inviteBusy ? t('生成中…') : (team.invite_code ? t('重新生成') : t('生成邀请码')) }}</button>
        </div>
      </div>
      <p v-if="team.role === 'owner' && team.invite_expiry" class="settings-hint">{{ t('邀请码 {date} 前有效，成员在「设置 · 团队」输入即可加入', { date: fmt(team.invite_expiry).slice(0, 10) }) }}。</p>
    </section>
    <TeamRecharge
      v-if="team.role === 'owner'"
      :team-id="team.id"
      @paid="onTeamRecharged"
    />

    <section class="wallet-card">
      <h3>
        {{ t('团队用量') }}
        <small>{{ t('近 30 天，按成员统计') }}</small>
      </h3>
      <p v-if="teamUsageLoading && !teamUsage" class="wallet-card__empty">{{ t('加载中…') }}</p>
      <p v-else-if="!teamUsage" class="wallet-card__empty">{{ t('团队版会员生效后显示用量') }}</p>
      <template v-else>
        <div class="quota">
          <div class="quota__row">
            <div class="quota__head">
              <span>{{ t('并发生成') }}</span>
              <strong>{{ teamUsage.concurrent.used }} / {{ teamUsage.concurrent.limit }} {{ t('路') }}</strong>
            </div>
            <div class="quota__bar" :class="{ 'is-full': teamUsage.concurrent.used >= teamUsage.concurrent.limit }"><i :style="{ width: `${pct(teamUsage.concurrent.used, teamUsage.concurrent.limit)}%` }" /></div>
          </div>
          <div class="quota__row">
            <div class="quota__head">
              <span>{{ t('云存储') }}</span>
              <strong>{{ formatBytes(teamUsage.storage.used_bytes) }} / {{ formatBytes(teamUsage.storage.limit_bytes) }}</strong>
            </div>
            <div class="quota__bar" :class="{ 'is-full': pct(teamUsage.storage.used_bytes, teamUsage.storage.limit_bytes) >= 90 }"><i :style="{ width: `${pct(teamUsage.storage.used_bytes, teamUsage.storage.limit_bytes)}%` }" /></div>
          </div>
        </div>
        <div class="usage-table-wrap">
          <table class="usage-table">
            <thead>
              <tr>
                <th>{{ t('成员') }}</th>
                <th>{{ t('任务数') }}</th>
                <th>{{ t('消耗积分') }}</th>
                <th>{{ t('存储') }}</th>
                <th>{{ t('进行中') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in teamUsage.members" :key="m.user_id">
                <td>{{ m.nickname || `#${m.user_id}` }}<em v-if="m.role === 'owner'">{{ t('所有者') }}</em></td>
                <td>{{ m.tasks_30d }}</td>
                <td>{{ m.points_30d.toLocaleString() }}</td>
                <td>{{ formatBytes(m.storage_bytes) }}</td>
                <td>{{ m.active_tasks }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>{{ t('合计') }}</td>
                <td>{{ teamUsage.totals.tasks_30d }}</td>
                <td>{{ teamUsage.totals.points_30d.toLocaleString() }}</td>
                <td>{{ formatBytes(teamUsage.totals.storage_bytes) }}</td>
                <td>{{ teamUsage.totals.active_tasks }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </template>
    </section>
    <section class="wallet-card">
      <h3>{{ t('成员') }} <small>{{ team.members.length }}</small></h3>
      <p class="settings-hint">{{ t('给成员设每月积分上限，用完后成员当月无法再发起生成，每月 1 日自动重置') }}</p>
      <ul class="wallet-list">
        <li v-for="m in team.members" :key="m.user_id">
          <span class="wallet-list__label">{{ m.nickname || `#${m.user_id}` }}<em v-if="m.role === 'owner'" class="settings-owner">{{ t('所有者') }}</em></span>
          <span class="wallet-list__num">
            <button v-if="canManageMember(m)" type="button" class="settings-link is-danger" @click="kick(m.user_id, m.nickname)">{{ t('移除') }}</button>
          </span>
          <span class="wallet-list__sub">{{ fmt(m.joined_at) }} {{ t('加入') }}</span>
          <div class="team-perm">
            <span>{{ t('权限') }}</span>
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
            <small>{{ PERMISSION_HINTS[memberPermission(m)] }}</small>
          </div>
          <!-- 额度只约束成员，所有者付款不受限 -->
          <div v-if="m.role !== 'owner'" class="team-limit">
            <div class="team-limit__head">
              <span>{{ t('本月额度') }}</span>
              <strong>{{ memberLimitText(m) }}</strong>
              <button
                v-if="canManageMember(m)"
                type="button"
                class="settings-link"
                @click="limitEditing === m.user_id ? closeLimitEditor() : openLimitEditor(m)"
              >
                {{ limitEditing === m.user_id ? t('收起') : t('编辑') }}
              </button>
            </div>
            <div
              v-if="memberLimit(m)"
              class="quota__bar team-limit__bar"
              :class="{ 'is-full': pct(Number(m.points_used ?? 0), memberLimit(m)) >= 100 }"
            >
              <i :style="{ width: `${pct(Number(m.points_used ?? 0), memberLimit(m))}%` }" />
            </div>
            <form v-if="canManageMember(m) && limitEditing === m.user_id" class="team-limit__form" @submit.prevent="saveMemberLimit(m)">
              <div class="team-limit__presets">
                <button
                  v-for="p in LIMIT_PRESETS"
                  :key="p"
                  type="button"
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
                >
                <button type="submit" class="plan-btn plan-btn--solid" :disabled="limitSaving">{{ limitSaving ? t('保存中…') : t('保存') }}</button>
                <button type="button" class="plan-btn plan-btn--ghost" @click="closeLimitEditor">{{ t('取消') }}</button>
              </div>
              <p class="settings-hint">{{ t('填 0 表示不限') }}</p>
            </form>
          </div>
        </li>
      </ul>
      <div v-if="team.role === 'member'" class="settings-secure">
        <button type="button" class="plan-btn plan-btn--ghost is-danger" :disabled="teamBusy" @click="quitTeam">{{ t('退出团队') }}</button>
      </div>
    </section>
  </template>
  <template v-else>
    <section class="wallet-card">
      <h3>{{ t('加入团队') }}</h3>
      <p class="settings-lead">{{ t('输入团队所有者给你的邀请码，加入后生成任务从团队积分池扣，并按会员价计费。') }}</p>
      <div class="settings-row settings-row--top">
        <span class="settings-row__label">{{ t('邀请码') }}</span>
        <div class="settings-row__field">
          <input v-model="joinCode" maxlength="16" class="settings-input settings-input--code" :placeholder="t('例如 7K3QX9AB')" @keydown.enter="joinTeam">
          <button type="button" class="plan-btn plan-btn--solid" :disabled="teamBusy" @click="joinTeam">{{ t('加入') }}</button>
        </div>
      </div>
    </section>
    <section class="wallet-card">
      <h3>{{ t('创建团队') }}</h3>
      <p class="settings-lead">{{ t('开通团队版会员即自动创建团队，席位数即会员席位，成员共享积分池。') }}</p>
      <div class="settings-secure">
        <button type="button" class="plan-btn plan-btn--solid" @click="gotoPricing('membership')">{{ t('开通团队版会员') }}</button>
      </div>
    </section>
  </template>
</template>
