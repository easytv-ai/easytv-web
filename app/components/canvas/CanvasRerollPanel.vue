<script setup lang="ts">
import {
  normalizeRerollReasons,
  rerollAdvice,
  rerollReasonsFor,
  type RerollAction,
  type RerollContext,
  type RerollReason,
} from '~/utils/canvas-reroll'

/**
 * 重抽询问（API.md 39.5）：节点已有结果时再点生成，先问一句「哪里不满意」。
 * 选了原因就地给对症建议——能局部修的不必整条重抽；也可以直接重抽，或勾「不再询问」。
 * 面板自己不提交任务：confirm / divert 都交回 CanvasWorkspace。
 */
const props = defineProps<{
  open: boolean
  /** 节点类型与当前挂了什么，决定能选哪些原因、建议带不带按钮 */
  context: RerollContext
  /** 节点名，标题下面带一句 */
  label?: string
}>()

const emit = defineEmits<{
  close: []
  /** reasons 为空 = 跳过直接重抽 */
  confirm: [reasons: RerollReason[], dontAsk: boolean]
  /** 点了建议上的按钮：改走局部修复 / 调整入口，不重抽 */
  divert: [action: RerollAction, reasons: RerollReason[], dontAsk: boolean]
}>()

const { t } = useI18n()

const picked = ref<RerollReason[]>([])
const dontAsk = ref(false)

const reasons = computed(() => rerollReasonsFor(props.context.type))
const chosen = computed(() => normalizeRerollReasons(picked.value, props.context.type))
const advice = computed(() => rerollAdvice(chosen.value, props.context))

watch(() => props.open, (open) => {
  if (open) {
    picked.value = []
    dontAsk.value = false
  }
})

/** 音频的「表演」说的是语气情绪，换个说法；其余与审片退回原因同码同义 */
function reasonLabel(reason: RerollReason) {
  if (props.context.type === 'audio' && reason === 'performance')
    return t('canvas.reroll.reason.performanceAudio')
  return t(`canvas.reroll.reason.${reason}`)
}

function toggle(reason: RerollReason) {
  picked.value = picked.value.includes(reason)
    ? picked.value.filter(item => item !== reason)
    : [...picked.value, reason]
}

function confirm(withReasons: boolean) {
  if (withReasons && !chosen.value.length)
    return
  emit('confirm', withReasons ? chosen.value : [], dontAsk.value)
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
    return
  }
  // ⌘/Ctrl+Enter 在面板开着时就是确认：选了原因按原因抽，没选直接抽；不能再漏给画布触发第二次生成
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    event.stopPropagation()
    confirm(chosen.value.length > 0)
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal canvas-presets canvas-reroll" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ t('canvas.reroll.title') }}</h2>
            <p>{{ label ? t('canvas.reroll.hintNode', { label }) : t('canvas.reroll.hint') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-reroll__reasons">
          <button
            v-for="reason in reasons"
            :key="reason"
            type="button"
            class="canvas-reroll__chip"
            :class="{ 'is-on': picked.includes(reason) }"
            :aria-pressed="picked.includes(reason)"
            @click="toggle(reason)"
          >
            <UIcon v-if="picked.includes(reason)" name="i-lucide-check" class="size-3.5" />
            {{ reasonLabel(reason) }}
          </button>
        </div>

        <section v-if="advice.length" class="canvas-reroll__advice">
          <h3>{{ t('canvas.reroll.adviceTitle') }}</h3>
          <ul>
            <li v-for="item in advice" :key="item.id">
              <span>{{ t(item.textKey) }}</span>
              <button
                v-if="item.action"
                type="button"
                class="canvas-reroll__act"
                @click="emit('divert', item.action, chosen, dontAsk)"
              >
                {{ t(`canvas.reroll.action.${item.action}`) }}
              </button>
            </li>
          </ul>
        </section>

        <div class="canvas-reroll__foot">
          <label class="canvas-reroll__mute">
            <input v-model="dontAsk" type="checkbox">
            {{ t('canvas.reroll.dontAsk') }}
          </label>
          <span class="canvas-reroll__grow" />
          <button type="button" class="canvas-optimize__ghost" @click="confirm(false)">
            {{ t('canvas.reroll.skip') }}
          </button>
          <button type="button" class="canvas-optimize__go" :disabled="!chosen.length" @click="confirm(true)">
            {{ t('canvas.reroll.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.canvas-reroll {
  width: min(94vw, 520px);
}

.canvas-reroll__reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 16px 12px;
}

.canvas-reroll__chip {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  border: 1px solid var(--st-border);
  border-radius: 999px;
  background: transparent;
  color: var(--st-text);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.canvas-reroll__chip:hover {
  background: var(--st-hover);
}

.canvas-reroll__chip.is-on {
  border-color: var(--st-on);
  background: var(--st-on);
  color: var(--st-on-text);
}

.canvas-reroll__advice {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border: 1px solid var(--st-border);
  border-radius: 12px;
  background: var(--st-card);
}

.canvas-reroll__advice h3 {
  margin: 0 0 6px;
  color: var(--st-muted);
  font-size: 12px;
  font-weight: 500;
}

.canvas-reroll__advice ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.canvas-reroll__advice li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--st-text);
  font-size: 13px;
  line-height: 1.5;
}

.canvas-reroll__advice li span {
  flex: 1;
  min-width: 0;
}

.canvas-reroll__act {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--st-border);
  border-radius: 999px;
  background: transparent;
  color: var(--st-text);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.canvas-reroll__act:hover {
  background: var(--st-hover);
}

.canvas-reroll__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 16px 6px;
}

.canvas-reroll__mute {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--st-muted);
  font-size: 12px;
  cursor: pointer;
}

.canvas-reroll__grow {
  flex: 1;
}
</style>
