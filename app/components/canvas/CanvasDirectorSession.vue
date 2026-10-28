<script setup lang="ts">
/**
 * 一个导演台节点的一次会话：建 store、provide 下去、把各块面板摆好。
 *
 * 单独拆出来是因为 provide 只能在 setup 里调。外层按 nodeId 给这个组件加 key，
 * 换节点时整棵子树重建，store、three 资源、撤销栈都跟着换新 —— 在 watch 里
 * 调 provide 只有第一次生效，之后换节点就会连到上一个节点的场景上。
 */
import { computed, nextTick, shallowRef, watch } from 'vue'
import DirectorViewport from '~/components/canvas/director/DirectorViewport.vue'
import DirectorObjectTree from '~/components/canvas/director/panels/DirectorObjectTree.vue'
import DirectorInspector from '~/components/canvas/director/panels/DirectorInspector.vue'
import DirectorTimeline from '~/components/canvas/director/timeline/DirectorTimeline.vue'
import DirectorAssistant from '~/components/canvas/director/agent/DirectorAssistant.vue'
import { createDirectorStore } from '~/utils/director/store'
import { provideDirectorStore } from '~/utils/director/use-director-store'
import { createCameraPlaybackStore } from '~/utils/director/playback/store'
import { provideCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { createDefaultDirectorProject } from '~/utils/director/default-project'
import { attachPanoramaToProject } from '~/utils/director/store/actions-selection'
import { attachLookToDefaultCharacter } from '~/utils/director/character-look'
import { isDirectorProject, prepareProjectForSave } from '~/utils/director/persist'
import { canvasToCardPreview } from '~/utils/director/card-preview'
import type { DirectorProject } from '~/utils/director/schema'

const props = defineProps<{
  nodeId: string
  scene?: DirectorProject | null
  panorama?: { url: string, name: string, edgeId: string, sourceNodeId: string } | null
  look?: { url: string, name: string } | null
  /** 队友只读画布：能看不能改场景 */
  readonly?: boolean
  /** 窄屏抽屉：桌面样式不看这两项，面板始终并排 */
  leftOpen?: boolean
  rightOpen?: boolean
}>()

const emit = defineEmits<{
  'scene-change': [payload: { nodeId: string, scene: DirectorProject }]
  captures: [items: { dataUrl: string, fileName: string }[]]
  'export-video': [payload: { blob: Blob, fileName: string, duration?: number }]
  'export-preview': [payload: {
    frames: { dataUrl: string, fileName: string, shotIndex: number, time: number, label: string }[]
    prompts: string[]
    output: 'color' | 'depth' | 'matte'
    generate?: boolean
  }]
  'panorama-removed': [payload: { edgeId: string, sourceNodeId: string }]
  /** 让外层的工具条知道现在有几张截图可送 */
  'capture-count': [count: number]
  /** 场景大到有保存风险，外层给个提示 */
  oversize: [value: boolean]
  'close-drawers': []
}>()

const { t } = useI18n()

const store = createDirectorStore(undefined, { readonly: props.readonly })
const playback = createCameraPlaybackStore()
provideDirectorStore(store)
provideCameraPlaybackStore(playback)

// 节点里存着的场景直接装进来；装不出来（旧节点、脏数据）就开一个默认场景
const initial = isDirectorProject(props.scene) ? props.scene : createDefaultDirectorProject()

// 画布上连进来的全景在装进去之前就并好，不要装完再提交一次 ——
// 那样撤销栈里会留一步，用户开台后按的第一次撤销就把全景摘了
const withPanorama = props.panorama?.url
  ? attachPanoramaToProject(initial, { url: props.panorama.url, fileName: props.panorama.name })
  : initial
store.loadProject(props.look?.url
  ? attachLookToDefaultCharacter(withPanorama, { url: props.look.url, fileName: props.look.name })
  : withPanorama)

/**
 * 场景回写。
 *
 * 不做防抖：写的是内存里的节点 data，画布本身有自己的自动保存节奏，
 * 这里再压一层只会让「关掉导演台时最后几步没存上」更容易发生。
 */
watch(() => store.project.value, (project) => {
  const result = prepareProjectForSave(project)
  emit('oversize', !result.withinLimit)
  emit('scene-change', { nodeId: props.nodeId, scene: result.project })
}, { deep: true })

/** 导演台里摘掉全景：画布上那条连线也断掉，两边保持一致 */
watch(() => store.project.value.panoramaAssetId, (id, previous) => {
  if (previous && !id && props.panorama)
    emit('panorama-removed', { edgeId: props.panorama.edgeId, sourceNodeId: props.panorama.sourceNodeId })
})

const captures = computed(() =>
  store.project.value.cameras.flatMap(camera => camera.captures ?? []))

watch(captures, list => emit('capture-count', list.length), { immediate: true })

function sendCaptures() {
  const items = captures.value.map(capture => ({
    dataUrl: capture.dataUrl,
    fileName: `${capture.name}.png`,
  }))
  if (items.length)
    emit('captures', items)
}

function waitTwoFrames() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

const viewportRef = shallowRef<InstanceType<typeof DirectorViewport> | null>(null)

/**
 * 离开前拍一张卡片封面。
 * 先取消选中、切回导演视角并拉远看全场，避免封面只剩最初那两个人。
 */
async function captureCardPreview() {
  store.openSceneInspector()
  store.setViewMode('director')
  viewportRef.value?.frameOverview()
  await nextTick()
  await waitTwoFrames()
  await waitTwoFrames()
  const canvas = playback.canvas.value
  if (!canvas?.width || !canvas.height)
    return ''
  try {
    return canvasToCardPreview(canvas)
  }
  catch {
    return ''
  }
}

defineExpose({ sendCaptures, captureCardPreview })
</script>

<template>
  <div class="director-shell">
    <button
      v-if="leftOpen || rightOpen"
      type="button"
      class="director-shell__backdrop"
      :aria-label="t('关闭')"
      @click="emit('close-drawers')"
    />
    <aside class="director-shell__left" :class="{ 'is-open': leftOpen }">
      <header v-if="$slots.brand" class="director-shell__brand">
        <slot name="brand" />
      </header>
      <DirectorObjectTree />
    </aside>

    <div class="director-shell__center">
      <div class="director-shell__stage">
        <DirectorViewport ref="viewportRef" />
        <DirectorAssistant />
      </div>
      <DirectorTimeline class="director-shell__timeline" @export-video="emit('export-video', $event)" @export-preview="emit('export-preview', $event)" />
    </div>

    <aside class="director-shell__right" :class="{ 'is-open': rightOpen }">
      <DirectorInspector>
        <template v-if="$slots.aside" #head-extra>
          <slot name="aside" />
        </template>
      </DirectorInspector>
    </aside>
  </div>
</template>
