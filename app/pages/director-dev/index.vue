<script setup lang="ts">
/**
 * 导演台开发入口。
 *
 * 挂的是画布里用的那个 CanvasDirectorSession，不是另搭一套 —— 两边跑同一段
 * 代码，这里验过的东西在画布里才算数。上面那条控制栏是这个页面自己的，
 * 用来模拟画布会做的事：装场景、看回写、接全景。
 *
 * 路径叫 director-dev 而不是 director：public/director/index.html 曾是 iframe 版
 * 的静态产物，静态资源优先于路由。阶段 6 已经把那份产物删掉，名字保留不动。
 * 生产环境：pages:extend 拿掉路由，这里再挂 dev-only，避免漏网。
 */
import CanvasDirectorSession from '~/components/canvas/CanvasDirectorSession.vue'
import { createDefaultDirectorProject } from '~/utils/director/default-project'
import { estimateProjectBytes } from '~/utils/director/persist'
import { downloadExportedVideo, downloadPreviewFrames } from '~/utils/director/playback/video-export'
import type { DirectorProject } from '~/utils/director/schema'

const { t } = useI18n()

definePageMeta({
  layout: false,
  middleware: ['auth', 'dev-only'],
})

useHead({ title: t('导演台（开发）') })

/** 模拟画布节点里存着的场景 */
const savedScene = ref<DirectorProject | null>(null)
const savedBytes = ref(0)
const captureCount = ref(0)
const oversize = ref(false)
/** 换这个值就等于换了一个画布节点，整棵子树重建 */
const sessionKey = ref('node-1')
const panorama = ref<{ url: string, name: string, edgeId: string, sourceNodeId: string } | null>(null)

function onSceneChange(payload: { nodeId: string, scene: DirectorProject }) {
  savedScene.value = payload.scene
  savedBytes.value = estimateProjectBytes(payload.scene)
}

/** 重新装一次刚存下来的场景，验证存取是闭合的 */
function reloadSaved() {
  sessionKey.value = `node-1-${Date.now()}`
}

/** 换成一个全新的空场景，验证换节点不会把上一个的东西带过来 */
function switchNode() {
  savedScene.value = createDefaultDirectorProject()
  sessionKey.value = `node-2-${Date.now()}`
}

/**
 * 模拟画布上连进来一张全景图。
 * 现画一张 2:1 的测试图，不往仓库里塞样例素材。
 */
function makeTestPanorama() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')!

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
  sky.addColorStop(0, '#1b3a6b')
  sky.addColorStop(0.5, '#7aa7d9')
  sky.addColorStop(1, '#2e2a22')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 竖条纹用来看朝向对不对：转 yaw 时应该跟着横向滚动
  ctx.font = '48px sans-serif'
  ctx.textAlign = 'center'
  for (let i = 0; i < 8; i++) {
    const x = (i + 0.5) * (canvas.width / 8)
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.16)'
    ctx.fillRect(i * (canvas.width / 8), 0, canvas.width / 8, canvas.height)
    ctx.fillStyle = '#fff'
    ctx.fillText(String(i), x, canvas.height / 2)
  }

  return canvas.toDataURL('image/jpeg', 0.8)
}

function attachPanorama() {
  panorama.value = {
    url: makeTestPanorama(),
    name: '全景样例.jpg',
    edgeId: 'edge-1',
    sourceNodeId: 'pano-1',
  }
  sessionKey.value = `node-pano-${Date.now()}`
}
</script>

<template>
  <div class="director-page">
    <header class="director-page__bar">
      <div>
        <h1>{{ t('导演台（开发）') }}</h1>
        <p>{{ t('跑的是画布里那个会话组件，这里的控制栏模拟画布的输入输出。') }}</p>
      </div>
      <div class="director-page__tools">
        <button type="button" @click="reloadSaved()">{{ t('重装当前场景') }}</button>
        <button type="button" @click="switchNode()">{{ t('换一个节点') }}</button>
        <button type="button" @click="attachPanorama()">{{ t('接一张全景') }}</button>
        <span class="director-page__stat">
          {{ t('存档 {n} 字节', { n: savedBytes }) }} ·
          {{ t('截图 {n} 张', { n: captureCount }) }}
          <template v-if="oversize"> · {{ t('已超软上限') }}</template>
        </span>
      </div>
    </header>

    <ClientOnly>
      <CanvasDirectorSession
        :key="sessionKey"
        :node-id="sessionKey"
        :scene="savedScene"
        :panorama="panorama"
        @scene-change="onSceneChange"
        @export-video="item => downloadExportedVideo(item.blob, item.fileName)"
        @export-preview="item => downloadPreviewFrames(item.frames)"
        @capture-count="captureCount = $event"
        @oversize="oversize = $event"
      />
      <template #fallback>
        <div class="director-page__fallback">{{ t('视口加载中…') }}</div>
      </template>
    </ClientOnly>
  </div>
</template>

<style>
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio.css';
</style>
