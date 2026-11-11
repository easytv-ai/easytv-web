<script setup lang="ts">
import type { NodeCandidate } from '~/types/creative'
import { prettyModelSlug } from '~/utils/model-name'
import { resolveMediaUrl } from '~/utils/media'
import {
  isCurrentNodeCandidate,
  isRejectedNodeCandidate,
  nodeCandidateDuration,
  nodeCandidateTime,
} from '~/utils/canvas-node-history'

/**
 * 节点历史结果入口（API.md 39.2）：检查器工具行上的「历史结果 n」+ 缩略图列表。
 * 重抽不覆盖旧结果，随时能切回来。父级只在够两条时渲染它。
 */
const props = defineProps<{
  items: NodeCandidate[]
  /** 节点种类：决定缩略图怎么画 */
  kind: string
  /** 节点当前的产物，用来标出「当前」那条 */
  current: { content?: string, assetId?: number }
  /** 只读画布 / 节点锁定 / 正在生成：能看不能切 */
  disabled?: boolean
  disabledTitle?: string
}>()

const emit = defineEmits<{
  pick: [candidate: NodeCandidate]
}>()

const { t } = useI18n()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function mediaKind(item: NodeCandidate) {
  const type = item.type || props.kind
  return type === 'video' || type === 'audio' ? type : 'image'
}

function thumbOf(item: NodeCandidate) {
  const kind = mediaKind(item)
  if (kind === 'image')
    return resolveMediaUrl(item.url)
  if (kind === 'video')
    return resolveMediaUrl(item.cover_url)
  return ''
}

function isCurrent(item: NodeCandidate) {
  return isCurrentNodeCandidate(props.current, item)
}

function onPick(item: NodeCandidate) {
  if (props.disabled || isCurrent(item))
    return
  open.value = false
  emit('pick', item)
}

function onDocPointer(event: PointerEvent) {
  if (open.value && rootRef.value && !rootRef.value.contains(event.target as Node))
    open.value = false
}

function onKey(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    event.stopPropagation()
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('keydown', onKey, true)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <span ref="rootRef" class="canvas-candidates">
    <button
      type="button"
      class="canvas-inspector__chip"
      :class="{ 'is-on': open }"
      :aria-expanded="open"
      :title="t('canvas.candidates.entry', { n: items.length })"
      :aria-label="t('canvas.candidates.entry', { n: items.length })"
      @click="open = !open"
    >
      <!-- 只放图标和条数：芯片行已经很满，带文字会把展开按钮挤到第二行 -->
      <UIcon name="i-lucide-history" class="size-3.5" />
      {{ items.length }}
    </button>
    <div v-if="open" class="canvas-candidates__pop nowheel" role="listbox" :aria-label="t('canvas.candidates.title')" @pointerdown.stop @wheel.stop>
      <p class="canvas-candidates__head">
        {{ disabled && disabledTitle ? disabledTitle : t('canvas.candidates.hint') }}
      </p>
      <button
        v-for="item in items"
        :key="item.task_id || item.asset_id || item.url"
        type="button"
        class="canvas-candidates__row"
        role="option"
        :aria-selected="isCurrent(item)"
        :class="{ 'is-current': isCurrent(item), 'is-disabled': disabled && !isCurrent(item) }"
        :title="item.prompt || undefined"
        @click="onPick(item)"
      >
        <span class="canvas-candidates__thumb" :class="`is-${mediaKind(item)}`">
          <img v-if="thumbOf(item)" :src="thumbOf(item)" alt="" loading="lazy" draggable="false">
          <UIcon v-else :name="mediaKind(item) === 'audio' ? 'i-lucide-audio-lines' : mediaKind(item) === 'video' ? 'i-lucide-video' : 'i-lucide-image'" class="size-4" />
          <i v-if="mediaKind(item) !== 'image' && nodeCandidateDuration(item.duration)">{{ nodeCandidateDuration(item.duration) }}</i>
        </span>
        <span class="canvas-candidates__meta">
          <strong>{{ prettyModelSlug(item.model) || t('canvas.candidates.unknownModel') }}</strong>
          <em>{{ nodeCandidateTime(item.created_at) }}</em>
        </span>
        <span class="canvas-candidates__tags">
          <i v-if="isCurrent(item)" class="is-current">{{ t('canvas.candidates.current') }}</i>
          <i v-if="isRejectedNodeCandidate(item)" class="is-rejected">{{ t('canvas.candidates.rejected') }}</i>
        </span>
      </button>
    </div>
  </span>
</template>

<style scoped>
.canvas-candidates {
  position: relative;
  display: inline-flex;
}

.canvas-candidates__pop {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 6;
  display: grid;
  align-content: start;
  width: 300px;
  max-height: min(320px, 46vh);
  gap: 4px;
  padding: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--st-border);
  border-radius: 16px;
  background: var(--st-pop);
  box-shadow: var(--st-shadow);
  scrollbar-width: thin;
  scrollbar-color: var(--st-scroll) transparent;
}

.canvas-candidates__head {
  margin: 0;
  padding: 2px 6px 4px;
  color: var(--st-muted);
  font-size: 11px;
  line-height: 1.4;
}

.canvas-candidates__row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--st-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.canvas-candidates__row:hover,
.canvas-candidates__row.is-current {
  background: var(--st-hover);
}

.canvas-candidates__row.is-current {
  cursor: default;
}

.canvas-candidates__row.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.canvas-candidates__thumb {
  position: relative;
  display: grid;
  flex: none;
  width: 64px;
  height: 44px;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: var(--st-card);
  color: var(--st-muted);
}

.canvas-candidates__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.canvas-candidates__thumb i {
  position: absolute;
  right: 3px;
  bottom: 3px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
  font-style: normal;
  line-height: 14px;
}

.canvas-candidates__meta {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.canvas-candidates__meta strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.canvas-candidates__meta em {
  color: var(--st-muted);
  font-size: 11px;
  font-style: normal;
}

.canvas-candidates__tags {
  display: grid;
  flex: none;
  gap: 2px;
  justify-items: end;
}

.canvas-candidates__tags i {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  white-space: nowrap;
}

.canvas-candidates__tags i.is-current {
  background: var(--st-on);
  color: var(--st-on-text);
}

.canvas-candidates__tags i.is-rejected {
  background: rgba(249, 115, 22, 0.14);
  color: #f97316;
}
</style>
