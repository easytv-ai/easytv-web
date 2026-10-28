<script setup lang="ts">
const { t } = useI18n()

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const mod = isMac ? '⌘' : 'Ctrl'
const active = ref('edit')

type Combo = string[]
type Item = { label: string, combos: Combo[] }
type Group = { id: string, title: string, items: Item[] }

const groups = computed<Group[]>(() => [
  {
    id: 'edit',
    title: t('编辑操作'),
    items: [
      { label: t('复制'), combos: [[mod, 'C']] },
      { label: t('粘贴'), combos: [[mod, 'V']] },
      { label: t('创建副本'), combos: [[mod, 'D']] },
      { label: t('撤销'), combos: [[mod, 'Z']] },
      { label: t('重做'), combos: [[mod, 'Shift', 'Z']] },
      { label: t('删除'), combos: [['Backspace'], ['Delete']] },
      { label: t('canvas.nudge'), combos: [['←'], ['→'], ['↑'], ['↓']] },
      { label: t('保存'), combos: [[mod, 'S']] },
    ],
  },
  {
    id: 'create',
    title: t('创作操作'),
    items: [
      { label: t('成组'), combos: [[mod, 'G'], ['Alt', 'G']] },
      { label: t('解组'), combos: [[mod, 'Shift', 'G'], ['Alt', 'Shift', 'G']] },
      { label: t('连线'), combos: [[mod, 'L']] },
      { label: t('canvas.lock.lock'), combos: [[mod, 'Shift', 'L']] },
      { label: t('生成'), combos: [[mod, 'Enter']] },
      { label: t('新建节点'), combos: [['Tab']] },
    ],
  },
  {
    id: 'align',
    title: t('canvas.align.menu'),
    items: [
      { label: t('canvas.align.left'), combos: [['Alt', '←']] },
      { label: t('canvas.align.right'), combos: [['Alt', '→']] },
      { label: t('canvas.align.top'), combos: [['Alt', '↑']] },
      { label: t('canvas.align.bottom'), combos: [['Alt', '↓']] },
      { label: t('canvas.align.center'), combos: [['Alt', 'H']] },
      { label: t('canvas.align.middle'), combos: [['Alt', 'V']] },
      { label: t('canvas.align.distributeH'), combos: [['Alt', 'Shift', 'H']] },
      { label: t('canvas.align.distributeV'), combos: [['Alt', 'Shift', 'V']] },
    ],
  },
  {
    id: 'view',
    title: t('视图与导航'),
    items: [
      { label: t('放大'), combos: [[mod, '+']] },
      { label: t('缩小'), combos: [[mod, '-']] },
      { label: t('适应画布'), combos: [[mod, '0']] },
      { label: t('canvas.find.title'), combos: [[mod, 'F']] },
      { label: t('canvas.find.next'), combos: [['F3']] },
      { label: t('canvas.find.prev'), combos: [['Shift', 'F3']] },
      { label: t('移动'), combos: [['V']] },
      { label: t('抓手工具'), combos: [[t('空格')]] },
      { label: t('整理画布'), combos: [['Alt', 'Shift', 'F']] },
    ],
  },
  {
    id: 'mouse',
    title: t('鼠标与手势'),
    items: [
      { label: t('按住空格拖动'), combos: [[t('空格'), t('拖动')]] },
      { label: t('滚轮平移画布'), combos: [[t('滚轮')]] },
      { label: t('滚轮缩放'), combos: [[mod, t('滚轮')]] },
      { label: t('触控板捏合缩放'), combos: [[t('捏合')]] },
      { label: t('中键拖动画布'), combos: [[t('中键')]] },
      { label: t('双击空白添加节点'), combos: [[t('双击')]] },
    ],
  },
  {
    id: 'other',
    title: t('其他'),
    items: [
      { label: t('打开快捷键'), combos: [['?']] },
      { label: t('关闭面板'), combos: [['Esc']] },
    ],
  },
])

const current = computed(() => groups.value.find(g => g.id === active.value) || groups.value[0])

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask"
      @click.self="emit('close')"
      @pointerdown.stop
      @keydown.stop="onKeydown"
    >
      <div class="canvas-shortcuts" role="dialog" aria-modal="true" aria-labelledby="canvas-shortcuts-title">
        <header class="canvas-shortcuts__head">
          <h2 id="canvas-shortcuts-title">{{ t('快捷键') }}</h2>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </header>
        <div class="canvas-shortcuts__body">
          <nav class="canvas-shortcuts__nav" :aria-label="t('快捷键')">
            <button
              v-for="group in groups"
              :key="group.id"
              type="button"
              :class="{ 'is-on': active === group.id }"
              @click="active = group.id"
            >
              {{ group.title }}
            </button>
          </nav>
          <ul class="canvas-shortcuts__list">
            <li v-for="item in current?.items" :key="item.label">
              <span>{{ item.label }}</span>
              <span class="canvas-shortcuts__keys">
                <template v-for="(combo, ci) in item.combos" :key="ci">
                  <em v-if="ci" class="canvas-shortcuts__or">/</em>
                  <span class="canvas-shortcuts__combo">
                    <template v-for="(key, ki) in combo" :key="ki">
                      <i v-if="ki">+</i>
                      <kbd>{{ key }}</kbd>
                    </template>
                  </span>
                </template>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
