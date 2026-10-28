<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  x: number
  y: number
  isMac?: boolean
  /** 选中的是带视频资产的节点时可发布为作品 */
  canPublish?: boolean
  /** 已完成的视频节点可重拍 / 续写 / 超分（API.md 10.3） */
  canRetake?: boolean
  canExtend?: boolean
  canUpscale?: boolean
  /** 批量出图分到同一组里的节点，可以挑一张当组封面 */
  canSetCover?: boolean
  /** 已经出图的全景节点可以进球面预览 */
  canViewPano?: boolean
  /** 导演台节点右键只留删除 */
  deleteOnly?: boolean
  /** 选区里的节点都已锁定：复制 / 副本 / 删除灰掉，菜单改成解锁 */
  locked?: boolean
  /** 媒体工具清单里「片段重拍」不可用时的原因（API.md 23.4 reason）：按钮灰掉并用它做 title */
  retakeReason?: string
}>(), {
  isMac: false,
  canPublish: false,
  canRetake: false,
  canExtend: false,
  canUpscale: false,
  canSetCover: false,
  canViewPano: false,
  deleteOnly: false,
  locked: false,
  retakeReason: '',
})

const emit = defineEmits<{
  copy: []
  duplicate: []
  remove: []
  publish: []
  retake: []
  extend: []
  upscale: []
  'set-cover': []
  'view-pano': []
  /** 给这个节点写批注（API.md 15） */
  comment: []
  /** 围绕这个节点问画布助手（API.md 16） */
  assist: []
  /** 锁定 / 解锁当前选中节点 */
  lock: []
  /** 点了不可用的媒体工具项，把原因抛出去 toast */
  unavailable: [name: string, reason: string]
}>()

function onRetake() {
  if (props.retakeReason) {
    emit('unavailable', 'retake', props.retakeReason)
    return
  }
  emit('retake')
}

const hasVideoOps = computed(() => props.canRetake || props.canExtend || props.canUpscale)

const cmd = computed(() => props.isMac ? '⌘' : 'Ctrl+')
</script>

<template>
  <div
    class="canvas-ctx nodrag nopan"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @pointerdown.stop
    @dblclick.stop
    @contextmenu.prevent
  >
    <template v-if="!deleteOnly">
    <button
      type="button"
      :class="{ 'is-disabled': locked }"
      :disabled="locked"
      :aria-disabled="locked"
      :title="locked ? t('canvas.lock.hint') : undefined"
      @click="emit('copy')"
    >
      <span>
        <UIcon name="i-lucide-copy" class="size-4" />
        {{ t('复制节点') }}
      </span>
      <kbd>{{ cmd }}C</kbd>
    </button>
    <button
      type="button"
      :class="{ 'is-disabled': locked }"
      :disabled="locked"
      :aria-disabled="locked"
      :title="locked ? t('canvas.lock.hint') : undefined"
      @click="emit('duplicate')"
    >
      <span>
        <UIcon name="i-lucide-copy-plus" class="size-4" />
        {{ t('创建副本') }}
      </span>
      <kbd>{{ cmd }}D</kbd>
    </button>
    <button type="button" @click="emit('assist')">
      <span>
        <UIcon name="i-lucide-sparkles" class="size-4" />
        {{ t('问助手') }}
      </span>
    </button>
    <button type="button" @click="emit('comment')">
      <span>
        <UIcon name="i-lucide-message-square-text" class="size-4" />
        {{ t('批注') }}
      </span>
    </button>
    <button v-if="canViewPano" type="button" @click="emit('view-pano')">
      <span>
        <UIcon name="i-lucide-globe" class="size-4" />
        {{ t('全景预览') }}
      </span>
    </button>
    <button v-if="canSetCover" type="button" @click="emit('set-cover')">
      <span>
        <UIcon name="i-lucide-image-up" class="size-4" />
        {{ t('设为组封面') }}
      </span>
    </button>
    <i v-if="hasVideoOps" class="canvas-ctx__line" />
    <button
      v-if="canRetake"
      type="button"
      :class="{ 'is-disabled': Boolean(retakeReason) }"
      :aria-disabled="Boolean(retakeReason)"
      :title="retakeReason || undefined"
      @click="onRetake"
    >
      <span>
        <UIcon name="i-lucide-rotate-ccw" class="size-4" />
        {{ t('重拍此段') }}
      </span>
    </button>
    <button v-if="canExtend" type="button" @click="emit('extend')">
      <span>
        <UIcon name="i-lucide-git-branch-plus" class="size-4" />
        {{ t('续写') }}
      </span>
    </button>
    <button v-if="canUpscale" type="button" @click="emit('upscale')">
      <span>
        <UIcon name="i-lucide-scan-search" class="size-4" />
        {{ t('超分') }}
      </span>
    </button>
    <i v-if="hasVideoOps" class="canvas-ctx__line" />
    <button v-if="canPublish" type="button" @click="emit('publish')">
      <span>
        <UIcon name="i-lucide-send" class="size-4" />
        {{ t('发布为作品') }}
      </span>
    </button>
    <i class="canvas-ctx__line" />
    <button type="button" :title="t('canvas.lock.hint')" @click="emit('lock')">
      <span>
        <UIcon :name="locked ? 'i-lucide-lock-open' : 'i-lucide-lock'" class="size-4" />
        {{ locked ? t('canvas.lock.unlock') : t('canvas.lock.lock') }}
      </span>
      <kbd>{{ cmd }}⇧L</kbd>
    </button>
    </template>
    <button
      type="button"
      class="is-danger"
      :class="{ 'is-disabled': locked }"
      :disabled="locked"
      :aria-disabled="locked"
      :title="locked ? t('canvas.lock.hint') : undefined"
      @click="emit('remove')"
    >
      <span>
        <UIcon name="i-lucide-trash-2" class="size-4" />
        {{ t('删除') }}
      </span>
    </button>
  </div>
</template>
