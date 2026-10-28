<script setup lang="ts">
import campaignApi from '~/api/campaign'
import workApi from '~/api/work'
import type { Asset, Work } from '~/types/creative'
import { useCampaign } from '~/composables/useCampaign'
import { resolveMediaUrl } from '~/utils/media'
import { workLangForLocale, workLangUsesChinesePlaza } from '~/utils/work-lang'

const { t, locale } = useI18n()
const { growth } = useStudioAppConfig()
const openSourceHint = computed(() => {
  const n = Number(growth.value?.work_clone_points) || 0
  if (n > 0)
    return t('开源作品可被做同款，每次被做同款作者得 {n} 积分', { n })
  return t('开源作品可被做同款，获得推荐加权与积分')
})

/**
 * 从视频资产发布作品（POST /user/work）。入口：资产页「发布为作品」、画布视频节点右键「发布为作品」。
 */
const props = defineProps<{
  open: boolean
  asset: { id: number, name: string, url: string, cover_url?: string } | null
  projectId?: number
  /** 从画布发布时传入：作品关联画布，播放页可查看制作过程 */
  canvasId?: number
}>()

const emit = defineEmits<{
  close: []
  published: [work: Work]
}>()

const toast = useToast()
const localePath = useLocalePath()
const submitting = ref(false)
const pickerOpen = ref(false)
const { names: categories, load: loadCategories } = useContentCategories('work')
const form = reactive({ title: '', description: '', category: categories.value[0] ?? '', cover: '', showProcess: true, openSource: true })
const error = ref('')
const coverFrame = ref<{ width: number, height: number } | null>(null)
const { running: runningCampaign, loadList: loadCampaigns } = useCampaign()

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
  if (!open)
    return
  const base = (props.asset?.name || '').replace(/\.[a-z0-9]+$/i, '')
  form.title = base && !/^GT\d+/.test(base) ? base : ''
  form.description = ''
  form.category = categories.value[0] ?? ''
  void loadCategories()
  form.cover = ''
  coverFrame.value = null
  form.showProcess = true
  form.openSource = true
  error.value = ''
  // 发布成功后要给「投稿到活动」入口，提前把活动列表拉好（无活动就不出现）
  void loadCampaigns()
}, { immediate: true })

/** 一键把刚发布的作品投进进行中的活动（POST /user/work/:id/enter，API.md 8.6） */
async function enterCampaign(work: Work) {
  const campaign = runningCampaign.value
  if (!campaign)
    return
  const res = await campaignApi.enter(work.id, campaign.id)
  if (!res?.success) {
    toast.add({ title: res?.message || t('投稿失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  toast.add({
    title: t('投稿成功，审核通过后出现在投稿墙'),
    description: campaign.title,
    color: 'success',
    close: false,
    progress: false,
    orientation: 'horizontal',
    actions: [{ label: t('查看活动'), onClick: () => void navigateTo(localePath(`/campaign/${campaign.slug}`)) }],
  })
}

function onCoverPicked(assets: Asset[]) {
  const asset = assets.find(item => item.type === 'image') || assets[0]
  if (!asset)
    return
  pickerOpen.value = false
  coverFrame.value = null
  form.cover = asset.url
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open && !submitting.value && !pickerOpen.value) {
    event.stopPropagation()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))

async function submit() {
  if (submitting.value || !props.asset)
    return
  const title = form.title.trim()
  if (!title) {
    error.value = t('请填写作品标题')
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const res = await workApi.publish({
      title,
      description: form.description.trim(),
      category: form.category,
      asset_id: props.asset.id,
      project_id: props.projectId || undefined,
      canvas_id: props.canvasId || undefined,
      cover_url: form.cover.trim() || undefined,
      show_process: props.canvasId ? form.showProcess : undefined,
      // 开源创作过程（API.md 7.1）：观众可「做同款」，来源画布即发布时所在画布
      source_canvas_id: props.canvasId && form.openSource ? props.canvasId : undefined,
      open_source: props.canvasId ? (form.openSource ? 1 : 0) : undefined,
      // 作品语种（F6，API.md 10.7）：后端要求前端按界面语言传，英文界面发 en
      lang: workLangForLocale(locale.value),
    })
    if (!res?.success || !res.data) {
      error.value = res?.message || t('发布失败，请稍后重试')
      return
    }
    const work = res.data
    toast.add({
      title: t('作品已发布到首页'),
      description: work.title,
      color: 'success',
      close: false,
      progress: false,
      orientation: 'horizontal',
      actions: [{ label: t('查看'), onClick: () => void navigateTo(localePath(`/watch/${work.id}`)) }],
    })
    // 活动投稿引导（API.md 8.6）：有进行中的活动才出现，非阻塞
    if (runningCampaign.value) {
      toast.add({
        title: t('有进行中的活动，投稿参赛可冲榜领奖'),
        description: runningCampaign.value.title,
        color: 'neutral',
        close: true,
        progress: false,
        orientation: 'horizontal',
        actions: [{ label: t('投稿到活动'), onClick: () => void enterCampaign(work) }],
      })
    }
    // 站外投稿引导（API.md 8.5）：非阻塞，第二条 toast 带去创作伙伴计划的入口
    toast.add({
      title: t('发到抖音 / 小红书后，来创作伙伴计划领积分'),
      color: 'neutral',
      close: true,
      progress: false,
      orientation: 'horizontal',
      actions: [{ label: t('去投稿'), onClick: () => void navigateTo(localePath({ path: '/settings', query: { tab: 'partner' } })) }],
    })
    emit('published', work)
    emit('close')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && asset" class="studio-modal-mask" @click.self="!submitting && emit('close')" @pointerdown.stop>
      <div class="studio-modal publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="publish-title">{{ t('发布为作品') }}</h2>
            <p>{{ t('发布后出现在首页「精选成片」，可随时下架') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" :disabled="submitting" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="publish-modal__body">
          <video class="publish-stage" :src="resolveMediaUrl(asset.url)" :poster="form.cover ? resolveMediaUrl(form.cover) : (asset.cover_url ? resolveMediaUrl(asset.cover_url) : undefined)" controls muted playsinline preload="metadata" />
          <div class="publish-modal__form">
            <label class="publish-field">
              <span>{{ t('标题') }} <i>*</i></span>
              <input v-model="form.title" maxlength="60" :placeholder="t('给作品起个名字')" @keydown.enter.prevent="submit">
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
            <label v-if="canvasId" class="publish-check">
              <input v-model="form.showProcess" type="checkbox">
              <span>{{ t('公开制作过程（观众可查看画布里的节点与提示词）') }}</span>
            </label>
            <label v-if="canvasId" class="publish-switch">
              <span class="pref-switch"><input v-model="form.openSource" type="checkbox"><i /></span>
              <span class="publish-switch__text">
                <strong>{{ t('开源创作过程') }}</strong>
                <small>{{ openSourceHint }}</small>
              </span>
            </label>
            <p v-if="workLangUsesChinesePlaza(locale)" class="publish-note">{{ t('当前界面语言发布后会进中文广场') }}</p>
            <p v-if="error" class="publish-error">{{ error }}</p>
          </div>
        </div>

        <footer class="publish-modal__foot">
          <button type="button" class="plan-btn plan-btn--ghost" :disabled="submitting" @click="emit('close')">{{ t('取消') }}</button>
          <button type="button" class="plan-btn plan-btn--solid" :disabled="submitting" @click="submit">
            {{ submitting ? t('发布中…') : t('发布') }}
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
