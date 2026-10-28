<script setup lang="ts">
import { practiceProgress, type PracticeGraphView, type PracticeStep } from '~/utils/canvas-practice'

/**
 * 跟练的常驻步骤清单：顶部「已完成 N/8 步」+ 进度条，每步一行标题 + 一句小字，
 * 当前步高亮、走过 / 已就位的打勾，点任意一行跳过去（点当前行 = 重播这一步）。
 *
 * 三态只有三个图标：当前步（打勾过就是勾，没打勾是播放）、已打勾、还没走（虚线圈）；
 * 图标三态之间做 Transition，行宽不变（图标容器在 CSS 里钉死宽度）。
 *
 * 它挂在 CanvasPracticeTour 的 .canvas-guide 层里（那层 Teleport 到 body、z-index 高于画布工具轨）：
 * 画布遮罩的 9999px 聚光阴影压不到它，点击也不会被画布的右键 / 双击处理器接住。
 * 位置与折叠由 tour 算（那边有 rAF 的节流测量与避让几何），这里只负责画。
 */
const props = defineProps<{
  steps: PracticeStep[]
  /** 当前画布的扁平视图：判「这一步的产物已就位没有」 */
  view: PracticeGraphView
  stepIndex: number
  /** 已完成 / 跳过的步骤 id（宿主 session.done）：demo 演示完与用户跳过都算完成 */
  doneIds: string[]
  /** 与右侧面板抢位置时折成一行表头（进度永远可见）；由 tour 的碰撞判定给出 */
  collapsed: boolean
}>()

const emit = defineEmits<{
  goto: [index: number]
  toggle: []
}>()

const { t } = useI18n()

const progress = computed(() => practiceProgress(props.steps, props.view, props.stepIndex, new Set(props.doneIds)))
const listEl = ref<HTMLElement | null>(null)

/** 当前行变了自己滚到可见处（不用 scrollIntoView：那会把整个页面滚走） */
function scrollCurrentIntoView() {
  const root = listEl.value
  if (!root || props.collapsed)
    return
  const row = root.querySelector<HTMLElement>('[aria-current="step"]')
  if (!row)
    return
  const box = root.getBoundingClientRect()
  const rowBox = row.getBoundingClientRect()
  if (rowBox.top < box.top)
    root.scrollTop += rowBox.top - box.top
  else if (rowBox.bottom > box.bottom)
    root.scrollTop += rowBox.bottom - box.bottom
}

watch(() => [props.stepIndex, props.collapsed, props.steps] as const, () => {
  nextTick(scrollCurrentIntoView)
})

function iconOf(item: { state: string, checked: boolean }) {
  if (item.state === 'current')
    return item.checked ? 'i-lucide-check' : 'i-lucide-play'
  return item.checked ? 'i-lucide-check' : 'i-lucide-circle-dashed'
}
</script>

<template>
  <section
    class="canvas-practice-list"
    :class="{ 'is-collapsed': collapsed }"
    :aria-label="t('跟练步骤清单')"
  >
    <header class="canvas-practice-list__head">
      <span class="canvas-practice-list__count">{{ t('已完成 {n}/{total} 步', { n: progress.done, total: progress.total }) }}</span>
      <button
        type="button"
        class="canvas-practice-list__fold"
        :aria-label="collapsed ? t('展开步骤清单') : t('收起步骤清单')"
        :title="collapsed ? t('展开步骤清单') : t('收起步骤清单')"
        @click="emit('toggle')"
      >
        <UIcon :name="collapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="size-3.5" />
      </button>
    </header>
    <span class="canvas-practice-list__bar">
      <i :style="{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }" />
    </span>
    <div class="canvas-practice-list__body">
      <ol ref="listEl" class="canvas-practice-list__rows">
        <li v-for="item in progress.items" :key="item.id">
          <button
            type="button"
            :class="{ 'is-on': item.state === 'current', 'is-checked': item.checked }"
            :aria-current="item.state === 'current' ? 'step' : undefined"
            :aria-label="t('第 {n} 步：{title}', { n: item.index + 1, title: t(steps[item.index]?.title || '') })"
            @click="emit('goto', item.index)"
          >
            <span class="canvas-practice-list__icon">
              <Transition name="practice-icon" mode="out-in">
                <UIcon :key="iconOf(item)" :name="iconOf(item)" class="size-3.5" />
              </Transition>
            </span>
            <span class="canvas-practice-list__text">
              <b>{{ t(steps[item.index]?.title || '') }}</b>
              <em>{{ t(steps[item.index]?.summary || '') }}</em>
            </span>
          </button>
        </li>
      </ol>
    </div>
  </section>
</template>
