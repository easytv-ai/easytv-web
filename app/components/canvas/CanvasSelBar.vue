<script setup lang="ts">
import type { GenerationModel, MediaAction } from '~/types/creative'
import type { CanvasGroupLayout } from '~/utils/canvas-group'
import { GROUP_COLORS, GROUP_LAYOUTS } from '~/utils/canvas-group'
import { pickCanvasImageEditModel, pickImageUpscaleModel, pickVisionTextModel } from '~/utils/image-input'
import { effectiveUnitPrice, estimateTaskPoints } from '~/utils/model-price'
import { mediaBarItemState } from '~/utils/canvas-media-job'

const { t } = useI18n()
const { isMember } = useWallet()         
const generationModels = useState<GenerationModel[]>('generation-models', () => [])
/** 媒体工具清单（GET /user/media/actions，工作区打开画布时拉一次）：视频工具项按 available 决定能不能点 */
const mediaActions = useState<MediaAction[]>('media-actions', () => [])
const { growth: growthConfig } = useStudioAppConfig()

function videoItemState(id: string) {
  return mediaBarItemState(mediaActions.value, id)
}

/** 和 runPromptReverse 同一套挑模，工具条上的积分跟实扣一致 */
const reverseCost = computed(() => {
  const modelId = pickVisionTextModel(generationModels.value, growthConfig.value?.vision_text_model)
  const model = generationModels.value.find(item => item.model === modelId)
  if (!model)
    return ''
  if (!model.priced)
    return t('未定价')
  return estimateTaskPoints(effectiveUnitPrice(model, isMember.value), model.unit, 1)
})

/** 和 imageEditModel / runThreeView / runRemoveBg 同一套图片编辑模型 */
function imageEditModel() {
  const modelId = pickCanvasImageEditModel(generationModels.value)
  return generationModels.value.find(item => item.model === modelId)
}

const imageEditCost = computed(() => {
  const model = imageEditModel()
  if (!model)
    return ''
  if (!model.priced)
    return t('未定价')
  return estimateTaskPoints(effectiveUnitPrice(model, isMember.value), model.unit, 1)
})

/** 和 runUpscale 同一个模型。按张计费，2x / 4x 都是这一张的单价 */
function upscaleCost(_scale: 2 | 4) {
  const modelId = pickImageUpscaleModel(generationModels.value, '')
  const model = generationModels.value.find(item => item.model === modelId)
  if (!model)
    return ''
  if (!model.priced)
    return t('未定价')
  return estimateTaskPoints(effectiveUnitPrice(model, isMember.value), model.unit, 1)
}

const props = withDefaults(defineProps<{
  mode: 'pick' | 'group' | 'text' | 'image' | 'video' | 'audio'
  left: number
  top: number
  width: number
  height: number
  color?: string
  layout?: CanvasGroupLayout
  collapsed?: boolean
  showBox?: boolean
  /** 文本节点当前字号，用于到顶/到底时灰掉放大缩小 */
  fontSize?: number
  /** 多选的都是带图的图片节点（2~25 张）时才露出「合成分镜组」 */
  montageReady?: boolean
  /** 多选的都是已出片的视频节点（2~24 段）时才露出「合成一条」 */
  composeReady?: boolean
  /** 选中的组是分镜组时的列数（0 = 普通组），列数控件替代排序下拉 */
  storyboardCols?: number
  /** 分镜组里子节点数：列数上限 */
  storyboardMax?: number
  /** 当前选中组 / 节点已锁定 */
  locked?: boolean
}>(), {
  color: '#ececee',
  layout: 'grid',
  collapsed: false,
  showBox: false,
  fontSize: 16,
  montageReady: false,
  composeReady: false,
  storyboardCols: 0,
  storyboardMax: 1,
  locked: false,
})

/** 与 Workspace scaleTextNode 同一上下限 */
const TEXT_FONT_MIN = 10
const TEXT_FONT_MAX = 48

const shrinkDisabled = computed(() => (props.fontSize || 16) <= TEXT_FONT_MIN)
const growDisabled = computed(() => (props.fontSize || 16) >= TEXT_FONT_MAX)

const emit = defineEmits<{
  action: [name: string]
  color: [value: string]
  layout: [value: CanvasGroupLayout]
  /** 分镜组改列数 / 转普通组 */
  storyboardCols: [cols: number]
  storyboardOff: []
  /** 点了清单里不可用的视频工具：把后端 reason 抛给工作区 toast */
  unavailable: [name: string, reason: string]
}>()

const ALIGN_ITEMS = [
  { id: 'align-left', label: 'canvas.align.left', icon: 'i-lucide-align-start-vertical' },
  { id: 'align-center', label: 'canvas.align.center', icon: 'i-lucide-align-center-vertical' },
  { id: 'align-right', label: 'canvas.align.right', icon: 'i-lucide-align-end-vertical' },
  { id: 'align-top', label: 'canvas.align.top', icon: 'i-lucide-align-start-horizontal' },
  { id: 'align-middle', label: 'canvas.align.middle', icon: 'i-lucide-align-center-horizontal' },
  { id: 'align-bottom', label: 'canvas.align.bottom', icon: 'i-lucide-align-end-horizontal' },
  { id: 'distribute-h', label: 'canvas.align.distributeH', icon: 'i-lucide-align-horizontal-space-between' },
  { id: 'distribute-v', label: 'canvas.align.distributeV', icon: 'i-lucide-align-vertical-space-between' },
] as const

const colorOpen = ref(false)
const layoutOpen = ref(false)
const alignOpen = ref(false)
const viewsOpen = ref(false)
const editOpen = ref(false)
const bgOpen = ref(false)
const upscaleOpen = ref(false)
const videoMenuOpen = ref('')

/** 视频工具条：常驻按钮 + 「编辑」下拉 + 下载 */
const VIDEO_ITEMS = [
  { id: 'viral-remake', label: '爆款复刻', icon: 'i-lucide-flame' },
  { id: 'hd', label: '视频高清', icon: 'i-lucide-scan-search' },
  { id: 'add-bgm', label: 'canvas.audio.sel', icon: 'i-lucide-music' },
  { id: 'depth', label: '深度提取', icon: 'i-lucide-layers-2' },
  { id: 'retake', label: '片段重拍', icon: 'i-lucide-clapperboard' },
  { id: 'smart-extend', label: '智能续写', icon: 'i-lucide-git-branch-plus' },
] as const

/** 「编辑」下拉：低频的视频工具 */
const VIDEO_EDIT_ITEMS = [
  { id: 'clip-cut', label: '片段裁剪', icon: 'i-lucide-scissors' },
  { id: 'video-split', label: '视频分割', icon: 'i-lucide-columns-2' },
  { id: 'remove-subtitles', label: '字幕擦除', icon: 'i-lucide-captions-off' },
  { id: 'prompt-reverse', label: '反推提示词', icon: 'i-lucide-sparkles' },
  { id: 'separate', label: '分离音频', icon: 'i-lucide-audio-lines' },
  { id: 'transcribe', label: '语音转字幕', icon: 'i-lucide-captions' },
  { id: 'remove-silence', label: '去停顿', icon: 'i-lucide-scissors-line-dashed' },
] as const

/** 音频工具条里的媒体动作（语音转字幕 / 去停顿），可用性同视频工具项 */
const AUDIO_MEDIA_ITEMS = [
  { id: 'transcribe', label: '语音转字幕', icon: 'i-lucide-captions' },
  { id: 'remove-silence', label: '去停顿', icon: 'i-lucide-scissors-line-dashed' },
] as const

/** 清单拉到后，未开通的媒体动作从工具条拿掉，避免点了只看到「暂未开放」 */
const visibleVideoItems = computed(() => VIDEO_ITEMS.filter(item => videoItemState(item.id).available))
const visibleVideoEditItems = computed(() => VIDEO_EDIT_ITEMS.filter(item => videoItemState(item.id).available))
const visibleAudioMediaItems = computed(() => AUDIO_MEDIA_ITEMS.filter(item => videoItemState(item.id).available))

const TEXT_BG_COLORS = ['#ffffff', ...GROUP_COLORS]

const IMAGE_VIEWS = [
  { id: 'view-char', label: '角色三视图', icon: 'i-lucide-user' },
  { id: 'view-face', label: '脸部三视图', icon: 'i-lucide-smile' },
  { id: 'view-prop', label: '道具三视图', icon: 'i-lucide-box' },
] as const

const IMAGE_BG = [
  { id: 'bg-object', label: '保留物品', icon: 'i-lucide-cone' },
  { id: 'bg-person', label: '保留人物', icon: 'i-lucide-sparkles' },
] as const

const IMAGE_EDITS = [
  { id: 'upscale', label: '图片高清', icon: 'i-lucide-scan-search', hd: true, more: true },
  { id: 'crop', label: '裁剪', icon: 'i-lucide-crop' },
  { id: 'grid-split', label: '宫格切分', icon: 'i-lucide-grid-3x3' },
  { id: 'flip', label: '旋转与镜像', icon: 'i-lucide-flip-horizontal-2' },
  { id: 'brush', label: '画笔标记', icon: 'i-lucide-pen-line' },
  { id: 'bg', label: '去除背景', icon: 'i-lucide-image', more: true },
  { id: 'outpaint', label: 'AI图像扩展', icon: 'i-lucide-expand' },
  { id: 'inpaint', label: '移除物体', icon: 'i-lucide-eraser' },
  { id: 'multiview', label: '多视角', icon: 'i-lucide-boxes' },
] as const

const visibleImageEdits = computed(() => IMAGE_EDITS.filter(item => videoItemState(item.id).available))

watch(() => [props.mode, props.left, props.top], () => {
  cancelHoverClose()
  colorOpen.value = false
  layoutOpen.value = false
  alignOpen.value = false
  viewsOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  videoEditOpen.value = false
})

function onColor(value: string) {
  colorOpen.value = false
  emit('color', value)
}

function onLayout(value: CanvasGroupLayout) {
  layoutOpen.value = false
  emit('layout', value)
}

function toggleColor() {
  layoutOpen.value = false
  alignOpen.value = false
  viewsOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  colorOpen.value = !colorOpen.value
}

function toggleLayout() {
  colorOpen.value = false
  alignOpen.value = false
  viewsOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  layoutOpen.value = !layoutOpen.value
}

function toggleAlign() {
  colorOpen.value = false
  layoutOpen.value = false
  viewsOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  alignOpen.value = !alignOpen.value
}

function onAlign(id: typeof ALIGN_ITEMS[number]['id']) {
  alignOpen.value = false
  emit('action', id)
}

function hoverOpensMenu() {
  return typeof window !== 'undefined'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelHoverClose() {
  if (!hoverCloseTimer)
    return
  clearTimeout(hoverCloseTimer)
  hoverCloseTimer = null
}

function closeHoverMenus() {
  cancelHoverClose()
  viewsOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  videoEditOpen.value = false
}

function openViewsMenu() {
  cancelHoverClose()
  colorOpen.value = false
  layoutOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  viewsOpen.value = true
}

function openEditMenu() {
  cancelHoverClose()
  colorOpen.value = false
  layoutOpen.value = false
  viewsOpen.value = false
  videoMenuOpen.value = ''
  editOpen.value = true
}

function onMenuEnter(open: () => void, e: PointerEvent) {
  if (e.pointerType !== 'mouse')
    return
  open()
}

function onMenuLeave(e: PointerEvent) {
  if (e.pointerType !== 'mouse')
    return
  cancelHoverClose()
  // 按钮→菜单之间有条 8px 死区，慢移（或弹层桥失效）时要在里面熬过一段时间，留足宽限
  hoverCloseTimer = setTimeout(() => {
    hoverCloseTimer = null
    closeHoverMenus()
  }, 300)
}

function toggleHoverMenu(isOpen: boolean, open: () => void) {
  if (hoverOpensMenu()) {
    open()
    return
  }
  if (isOpen)
    closeHoverMenus()
  else
    open()
}

onUnmounted(cancelHoverClose)

function toggleViews() {
  toggleHoverMenu(viewsOpen.value, openViewsMenu)
}

function toggleEdit() {
  toggleHoverMenu(editOpen.value, openEditMenu)
}

function onVideoMenuItem(id: string) {
  const state = videoItemState(id)
  if (!state.available) {
    emit('unavailable', id, state.reason)
    return
  }
  videoMenuOpen.value = ''
  emit('action', id)
}

function onEditItem(id: string) {
  if (id === 'bg') {
    upscaleOpen.value = false
    bgOpen.value = !bgOpen.value
    return
  }
  if (id === 'upscale') {
    bgOpen.value = false
    upscaleOpen.value = !upscaleOpen.value
    return
  }
  bgOpen.value = false
  upscaleOpen.value = false
  editOpen.value = false
  emit('action', id)
}

function onBgItem(id: string) {
  bgOpen.value = false
  upscaleOpen.value = false
  editOpen.value = false
  emit('action', id)
}

function onUpscaleItem(scale: 2 | 4) {
  bgOpen.value = false
  upscaleOpen.value = false
  editOpen.value = false
  emit('action', `upscale-${scale}x`)
}

/** 视频条「编辑」下拉的展开状态（与图片条编辑菜单同一套 hover 习惯） */
const videoEditOpen = ref(false)
/** 任一向下展开的菜单都要抬到生成条上面，否则下半截会被检查器挡住 */
const menuOpen = computed(() => Boolean(
  colorOpen.value || layoutOpen.value || alignOpen.value || viewsOpen.value || editOpen.value
  || bgOpen.value || upscaleOpen.value || videoMenuOpen.value || videoEditOpen.value,
))

function openVideoEditMenu() {
  cancelHoverClose()
  colorOpen.value = false
  layoutOpen.value = false
  viewsOpen.value = false
  editOpen.value = false
  bgOpen.value = false
  upscaleOpen.value = false
  videoMenuOpen.value = ''
  videoEditOpen.value = true
}

function toggleVideoEdit() {
  toggleHoverMenu(videoEditOpen.value, openVideoEditMenu)
}
</script>

<template>
  <div
    class="canvas-sel-layer"
    :class="{ 'is-menu': menuOpen }"
    :style="{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }"
  >
    <div v-if="showBox" class="canvas-sel-layer__box" />
    <div
      class="canvas-selbar"
      :class="{ 'is-text': mode === 'text', 'is-image': mode === 'image', 'is-write-blocked': locked }"
      @pointerdown.stop
      @dblclick.stop
    >
    <template v-if="mode === 'pick'">
      <button type="button" @click="emit('action', 'group')">
        <UIcon name="i-lucide-scan" class="size-4" />
        {{ t('打组') }}
      </button>
      <button type="button" @click="emit('action', 'save-workflow')">
        <UIcon name="i-lucide-workflow" class="size-4" />
        {{ t('存为工作流') }}
      </button>
      <button v-if="montageReady" type="button" @click="emit('action', 'montage')">
        <UIcon name="i-lucide-layout-grid" class="size-4" />
        {{ t('合成分镜组') }}
      </button>
      <button v-if="composeReady" type="button" @click="emit('action', 'compose')">
        <UIcon name="i-lucide-clapperboard" class="size-4" />
        {{ t('canvas.compose.title') }}
      </button>
      <div class="canvas-selbar__color-wrap">
        <button type="button" :class="{ 'is-on': layoutOpen }" @click="toggleLayout">
          <UIcon name="i-lucide-layout-grid" class="size-4" />
          {{ t('排序') }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-selbar__chev" />
        </button>
        <div v-if="layoutOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--down">
          <button
            v-for="item in GROUP_LAYOUTS"
            :key="item.id"
            type="button"
            :class="{ 'is-on': layout === item.id }"
            @click="onLayout(item.id)"
          >
            {{ t(item.label) }}
          </button>
        </div>
      </div>
      <div class="canvas-selbar__color-wrap">
        <button type="button" :class="{ 'is-on': alignOpen }" @click="toggleAlign">
          <UIcon name="i-lucide-align-horizontal-space-around" class="size-4" />
          {{ t('canvas.align.menu') }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-selbar__chev" />
        </button>
        <div v-if="alignOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--down">
          <button
            v-for="item in ALIGN_ITEMS"
            :key="item.id"
            type="button"
            @click="onAlign(item.id)"
          >
            <UIcon :name="item.icon" class="size-4" />
            {{ t(item.label) }}
          </button>
        </div>
      </div>
      <button type="button" data-keep class="canvas-selbar__icon" :aria-label="t('下载')" @click="emit('action', 'download')">
        <UIcon name="i-lucide-download" class="size-4" />
        <span class="canvas-tip canvas-tip--up">{{ t('下载') }}</span>
      </button>
    </template>

    <template v-else-if="mode === 'text'">
      <div class="canvas-selbar__color-wrap">
        <button
          type="button"
          class="canvas-selbar__swatch"
          :style="{ background: color }"
          :aria-label="t('背景色')"
          @click="toggleColor"
        >
          <span class="canvas-tip canvas-tip--up">{{ t('背景色') }}</span>
        </button>
        <div v-if="colorOpen" class="canvas-selbar__pop">
          <button
            v-for="item in TEXT_BG_COLORS"
            :key="item"
            type="button"
            class="canvas-selbar__chip"
            :class="{ 'is-on': color === item }"
            :style="{ background: item }"
            @click="onColor(item)"
          />
          <label class="canvas-selbar__picker">
            <input type="color" :value="color" @input="onColor(($event.target as HTMLInputElement).value)">
          </label>
        </div>
      </div>
      <button type="button" :aria-label="t('编辑')" @click="emit('action', 'expand')">
        <UIcon name="i-lucide-pen-line" class="size-4" />
        <span class="canvas-tip canvas-tip--up">{{ t('编辑') }}</span>
      </button>
      <span class="canvas-selbar__div" />
      <button
        type="button"
        class="canvas-selbar__font"
        :aria-label="t('缩小')"
        :disabled="shrinkDisabled"
        :class="{ 'is-disabled': shrinkDisabled }"
        @click="emit('action', 'shrink')"
      >
        <span class="canvas-selbar__font-ico" aria-hidden="true">
          <em>A</em>
          <i class="is-down" />
        </span>
        <span class="canvas-tip canvas-tip--up">{{ t('缩小') }}</span>
      </button>
      <button
        type="button"
        class="canvas-selbar__font"
        :aria-label="t('放大')"
        :disabled="growDisabled"
        :class="{ 'is-disabled': growDisabled }"
        @click="emit('action', 'grow')"
      >
        <span class="canvas-selbar__font-ico" aria-hidden="true">
          <em>A</em>
          <i class="is-up" />
        </span>
        <span class="canvas-tip canvas-tip--up">{{ t('放大') }}</span>
      </button>
      <span class="canvas-selbar__div" />
      <button type="button" data-keep :aria-label="t('下载')" @click="emit('action', 'download')">
        <UIcon name="i-lucide-download" class="size-4" />
        <span class="canvas-tip canvas-tip--up">{{ t('下载') }}</span>
      </button>
    </template>

    <template v-else-if="mode === 'image'">
      <button type="button" @click="emit('action', 'smart-edit')">
        <UIcon name="i-lucide-wand-sparkles" class="size-4" />
        {{ t('智能编辑') }}
      </button>
      <span class="canvas-selbar__div" />
      <button type="button" @click="emit('action', 'prompt-reverse')">
        <UIcon name="i-lucide-file-text" class="size-4" />
        {{ t('反推提示词') }}
        <i v-if="reverseCost !== ''" class="canvas-selbar__zap">
          <UIcon name="i-lucide-zap" class="size-3.5" />
          {{ reverseCost }}
        </i>
      </button>
      <span class="canvas-selbar__div" />
      <div
        class="canvas-selbar__color-wrap"
        @pointerenter="onMenuEnter(openViewsMenu, $event)"
        @pointerleave="onMenuLeave"
      >
        <button type="button" :class="{ 'is-on': viewsOpen }" @click="toggleViews">
          <UIcon name="i-lucide-box" class="size-4" />
          {{ t('三视图') }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-selbar__chev" />
        </button>
        <div v-if="viewsOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--menu canvas-selbar__pop--down">
          <button
            v-for="item in IMAGE_VIEWS"
            :key="item.id"
            type="button"
            @click="viewsOpen = false; emit('action', item.id)"
          >
            <UIcon :name="item.icon" class="size-4" />
            <span>{{ t(item.label) }}</span>
            <i v-if="imageEditCost !== ''" class="canvas-selbar__cost">
              <UIcon name="i-lucide-zap" class="size-3.5" />
              {{ imageEditCost }}
            </i>
          </button>
        </div>
        <!-- 按钮→菜单之间有 8px 死区：真实元素桥接（内联样式，不吃样式表热更新的亏），悬停经过不触发 pointerleave -->
        <span v-if="viewsOpen" aria-hidden="true" style="position: absolute; left: 0; top: 100%; width: 220px; height: 12px;" />
      </div>
      <span class="canvas-selbar__div" />
      <button type="button" class="canvas-selbar__lit" @click="emit('action', 'light')">
        <UIcon name="i-lucide-sun" class="size-4" />
        {{ t('打光') }}
        <span class="canvas-selbar__dot" />
      </button>
      <template v-if="videoItemState('depth').available">
        <span class="canvas-selbar__div" />
        <button type="button" @click="emit('action', 'depth')">
          <UIcon name="i-lucide-layers" class="size-4" />
          {{ t('深度提取') }}
        </button>
      </template>
      <span class="canvas-selbar__div" />
      <div
        class="canvas-selbar__color-wrap"
        @pointerenter="onMenuEnter(openEditMenu, $event)"
        @pointerleave="onMenuLeave"
      >
        <button type="button" :class="{ 'is-on': editOpen }" @click="toggleEdit">
          <UIcon name="i-lucide-pen-line" class="size-4" />
          {{ t('编辑') }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-selbar__chev" />
        </button>
        <div v-if="editOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--menu canvas-selbar__pop--down">
          <template v-for="item in visibleImageEdits" :key="item.id">
            <div
              v-if="item.id === 'bg'"
              class="canvas-selbar__fly"
              @pointerenter="bgOpen = true; upscaleOpen = false"
              @pointerleave="bgOpen = false"
            >
              <button type="button" :class="{ 'is-on': bgOpen }" @click="onEditItem(item.id)">
                <UIcon :name="item.icon" class="size-4" />
                <span>{{ t(item.label) }}</span>
                <UIcon name="i-lucide-chevron-right" class="size-3.5 canvas-selbar__chev" />
              </button>
              <div v-if="bgOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--menu canvas-selbar__pop--fly">
                <button
                  v-for="sub in IMAGE_BG"
                  :key="sub.id"
                  type="button"
                  @click="onBgItem(sub.id)"
                >
                  <UIcon :name="sub.icon" class="size-4" />
                  <span>{{ t(sub.label) }}</span>
                  <i v-if="imageEditCost !== ''" class="canvas-selbar__cost">
                    <UIcon name="i-lucide-zap" class="size-3.5" />
                    {{ imageEditCost }}
                  </i>
                </button>
              </div>
            </div>
            <div
              v-else-if="item.id === 'upscale'"
              class="canvas-selbar__fly"
              @pointerenter="upscaleOpen = true; bgOpen = false"
              @pointerleave="upscaleOpen = false"
            >
              <button type="button" :class="{ 'is-on': upscaleOpen }" @click="onEditItem(item.id)">
                <UIcon :name="item.icon" class="size-4" />
                <span class="canvas-selbar__label">
                  {{ t(item.label) }}
                  <i class="canvas-selbar__hd">HD</i>
                </span>
                <UIcon name="i-lucide-chevron-right" class="size-3.5 canvas-selbar__chev" />
              </button>
              <div v-if="upscaleOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--menu canvas-selbar__pop--fly">
                <button
                  v-for="scale in [2, 4] as const"
                  :key="scale"
                  type="button"
                  @click="onUpscaleItem(scale)"
                >
                  <span class="canvas-selbar__label">
                    <i class="canvas-selbar__hd">HD</i>
                    {{ scale }}x
                  </span>
                  <i v-if="upscaleCost(scale) !== ''" class="canvas-selbar__cost">
                    <UIcon name="i-lucide-zap" class="size-3.5" />
                    {{ upscaleCost(scale) }}
                  </i>
                </button>
              </div>
            </div>
            <button
              v-else
              type="button"
              @click="onEditItem(item.id)"
            >
              <UIcon :name="item.icon" class="size-4" />
              <span>{{ t(item.label) }}</span>
              <em v-if="'hd' in item && item.hd" class="canvas-selbar__hd">HD</em>
              <UIcon v-if="'more' in item && item.more" name="i-lucide-chevron-right" class="size-3.5 canvas-selbar__chev" />
            </button>
          </template>
        </div>
        <!-- 同上：按钮→菜单死区的真实元素桥 -->
        <span v-if="editOpen" aria-hidden="true" style="position: absolute; left: 0; top: 100%; width: 220px; height: 12px;" />
      </div>
    </template>

    <template v-else-if="mode === 'video'">
      <template v-for="(item, index) in visibleVideoItems" :key="item.id">
        <span v-if="index" class="canvas-selbar__div" />
        <button
          type="button"
          @click="onVideoMenuItem(item.id)"
        >
          <UIcon :name="item.icon" class="size-4" />
          {{ t(item.label) }}
        </button>
      </template>
      <span v-if="visibleVideoItems.length && visibleVideoEditItems.length" class="canvas-selbar__div" />
      <div
        v-if="visibleVideoEditItems.length"
        class="canvas-selbar__color-wrap"
        @pointerenter="onMenuEnter(openVideoEditMenu, $event)"
        @pointerleave="onMenuLeave"
      >
        <button type="button" :class="{ 'is-on': videoEditOpen }" @click="toggleVideoEdit">
          <UIcon name="i-lucide-pen-line" class="size-4" />
          {{ t('编辑') }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-selbar__chev" />
        </button>
        <div v-if="videoEditOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--menu canvas-selbar__pop--down">
          <button
            v-for="item in visibleVideoEditItems"
            :key="item.id"
            type="button"
            @click="onVideoMenuItem(item.id)"
          >
            <UIcon :name="item.icon" class="size-4" />
            <span>{{ t(item.label) }}</span>
            <i v-if="item.id === 'prompt-reverse' && reverseCost !== ''" class="canvas-selbar__cost">
              <UIcon name="i-lucide-zap" class="size-3.5" />
              {{ reverseCost }}
            </i>
          </button>
        </div>
        <!-- 同上：按钮→菜单死区的真实元素桥 -->
        <span v-if="videoEditOpen" aria-hidden="true" style="position: absolute; left: 0; top: 100%; width: 220px; height: 12px;" />
      </div>
      <span v-if="visibleVideoItems.length || visibleVideoEditItems.length" class="canvas-selbar__div" />
      <button type="button" data-keep class="canvas-selbar__icon" :aria-label="t('下载')" @click="emit('action', 'download')">
        <UIcon name="i-lucide-download" class="size-4" />
        <span class="canvas-tip canvas-tip--up">{{ t('下载') }}</span>
      </button>
    </template>

    <template v-else-if="mode === 'audio'">
      <button
        v-for="item in visibleAudioMediaItems"
        :key="item.id"
        type="button"
        @click="onVideoMenuItem(item.id)"
      >
        <UIcon :name="item.icon" class="size-4" />
        {{ t(item.label) }}
      </button>
      <button type="button" data-keep @click="emit('action', 'download')">
        <UIcon name="i-lucide-download" class="size-4" />
        {{ t('下载') }}
      </button>
      <button type="button" @click="emit('action', 'regen')">
        <UIcon name="i-lucide-rotate-ccw" class="size-4" />
        {{ t('重新生成') }}
      </button>
    </template>

    <template v-else-if="mode === 'group'">
      <div class="canvas-selbar__color-wrap">
        <button
          type="button"
          class="canvas-selbar__swatch"
          :style="{ background: color }"
          :aria-label="t('背景色')"
          :disabled="locked"
          @click="toggleColor"
        >
          <span class="canvas-tip canvas-tip--up">{{ t('背景色') }}</span>
        </button>
        <div v-if="colorOpen" class="canvas-selbar__pop canvas-selbar__pop--down">
          <button
            v-for="item in GROUP_COLORS"
            :key="item"
            type="button"
            class="canvas-selbar__chip"
            :class="{ 'is-on': color === item }"
            :style="{ background: item }"
            @click="onColor(item)"
          />
          <label class="canvas-selbar__picker">
            <input type="color" :value="color" @input="onColor(($event.target as HTMLInputElement).value)">
          </label>
        </div>
      </div>
      <button v-if="!collapsed" type="button" :disabled="locked" @click="emit('action', 'ungroup')">
        <UIcon name="i-lucide-ungroup" class="size-4" />
        {{ t('解组') }}
      </button>
      <button v-if="!collapsed" type="button" :disabled="locked" @click="emit('action', 'save-workflow')">
        <UIcon name="i-lucide-workflow" class="size-4" />
        {{ t('存为工作流') }}
      </button>
      <button
        type="button"
        data-keep
        :class="{ 'is-on': locked }"
        :aria-label="locked ? t('canvas.lock.unlock') : t('canvas.lock.lock')"
        @click="emit('action', 'lock')"
      >
        <UIcon :name="locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" class="size-4" />
        {{ locked ? t('canvas.lock.unlock') : t('canvas.lock.lock') }}
        <span class="canvas-tip canvas-tip--up">{{ t('canvas.lock.hint') }}</span>
      </button>
      <button type="button" :disabled="locked" @click="emit('action', 'collapse')">
        <UIcon :name="collapsed ? 'i-lucide-maximize-2' : 'i-lucide-chevrons-down-up'" class="size-4" />
        {{ collapsed ? t('展开') : t('收起') }}
      </button>
      <template v-if="!collapsed && storyboardCols > 0">
        <span class="canvas-selbar__cols">
          <UIcon name="i-lucide-layout-grid" class="size-4" />
          {{ t('分镜组 · {cols} 列', { cols: storyboardCols }) }}
          <button type="button" :aria-label="t('减少列数')" :disabled="locked || storyboardCols <= 1" @click="emit('storyboardCols', storyboardCols - 1)">−</button>
          <button type="button" :aria-label="t('增加列数')" :disabled="locked || storyboardCols >= storyboardMax" @click="emit('storyboardCols', storyboardCols + 1)">+</button>
        </span>
        <button type="button" :disabled="locked" @click="emit('storyboardOff')">
          <UIcon name="i-lucide-group" class="size-4" />
          {{ t('转普通组') }}
        </button>
      </template>
      <div v-else-if="!collapsed" class="canvas-selbar__color-wrap">
        <button type="button" :class="{ 'is-on': layoutOpen }" :disabled="locked" @click="toggleLayout">
          <UIcon name="i-lucide-layout-grid" class="size-4" />
          {{ t('排序') }}
          <UIcon name="i-lucide-chevron-down" class="size-3.5 canvas-selbar__chev" />
        </button>
        <div v-if="layoutOpen" class="canvas-selbar__pop canvas-selbar__pop--list canvas-selbar__pop--down">
          <button
            v-for="item in GROUP_LAYOUTS"
            :key="item.id"
            type="button"
            :class="{ 'is-on': layout === item.id }"
            @click="onLayout(item.id)"
          >
            {{ t(item.label) }}
          </button>
        </div>
      </div>
      <button type="button" data-keep class="canvas-selbar__icon" :aria-label="t('下载')" @click="emit('action', 'download')">
        <UIcon name="i-lucide-download" class="size-4" />
        <span class="canvas-tip canvas-tip--up">{{ t('下载') }}</span>
      </button>
    </template>
    </div>
  </div>
</template>
