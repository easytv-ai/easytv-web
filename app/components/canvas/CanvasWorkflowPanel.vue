<script setup lang="ts">
import workflowApi, { type CanvasWorkflow } from '~/api/workflow'
import { groupedWorkflowPresets, type WorkflowPreset } from '~/utils/canvas-workflow-presets'

const props = defineProps<{
  open: boolean
  /** 变了就重新拉列表（存完一条时） */
  refreshAt?: number
}>()

const emit = defineEmits<{
  close: []
  use: [id: number]
  /** 官方预设是前端常量，直接给 graph，不用回后端取 */
  usePreset: [preset: WorkflowPreset]
}>()

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
/** 官方预设按场景分组：通用 → 电商商品 → 本地生活 → 课程知识（组内顺序即配方库里的顺序） */
const presetGroups = groupedWorkflowPresets()
const tab = ref<'official' | 'mine'>('official')
const list = ref<CanvasWorkflow[]>([])
const loading = ref(false)
const loadError = ref(false)
const keyword = ref('')
const renaming = ref(0)
const renameText = ref('')
const renamingBusy = ref(false)
const removingId = ref(0)

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}
/** 教学句默认收起，点说明再展开，不触发放入画布 */
const teachOpen = reactive<Record<string, boolean>>({})

function toggleTeach(id: string) {
  teachOpen[id] = !teachOpen[id]
}

/** 规格行：比例 · 单镜时长 · 分辨率（多镜配方的时长是"每镜"，整片时长看配方文案） */
function presetSpec(preset: WorkflowPreset) {
  const platform = preset.platform
  if (!platform)
    return ''
  return t('{ratio} · {seconds} 秒 · {resolution}', {
    ratio: platform.shotLine ? t(platform.shotLine) : platform.ratio,
    seconds: platform.durationSeconds,
    resolution: platform.resolution,
  })
}

/** 图里有高清节点时，卡片上的点数不含那次 upscale（高清另计） */
function presetChargesHdSeparately(preset: WorkflowPreset) {
  return preset.graph.nodes.some((node) => {
    const data = node.data as { tag?: string, hdParams?: unknown }
    return data.tag === '高清' || Boolean(data.hdParams)
  })
}

/** 点数行：按这条配方的口径估算一次要花多少点（单镜=重跑 graph，多镜=场景铺满） */
function presetPoints(preset: WorkflowPreset) {
  if (preset.estimatedPoints == null)
    return ''
  return presetChargesHdSeparately(preset)
    ? t('预计 {n} 点（高清另计）', { n: preset.estimatedPoints })
    : t('预计 {n} 点', { n: preset.estimatedPoints })
}

/** 卡片第三行：规格 · 预计点数（两个都缺就返回空串，卡片回到原来的两行式） */
function presetLine(preset: WorkflowPreset) {
  return [presetSpec(preset), presetPoints(preset)].filter(Boolean).join(' · ')
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const res = await workflowApi.list({ keyword: keyword.value.trim() || undefined, page: 1, page_size: 50 })
    if (!res?.success || !res.data) {
      loadError.value = list.value.length === 0
      notify(res?.message || t('account.workflow.loadFailed'), 'error')
      return
    }
    list.value = res.data.items ?? []
  }
  catch {
    loadError.value = list.value.length === 0
    notify(t('account.workflow.loadFailed'), 'error')
  }
  finally {
    loading.value = false
  }
}

/** 改名输入框一出现就聚焦，省一次点击 */
function focusRename(el: unknown) {
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

function startRename(item: CanvasWorkflow) {
  renaming.value = item.id
  renameText.value = item.name
}

async function commitRename() {
  const id = renaming.value
  const name = renameText.value.trim()
  if (!id || renamingBusy.value)
    return
  const previous = list.value.find(item => item.id === id)?.name ?? ''
  if (!name || name === previous) {
    renaming.value = 0
    return
  }
  renamingBusy.value = true
  try {
    const res = await workflowApi.update(id, { name })
    if (!res?.success || !res.data) {
      notify(res?.message || t('改名失败'), 'error')
      return
    }
    const hit = list.value.find(item => item.id === id)
    if (hit)
      hit.name = res.data.name
    renaming.value = 0
  }
  finally {
    renamingBusy.value = false
  }
}

async function remove(item: CanvasWorkflow) {
  if (removingId.value)
    return
  const ok = await confirm({
    title: t('account.workflow.deleteTitle'),
    message: t('account.workflow.deleteMessage', { name: item.name }),
    confirmText: t('删除'),
    danger: true,
  })
  if (!ok)
    return
  removingId.value = item.id
  try {
    const res = await workflowApi.remove(item.id)
    if (!res?.success) {
      notify(res?.message || t('删除失败'), 'error')
      return
    }
    list.value = list.value.filter(row => row.id !== item.id)
    notify(t('已删除'), 'success')
  }
  finally {
    removingId.value = 0
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}

watch(() => [props.open, props.refreshAt], ([open]) => {
  if (open) {
    tab.value = 'official'
    void load()
  }
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask canvas-wf-mask"
      @click.self="emit('close')"
      @pointerdown.stop
      @keydown.stop
    >
      <div
        class="canvas-wf studio-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-wf-title"
        @wheel.stop
      >
        <header class="canvas-wf__head">
          <h2 id="canvas-wf-title">{{ t('工作流') }}</h2>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-5" />
          </button>
        </header>
        <div class="canvas-wf__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :class="{ 'is-on': tab === 'official' }"
            :aria-selected="tab === 'official'"
            @click="tab = 'official'"
          >
            {{ t('官方预设') }}
          </button>
          <button
            type="button"
            role="tab"
            :class="{ 'is-on': tab === 'mine' }"
            :aria-selected="tab === 'mine'"
            @click="tab = 'mine'"
          >
            {{ t('我的工作流') }}
          </button>
        </div>
        <div class="canvas-wf__body">
          <section v-if="tab === 'official'" class="canvas-wf__section">
            <div class="canvas-wf__groups">
              <div v-for="group in presetGroups" :key="group.scenario" class="canvas-wf__group">
                <p class="canvas-wf__group-title">
                  <strong>{{ t(group.label) }}</strong>
                  <em>{{ t(group.note) }}</em>
                </p>
                <ul>
                  <li v-for="preset in group.items" :key="preset.id">
                    <button type="button" class="canvas-wf__card" @click="emit('usePreset', preset)">
                      <span class="canvas-wf__ph"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
                      <span class="canvas-wf__meta">
                        <strong>{{ t(preset.name) }}</strong>
                        <em class="canvas-wf__hint">{{ t(preset.hint) }}</em>
                        <em v-if="presetLine(preset)" class="canvas-wf__spec">{{ presetLine(preset) }}</em>
                        <em
                          v-if="preset.teachingPoint && teachOpen[preset.id]"
                          class="canvas-wf__teach"
                          @click.stop="toggleTeach(preset.id)"
                        >{{ t(preset.teachingPoint) }}</em>
                      </span>
                    </button>
                    <button
                      v-if="preset.teachingPoint"
                      type="button"
                      class="canvas-wf__teach-btn"
                      :class="{ 'is-on': teachOpen[preset.id] }"
                      :aria-expanded="teachOpen[preset.id] ? 'true' : 'false'"
                      :aria-label="t(preset.teachingPoint)"
                      @click.stop="toggleTeach(preset.id)"
                    >
                      <UIcon name="i-lucide-info" class="size-3.5" />
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </section>
          <section v-else class="canvas-wf__section">
            <input v-model="keyword" type="search" :placeholder="t('搜索工作流')" @keyup.enter="load()">
            <p v-if="loading && !list.length" class="canvas-wf__empty">{{ t('加载中…') }}</p>
            <div v-else-if="loadError" class="canvas-wf__empty">
              <p>{{ t('account.workflow.loadFailed') }}</p>
              <button type="button" class="canvas-wf__retry" @click="load()">{{ t('重试') }}</button>
            </div>
            <p v-else-if="!list.length" class="canvas-wf__empty">
              {{ t('还没有工作流。在画布上选中一串连好线的节点，点工具条「存为工作流」即可。') }}
            </p>
            <ul v-else>
              <li v-for="item in list" :key="item.id">
                <button type="button" class="canvas-wf__card" @click="emit('use', item.id)">
                  <img v-if="item.cover_url" :src="item.cover_url" alt="">
                  <span v-else class="canvas-wf__ph"><UIcon name="i-lucide-workflow" class="size-4" /></span>
                  <span class="canvas-wf__meta">
                    <input
                      v-if="renaming === item.id"
                      :ref="focusRename"
                      v-model="renameText"
                      type="text"
                      :disabled="renamingBusy"
                      @click.stop
                      @keyup.enter="commitRename()"
                      @blur="commitRename()"
                    >
                    <strong v-else>{{ item.name }}</strong>
                    <em>{{ t('{n} 个节点', { n: item.node_count }) }} · {{ t('用过 {n} 次', { n: item.uses }) }}</em>
                  </span>
                </button>
                <span class="canvas-wf__ops">
                  <button type="button" :aria-label="t('重命名')" @click.stop="startRename(item)">
                    <UIcon name="i-lucide-pencil" class="size-3.5" />
                  </button>
                  <button type="button" :aria-label="t('删除')" :disabled="removingId === item.id" @click.stop="remove(item)">
                    <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  </button>
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
