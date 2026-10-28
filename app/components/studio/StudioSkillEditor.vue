<script setup lang="ts">
import skillApi, { type MySkillPayload } from '~/api/skill'
import type { Asset, Skill } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/**
 * 我的 Skill 编辑器（POST / PUT /user/skill）：私有提示词模板，{{prompt}} 为灵感占位。
 */
const props = defineProps<{
  open: boolean
  /** 传入表示编辑，否则新建 */
  skill: Skill | null
  /** 新建时的预填（从画布「存为 Skill」） */
  preset?: { title?: string, description?: string, prompt?: string, category?: string, cover_url?: string, scene?: string } | null
  /** 新建时把该画布作为模板一起保存 */
  canvasId?: number
  /** 画布节点数，仅展示用 */
  canvasNodes?: number
}>()

const emit = defineEmits<{
  close: []
  saved: [skill: Skill | null]
}>()

const toast = useToast()
/** 模板里的灵感占位，写成常量避免模板解析把 {{ 当插值 */
const PH = '{{prompt}}'
const { names: categories, load: loadCategories } = useContentCategories('skill')
const submitting = ref(false)
const error = ref('')
const pickerOpen = ref(false)
const form = reactive({ title: '', description: '', category: '', cover_url: '', prompt: '', guide: '', output_format: '', scene: '', howto: '', output: '', shared: false })

watch(() => props.open, (open) => {
  if (!open)
    return
  void loadCategories()
  error.value = ''
  const src = props.skill ?? props.preset ?? {}
  Object.assign(form, {
    title: src.title ?? '',
    description: src.description ?? '',
    category: src.category ?? '',
    cover_url: src.cover_url ?? '',
    prompt: src.prompt ?? '',
    guide: props.skill?.guide ?? '',
    output_format: props.skill?.output_format ?? '',
    scene: src.scene ?? '',
    howto: props.skill?.howto ?? '',
    output: props.skill?.output ?? '',
    // 只有编辑已有技能时才带共享状态；shared=1 即已共享给团队（API.md 10.10）
    shared: props.skill?.shared === 1,
  })
})

const withTemplate = computed(() => !props.skill && !!props.canvasId)

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
  form.cover_url = asset.url
}

function insertPlaceholder() {
  if (!form.prompt.includes(PH))
    form.prompt = `${form.prompt.trim()}${form.prompt.trim() ? '\n' : ''}${PH}`
}

async function submit() {
  if (submitting.value)
    return
  const title = form.title.trim()
  const prompt = form.prompt.trim()
  if (!title) {
    error.value = t('请填写名称')
    return
  }
  if (!prompt) {
    error.value = t('请填写提示词模板')
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const payload: MySkillPayload = {
      title,
      prompt,
      description: form.description.trim(),
      category: form.category,
      cover_url: form.cover_url.trim(),
      guide: form.guide.trim(),
      output_format: form.output_format.trim(),
      scene: form.scene.trim(),
      howto: form.howto.trim(),
      output: form.output.trim(),
      shared: form.shared,
    }
    const res = props.skill
      ? await skillApi.update(props.skill.id, payload)
      : await skillApi.create({ ...payload, title, prompt, ...(props.canvasId ? { canvas_id: props.canvasId } : {}) })
    if (!res?.success) {
      error.value = res?.message || t('保存失败')
      return
    }
    toast.add({ title: props.skill ? t('Skill 已更新') : t('Skill 已创建'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    emit('saved', props.skill ? null : (res.data as Skill | null))
    emit('close')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="!submitting && emit('close')">
      <div class="studio-modal publish-modal skill-editor" role="dialog" aria-modal="true" aria-labelledby="skill-editor-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="skill-editor-title">{{ skill ? t('编辑 Skill') : t('新建 Skill') }}</h2>
            <p v-if="withTemplate">{{ t('会把当前画布的 {n} 个节点一起保存为模板，下次「加入创作台」直接生成整块画布', { n: canvasNodes ?? 0 }) }}</p>
            <p v-else>{{ t('私有提示词模板，只有你自己可见；在模板里用 {ph} 代表输入的灵感', { ph: PH }) }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="publish-modal__form skill-editor__form">
          <label class="publish-field">
            <span>{{ t('名称') }} <i>*</i></span>
            <input v-model="form.title" maxlength="100" :placeholder="t('例如：赛博夜景广告')">
          </label>
          <label class="publish-field">
            <span>{{ t('提示词模板') }} <i>*</i></span>
            <textarea v-model="form.prompt" rows="5" maxlength="4000" :placeholder="withTemplate ? t('说明这个模板怎么用，或写一段总提示词；{ph} 会被替换成输入的灵感', { ph: PH }) : t('描述风格、镜头、节奏……用 {ph} 放入灵感', { ph: PH })" />
            <button type="button" class="skill-editor__ph" @click="insertPlaceholder">{{ t('插入 {ph} 占位', { ph: PH }) }}</button>
          </label>
          <label class="publish-field">
            <span>{{ t('一句话介绍') }}</span>
            <input v-model="form.description" maxlength="500" :placeholder="t('选填')">
          </label>
          <label class="publish-field">
            <span>{{ t('分类') }}</span>
            <div class="publish-tags">
              <button
                v-for="c in categories"
                :key="c"
                type="button"
                :class="{ 'is-on': form.category === c }"
                @click="form.category = form.category === c ? '' : c"
              >
                {{ t(c) }}
              </button>
            </div>
          </label>
          <label class="publish-field">
            <span>{{ t('封面') }}</span>
            <div class="skill-editor__cover">
              <img v-if="form.cover_url" :src="resolveMediaUrl(form.cover_url)" alt="">
              <button type="button" class="plan-btn plan-btn--ghost" @click="pickerOpen = true">{{ form.cover_url ? t('更换封面') : t('从资产库选择') }}</button>
              <button v-if="form.cover_url" type="button" class="plan-btn plan-btn--ghost" @click="form.cover_url = ''">{{ t('清除') }}</button>
            </div>
          </label>
          <label class="publish-field">
            <span>{{ t('执行规则') }}</span>
            <textarea
              v-model="form.guide"
              rows="4"
              maxlength="4000"
              :placeholder="t('选填。这个技能要求 AI 按什么步骤做、必须先问清什么、有哪些不能做的事')"
            />
            <small class="skill-editor__hint">{{ t('只对文字对话生效，会拼在提示词最前面；生图生视频不受影响') }}</small>
          </label>
          <label class="publish-field">
            <span>{{ t('输出格式') }}</span>
            <textarea
              v-model="form.output_format"
              rows="3"
              maxlength="4000"
              :placeholder="t('选填。产出应该长什么样，比如分镜表的列、每段的字数上限')"
            />
          </label>
          <label class="publish-field">
            <span>{{ t('使用场景') }}</span>
            <input v-model="form.scene" maxlength="200" :placeholder="t('选填')">
          </label>
          <label class="publish-switch">
            <span class="pref-switch"><input v-model="form.shared" type="checkbox" :disabled="submitting"><i /></span>
            <span class="publish-switch__text">
              <strong>{{ t('共享给团队') }}</strong>
              <small>{{ t('同团队成员都能使用这个 Skill，但不能修改或删除') }}</small>
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
