<script setup lang="ts">
const { t } = useI18n()

defineProps<{
  readonly?: boolean
  menuFromAdd?: boolean
  pickerOpen?: boolean
  toolMenu?: boolean
  workflowOpen?: boolean
  /** 一稿多版矩阵面板开着没有 */
  matrixOpen?: boolean
  /** 运行队列面板开着没有 */
  queueOpen?: boolean
  /** 这幅画布进行中的任务数（运行队列入口上的角标） */
  queueActive?: number
  /** 角标数字（超过 99 显示 99+，直接显示传进来的字符串） */
  queueBadge?: string
  practiceOpen?: boolean
  canvasTool: 'select' | 'pan'
  showHelp?: boolean
  findOpen?: boolean
}>()

const emit = defineEmits<{
  add: [event: MouseEvent]
  assets: []
  workflow: []
  /** 一稿多版矩阵（平台规格 × 多语言派生） */
  matrix: []
  /** 运行队列（这幅画布正在跑 / 刚跑完的任务） */
  queue: []
  practice: []
  'toggle-tool': []
  'set-tool': [tool: 'select' | 'pan']
  history: []
  shortcuts: []
  find: []
  help: []
}>()
</script>

<template>
  <aside class="canvas-tools" data-guide="tools" @pointerdown.stop @dblclick.stop>
    <button
      type="button"
      class="canvas-tools__add"
      :class="{ 'is-open': menuFromAdd }"
      :aria-label="t('添加节点')"
      @click="emit('add', $event)"
    >
      <UIcon name="i-lucide-plus" class="size-4" />
      <span class="canvas-tip">{{ t('添加') }}</span>
    </button>
    <button
      type="button"
      :class="{ 'is-on': pickerOpen }"
      :aria-label="t('资产管理')"
      @click="emit('assets')"
    >
      <UIcon name="i-lucide-images" class="size-4" />
      <span class="canvas-tip">{{ t('资产管理') }}</span>
    </button>
    <button
      type="button"
      :class="{ 'is-on': workflowOpen }"
      :aria-label="t('工作流')"
      @click="emit('workflow')"
    >
      <UIcon name="i-lucide-workflow" class="size-4" />
      <span class="canvas-tip">{{ t('工作流') }}</span>
    </button>
    <button
      type="button"
      :class="{ 'is-on': matrixOpen }"
      :aria-label="t('一稿多版')"
      @click="emit('matrix')"
    >
      <UIcon name="i-lucide-layout-grid" class="size-4" />
      <span class="canvas-tip">{{ t('一稿多版') }}</span>
    </button>
    <button
      type="button"
      :class="{ 'is-on': queueOpen }"
      :aria-label="t('运行队列')"
      @click="emit('queue')"
    >
      <UIcon name="i-lucide-list-checks" class="size-4" />
      <span v-if="queueActive" class="canvas-tools__badge">{{ queueBadge || queueActive }}</span>
      <span class="canvas-tip">{{ t('运行队列') }}</span>
    </button>
    <button
      type="button"
      :class="{ 'is-on': practiceOpen }"
      :aria-label="t('新手跟练')"
      @click="emit('practice')"
    >
      <UIcon name="i-lucide-graduation-cap" class="size-4" />
      <span class="canvas-tip">{{ t('新手跟练') }}</span>
    </button>
    <div class="canvas-tools__item">
      <button
        type="button"
        :aria-label="t('工具')"
        :class="{ 'is-on': toolMenu }"
        @click="emit('toggle-tool')"
      >
        <UIcon :name="canvasTool === 'pan' ? 'i-lucide-hand' : 'i-lucide-mouse-pointer-2'" class="size-4" />
        <span v-if="!toolMenu" class="canvas-tip">{{ canvasTool === 'pan' ? t('抓手工具') : t('移动') }}</span>
      </button>
      <div v-if="toolMenu" class="canvas-tool-pop" @pointerdown.stop>
        <button type="button" :class="{ 'is-on': canvasTool === 'select' }" @click="emit('set-tool', 'select')">
          <UIcon name="i-lucide-mouse-pointer-2" class="size-4" />
          {{ t('移动') }}
          <kbd>V</kbd>
        </button>
        <button type="button" :class="{ 'is-on': canvasTool === 'pan' }" @click="emit('set-tool', 'pan')">
          <UIcon name="i-lucide-hand" class="size-4" />
          {{ t('抓手工具') }}
          <kbd>{{ t('空格') }}</kbd>
        </button>
      </div>
    </div>
    <button v-if="!readonly" type="button" :aria-label="t('历史')" @click="emit('history')">
      <UIcon name="i-lucide-history" class="size-4" />
      <span class="canvas-tip">{{ t('历史') }}</span>
    </button>
    <span class="canvas-tools__div" />
    <button type="button" :aria-label="t('canvas.find.title')" :class="{ 'is-on': findOpen }" @click="emit('find')">
      <UIcon name="i-lucide-search" class="size-4" />
      <span class="canvas-tip">{{ t('canvas.find.title') }}</span>
    </button>
    <button type="button" :aria-label="t('快捷键')" :class="{ 'is-on': showHelp }" @click="emit('shortcuts')">
      <UIcon name="i-lucide-keyboard" class="size-4" />
      <span class="canvas-tip">{{ t('快捷键') }}</span>
    </button>
    <button type="button" :aria-label="t('帮助')" @click="emit('help')">
      <UIcon name="i-lucide-circle-help" class="size-4" />
      <span class="canvas-tip">{{ t('帮助') }}</span>
    </button>
  </aside>
</template>
