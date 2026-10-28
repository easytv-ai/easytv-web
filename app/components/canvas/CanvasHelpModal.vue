<script setup lang="ts">
const { t, locale } = useI18n()

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

type HelpToken =
  | { kind: 'text', value: string }
  | { kind: 'kbd', value: string }
  | { kind: 'chip', value: string }

function localizeKeys(line: string) {
  return isMac ? line.replaceAll('Ctrl+', '⌘+') : line
}

function tokenize(line: string): HelpToken[] {
  const tokens: HelpToken[] = []
  const re = /「([^」]+)」|(Ctrl\+(?:Shift\+)?[A-Z]|⌘\+(?:Shift\+)?[A-Z])/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(line))) {
    if (match.index > last)
      tokens.push({ kind: 'text', value: line.slice(last, match.index) })
    const quoted = match[1]
    const shortcut = match[2]
    if (quoted != null) {
      tokens.push(quoted === '+'
        ? { kind: 'kbd', value: '+' }
        : { kind: 'chip', value: quoted })
    }
    else if (shortcut) {
      tokens.push({ kind: 'kbd', value: shortcut })
    }
    last = match.index + match[0].length
  }
  if (last < line.length)
    tokens.push({ kind: 'text', value: line.slice(last) })
  return tokens
}

const blocks = computed(() => [
  {
    icon: 'i-lucide-spline',
    title: t('添加与连线'),
    lines: [
      t('双击空白或点左下角「+」添加节点。'),
      t('从节点两侧圆点拖出连线，上游图片会当作下游的参考。'),
    ],
  },
  {
    icon: 'i-lucide-sparkles',
    title: t('生成'),
    lines: [
      t('选中节点，在面板里写提示词、选模型和参数，点右下角箭头提交。'),
      t('图片节点可先加「参考 / 风格 / 标记」，再生成。'),
      t('视频工具条只显示当前账号已开通的能力，没开通的不会出现。'),
    ],
  },
  {
    icon: 'i-lucide-wand-sparkles',
    title: t('图片编辑'),
    lines: [
      t('选中已有图片，用上方工具条做智能编辑、裁剪、去背、放大、三视图等。'),
      t('「画笔标记」用来圈要改的区域；「移除物体」是涂抹擦除，涂掉不想要的再生成。'),
    ],
  },
  {
    icon: 'i-lucide-palette',
    title: t('风格、宫格与引用'),
    lines: [
      t('面板里的「风格库」套运营风格；「宫格」做分镜或故事板。'),
      t('输入艾特引用画布上的节点；左下角对话栏是画布助手。'),
    ],
  },
  {
    icon: 'i-lucide-clapperboard',
    title: t('一句话成片'),
    lines: [
      t('侧栏进「一句话成片」，会拆成时间轴再生成。'),
    ],
  },
  {
    icon: 'i-lucide-graduation-cap',
    title: t('新手跟练'),
    lines: [
      t('左下角学士帽，或空画布上的「第一次来？跟练一遍」。跟练不会真的生成，退出后画布会还原。'),
      t('跟练期间画布只读：跟练替你布好每一步，你点生成看回放；退出会把画布还原。'),
    ],
  },
  {
    icon: 'i-lucide-workflow',
    title: t('工作流库'),
    lines: [
      t('左下角工作流图标，或空画布上的「从工作流库开始」。官方预设点一下就落到画布上。选中连好的节点，可以存成自己的工作流。'),
    ],
  },
  {
    icon: 'i-lucide-history',
    title: t('结果已过期'),
    lines: [
      t('上游变了，或改过模型、提示词，节点上会标「结果已过期」。点旁边的刷新，只重跑这一个节点。'),
    ],
  },
  {
    icon: 'i-lucide-box',
    title: t('3D 导演台'),
    lines: [
      t('添加「3D 导演台」节点，点「打开导演台」摆角色和机位。'),
      t('视口里点「截图」，再点「截图送回画布」，图片会出现在节点旁边。'),
      t('canvas.director.preview.help'),
      t('canvas.director.export.help'),
      t('canvas.director.preview.controlHint'),
    ],
  },
  {
    icon: 'i-lucide-layers',
    title: t('canvas.help.composeTitle'),
    lines: [
      t('canvas.help.compose'),
      t('canvas.help.audio'),
    ],
  },
  {
    icon: 'i-lucide-share-2',
    title: t('保存与分享'),
    lines: [
      t('Ctrl+S 保存。右上角「更多」可导出、导入、存为 Skill；「分享」可生成只读链接。'),
      t('canvas.help.shortcuts'),
    ],
  },
])

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
      <div
        class="canvas-help"
        :lang="locale"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-help-title"
      >
        <header class="canvas-help__head">
          <div class="canvas-help__title">
            <span class="canvas-help__mark" aria-hidden="true">
              <UIcon name="i-lucide-circle-help" class="size-5" />
            </span>
            <div>
              <h2 id="canvas-help-title">{{ t('画布帮助') }}</h2>
              <p>{{ t('常用操作，做完就能出片') }}</p>
            </div>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </header>
        <div class="canvas-help__body">
          <article v-for="item in blocks" :key="item.title" class="canvas-help__card">
            <div class="canvas-help__icon" aria-hidden="true">
              <UIcon :name="item.icon" class="size-4" />
            </div>
            <div class="canvas-help__copy">
              <h3>{{ item.title }}</h3>
              <p v-for="(line, index) in item.lines" :key="index">
                <template v-for="(token, tokenIndex) in tokenize(localizeKeys(line))" :key="tokenIndex">
                  <kbd v-if="token.kind === 'kbd'">{{ token.value }}</kbd>
                  <em v-else-if="token.kind === 'chip'">{{ token.value }}</em>
                  <template v-else>{{ token.value }}</template>
                </template>
              </p>
            </div>
          </article>
        </div>
      </div>
    </div>
  </Teleport>
</template>
