<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import type { NodeProps } from '@vue-flow/core'
import type { CanvasFlowData } from '~/utils/canvas-group'
import type { CanvasNodeData, CanvasNodeKind } from '~/utils/canvas-node-kinds'
import { canvasNodeIcon } from '~/utils/canvas-node-kinds'
import { isMediaUrl, resolveMediaUrl } from '~/utils/media'
import CanvasAudioPlayer from '~/components/canvas/CanvasAudioPlayer.vue'
import CanvasVideoPlayer from '~/components/canvas/CanvasVideoPlayer.vue'

const { t } = useI18n()

/** 分享页只读节点：卡片本身不叠文案，图/视频/音频都能直接看、播。 */
const props = defineProps<NodeProps<CanvasFlowData>>()

const data = computed(() => props.data)
const isGroup = computed(() => data.value.kind === 'group')
const node = computed(() => isGroup.value ? null : data.value as CanvasNodeData)
const kind = computed(() => node.value?.kind || 'text')

const imageSrc = computed(() => {
  const d = node.value
  if (!d)
    return ''
  const raw = ((d.kind === 'director' ? d.previewUrl : d.content) || '').trim()
  if ((d.kind !== 'image' && d.kind !== 'panorama' && d.kind !== 'director') || !raw || !isMediaUrl(raw))
    return ''
  return resolveMediaUrl(raw)
})

const videoSrc = computed(() => {
  const d = node.value
  if (!d || d.kind !== 'video')
    return ''
  const raw = (d.content || '').trim()
  return raw && isMediaUrl(raw) ? resolveMediaUrl(raw) : ''
})

const audioSrc = computed(() => {
  const d = node.value
  if (!d || d.kind !== 'audio')
    return ''
  const raw = (d.content || '').trim()
  return raw && isMediaUrl(raw) ? resolveMediaUrl(raw) : ''
})

const isBlank = computed(() => {
  if (!node.value || node.value.kind === 'text')
    return false
  return !imageSrc.value && !videoSrc.value && !audioSrc.value
})

const hasText = computed(() => Boolean((node.value?.content || '').replace(/<[^>]+>/g, ' ').trim()))

const copyText = computed(() => {
  const d = node.value
  if (!d || d.kind === 'text')
    return ''
  return String(d.talking?.script || d.prompt || '').trim()
})

const textStyle = computed(() => {
  const d = node.value
  if (!d || d.kind !== 'text')
    return undefined
  return { fontSize: `${d.fontSize || 16}px` } as Record<string, string>
})

const stageTone = computed(() => {
  const d = node.value
  if (!d || d.kind !== 'text' || !d.color)
    return undefined
  return { background: d.color }
})

const tagText = computed(() => node.value?.label || t('节点'))
const tagIcon = computed(() => canvasNodeIcon(kind.value as CanvasNodeKind))

const { open: openShareMedia } = useShareMediaPreview()
const textPreviewOpen = ref(false)
const textModalBody = ref('')

function openImage() {
  openShareMedia('image', imageSrc.value, copyText.value)
}

function openAudio() {
  openShareMedia('audio', audioSrc.value, copyText.value)
}

function openCopy(text = '') {
  const body = String(text || '').trim()
  if (!body.replace(/<[^>]+>/g, ' ').trim())
    return
  textModalBody.value = body
  textPreviewOpen.value = true
}

function onTextPreviewKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape')
    textPreviewOpen.value = false
}

watch(textPreviewOpen, (on) => {
  if (!import.meta.client)
    return
  if (on)
    window.addEventListener('keydown', onTextPreviewKeydown, true)
  else
    window.removeEventListener('keydown', onTextPreviewKeydown, true)
})
onUnmounted(() => window.removeEventListener('keydown', onTextPreviewKeydown, true))
</script>

<template>
  <div v-if="isGroup" class="share-group">
    <span class="share-group__label">{{ data.label }}</span>
  </div>
  <div
    v-else
    class="cnode is-stage nopan nodrag"
    :class="{
      'is-text': kind === 'text',
      'is-image': kind === 'image' || kind === 'panorama',
      'is-panorama': kind === 'panorama',
      'is-video': kind === 'video',
      'is-audio': kind === 'audio',
      'is-director': kind === 'director',
      'has-prompt': (kind === 'text' && hasText) || Boolean(imageSrc || videoSrc || audioSrc),
      'is-blank': isBlank,
    }"
  >
    <p class="cnode__tag">
      <span class="cnode__tag-name">
        <UIcon :name="tagIcon" class="size-3.5" />
        {{ tagText }}
      </span>
      <button
        v-if="copyText"
        type="button"
        class="share-node__copy nodrag nopan nowheel"
        @pointerdown.stop
        @click.stop="openCopy(copyText)"
      >
        {{ t('文案') }}
      </button>
    </p>
    <Handle type="target" :position="Position.Left" :connectable="false" />
    <div class="cnode__stage" :style="stageTone">
      <template v-if="kind === 'text'">
        <ClientOnly v-if="hasText">
          <v-md-preview
            class="cnode__preview is-rich nowheel nodrag nopan"
            :style="textStyle"
            :text="node?.content || ''"
          />
          <template #fallback>
            <div class="cnode__preview nowheel nodrag nopan" :style="textStyle">{{ node?.content || '' }}</div>
          </template>
        </ClientOnly>
        <div v-else class="cnode__preview">{{ t('（空）') }}</div>
        <button
          v-if="hasText"
          type="button"
          class="cnode-player__full nodrag nopan nowheel"
          :aria-label="t('查看全文')"
          @pointerdown.stop
          @click.stop="openCopy(node?.content || '')"
        >
          <UIcon name="i-lucide-maximize-2" class="size-4" />
          <span class="canvas-tip canvas-tip--down">{{ t('查看全文') }}</span>
        </button>
      </template>
      <template v-else-if="imageSrc">
        <img
          class="cnode__media"
          :src="imageSrc"
          :alt="tagText"
          loading="lazy"
          draggable="false"
        >
        <button
          type="button"
          class="share-node__hit nodrag nopan nowheel"
          :aria-label="t('查看大图')"
          @pointerdown.capture.stop
          @click.stop="openImage"
        />
        <div class="cnode-player__tools nodrag nopan nowheel">
          <button
            type="button"
            class="cnode-player__full"
            :aria-label="t('查看大图')"
            @pointerdown.stop
            @click.stop="openImage"
          >
            <UIcon name="i-lucide-maximize-2" class="size-4" />
            <span class="canvas-tip canvas-tip--down">{{ t('查看大图') }}</span>
          </button>
        </div>
      </template>
      <div
        v-else-if="videoSrc"
        class="share-node__media-wrap nodrag nopan nowheel"
        @pointerdown.stop
      >
        <CanvasVideoPlayer always-on :src="videoSrc" :crop="node?.cropRect || null" />
      </div>
      <div
        v-else-if="audioSrc"
        class="share-node__media-wrap nodrag nopan nowheel"
      >
        <CanvasAudioPlayer :src="audioSrc" />
        <button
          type="button"
          class="share-node__audio-hit nodrag nopan nowheel"
          :aria-label="t('播放音频')"
          @pointerdown.capture.stop
          @click.capture.stop="openAudio"
        />
      </div>
      <template v-else>
        <span class="cnode__glyph is-media">
          <UIcon :name="tagIcon" class="size-10" />
        </span>
        <span class="share-node__empty">{{ t('尚未生成') }}</span>
      </template>
    </div>
    <Handle type="source" :position="Position.Right" :connectable="false" />

    <Teleport to="body">
      <div
        v-if="textPreviewOpen && textModalBody"
        class="studio-modal-mask canvas-media-mask share-text-mask"
        role="dialog"
        aria-modal="true"
        :aria-label="t('查看全文')"
        @click.self="textPreviewOpen = false"
        @pointerdown.stop
      >
        <button
          type="button"
          class="canvas-media-mask__close"
          :aria-label="t('关闭')"
          @click="textPreviewOpen = false"
        >
          <UIcon name="i-lucide-x" class="size-5" />
        </button>
        <div class="share-text-mask__stage" @click.stop>
          <ClientOnly>
            <v-md-preview class="cnode__preview is-rich" :text="textModalBody" />
            <template #fallback>
              <div class="cnode__preview">{{ textModalBody }}</div>
            </template>
          </ClientOnly>
        </div>
      </div>
    </Teleport>
  </div>
</template>
