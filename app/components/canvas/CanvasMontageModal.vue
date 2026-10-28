<script setup lang="ts">
import {
  MONTAGE_COLS_MAX,
  MONTAGE_GAP_MAX,
  MONTAGE_RATIOS,
  montageDefaultCols,
  montageRows,
  type MontageOptions,
  type MontageRatio,
  type MontageSource,
} from '~/utils/canvas-montage'

/**
 * 分镜组拼接（L4）：选中的图片已按阅读顺序排好，这里只定行列、画幅、间距、序号。
 * 确认后由工作区提交 montage 作业（本地 ffmpeg，免费），结果落成一个新的图片节点。
 */
const props = defineProps<{
  open: boolean
  /** 已排好序的源图 */
  items: MontageSource[]
}>()

const emit = defineEmits<{
  close: []
  confirm: [opts: MontageOptions]
}>()

const { t } = useI18n()

const cols = ref(2)
const ratio = ref<MontageRatio>('original')
const gap = ref(8)
const number = ref(true)

const count = computed(() => props.items.length)
const colsMax = computed(() => Math.max(1, Math.min(MONTAGE_COLS_MAX, count.value)))
const rows = computed(() => montageRows(count.value, cols.value))

function stepCols(delta: number) {
  cols.value = Math.max(1, Math.min(colsMax.value, cols.value + delta))
}

function onConfirm() {
  if (count.value < 2)
    return
  emit('confirm', { cols: cols.value, ratio: ratio.value, gap: gap.value, number: number.value })
}

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

// 每次打开按张数重算缺省列数：上一次的排法跟这一批图没关系
watch(() => props.open, (open) => {
  if (open)
    cols.value = montageDefaultCols(count.value)
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal canvas-presets canvas-montage" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ t('合成分镜组') }}</h2>
            <p>{{ t('已选 {n} 张，按画布位置从上到下、从左到右排', { n: count }) }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-montage__grid" :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: `${Math.min(gap, 16)}px` }">
          <figure v-for="(item, i) in items" :key="item.id">
            <img :src="item.url" :alt="item.label">
            <b v-if="number">{{ i + 1 }}</b>
          </figure>
        </div>

        <div class="canvas-montage__row">
          <span>{{ t('每行几张') }}</span>
          <div class="canvas-montage__step">
            <button type="button" :disabled="cols <= 1" @click="stepCols(-1)">−</button>
            <b>{{ cols }}</b>
            <button type="button" :disabled="cols >= colsMax" @click="stepCols(1)">+</button>
          </div>
          <em>{{ t('{c} 列 × {r} 行', { c: cols, r: rows }) }}</em>
        </div>

        <div class="canvas-montage__row">
          <span>{{ t('单格画幅') }}</span>
          <div class="canvas-presets__picks canvas-montage__picks">
            <button
              v-for="item in MONTAGE_RATIOS"
              :key="item.id"
              type="button"
              :class="{ 'is-on': ratio === item.id }"
              @click="ratio = item.id"
            >
              <strong>{{ item.id === 'original' ? t(item.label) : item.label }}</strong>
            </button>
          </div>
        </div>

        <div class="canvas-montage__row">
          <span>{{ t('间距') }}</span>
          <input v-model.number="gap" type="range" min="0" :max="MONTAGE_GAP_MAX" step="2">
          <em>{{ gap }}px</em>
        </div>

        <div class="canvas-montage__row">
          <label class="canvas-montage__check">
            <input v-model="number" type="checkbox">
            <span>{{ t('加序号') }}</span>
          </label>
          <button type="button" class="canvas-montage__go" :disabled="count < 2" @click="onConfirm">
            {{ t('拼接') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
