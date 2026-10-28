<script setup lang="ts">
import type { ClonePreview } from '~/types/creative'

/**
 * 做同款前的预览（API.md 14.3）：用到哪些模型、现在能不能用 / 调没调价、全部重新生成预计多少积分、
 * 哪些参考素材复制后需要重新选。确认后才真正复制画布。
 */
const props = defineProps<{
  open: boolean
  preview: ClonePreview | null
  loading?: boolean
  cloning?: boolean
}>()

const emit = defineEmits<{
  close: []
  confirm: []
}>()

const { t } = useI18n()

const problems = computed(() => (props.preview?.models ?? []).filter(m => !m.available || !m.priced).length)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask studio-confirm-mask" @click.self="emit('close')">
      <div class="studio-confirm wcp" role="dialog" aria-modal="true">
        <header class="studio-confirm__head">
          <span class="studio-confirm__icon" aria-hidden="true"><UIcon name="i-lucide-copy-plus" class="size-4" /></span>
          <h2>{{ t('做同款') }}</h2>
          <button type="button" class="studio-confirm__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <p v-if="loading || !preview">{{ t('正在分析这个作品的创作过程…') }}</p>
        <template v-else>
          <p v-if="preview.generative_nodes">
            {{ t('会复制一张 {n} 个节点的画布到你的项目。全部重新生成预计约 {p} 积分（按当前价格估算，可以只改部分节点再生成）。', { n: preview.node_count, p: preview.estimate_points }) }}
          </p>
          <p v-else>
            {{ t('会复制一张 {n} 个节点的画布到你的项目。作者没有留下生成记录，复制后需要你自己为节点选模型生成。', { n: preview.node_count }) }}
          </p>

          <h3 v-if="preview.models.length" class="wcp__title">{{ t('用到的模型') }}</h3>
          <ul v-if="preview.models.length" class="wcp__list">
            <li v-for="m in preview.models" :key="`${m.type}-${m.model}`" :class="{ 'is-bad': !m.available || !m.priced }">
              <strong>{{ m.label || m.model }}</strong>
              <small>{{ t('{n} 个节点', { n: m.nodes }) }}<template v-if="m.points_per_unit"> · {{ t('{p} 积分/{unit}', { p: m.points_per_unit, unit: m.unit === 'second' ? t('秒') : m.unit === 'image' ? t('张') : t('次') }) }}</template></small>
              <em v-for="c in m.changes" :key="c">{{ c }}</em>
            </li>
          </ul>

          <template v-if="preview.missing_refs.length">
            <h3 class="wcp__title">{{ t('需要重新选择的素材') }}</h3>
            <p class="wcp__hint">{{ t('作者的素材不会随画布复制，下面这些节点的参考图 / 主体需要换成你自己的，否则生成时不会使用。') }}</p>
            <ul class="wcp__list">
              <li v-for="item in preview.missing_refs.slice(0, 8)" :key="item.node_id">
                <strong>{{ item.label || item.node_id }}</strong>
                <small>{{ item.fields.join('、') }}</small>
              </li>
            </ul>
            <p v-if="preview.missing_refs.length > 8" class="wcp__hint">{{ t('还有 {n} 个节点', { n: preview.missing_refs.length - 8 }) }}</p>
          </template>

          <p v-if="problems" class="wcp__warn">{{ t('有 {n} 个模型现在不可用，复制后请在节点上换成其他模型。', { n: problems }) }}</p>
        </template>

        <div class="studio-confirm__actions">
          <button type="button" class="studio-confirm__btn" @click="emit('close')">{{ t('取消') }}</button>
          <button type="button" class="studio-confirm__btn is-primary" :disabled="loading || cloning || !preview" @click="emit('confirm')">
            {{ cloning ? t('复制中…') : t('复制到我的项目') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wcp {
  max-width: 520px;
  max-height: 86vh;
  overflow-y: auto;
}

.wcp__title {
  margin: 16px 0 6px;
  font-size: 13px;
}

.wcp__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wcp__list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  padding: 8px 10px;
  border: 1px solid var(--st-border);
  border-radius: 10px;
  font-size: 12px;
}

.wcp__list li.is-bad {
  border-color: #d97706;
}

.wcp__list small {
  color: var(--st-muted);
}

.wcp__list em {
  flex-basis: 100%;
  font-style: normal;
  color: #d97706;
}

.wcp__hint {
  margin-top: 4px !important;
  font-size: 12px !important;
}

.wcp__warn {
  margin-top: 12px !important;
  color: #d97706 !important;
}
</style>
