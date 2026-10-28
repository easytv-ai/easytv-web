<script setup lang="ts">
import workApi from '~/api/work'
import type { Asset, Work } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()
const { growth } = useStudioAppConfig()
const openSourceHint = computed(() => {
  const n = Number(growth.value?.work_clone_points) || 0
  if (n > 0)
    return t('开源作品可被做同款，每次被做同款作者得 {n} 积分', { n })
  return t('开源作品可被做同款，获得推荐加权与积分')
})

/** 作者编辑已发布作品：标题、简介、分类、封面、是否公开制作过程（PUT /user/work/:id）。 */
const props = defineProps<{
  open: boolean
  work: Work | null
}>()

const emit = defineEmits<{
  close: []
  saved: [work: Work]
}>()

const toast = useToast()
const { names: categories, load: loadCategories } = useContentCategories('work')
const submitting = ref(false)
const error = ref('')
const pickerOpen = ref(false)
const coverFrame = ref<{ width: number, height: number } | null>(null)
const form = reactive({ title: '', description: '', category: '', cover: '', showProcess: true, openSource: false })

/** 封面框跟着原图比例走，最长边 220，避免竖图被塞进横框裁掉两边 */
function onCoverLoad(event: Event) {
  const img = event.target as HTMLImageElement
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!width || !height)
    return
  const max = 220
  const ratio = width / height
  coverFrame.value = ratio >= 1
    ? { width: max, height: Math.max(96, Math.round(max / ratio)) }
    : { width: Math.max(96, Math.round(max * ratio)), height: max }
}

watch(() => props.open, (open) => {
  if (!open || !props.work)
    return
  void loadCategories()
  error.value = ''
  coverFrame.value = null
  Object.assign(form, {
    title: props.work.title,
    description: props.work.description || '',
    category: props.work.category || '',
    cover: props.work.cover_url || '',
    showProcess: props.work.show_process !== false,
    openSource: props.work.open_source === 1,
  })
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !submitting.value && !pickerOpen.value) {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

function onCoverPicked(assets: Asset[]) {
  const asset = assets.find(item => item.type === 'image') || assets[0]
  if (!asset)
    return
  pickerOpen.value = false
  coverFrame.value = null
  form.cover = asset.url
}

async function submit() {
  if (submitting.value || !props.work)
    return
  const title = form.title.trim()
  if (!title) {
    error.value = t('请填写作品标题')
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const payload = {
      title,
      description: form.description.trim(),
      category: form.category,
      cover_url: form.cover.trim(),
      show_process: form.showProcess,
      // 开源做同款（API.md 7.1）：来源画布缺省用发布时所在画布
      open_source: props.work.canvas_id ? (form.openSource ? 1 : 0) as 0 | 1 : undefined,
      source_canvas_id: props.work.canvas_id && form.openSource ? (props.work.source_canvas_id || props.work.canvas_id) : undefined,
    }
    const res = await workApi.update(props.work.id, payload)
    if (!res?.success) {
      error.value = res?.message || t('保存失败')
      return
    }
    toast.add({ title: t('作品已更新'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    emit('saved', { ...props.work, title, description: payload.description, category: form.category, cover_url: payload.cover_url, show_process: form.showProcess, open_source: payload.open_source ?? props.work.open_source })
    emit('close')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && work" class="studio-modal-mask" @click.self="!submitting && emit('close')">
      <div class="studio-modal publish-modal work-edit" role="dialog" aria-modal="true" aria-labelledby="work-edit-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="work-edit-title">{{ t('编辑作品') }}</h2>
            <p>{{ t('改动会立即体现在首页和播放页') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="publish-modal__form work-edit__form">
          <label class="publish-field">
            <span>{{ t('标题') }} <i>*</i></span>
            <input v-model="form.title" maxlength="60" @keydown.enter.prevent="submit">
          </label>
          <label class="publish-field">
            <span>{{ t('分类') }}</span>
            <div class="publish-tags">
              <button
                v-for="c in categories"
                :key="c"
                type="button"
                :class="{ 'is-on': form.category === c }"
                @click="form.category = c"
              >
                {{ t(c) }}
              </button>
            </div>
          </label>
          <label class="publish-field">
            <span>{{ t('简介') }}</span>
            <textarea v-model="form.description" rows="3" maxlength="300" :placeholder="t('一句话介绍这部作品（选填）')" />
          </label>
          <label class="publish-field">
            <span class="publish-cover__head">
              {{ t('封面') }}
              <small>{{ t('选填，留空用视频首帧') }}</small>
            </span>
            <div class="publish-cover">
              <button
                type="button"
                class="publish-cover__shot"
                :style="coverFrame ? { width: `${coverFrame.width}px`, height: `${coverFrame.height}px` } : undefined"
                :aria-label="form.cover ? t('更换封面') : t('从资产库选择')"
                :disabled="submitting"
                @click="pickerOpen = true"
              >
                <img v-if="form.cover" :src="resolveMediaUrl(form.cover)" alt="" @load="onCoverLoad">
                <UIcon v-else name="i-lucide-plus" class="size-7" />
              </button>
              <button
                v-if="form.cover"
                type="button"
                class="publish-cover__x"
                :aria-label="t('清除')"
                :disabled="submitting"
                @click="form.cover = ''; coverFrame = null"
              >
                <UIcon name="i-lucide-x" class="size-3.5" />
              </button>
            </div>
          </label>
          <label v-if="work.canvas_id" class="publish-check">
            <input v-model="form.showProcess" type="checkbox">
            <span>{{ t('公开制作过程（观众可查看画布里的节点与提示词）') }}</span>
          </label>
          <label v-if="work.canvas_id" class="publish-switch">
            <span class="pref-switch"><input v-model="form.openSource" type="checkbox"><i /></span>
            <span class="publish-switch__text">
              <strong>{{ t('开源创作过程') }}</strong>
              <small>{{ openSourceHint }}</small>
            </span>
          </label>
          <p v-if="error" class="publish-error">{{ error }}</p>
        </div>

        <footer class="plan-confirm__actions publish-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="submitting" @click="emit('close')">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid" :disabled="submitting" @click="submit">
            {{ submitting ? t('保存中…') : t('保存') }}
          </button>
        </footer>
      </div>
    </div>
    <CanvasAssetPicker
      :open="pickerOpen"
      :title="t('选择封面')"
      :accept="['image']"
      @close="pickerOpen = false"
      @pick="onCoverPicked"
    />
  </Teleport>
</template>
