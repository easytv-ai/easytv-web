<script setup lang="ts">
import { canvasFlowPaneRect } from '~/utils/canvas-panel-layout'
import {
  pickGuideCardPosition,
  type GuideCardSize,
  type GuideRect,
  type GuideZones,
} from '~/utils/canvas-guide-card'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

type GuideStep = { anchor: string, title: string, body: string }

const STEPS = computed((): GuideStep[] => [
  {
    anchor: 'starts',
    title: t('点中间入口开始'),
    body: t('挑一张技能卡片，在右侧对话里描述内容再生成。'),
  },
  {
    anchor: 'tools',
    title: t('左侧也能添加节点'),
    body: t('用加号添加节点，或从资产库导入素材。'),
  },
  {
    anchor: 'chat',
    title: t('右侧对话帮你写'),
    body: t('选 Skill 或直接跟助手说，生成提示词再出片。'),
  },
])

const index = ref(0)
const spot = ref<GuideRect | null>(null)
/** 量不到卡片时沿用原先的 320×168，量到之后按真实尺寸避让 */
const cardSize = ref<GuideCardSize>({ width: 320, height: 168 })
const zones = ref<GuideZones>({ hard: [], soft: [] })

function rectOf(el: Element | null | undefined): GuideRect | null {
  const r = el?.getBoundingClientRect()
  if (!r || r.width <= 0 || r.height <= 0)
    return null
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function queryRects(selector: string): GuideRect[] {
  return [...document.querySelectorAll(selector)]
    .map(el => rectOf(el))
    .filter((rect): rect is GuideRect => Boolean(rect))
}

/** 硬禁区：弹出的菜单 / 弹层（z-index 比引导浮层低，卡片压住就点不到） */
const HARD_ZONE_SELECTORS = ['.canvas-menu', '.canvas-ctx', '.canvas-tool-pop']
/** 软禁区：常驻面板与工具轨，尽量避 */
const SOFT_ZONE_SELECTORS = ['.canvas-tools', '.canvas-dock', '[data-guide="inspector"]', '[data-guide="chat"]']

function collectZones() {
  zones.value = {
    hard: HARD_ZONE_SELECTORS.flatMap(queryRects),
    soft: SOFT_ZONE_SELECTORS.flatMap(queryRects),
  }
}

function readCardSize() {
  const card = document.querySelector('.canvas-guide:not(.canvas-guide--practice) .canvas-guide__card')
  const rect = rectOf(card)
  if (!rect)
    return
  if (rect.width !== cardSize.value.width || rect.height !== cardSize.value.height)
    cardSize.value = { width: rect.width, height: rect.height }
}

function currentStep(): GuideStep {
  const items = STEPS.value
  return items[index.value] ?? items[0] ?? { anchor: 'starts', title: '', body: '' }
}

const step = computed(() => currentStep())
const last = computed(() => index.value >= STEPS.value.length - 1)

function measure() {
  if (!props.open || !import.meta.client)
    return
  const el = document.querySelector<HTMLElement>(`[data-guide="${currentStep().anchor}"]`)
  if (!el) {
    spot.value = null
    if (index.value === 0 && STEPS.value.length > 1)
      index.value = 1
    return
  }
  const r = el.getBoundingClientRect()
  const pad = 8
  spot.value = {
    top: Math.max(8, r.top - pad),
    left: Math.max(8, r.left - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  }
  collectZones()
  readCardSize()
}

const cardStyle = computed(() => {
  const s = spot.value
  if (!s || typeof window === 'undefined') {
    return {
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
    }
  }
  const pane = canvasFlowPaneRect()
  const placement = pickGuideCardPosition(s, cardSize.value, zones.value, {
    width: window.innerWidth,
    height: window.innerHeight,
  }, {
    left: pane.left,
    top: pane.top,
    width: pane.width ?? 0,
    height: pane.height ?? 0,
  })
  return {
    left: `${placement.left}px`,
    top: `${placement.top}px`,
    width: `${cardSize.value.width}px`,
  }
})

function next() {
  if (last.value) {
    emit('close')
    return
  }
  index.value += 1
  nextTick(measure)
}

function skip() {
  emit('close')
}

let measureTimer = 0

watch(() => [props.open, index.value, currentStep().anchor] as const, () => {
  if (!props.open) {
    index.value = 0
    spot.value = null
    if (measureTimer) {
      window.clearInterval(measureTimer)
      measureTimer = 0
    }
    return
  }
  nextTick(() => {
    measure()
    requestAnimationFrame(measure)
  })
  if (!measureTimer)
    measureTimer = window.setInterval(measure, 400)
}, { immediate: true })

onMounted(() => {
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
})

onUnmounted(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('scroll', measure, true)
  if (measureTimer)
    window.clearInterval(measureTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="canvas-guide" role="dialog" aria-modal="true" :aria-label="t('新手跟练')">
      <div
        v-if="spot"
        class="canvas-guide__spot"
        :style="{
          top: `${spot.top}px`,
          left: `${spot.left}px`,
          width: `${spot.width}px`,
          height: `${spot.height}px`,
        }"
      />
      <div v-else class="canvas-guide__mask" />
      <aside class="canvas-guide__card" :style="cardStyle">
        <p class="canvas-guide__index">{{ index + 1 }} / {{ STEPS.length }}</p>
        <h3>{{ step.title }}</h3>
        <p>{{ step.body }}</p>
        <div class="canvas-guide__actions">
          <button type="button" class="canvas-guide__skip" @click="skip">{{ t('跳过') }}</button>
          <button type="button" class="canvas-guide__next" @click="next">
            {{ last ? t('开始创作') : t('下一步') }}
          </button>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
