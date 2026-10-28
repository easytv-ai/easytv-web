<script setup lang="ts">
import styleApi, { type MyStylePayload } from '~/api/style'
import type { Asset, Style } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

/**
 * 我的风格编辑器（API.md 34.5，POST / PUT /user/style）：名字 + 提示词片段 + 封面，
 * 可手写，也可由「从当前图定风格」预填（preset 带 prompt / cover_url / source_asset_id）。
 * 保存成功 emit saved(style)，由工作区决定是刷新列表还是直接套用。
 */
export type StylePreset = {
  name?: string
  prompt?: string
  cover_url?: string
  negative?: string
  category?: string
  tags?: string[]
  kinds?: Array<'image' | 'video'>
  source_asset_id?: number
}

const props = defineProps<{
  open: boolean
  /** 传入表示编辑，否则新建（不叫 style：那是 Vue 保留的属性名，传 null 会被归一成 undefined 触发类型告警） */
  editing?: Style | null
  /** 新建时的预填 */
  preset?: StylePreset | null
}>()

const emit = defineEmits<{
  close: []
  saved: [style: Style, mode: 'create' | 'update']
}>()

const { t } = useI18n()
const toast = useToast()

const NAME_MAX = 50
const PROMPT_MAX = 2000
const NEGATIVE_MAX = 500

type KindChoice = 'all' | 'image' | 'video'

const submitting = ref(false)
const error = ref('')
const pickerOpen = ref(false)
/** 官方风格库已有的分类，做分类输入建议 */
const categories = ref<string[]>([])
const form = reactive({ name: '', prompt: '', negative: '', tags: '', category: '', kind: 'all' as KindChoice, cover_url: '', source_asset_id: 0 })

const kindChoices = computed<Array<{ id: KindChoice, label: string }>>(() => [
  { id: 'all', label: t('都可') },
  { id: 'image', label: t('仅图片') },
  { id: 'video', label: t('仅视频') },
])

/** 预填来自一张图时封面只读展示，不给换 */
const coverLocked = computed(() => !props.editing && !!props.preset?.source_asset_id && !!props.preset?.cover_url)

function kindOf(kinds?: Array<'image' | 'video'>): KindChoice {
  if (!kinds || kinds.length !== 1)
    return 'all'
  return kinds[0] === 'video' ? 'video' : 'image'
}

watch(() => props.open, (open) => {
  if (!open)
    return
  error.value = ''
  pickerOpen.value = false
  if (!categories.value.length) {
    styleApi.categories().then((res) => {
      if (res?.success && Array.isArray(res.data))
        categories.value = res.data
    }).catch(() => {})
  }
  const src: StylePreset = props.editing ?? props.preset ?? {}
  Object.assign(form, {
    name: src.name ?? '',
    prompt: src.prompt ?? '',
    negative: src.negative ?? '',
    tags: (src.tags ?? []).join(', '),
    category: src.category ?? '',
    kind: kindOf(src.kinds),
    cover_url: src.cover_url ?? '',
    source_asset_id: props.editing?.source_asset_id ?? src.source_asset_id ?? 0,
  })
}, { immediate: true })

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
  pickerOpen.value = false
  if (asset)
    form.cover_url = asset.url
}

function parseTags(raw: string) {
  const out: string[] = []
  for (const item of raw.split(/[,，]/)) {
    const tag = item.trim().slice(0, 30)
    if (tag && !out.includes(tag))
      out.push(tag)
  }
  return out
}

async function submit() {
  if (submitting.value)
    return
  const name = form.name.trim()
  const prompt = form.prompt.trim()
  if (!name) {
    error.value = t('请填写风格名')
    return
  }
  if (!prompt) {
    error.value = t('请填写风格提示词')
    return
  }
  if (prompt.length > PROMPT_MAX) {
    error.value = t('风格提示词过长')
    return
  }
  const negative = form.negative.trim()
  if (negative.length > NEGATIVE_MAX) {
    error.value = t('负向提示词过长')
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const kinds: Array<'image' | 'video'> = form.kind === 'all' ? [] : [form.kind]
    const payload: MyStylePayload = {
      name: name.slice(0, NAME_MAX),
      prompt,
      cover_url: form.cover_url.trim(),
      negative,
      tags: parseTags(form.tags),
      category: form.category.trim().slice(0, 50),
      kinds,
      ...(props.editing ? {} : { source_asset_id: form.source_asset_id || 0 }),
    }
    const res = props.editing
      ? await styleApi.update(props.editing.id, payload)
      : await styleApi.create({ ...payload, name: payload.name!, prompt })
    if (!res?.success) {
      error.value = res?.message || t('保存失败')
      return
    }
    const base: Style = props.editing
      ? { ...props.editing }
      : { id: 0, name, cover_url: '', prompt, negative: '', tags: [], category: '', kinds: [], uses: 0, status: 1 }
    const saved: Style = {
      ...base,
      ...(res.data && typeof res.data === 'object' ? res.data : {}),
      name: payload.name!,
      prompt,
      cover_url: payload.cover_url || '',
      negative,
      tags: payload.tags || [],
      category: payload.category || '',
      kinds,
    }
    if (res.data && typeof res.data === 'object' && res.data.id)
      saved.id = res.data.id
    // 已收录的风格改动后服务端自动回到待审核；服务端没回视图时本地同步这一态
    if (props.editing && props.editing.status === 4 && !(res.data && typeof res.data === 'object' && res.data.status))
      saved.status = 3
    toast.add({ title: props.editing ? t('风格已更新') : t('风格已保存'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    emit('saved', saved, props.editing ? 'update' : 'create')
    emit('close')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="!submitting && emit('close')" @pointerdown.stop>
      <div class="studio-modal publish-modal skill-editor style-editor" role="dialog" aria-modal="true" aria-labelledby="style-editor-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="style-editor-title">{{ editing ? t('编辑风格') : t('新建风格') }}</h2>
            <p v-if="editing && editing.status === 4">{{ t('这个风格已收录进官方风格库，改动后会重新送审') }}</p>
            <p v-else>{{ t('生成时把提示词片段接在节点提示词末尾；只有你自己可见，也可以投稿进官方风格库') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="publish-modal__form skill-editor__form">
          <label class="publish-field">
            <span>{{ t('风格名') }} <i>*</i></span>
            <input v-model="form.name" :maxlength="NAME_MAX" :placeholder="t('例如：胶片暖调')">
          </label>
          <label class="publish-field">
            <span>{{ t('提示词片段') }} <i>*</i></span>
            <textarea v-model="form.prompt" rows="5" :maxlength="PROMPT_MAX" :placeholder="t('描述媒介、色调、光线、构图、质感……不写主体内容')" />
            <small class="skill-editor__hint">{{ form.prompt.length }} / {{ PROMPT_MAX }}</small>
          </label>
          <label class="publish-field">
            <span>{{ t('负向提示词') }}</span>
            <input v-model="form.negative" :maxlength="NEGATIVE_MAX" :placeholder="t('选填')">
          </label>
          <label class="publish-field">
            <span>{{ t('标签') }}</span>
            <input v-model="form.tags" :placeholder="t('用逗号分隔，选填')">
          </label>
          <label class="publish-field">
            <span>{{ t('分类') }}</span>
            <input v-model="form.category" list="style-editor-categories" maxlength="50" :placeholder="t('选填，例如：电影感')">
            <datalist id="style-editor-categories">
              <option v-for="c in categories" :key="c" :value="c" />
            </datalist>
          </label>
          <div class="publish-field">
            <span>{{ t('适用') }}</span>
            <div class="publish-tags">
              <button
                v-for="item in kindChoices"
                :key="item.id"
                type="button"
                :class="{ 'is-on': form.kind === item.id }"
                @click="form.kind = item.id"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
          <div class="publish-field">
            <span>{{ t('封面') }}</span>
            <div class="skill-editor__cover">
              <img v-if="form.cover_url" :src="resolveMediaUrl(form.cover_url)" alt="">
              <template v-if="coverLocked">
                <small class="skill-editor__hint">{{ t('封面取自定风格的那张图') }}</small>
              </template>
              <template v-else>
                <button type="button" class="plan-btn plan-btn--ghost" @click="pickerOpen = true">{{ form.cover_url ? t('更换封面') : t('从资产库选择') }}</button>
                <button v-if="form.cover_url" type="button" class="plan-btn plan-btn--ghost" @click="form.cover_url = ''">{{ t('清除') }}</button>
              </template>
            </div>
            <small v-if="!form.cover_url" class="skill-editor__hint">{{ t('没有封面时显示纯文字卡片；投稿需要一张封面') }}</small>
          </div>
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
