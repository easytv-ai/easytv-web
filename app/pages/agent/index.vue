<script setup lang="ts">
import type { Asset, Style } from '~/types/creative'

const { t } = useI18n()

/** 首页匿名可看：上面是创作入口，下面是精选成片；创建 Skill / 加入创作台需要登录 */
definePageMeta({
  layout: 'studio',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('首页') })

const route = useRoute()
const localePath = useLocalePath()
const { requireLogin } = useRequireLogin()

/** Skill 详情搬到了技能库，旧链接 /agent?skill=:id 转过去 */
function gotoSkillFromQuery() {
  const sid = Number(route.query.skill) || 0
  if (sid)
    void navigateTo(localePath({ path: '/skills', query: { skill: String(sid) } }), { replace: true })
}

// ---- 输入栏里的「新建 Skill」 ----
const editorOpen = ref(false)

function openCreate() {
  if (!requireLogin())
    return
  editorOpen.value = true
}

// ---- 风格库 / 资产：交给画布同一套输入栏
const entryChat = ref<any>(null)
const styleOpen = ref(false)
const styleEditOpen = ref(false)
const styleEditTarget = ref<Style | null>(null)
const styleMineVersion = ref(0)
const pickerOpen = ref(false)

function onStylePick(style: Style) {
  entryChat.value?.applyStyle({ name: style.name, prompt: style.prompt || style.name, cover_url: style.cover_url })
  styleOpen.value = false
}

function onStyleCreate() {
  styleEditTarget.value = null
  styleEditOpen.value = true
}

function onStyleEdit(style: Style) {
  styleEditTarget.value = style
  styleEditOpen.value = true
}

function onStyleSaved() {
  styleMineVersion.value++
  styleEditOpen.value = false
}

function onAssetPicked(assets: Asset[]) {
  pickerOpen.value = false
  if (assets?.length)
    entryChat.value?.addAssetAttachments(assets)
}

onMounted(gotoSkillFromQuery)

watch(() => route.query.skill, gotoSkillFromQuery)
</script>

<template>
  <section class="agent-page">
    <div class="agent-hero">
      <h1>{{ t('EasyTV，') }}<em>{{ t('让每个想法都成片') }}</em></h1>
      <CanvasChat
        ref="entryChat"
        entry
        :canvas-id="0"
        @open-style="styleOpen = true"
        @pick-asset="pickerOpen = true"
        @create-skill="openCreate"
      />
    </div>

    <div class="agent-feed">
      <StudioWorkFeed featured />
    </div>

    <StudioSkillEditor :open="editorOpen" :skill="null" @close="editorOpen = false" />
    <ClientOnly>
      <CanvasAssetPicker
        :open="pickerOpen"
        :title="t('从资产库选择')"
        @close="pickerOpen = false"
        @pick="onAssetPicked"
      />
      <CanvasStyleLibrary
        v-if="styleOpen"
        :open="styleOpen"
        :locked="styleEditOpen"
        :mine-version="styleMineVersion"
        @close="styleOpen = false"
        @pick="onStylePick"
        @clear="entryChat?.applyStyle(null)"
        @create="onStyleCreate"
        @edit="onStyleEdit"
      />
      <CanvasStyleEditModal
        v-if="styleEditOpen"
        :open="styleEditOpen"
        :editing="styleEditTarget"
        @close="styleEditOpen = false"
        @saved="onStyleSaved"
      />
    </ClientOnly>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio-parts/canvas.css';
@import '~/assets/css/studio-parts/features.css';
</style>
