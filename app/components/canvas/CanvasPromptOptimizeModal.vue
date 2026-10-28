<script setup lang="ts">
import type { OptimizeApplyMode } from '~/utils/canvas-prompt-optimize'

/**
 * 提示词优化（L15）的对照弹窗：左边原文、右边改写，用户决定替换、追加还是放弃。
 * 改写中时右边先占位；失败时 error 非空、右边显示原因并只留「关闭」。
 */
const props = defineProps<{
  open: boolean
  original: string
  optimized: string
  busy: boolean
  error?: string
  model?: string
  /** 预计扣的积分；0 表示免费或没估出来，不显示 */
  points?: number
}>()

const emit = defineEmits<{
  close: []
  apply: [mode: OptimizeApplyMode]
}>()

const { t } = useI18n()

const ready = computed(() => !props.busy && !props.error && props.optimized.trim().length > 0)

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal canvas-presets canvas-optimize" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ t('提示词优化') }}</h2>
            <p v-if="busy">
              {{ t('正在改写…') }}
              <span v-if="points" class="canvas-optimize__points">{{ t('本次约扣 {n} 积分', { n: points }) }}</span>
            </p>
            <p v-else-if="model">
              {{ t('由 {model} 改写，保留你的原意并补全维度', { model }) }}
              <span v-if="points" class="canvas-optimize__points">{{ t('本次约扣 {n} 积分', { n: points }) }}</span>
            </p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-optimize__cols">
          <section>
            <h3>{{ t('原文') }}</h3>
            <pre>{{ original }}</pre>
          </section>
          <section :class="{ 'is-busy': busy, 'is-error': !!error }">
            <h3>{{ t('改写后') }}</h3>
            <p v-if="busy" class="canvas-optimize__wait">
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              {{ t('模型思考中，一般十几秒') }}
            </p>
            <p v-else-if="error" class="canvas-optimize__err">{{ error }}</p>
            <pre v-else>{{ optimized }}</pre>
          </section>
        </div>

        <div class="canvas-optimize__actions">
          <button type="button" class="canvas-optimize__ghost" @click="emit('close')">{{ t('放弃') }}</button>
          <button type="button" class="canvas-optimize__ghost" :disabled="!ready" @click="emit('apply', 'append')">
            {{ t('追加到原文后') }}
          </button>
          <button type="button" class="canvas-optimize__go" :disabled="!ready" @click="emit('apply', 'replace')">
            {{ t('替换原文') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
