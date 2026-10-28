<script setup lang="ts">
import {
  anchorSelector,
  findPracticeScript,
  practiceAnchorKey,
  practiceKindLabel,
  practiceProgress,
  practiceReadyItems,
  practiceStepSatisfied,
  PRACTICE_LEVELS,
  PRACTICE_LIST_WIDTH,
  PRACTICE_SCRIPTS,
  type PracticeAppliedPrepare,
  type PracticeGraphView,
  type PracticeReadyItem,
  type PracticeStep,
} from '~/utils/canvas-practice'
import { canvasFlowPaneRect } from '~/utils/canvas-panel-layout'
import {
  GUIDE_CARD_WIDTH,
  guideRectOverlap,
  pickGuideCardPosition,
  type GuideCardSize,
  type GuideRect,
  type GuideViewport,
  type GuideZones,
} from '~/utils/canvas-guide-card'
import { GUIDE_CARD_GLIDE_CLASS, guideCardTransform } from '~/utils/guide-anim'
import { useGuideOverlay } from '~/composables/useGuideOverlay'
import CanvasPracticeList from '~/components/canvas/CanvasPracticeList.vue'

/**
 * 跟练卡片（播放式引导）：上一步 / 重播这一步 / 收起 / 退出都在表头，底栏只有主次两个按钮——
 * 主按钮在产物步没做完时是禁用的（「等你动手」），次按钮「跳过这一步」是统一逃生口。
 *
 * 三套过渡都在 CSS（canvas.css）里，这里只给名字与 key：
 * - `practice-pop`：步骤卡 / 选场景弹窗互切（mode="out-in"）；
 * - `practice-pill`：药丸单独一套，`.practice-pill-enter-from` 必须写全 translateX(-50%) scale(.96)，
 *   否则丢掉居中位移、药丸会右移半个身位；
 * - `practice-step` / `practice-icon`：卡片内容切步、清单图标三态（见 CanvasPracticeList）。
 *
 * 聚光与卡片位置由 useGuideOverlay 的常驻 rAF 循环维护：锚点矩形用 guideApproach 做帧率无关的
 * 指数趋近，锚点换身份 / 相机补间在飞 / reduced-motion 三种情况直落；位置一律走 transform:
 * translate3d(x,y,0)（.canvas-guide 是 fixed inset:0，坐标原点就是视口原点），卡片滑行期间挂
 * `.is-gliding`（CSS 里 pointer-events: none，滑过锚点时别吞掉用户的一次点击）。
 */
const props = defineProps<{
  /** 跟练会话（workspace 里 useCanvasPractice 的 session） */
  session: {
    active: boolean
    scriptId: string
    stepIndex: number
    minimized: boolean
    /** 已完成 / 跳过的步骤 id（宿主的 session.done）：demo 步与「跳过这一步」都写这里 */
    done: string[]
    /** 跟练这次实际写进画布的 prepare（宿主的 session.applied）：ready 行只报真写进去的东西 */
    applied?: PracticeAppliedPrepare[]
    /** 回放在飞（宿主可选带上）：飞的时候禁用「跳过这一步」，别把回放悬在半空 */
    replayBusy?: boolean
    /** 宿主这次会话的提示行（主体库为空 / 清单里没有带原生出声的模型…） */
    notice?: string
  }
  /** 当前画布的扁平视图，用来判「这一步做完没有」和高亮哪个节点 */
  view: PracticeGraphView
  /** 宿主这次会话的提示行（与 session.notice 同一份，显式传时以它为准） */
  notice?: string
  /** 相机补间在飞（宿主 camera.tweening）：聚光与卡片直落，别吊在移动中的锚点后面 */
  cameraTweening?: boolean
}>()

const emit = defineEmits<{
  exit: []
  next: []
  goto: [index: number]
  minimize: []
  restore: []
  /** 场景选择卡上挑了一条剧本 */
  pickScript: [id: string]
  /** 「跳过这一步」：产物步的统一逃生口（宿主写 session.done 后推进） */
  skip: []
}>()

const { t } = useI18n()

const scripts = PRACTICE_SCRIPTS
const script = computed(() => findPracticeScript(props.session.scriptId))
const steps = computed(() => script.value?.steps ?? [])
const step = computed<PracticeStep | null>(() => steps.value[props.session.stepIndex] ?? null)
/** 已完成 / 跳过的步（demo 演示完与用户跳过都走这条通道）+ 判据，两路取或 */
const doneIds = computed(() => new Set(props.session.done))
const satisfied = computed(() => (step.value ? practiceStepSatisfied(step.value, props.view, doneIds.value) : true))
const isLast = computed(() => steps.value.length > 0 && props.session.stepIndex >= steps.value.length - 1)
/** 产物步：底栏要给「跳过这一步」（回放点不出来时的逃生口，跳过照样打勾） */
const resultStep = computed(() => step.value?.gate?.kind === 'result')
/** 顶部数字与药丸上的 N/8（与清单同一份规则） */
const progress = computed(() => practiceProgress(steps.value, props.view, props.session.stepIndex, doneIds.value))
/** 「跟练已替你布好这一步」那一行：由宿主实际执行过的 prepare 反推，没写进去的不上行 */
const ready = computed<PracticeReadyItem[]>(() => practiceReadyItems(step.value, props.session.applied))
const noticeLine = computed(() => props.notice || props.session.notice || '')

/**
 * gate 行：产物步没做完是「等你动手」（主按钮同步禁用），demo 步是「这一步的做法：{what}」
 * （what 由剧本 gateHint 给中文原文），其余步是「由跟练演示」；做完之后统一「这一步做好了」。
 */
const gateLine = computed(() => {
  const current = step.value
  if (!current?.gate)
    return null
  if (satisfied.value)
    return { done: true, icon: 'i-lucide-check-circle-2', text: t('这一步做好了') }
  if (current.gate.kind === 'result' && current.gateHint)
    return { done: false, icon: 'i-lucide-circle-dashed', text: t('等你动手：{hint}', { hint: t(current.gateHint) }) }
  if (current.gate.kind === 'demo' && current.gateHint)
    return { done: false, icon: 'i-lucide-circle-dashed', text: t('这一步的做法：{what}', { what: t(current.gateHint) }) }
  return { done: false, icon: 'i-lucide-circle-dashed', text: t('由跟练演示：看完点继续') }
})

/** 运镜 / 特效是用「 · 」拼起来的中文原文（即翻译键），逐段翻译后再拼回去 */
function translateParts(text: string) {
  return text.split(' · ').map(part => t(part)).join(' · ')
}

/** ready 行的文案：一条 prepare 可能拆成多行（口播就是「台词 + 自动时长」两行），所以返回数组 */
function readyLines(item: PracticeReadyItem): string[] {
  switch (item.kind) {
    case 'subject':
      return [t('已引用主体：{name}', { name: t(item.name) })]
    case 'talking':
      return [t('已写好台词：{text}', { text: item.script }), t('自动 {n} 秒', { n: item.seconds })]
    case 'text':
      return [item.asScript ? t('已写好脚本：{text}', { text: item.text }) : t('已写好正文：{text}', { text: item.text })]
    case 'audio':
      return [t('已放好音频轨（{n} 秒）', { n: item.seconds })]
    case 'camera':
      return [t('已配好运镜：{moves}', { moves: translateParts(item.moves) })]
    case 'model':
      return [t('模型已选好：{value}', { value: item.value })]
    case 'connect':
      return [t('已放好{from} → {to} 的连线', { from: t(practiceKindLabel(item.fromKind)), to: t(practiceKindLabel(item.toKind)) })]
    case 'node':
      return [t('已放好一个{kind}节点', { kind: t(practiceKindLabel(item.nodeKind)) })]
  }
}

/** 场景选择卡按等级分组（入门 / 进阶 / 高阶），组内保持剧本表里的原顺序 */
const scriptGroups = computed(() => PRACTICE_LEVELS
  .map(level => ({ level: level.id, label: level.label, items: scripts.filter(item => item.level === level.id) }))
  .filter(group => group.items.length > 0))

// ---- 聚光 / 卡片 / 清单的几何：每帧一条快路径（useGuideOverlay），禁区与清单是每 8 帧的慢活 ----

/** 硬 / 软禁区，每 8 帧重收一次：菜单是点开的，只能靠周期性测量让卡片自己让位 */
const zones = ref<GuideZones>({ hard: [], soft: [] })
/** 卡片真实尺寸：ResizeObserver 量，替掉以前写死的 340×250 */
const cardSize = ref<GuideCardSize>({ width: GUIDE_CARD_WIDTH, height: 250 })
const cardEl = ref<HTMLElement | null>(null)

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

/**
 * 硬禁区：弹出的菜单 / 弹层、常驻的跟练清单（z-index 都比引导浮层低，卡片压住就真的点不到里面），
 * 以及通知 toast。toast 是浏览器验收发现的：进跟练时那条「先选一个场景…」的通知正好落在选课卡右上角，
 * 把卡头的「退出跟练」按钮整块盖住（elementFromPoint 命中 toast 标题），用户连退都退不出来。
 * 量 toast 只能量到「项」：外层 region 高度 0、ol[data-slot=viewport] 宽度 0，只有 li 有真实矩形；
 * 用 aria 前缀（运行时实测的 Nuxt UI 默认标签）+ 结构（该 ol 里只有 toast li）两条一起兜。
 */
const HARD_ZONE_SELECTORS = [
  '.canvas-menu',
  '.canvas-ctx',
  '.canvas-tool-pop',
  '.canvas-practice-list',
  /* 左边工具条很窄，卡片一压就把加号盖死；跟高亮锚点一样，任何情况下都不压 */
  '.canvas-tools',
  '[aria-label^="Notifications"] li',
  'ol[data-slot="viewport"] > li',
]
/** 软禁区：常驻面板，尽量避但不强求 */
const SOFT_ZONE_SELECTORS = ['.canvas-dock', '[data-guide="inspector"]', '[data-guide="chat"]']

/**
 * 画布舞台的矩形：跟禁区一起每 8 帧量一次（只有面板开合才会变，逐帧量那份是白给的 DOM 开销）。
 * 不进响应式——它只被 pickCard 这个回调读，模板不读。
 */
let paneBox = { left: 0, top: 0, width: 0, height: 0 }

function collectZones() {
  const pane = canvasFlowPaneRect()
  paneBox = { left: pane.left, top: pane.top, width: pane.width ?? 0, height: pane.height ?? 0 }
  zones.value = {
    hard: HARD_ZONE_SELECTORS.flatMap(queryRects),
    soft: SOFT_ZONE_SELECTORS.flatMap(queryRects),
  }
}

// ---- 常驻步骤清单：贴在画布舞台右上，与 Inspector 抢位置时折成一行表头 ----
/** 展开态的高度：折起时量到的是表头高度，采信它会让碰撞判定抖，所以只记展开时量到的值（初值 340） */
const listHeight = ref(340)
/** 折叠：auto = 撞了就折；open / closed = 用户在本步内手动定过（切步重置） */
const listManual = ref<'auto' | 'open' | 'closed'>('auto')

const overlay = useGuideOverlay({
  /** 会话在跑才测量：最小化 / 退出后浮层不在，循环停手 */
  enabled: () => props.session.active && !props.session.minimized,
  /** 锚点身份 + 屏幕矩形：换步 / 换节点由 practiceAnchorKey 判定，变了直落 */
  anchor: () => ({ key: practiceAnchorKey(step.value, props.view), rect: anchorRect() }),
  /** 每 8 帧的慢活：重收禁区 + 重算清单的碰撞结论（都是 querySelectorAll） */
  refreshZones: () => {
    collectZones()
    measureList()
  },
  pickCard: spot => pickGuideCardPosition(spot, cardSize.value, zones.value, windowViewport(), paneBox),
  directFall: () => Boolean(props.cameraTweening),
  cardSize: () => cardSize.value,
  listHeight: () => listHeight.value,
})

const { spot, card, gliding, listRect, listCollapsed, measureNow } = overlay

function windowViewport(): GuideViewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** 锚点元素：节点类锚点按「当前这一类的第一个节点」算（anchorSelector 负责回落），找不到给 null */
function anchorRect(): GuideRect | null {
  if (!import.meta.client)
    return null
  const selector = anchorSelector(step.value?.anchor, props.view)
  return selector ? rectOf(document.querySelector(selector)) : null
}

/** 清单的碰撞：永远拿「展开态矩形」跟 Inspector 比——用当前（可能已折起）的尺寸会判成不撞 → 展开 → 再撞 */
function measureList() {
  const list = queryRects('.canvas-practice-list')[0]
  if (!list)
    return
  const expanded: GuideRect = { ...list, height: listHeight.value }
  const collides = queryRects('[data-guide="inspector"]').some(rect => guideRectOverlap(expanded, rect) > 0)
  if (collides !== listCollapsed.value)
    listCollapsed.value = collides
  // 只在展开态采信量到的高度：折起时量到的是表头，采信它会让碰撞判定抖
  if (!listFolded.value) {
    if (list.height > 0 && list.height !== listHeight.value)
      listHeight.value = list.height
  }
}

const listFolded = computed(() => {
  if (listManual.value === 'open')
    return false
  if (listManual.value === 'closed')
    return true
  return listCollapsed.value
})

const listStyle = computed(() => ({
  left: `${listRect.value.left}px`,
  top: `${listRect.value.top}px`,
  width: `${PRACTICE_LIST_WIDTH}px`,
}))

function onListToggle() {
  listManual.value = listFolded.value ? 'open' : 'closed'
}

watch(() => props.session.stepIndex, () => {
  listManual.value = 'auto'
})

function readCardSize() {
  // 首帧卡片走的是兜底样式（没有 inline 宽度），那时量到的是「被正文撑开的宽度」
  // ——实测 640px，一旦锁进 cardSize 就再也回不到 340。所以只在定位样式已经带上宽度之后才采信。
  // 宽度用 offsetWidth（不含 transform）：入场的 scale 会让 getBoundingClientRect 变小，写回去就越缩越窄。
  // 宽度只往上长，不低于卡片默认宽；高度跟内容走。
  const el = cardEl.value as (HTMLElement & { offsetWidth: number, offsetHeight: number }) | null
  if (!el || !el.style.width)
    return
  const width = Math.max(GUIDE_CARD_WIDTH, el.offsetWidth)
  const height = el.offsetHeight
  if (width > 0 && height > 0 && (width !== cardSize.value.width || height !== cardSize.value.height))
    cardSize.value = { width, height }
}

const spotStyle = computed(() => ({
  transform: guideCardTransform(spot.value),
  width: `${spot.value.width}px`,
  height: `${spot.value.height}px`,
}))

/** 卡片位置一律走 transform（left/top 由 CSS 固定在 0）；inline width 必须保留：readCardSize 靠它认定位样式 */
const cardStyle = computed(() => ({
  transform: guideCardTransform(card.value),
  width: `${cardSize.value.width}px`,
}))

/**
 * 三套过渡的名字（CSS 在 canvas.css）：
 * - practice-pop：步骤卡 / 选场景弹窗互切（mode="out-in"，避免两段动画重叠）；
 * - practice-pill：药丸单独一套，`.practice-pill-enter-from` 要写全 translateX(-50%) scale(.96)。
 */
const transitionName = computed(() => (props.session.minimized ? 'practice-pill' : 'practice-pop'))

let cardObserver: ResizeObserver | null = null

watch(cardEl, (el) => {
  cardObserver?.disconnect()
  if (el && cardObserver)
    cardObserver.observe(el as unknown as Element)
  nextTick(readCardSize)
})

// 会话 / 切步 / 视图一变就立刻量一轮：常态的每帧测量在 rAF 里，但那要等下一帧，锚点会闪一下旧位置
watch(() => [props.session.active, props.session.minimized, props.session.stepIndex, props.session.scriptId, props.view] as const, () => {
  if (!props.session.active)
    return
  nextTick(() => {
    measureNow()
    requestAnimationFrame(() => measureNow())
  })
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    cardObserver = new ResizeObserver(() => readCardSize())
    if (cardEl.value)
      cardObserver.observe(cardEl.value as unknown as Element)
  }
})

onUnmounted(() => {
  cardObserver?.disconnect()
  cardObserver = null
})
</script>

<template>
  <Teleport to="body">
    <Transition :name="transitionName" mode="out-in">
      <button
        v-if="session.active && session.minimized"
        key="pill"
        type="button"
        class="canvas-practice-pill"
        @click="emit('restore')"
      >
        <UIcon name="i-lucide-graduation-cap" class="size-3.5" />
        {{ t('跟练中 · 展开') }}
        <em>{{ progress.done }}/{{ progress.total }}</em>
      </button>
      <div
        v-else-if="session.active && !step"
        key="pick"
        class="studio-modal-mask canvas-practice-pick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-practice-pick-title"
        @click.self="emit('exit')"
        @pointerdown.stop
      >
        <div class="studio-modal canvas-practice-pick__modal">
          <header class="canvas-practice-pick__head">
            <div>
              <h2 id="canvas-practice-pick-title">{{ t('新手跟练') }}</h2>
              <p>{{ t('按你的业务选一条，跟练一遍') }}。{{ t('每条都是从易到难的一条链：跟练替你布好、你点生成看回放。全程不调模型、不花点数；中途随时可以退出，退出会把画布还原成现在的样子。') }}</p>
            </div>
            <button type="button" class="trash-modal__close" :aria-label="t('退出跟练')" :title="t('退出并还原画布')" @click="emit('exit')">
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
          </header>
          <div class="canvas-practice-pick__body">
            <div class="canvas-guide__scenes">
              <template v-for="group in scriptGroups" :key="group.level">
                <h4 class="canvas-guide__scenes-title">{{ t(group.label) }}</h4>
                <button
                  v-for="item in group.items"
                  :key="item.id"
                  type="button"
                  :aria-label="t('跟练场景：{name}', { name: t(item.name) })"
                  @click="emit('pickScript', item.id)"
                >
                  <UIcon :name="item.icon" class="size-4" />
                  <span>
                    <b>{{ t(item.name) }}</b>
                    <em>{{ t(item.hint) }}</em>
                  </span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="session.active && step" key="card" class="canvas-guide canvas-guide--practice" role="dialog" aria-modal="false" :aria-label="t('新手跟练')">
        <div class="canvas-guide__spot" :style="spotStyle" />
        <CanvasPracticeList
          :steps="steps"
          :view="view"
          :step-index="session.stepIndex"
          :done-ids="session.done"
          :collapsed="listFolded"
          :style="listStyle"
          @goto="emit('goto', $event)"
          @toggle="onListToggle"
        />
        <aside
          ref="cardEl"
          class="canvas-guide__card canvas-guide__card--practice"
          :class="{ [GUIDE_CARD_GLIDE_CLASS]: gliding }"
          :style="cardStyle"
        >
          <header class="canvas-guide__head">
            <span class="canvas-guide__head-row">
              <span class="canvas-guide__index">{{ session.stepIndex + 1 }} / {{ steps.length }}</span>
              <span class="canvas-guide__head-ops">
              <button
                type="button"
                :disabled="session.stepIndex <= 0"
                :aria-label="t('上一步')"
                :title="t('上一步')"
                @click="emit('goto', session.stepIndex - 1)"
              >
                <UIcon name="i-lucide-chevron-left" class="size-3.5" />
              </button>
              <button
                type="button"
                :aria-label="t('播放')"
                :title="t('播放')"
                @click="emit('goto', session.stepIndex)"
              >
                <UIcon name="i-lucide-rotate-ccw" class="size-3.5" />
              </button>
              <button type="button" :aria-label="t('收起')" :title="t('收起（跟练继续，随时能展开）')" @click="emit('minimize')">
                <UIcon name="i-lucide-minus" class="size-3.5" />
              </button>
              <button type="button" :aria-label="t('退出跟练')" :title="t('退出并还原画布')" @click="emit('exit')">
                <UIcon name="i-lucide-log-out" class="size-3.5" />
              </button>
              </span>
            </span>
            <strong class="canvas-guide__script">{{ t(script?.name || '新手跟练') }}</strong>
          </header>
          <Transition name="practice-step">
            <div class="canvas-guide__step" :key="session.stepIndex">
              <h3>{{ t(step.title) }}</h3>
              <p>{{ t(step.body) }}</p>
              <div v-if="ready.length" class="canvas-guide__ready">
                <p class="canvas-guide__ready-head">
                  <UIcon name="i-lucide-sparkles" class="size-3.5" />
                  {{ t('跟练已替你布好这一步') }}
                </p>
                <ul>
                  <template v-for="(item, index) in ready" :key="index">
                    <li v-for="(line, lineIndex) in readyLines(item)" :key="lineIndex">{{ line }}</li>
                  </template>
                </ul>
              </div>
              <p v-if="noticeLine" class="canvas-guide__gate is-warn">
                <UIcon name="i-lucide-info" class="size-3.5" />
                {{ noticeLine }}
              </p>
              <p v-if="gateLine" class="canvas-guide__gate" :class="{ 'is-done': gateLine.done }">
                <UIcon :name="gateLine.icon" class="size-3.5" />
                {{ gateLine.text }}
              </p>
              <p v-if="isLast" class="canvas-guide__gate is-done">
                <UIcon name="i-lucide-package-check" class="size-3.5" />
                {{ t('跟练走完了：退出会把画布还原成进来那一刻') }}
              </p>
            </div>
          </Transition>
          <div class="canvas-guide__actions">
            <button
              v-if="resultStep"
              type="button"
              class="canvas-guide__skip"
              :disabled="Boolean(session.replayBusy)"
              @click="emit('skip')"
            >
              {{ t('跳过这一步') }}
            </button>
            <button
              type="button"
              class="canvas-guide__next"
              :class="{ 'is-finish': isLast }"
              :disabled="resultStep && !satisfied"
              @click="isLast ? emit('exit') : emit('next')"
            >
              {{ isLast ? t('完成，退出并还原画布') : t('继续') }}
            </button>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>
