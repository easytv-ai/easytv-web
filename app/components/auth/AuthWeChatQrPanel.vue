<script setup lang="ts">
import { useWeChatOpenLogin } from '~/composables/useWeChatOpenLogin'

const { t } = useI18n()

const emit = defineEmits<{
  close: []
}>()

const props = withDefaults(defineProps<{
  /** 面板用途：login=扫码登录，bind=扫码绑定 */
  mode?: 'login' | 'bind'
  /** 登录页内嵌：无关闭按钮，进页即展示二维码 */
  embedded?: boolean
}>(), {
  mode: 'login',
  embedded: false,
})

const {
  qrLoading,
  qrError,
  qrErrorCode,
  mountQrCode,
  clearQrCode,
  wechatOAuthResolving,
  wechatOAuthErrorMessage,
} = useWeChatOpenLogin()

const containerId = 'easyapi-wechat-login-qr'

const titleKey = computed(() => props.mode === 'bind' ? 'auth.wechat.scanTitleBind' : 'auth.wechat.scanTitle')
const hintKey = computed(() => props.mode === 'bind' ? 'auth.wechat.scanConfirmHintBind' : 'auth.wechat.scanConfirmHint')

/** 扫码确认后回调当前页，由本页轮询登录结果 */
function resolveRedirectUrl(): string {
  if (!import.meta.client)
    return ''
  return window.location.href
}

async function initQr() {
  await nextTick()
  await mountQrCode(containerId, resolveRedirectUrl())
}

onMounted(() => {
  void initQr()
})

onUnmounted(() => {
  clearQrCode()
})

function onClose() {
  clearQrCode()
  emit('close')
}

const errorMessage = computed(() => {
  switch (qrError.value) {
    case 'expired':
      return t('auth.wechat.expired')
    case 'notConfigured':
      return t('auth.wechat.notConfigured')
    case 'stateFailed':
      return t('auth.wechat.stateFailed')
    case 'loadFailed':
      return t('auth.wechat.loadFailed')
    case 'oauth':
      return wechatOAuthErrorMessage(qrErrorCode.value, t)
    default:
      return ''
  }
})

/** 手机确认后等待结果：覆盖空白 QR / 短暂 expired 误报，避免闪一下错误页 */
const showConfirming = computed(() => wechatOAuthResolving.value && !qrLoading.value)
</script>

<template>
  <div class="ea-wechat-qr-panel overflow-hidden rounded-xl" :class="{ 'is-embedded': embedded, 'mb-4': !embedded }">
    <div v-if="!embedded" class="ea-wechat-qr-panel__head flex items-center justify-between px-4 py-3">
      <div class="flex items-center gap-2">
        <span class="ea-wechat-qr-panel__badge flex size-7 items-center justify-center rounded-md">
          <img
            src="/images/pay/wechatpay.svg"
            alt=""
            class="size-4"
            width="16"
            height="16"
            aria-hidden="true"
          >
        </span>
        <span class="ea-wechat-qr-panel__title text-sm font-medium">
          {{ t(titleKey) }}
        </span>
      </div>
      <button
        type="button"
        class="ea-wechat-qr-panel__close"
        :aria-label="t('auth.wechat.close')"
        @click="onClose"
      >
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
    </div>

    <div class="flex flex-col items-center" :class="embedded ? 'px-0 py-0' : 'px-4 py-5'">
        <h3 v-if="embedded" class="xyq-login__label">{{ t(titleKey) }}</h3>
      <div
        class="ea-wechat-qr-box relative mx-auto flex items-center justify-center overflow-hidden rounded-lg"
        :class="[embedded ? 'is-embed-box' : 'h-[280px] w-[280px]', { 'is-expired': qrError === 'expired' }]"
      >
        <div
          v-if="qrLoading"
          class="ea-wechat-qr-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-2"
        >
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-[#07c160]" />
          <p class="ea-wechat-qr-overlay__text text-xs">
            {{ t('auth.wechat.loading') }}
          </p>
        </div>

        <div
          v-else-if="showConfirming"
          class="ea-wechat-qr-overlay absolute inset-0 z-20 flex flex-col items-center justify-center gap-2"
        >
          <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-[#07c160]" />
          <p class="ea-wechat-qr-overlay__text max-w-[200px] text-center text-xs">
            {{ t('auth.wechat.loading') }}
          </p>
        </div>

        <div
          v-else-if="qrError && qrError !== 'expired'"
          class="ea-wechat-qr-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-4 text-center"
        >
          <div class="ea-wechat-qr-overlay__icon flex size-16 items-center justify-center rounded-2xl">
            <UIcon name="i-lucide-qr-code" class="size-8" />
          </div>
          <p class="ea-wechat-qr-overlay__text max-w-[220px] text-xs leading-relaxed">
            {{ errorMessage }}
          </p>
          <button
            type="button"
            class="ea-wechat-qr-retry"
            @click="initQr"
          >
            {{ t('auth.wechat.retry') }}
          </button>
        </div>

        <button
          v-else-if="qrError === 'expired'"
          type="button"
          class="ea-wechat-qr-refresh"
          :aria-label="t('auth.wechat.retry')"
          @click="initQr"
        >
          <span>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.2-5.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
              <path
                d="M20 4.5v5h-5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
        </button>

        <div
          v-show="(!qrError || qrError === 'expired') && !showConfirming"
          :id="containerId"
          class="ea-wechat-qr-host flex size-full items-center justify-center"
        />
      </div>

      <p
        class="ea-wechat-qr-panel__hint flex w-full items-center justify-center gap-1.5 text-center"
        :class="embedded ? 'is-embed' : 'mt-4 text-xs'"
      >
        <img
          v-if="!embedded"
          src="/images/pay/wechatpay.svg"
          alt=""
          class="size-4 shrink-0"
          width="16"
          height="16"
          aria-hidden="true"
        >
        {{ embedded ? t('打开微信扫一扫') : t(hintKey) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.ea-wechat-qr-panel {
  border: 1px solid var(--st-border);
  background: var(--st-elevated);
  color: var(--st-text);
}

.ea-wechat-qr-panel__head {
  border-bottom: 1px solid var(--st-border);
}

.ea-wechat-qr-panel__badge {
  background: rgba(7, 193, 96, 0.12);
}

.ea-wechat-qr-panel__title {
  color: var(--st-text);
}

.ea-wechat-qr-panel__close {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--st-muted);
  cursor: pointer;
}

.ea-wechat-qr-panel__close:hover {
  background: var(--st-hover);
  color: var(--st-text);
}

.ea-wechat-qr-panel__hint {
  color: var(--st-muted);
}

.ea-wechat-qr-box,
.ea-wechat-qr-overlay,
.ea-wechat-qr-host {
  background: var(--st-bg);
}

.ea-wechat-qr-box {
  border: 1px solid var(--st-border);
}

.ea-wechat-qr-overlay__text {
  color: var(--st-muted);
}

.ea-wechat-qr-overlay__icon {
  border: 2px dashed var(--st-border);
  background: var(--st-card);
  color: var(--st-muted);
}

.ea-wechat-qr-retry {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--st-border);
  border-radius: 8px;
  background: var(--st-elevated);
  color: var(--st-text);
  font-size: 13px;
  cursor: pointer;
}

.ea-wechat-qr-retry:hover {
  background: var(--st-hover);
}

.ea-wechat-qr-box.is-expired .ea-wechat-qr-host {
  filter: blur(6px) saturate(0.7);
  pointer-events: none;
}

.ea-wechat-qr-refresh {
  position: absolute;
  inset: 0;
  z-index: 12;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
}

.ea-wechat-qr-refresh span {
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(24, 24, 27, 0.08);
  border-radius: 999px;
  background: #fff;
  color: #18181b;
  box-shadow: 0 2px 10px rgba(24, 24, 27, 0.12);
}

.ea-wechat-qr-refresh:hover span {
  background: #f4f4f5;
}

.ea-wechat-qr-panel.is-embedded {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: center;
  border: 0;
  background: transparent;
}

.ea-wechat-qr-panel.is-embedded .ea-wechat-qr-box,
.ea-wechat-qr-panel.is-embedded .ea-wechat-qr-overlay,
.ea-wechat-qr-panel.is-embedded .ea-wechat-qr-host {
  background: #fff;
}

.ea-wechat-qr-panel.is-embedded .ea-wechat-qr-box {
  flex-shrink: 0;
  width: 188px;
  height: auto;
  margin: 0 auto;
  padding: 12px 0;
  overflow: hidden;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  box-sizing: border-box;
}


.ea-wechat-qr-panel.is-embedded .ea-wechat-qr-host {
  display: flex;
  width: 160px !important;
  height: 160px !important;
  flex: none;
  align-items: center;
  justify-content: center;
}

.ea-wechat-qr-panel.is-embedded .xyq-login__label {
  margin-bottom: 16px;
}

.ea-wechat-qr-panel__hint.is-embed {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.4;
}

.ea-wechat-qr-host :deep(iframe) {
  width: 280px !important;
  height: 186px !important;
  border: none;
  display: block;
  margin: 0 auto;
}

.ea-wechat-qr-panel.is-embedded .ea-wechat-qr-host :deep(iframe) {
  width: 160px !important;
  height: 160px !important;
  margin: 0 auto !important;
}
</style>
