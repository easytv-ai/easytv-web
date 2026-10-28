<script setup lang="ts">
import canvasApi from '~/api/canvas'
import type { CanvasShare } from '~/types/creative'
import { rewritePublicLandingUrl } from '~/utils/public-landing-url'

const { t } = useI18n()

/**
 * 画布只读分享：开关 + 复制链接（GET/PUT /user/canvas/:id/share）。
 * 打开链接的人不用登录就能看节点和提示词，登录后可「复制到我的画布」。
 */
const props = defineProps<{
  open: boolean
  canvasId: number
}>()

const emit = defineEmits<{
  close: []
}>()

const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const share = ref<CanvasShare | null>(null)

const link = computed(() => {
  if (!share.value?.enabled || !share.value.path || !import.meta.client)
    return ''
  return `${window.location.origin}${rewritePublicLandingUrl(share.value.path)}`
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

async function load() {
  if (!props.canvasId)
    return
  loading.value = true
  try {
    const res = await canvasApi.share(props.canvasId)
    if (res?.success && res.data)
      share.value = res.data
  }
  finally {
    loading.value = false
  }
}

async function toggle() {
  if (saving.value || !props.canvasId)
    return
  saving.value = true
  try {
    const next = !share.value?.enabled
    const res = await canvasApi.setShare(props.canvasId, next)
    if (!res?.success || !res.data) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    share.value = res.data
    notify(next ? t('分享已开启') : t('分享已关闭，链接立即失效'))
  }
  finally {
    saving.value = false
  }
}

async function copy() {
  if (!link.value)
    return
  try {
    await navigator.clipboard.writeText(link.value)
    notify(t('链接已复制'), 'success')
  }
  catch {
    notify(t('当前浏览器不支持复制'), 'error')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}

watch(() => props.open, (open) => {
  if (open)
    void load()
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop @keydown.stop>
      <div class="studio-modal canvas-share" role="dialog" aria-modal="true" aria-labelledby="canvas-share-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="canvas-share-title">{{ t('分享画布') }}</h2>
            <p>{{ t('拿到链接的人不用登录就能查看节点和提示词，登录后可以复制到自己的画布') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-share__body">
          <div v-if="!canvasId" class="asset-picker__empty">{{ t('画布保存后才能分享') }}</div>
          <template v-else>
            <label class="canvas-share__switch">
              <span class="pref-switch">
                <input type="checkbox" :checked="share?.enabled" :disabled="loading || saving" @change="toggle">
                <i />
              </span>
              <span>{{ share?.enabled ? t('已开启只读分享') : t('开启只读分享') }}</span>
            </label>
            <div v-if="share?.enabled" class="canvas-share__link">
              <input type="text" :value="link" readonly @focus="($event.target as HTMLInputElement).select()">
              <button type="button" class="plan-btn plan-btn--solid" @click="copy">{{ t('复制链接') }}</button>
            </div>
            <p class="canvas-share__note">
              {{ t('分享内容为当前已保存的版本，之后的修改会实时体现；生成任务状态和你的资产不会暴露给对方。关闭分享后链接立即失效。') }}
            </p>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
