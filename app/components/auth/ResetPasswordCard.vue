<script setup lang="ts">
import userAuth from '~/api/user-auth'
import { useAuthCountdown } from '~/composables/useAuth'
import { useToast } from '#imports'

const { t } = useI18n()

const RESET_CONFIRM_COOLDOWN_SEC = 30

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { secondsLeft, isActive, clear: clearCountdown } = useAuthCountdown(RESET_CONFIRM_COOLDOWN_SEC)

const loading = ref(false)
const newPassword = ref('')
const copied = ref(false)

const email = computed(() => {
  const raw = route.query.email
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').trim()
})

const token = computed(() => {
  const raw = route.query.token
  return String(Array.isArray(raw) ? raw[0] : raw ?? '').trim()
})

const isValidLink = computed(() => Boolean(email.value && token.value))

const confirmLabel = computed(() => {
  if (newPassword.value)
    return t('auth.resetPasswordCard.confirmGoLogin')
  if (loading.value)
    return t('auth.resetPasswordCard.confirmResetting')
  if (isActive.value)
    return t('auth.resetPasswordCard.confirmRetryAfter', { seconds: secondsLeft.value })
  return t('auth.resetPasswordCard.confirmReset')
})

async function copyPassword() {
  if (!newPassword.value)
    return
  try {
    await navigator.clipboard.writeText(newPassword.value)
    copied.value = true
    toast.add({ title: t('auth.resetPasswordCard.toastCopied'), color: 'success' })
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }
  catch {
    toast.add({ title: t('auth.resetPasswordCard.toastCopyFailed'), color: 'warning' })
  }
}

async function onConfirm() {
  if (newPassword.value) {
    await navigateTo(localePath('/login'))
    return
  }
  if (!isValidLink.value || loading.value || isActive.value)
    return

  loading.value = true
  clearCountdown()
  try {
    const res = await userAuth.reset({
      email: email.value,
      token: token.value,
    }) as any
    if (res?.success === false) {
      toast.add({
        title: res?.message || t('auth.resetPasswordCard.toastFailedExpired'),
        color: 'error',
      })
      return
    }
    const password = String(res?.data ?? '').trim()
    if (!password) {
      toast.add({ title: t('auth.resetPasswordCard.toastFailedEmpty'), color: 'error' })
      return
    }
    newPassword.value = password
    try {
      await navigator.clipboard.writeText(password)
      toast.add({
        title: t('auth.resetPasswordCard.toastSuccessCopiedTitle'),
        description: t('auth.resetPasswordCard.toastSuccessCopiedDesc'),
        color: 'success',
      })
    }
    catch {
      toast.add({
        title: t('auth.resetPasswordCard.toastSuccessTitle'),
        description: t('auth.resetPasswordCard.toastSuccessDesc'),
        color: 'success',
      })
    }
  }
  catch {
    toast.add({ title: t('auth.resetPasswordCard.toastFailedRetry'), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

function gotoLogin() {
  navigateTo(localePath('/login'))
}

function gotoForgotPassword() {
  navigateTo(localePath('/forgot-password'))
}
</script>

<template>
  <AuthCardShell>
    <div class="flex min-h-full flex-col">
    <div class="mb-6">
      <h2 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
        {{ t('auth.resetPasswordCard.title') }}
      </h2>
      <p class="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        {{ newPassword ? t('auth.resetPasswordCard.leadDone') : t('auth.resetPasswordCard.leadPending') }}
      </p>
    </div>

    <div class="space-y-4">
      <UAlert
        v-if="!isValidLink"
        color="error"
        variant="soft"
        :title="t('auth.resetPasswordCard.invalidLinkTitle')"
        :description="t('auth.resetPasswordCard.invalidLinkDesc')"
        class="text-sm"
      />

      <UFormField :label="t('auth.resetPasswordCard.emailLabel')">
        <UInput
          :model-value="email"
          type="email"
          disabled
          leading-icon="i-lucide-mail"
          size="lg"
          class="w-full"
          :placeholder="t('auth.resetPasswordCard.emailWaitingPh')"
        />
      </UFormField>

      <UFormField v-if="newPassword" :label="t('auth.resetPasswordCard.newPasswordLabel')">
        <div class="flex gap-2">
          <UInput
            :model-value="newPassword"
            disabled
            leading-icon="i-lucide-lock"
            size="lg"
            class="w-full font-mono"
          />
          <UButton
            type="button"
            variant="outline"
            color="neutral"
            size="lg"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :aria-label="t('auth.resetPasswordCard.copyPasswordAria')"
            @click="copyPassword"
          />
        </div>
        <p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {{ t('auth.resetPasswordCard.changePasswordHint') }}
        </p>
      </UFormField>

      <UButton
        type="button"
        block
        size="lg"
        class="justify-center"
        :loading="loading"
        :disabled="!newPassword && (!isValidLink || isActive)"
        @click="onConfirm"
      >
        {{ confirmLabel }}
      </UButton>

      <p v-if="!newPassword" class="mt-auto pt-6 text-center text-sm text-gray-600 dark:text-gray-400">
        <UButton type="button" variant="link" class="h-auto p-0" @click="gotoLogin">
          {{ t('auth.resetPasswordCard.backToLogin') }}
        </UButton>
        <span class="mx-2 text-gray-300 dark:text-gray-600">·</span>
        <UButton type="button" variant="link" class="h-auto p-0" @click="gotoForgotPassword">
          {{ t('auth.resetPasswordCard.resendEmail') }}
        </UButton>
      </p>
    </div>
    </div>
  </AuthCardShell>
</template>
