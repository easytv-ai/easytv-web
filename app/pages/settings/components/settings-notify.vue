<script setup lang="ts">
/**
 * 设置 · 通知偏好
 *
 * - GET /user/notification/prefs：通知类型开关 + 邮件开关
 * - PUT /user/notification/prefs：保存
 * 接口返回的 label / desc 会改措辞，这里按 type 固定文案，避免英文界面漏翻。
 */
import notificationApi from '~/api/notification'
import type { NotificationPrefs } from '~/types/creative'

const props = defineProps<{
  /** 当前账号（用于展示邮箱） */
  username: string
}>()

const { t } = useI18n()
const toast = useToast()

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const prefs = ref<NotificationPrefs | null>(null)
const prefsLoading = ref(false)
const prefsSaving = ref(false)

async function loadPrefs() {
  prefsLoading.value = true
  try {
    const res = await notificationApi.prefs()
    if (!res?.success || !res.data) {
      notify(res?.message || t('通知偏好加载失败'), 'error')
      return
    }
    prefs.value = res.data
  }
  finally {
    prefsLoading.value = false
  }
}

async function savePrefs(next: { disabled_types: string[], email_enabled: boolean }) {
  if (prefsSaving.value)
    return
  prefsSaving.value = true
  try {
    const res = await notificationApi.updatePrefs(next)
    if (!res?.success || !res.data) {
      notify(res?.message || t('保存失败'), 'error')
      await loadPrefs()
      return
    }
    prefs.value = res.data
    notify(t('通知偏好已保存'), 'success')
  }
  finally {
    prefsSaving.value = false
  }
}

function togglePrefType(type: string, enabled: boolean) {
  if (!prefs.value)
    return
  const disabled = prefs.value.types.filter(item => !item.enabled && !item.globally_off).map(item => item.type)
  const next = enabled ? disabled.filter(item => item !== type) : Array.from(new Set([...disabled, type]))
  void savePrefs({ disabled_types: next, email_enabled: prefs.value.email_enabled })
}

function toggleEmail(enabled: boolean) {
  if (!prefs.value)
    return
  const disabled = prefs.value.types.filter(item => !item.enabled && !item.globally_off).map(item => item.type)
  void savePrefs({ disabled_types: disabled, email_enabled: enabled })
}

/** 接口 label/desc 会改措辞；按 type 固定文案，避免英文界面漏翻 */
const PREF_LABEL: Record<string, string> = {
  work: '作品审核',
  comment: '评论',
  like: '喜欢',
  task: '生成任务',
  system: '系统消息',
}
const PREF_DESC: Record<string, string> = {
  work: '作品被驳回、下架或举报成立时通知',
  comment: '有人评论你的作品、回复你，或你的评论被隐藏时通知',
  like: '作品收到新的喜欢时通知，每部作品每天最多一条',
  task: '任务超时终止、积分退回时通知',
  system: '运营手动发送的站内消息',
}

function prefLabel(item: { type: string, label: string }) {
  return t(PREF_LABEL[item.type] || item.label)
}

function prefDesc(item: { type: string, desc: string }) {
  return t(PREF_DESC[item.type] || item.desc)
}

onMounted(() => {
  void loadPrefs()
})
</script>

<template>
  <section class="wallet-card settings-card">
    <h3>{{ t('站内通知') }} <small>{{ t('关闭后对应类型不再写入消息中心，已收到的消息保留') }}</small></h3>
    <p v-if="prefsLoading && !prefs" class="wallet-card__empty">{{ t('加载中…') }}</p>
    <ul v-else-if="prefs" class="pref-list">
      <li v-for="item in prefs.types" :key="item.type">
        <div class="pref-list__main">
          <strong>{{ prefLabel(item) }}</strong>
          <span>{{ prefDesc(item) }}</span>
          <em v-if="item.globally_off">{{ t('运营已停用该类型通知') }}</em>
        </div>
        <label class="pref-switch" :class="{ 'is-off': item.globally_off }">
          <input
            type="checkbox"
            :checked="item.enabled"
            :disabled="prefsSaving || item.globally_off"
            @change="togglePrefType(item.type, ($event.target as HTMLInputElement).checked)"
          >
          <i />
        </label>
      </li>
    </ul>
  </section>
  <section v-if="prefs" class="wallet-card settings-card">
    <h3>{{ t('邮件通知') }} <small>{{ t('开启后，作品审核、下架或举报成立会同步发到你的注册邮箱') }}</small></h3>
    <ul class="pref-list">
      <li>
        <div class="pref-list__main">
          <strong>{{ t('重要通知同步发邮件') }}</strong>
          <span>{{ username || t('未设置邮箱') }}</span>
        </div>
        <label class="pref-switch">
          <input type="checkbox" :checked="prefs.email_enabled" :disabled="prefsSaving" @change="toggleEmail(($event.target as HTMLInputElement).checked)">
          <i />
        </label>
      </li>
    </ul>
  </section>
</template>
