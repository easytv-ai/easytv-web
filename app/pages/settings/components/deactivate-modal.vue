<script setup lang="ts">
/**
 * 注销账号确认弹窗。
 * 注销后作品全部下架、画布分享失效、退出所在团队，剩余积分与会员权益作废且不退款。
 * 邮箱和手机号会释放，可以重新注册。
 */
import accountApi from '~/api/account'

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { logout } = useAuth()
const { setUser } = useAuth()

const open = defineModel<boolean>('open', { default: false })

const password = ref('')
const agree = ref(false)
const submitting = ref(false)
const error = ref('')

/** 打开时重置表单，避免上次的密码 / 勾选残留 */
watch(open, (v) => {
  if (!v)
    return
  password.value = ''
  agree.value = false
  error.value = ''
})

async function submit() {
  if (submitting.value || !agree.value)
    return
  submitting.value = true
  error.value = ''
  try {
    const res = await accountApi.deactivate(password.value)
    if (!res?.success) {
      error.value = res?.message || t('注销失败，请稍后重试')
      return
    }
    open.value = false
    toast.add({ title: t('账号已注销'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    await logout().catch(() => null)
    setUser(null)
    await navigateTo(localePath('/'))
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="!submitting && (open = false)">
      <div class="studio-modal publish-modal deactivate-modal" role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="deactivate-title">{{ t('确认注销账号') }}</h2>
            <p>{{ t('这个操作无法撤销，请仔细阅读下面的说明') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="open = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="publish-modal__form deactivate-modal__form">
          <ul class="deactivate-modal__list">
            <li>{{ t('已发布的作品全部下架，评论与点赞记录保留但不再关联到你') }}</li>
            <li>{{ t('画布、资产进入不可访问状态，分享链接立即失效') }}</li>
            <li>{{ t('剩余积分、会员剩余时长作废，不支持退款') }}</li>
            <li>{{ t('团队所有者需先移除其他成员；团队成员会自动退出团队') }}</li>
          </ul>
          <label class="publish-field">
            <span>{{ t('登录密码') }}</span>
            <input v-model="password" type="password" autocomplete="current-password" :placeholder="t('第三方登录且未设置密码的账号可留空')">
          </label>
          <label class="publish-check">
            <input v-model="agree" type="checkbox">
            <span>{{ t('我已了解以上后果，确认注销') }}</span>
          </label>
          <p v-if="error" class="publish-error">{{ error }}</p>
        </div>
        <footer class="plan-confirm__actions publish-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="submitting" @click="open = false">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid is-danger" :disabled="submitting || !agree" @click="submit">
            {{ submitting ? t('注销中…') : t('确认注销') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
