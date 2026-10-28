<script setup lang="ts">
import { getUserId } from '~/utils/auth-user'
import { WELCOME_GIFT_SESSION_KEY, welcomeGiftShownKey } from '~/utils/welcome-gift'

const { t } = useI18n()

/**
 * 「新人红包」浮层：注册成功后 LoginRegister 写 sessionStorage 标记，首页首次进入弹一次；
 * 再用 localStorage 按用户 id 记录已展示，保证不会出现第二次。
 */
const { isLoggedIn } = useAuth()
const { growth, load: loadConfig } = useStudioAppConfig()

const open = ref(false)
const points = computed(() => growth.value?.signup_points || 0)
const validDays = computed(() => growth.value?.signup_valid_days || 0)

function tryOpen() {
  if (!import.meta.client || !isLoggedIn.value)
    return
  let flagged = false
  try {
    flagged = sessionStorage.getItem(WELCOME_GIFT_SESSION_KEY) === '1'
    if (flagged)
      sessionStorage.removeItem(WELCOME_GIFT_SESSION_KEY)
  }
  catch {
    flagged = false
  }
  if (!flagged)
    return
  const key = welcomeGiftShownKey(getUserId())
  try {
    if (localStorage.getItem(key) === '1')
      return
    localStorage.setItem(key, '1')
  }
  catch {
    // 存储不可用时仍弹一次
  }
  void loadConfig()
  open.value = true
}

function close() {
  open.value = false
}

function goTasks() {
  close()
  nextTick(() => {
    document.getElementById('tasks')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

onMounted(tryOpen)
watch(isLoggedIn, (on) => {
  if (on)
    tryOpen()
})
</script>

<template>
  <ClientOnly>
    <Transition name="welcome-gift">
      <aside v-if="open" class="welcome-gift" role="dialog" :aria-label="t('新人红包')">
        <button type="button" class="welcome-gift__close" :aria-label="t('关闭')" @click="close">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <div class="welcome-gift__glow" aria-hidden="true" />
        <div class="welcome-gift__icon" aria-hidden="true">
          <UIcon name="i-lucide-gift" class="size-6" />
        </div>
        <h3>{{ t('新人红包') }}</h3>
        <p class="welcome-gift__amount">
          <strong>{{ points.toLocaleString() }}</strong>
          <span>{{ t('积分') }}</span>
        </p>
        <p class="welcome-gift__sub">
          {{ t('已发放到你的积分钱包') }}<template v-if="validDays">，{{ t('{n} 天内有效', { n: validDays }) }}</template>
        </p>
        <div class="welcome-gift__actions">
          <button type="button" class="welcome-gift__btn" @click="goTasks">{{ t('去完成新手任务') }}</button>
          <button type="button" class="welcome-gift__ghost" @click="close">{{ t('稍后再说') }}</button>
        </div>
      </aside>
    </Transition>
  </ClientOnly>
</template>
