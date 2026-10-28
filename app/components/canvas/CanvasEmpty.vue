<script setup lang="ts">
import { CANVAS_EMPTY_STARTS, type CanvasEmptyStart, type CanvasStartSkill } from '~/utils/canvas-node-kinds'
import skillApi from '~/api/skill'
import { resolveMediaUrl } from '~/utils/media'
import type { Skill } from '~/types/creative'

const { t } = useI18n()

defineProps<{
  readonly?: boolean
  canvasLocked?: boolean
}>()

const emit = defineEmits<{
  start: [item: CanvasEmptyStart]
  /** 点击技能起步卡：不落节点，由页面打开右侧抽屉配置生成 */
  'start-skill': [skill: CanvasStartSkill]
  workflow: []
  practice: []
}>()

// 空画布起步卡优先展示后台配置的 Skill；加载中先给骨架，失败或为空回退到固定预设
const TONES = ['green', 'rose', 'blue', 'violet'] as const
const startSkills = ref<CanvasStartSkill[]>([])
const startState = ref<'loading' | 'ready' | 'fallback'>('loading')

function toStartSkill(item: Skill): CanvasStartSkill {
  return {
    id: item.id,
    title: item.title,
    slug: item.slug || `/skill/${item.id}`,
    cover: resolveMediaUrl(item.cover_url),
    description: item.description || '',
    prompt: item.prompt || '',
    hasGuide: Boolean(item.guide?.trim() || item.output_format?.trim()),
  }
}

async function loadStartSkills() {
  try {
    const res = await skillApi.list({ page: 1, page_size: 4 })
    const items = res?.success && res.data ? res.data.items : []
    if (items.length) {
      startSkills.value = items.map(toStartSkill)
      startState.value = 'ready'
    }
    else {
      startState.value = 'fallback'
    }
  }
  catch {
    startState.value = 'fallback'
  }
}

onMounted(() => {
  void loadStartSkills()
})
</script>

<template>
  <div class="canvas-empty" data-guide="starts">
    <p class="canvas-empty__hint">
      <UIcon name="i-lucide-mouse-pointer-2" class="size-3.5" />
      <span>{{ t('双击画布 自由添加节点') }}</span>
    </p>
    <div
      v-if="!readonly && !canvasLocked"
      class="canvas-empty__row"
      @pointerdown.stop
      @dblclick.stop
    >
      <template v-if="startState === 'ready'">
        <button
          v-for="(item, index) in startSkills"
          :key="`s${item.id}`"
          type="button"
          class="canvas-empty__chip"
          :data-tone="TONES[index % TONES.length]"
          :title="item.description"
          @click="emit('start-skill', item)"
        >
          <span class="canvas-empty__icon">
            <img v-if="item.cover" :src="item.cover" :alt="item.title" loading="lazy">
            <UIcon v-else name="i-lucide-sparkles" class="size-4.5" />
          </span>
          <span class="canvas-empty__copy">
            <strong>{{ item.title }}</strong>
            <em>{{ item.description }}</em>
          </span>
        </button>
      </template>
      <template v-else-if="startState === 'fallback'">
        <button
          v-for="item in CANVAS_EMPTY_STARTS"
          :key="item.id"
          type="button"
          class="canvas-empty__chip"
          :data-tone="item.tone"
          @click="emit('start', item)"
        >
          <span class="canvas-empty__icon">
            <UIcon :name="item.icon" class="size-4.5" />
          </span>
          <span class="canvas-empty__copy">
            <strong>{{ t(item.label) }}</strong>
            <em>{{ t(item.hint) }}</em>
          </span>
        </button>
      </template>
      <template v-else>
        <div v-for="n in 4" :key="n" class="canvas-empty__chip is-skeleton" aria-hidden="true">
          <span class="canvas-empty__icon" />
          <span class="canvas-empty__copy">
            <strong />
            <em />
          </span>
        </div>
      </template>
    </div>
    <button
      v-if="!readonly && !canvasLocked"
      type="button"
      class="canvas-empty__library"
      @pointerdown.stop
      @dblclick.stop
      @click="emit('workflow')"
    >
      <UIcon name="i-lucide-workflow" class="size-3.5" />
      {{ t('从工作流库开始') }}
    </button>
    <button
      v-if="!readonly && !canvasLocked"
      type="button"
      class="canvas-empty__library"
      @pointerdown.stop
      @dblclick.stop
      @click="emit('practice')"
    >
      <UIcon name="i-lucide-graduation-cap" class="size-3.5" />
      {{ t('第一次来？跟练一遍') }}
    </button>
  </div>
</template>
