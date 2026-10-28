<script setup lang="ts">
import skillApi from '~/api/skill'
import type { SkillReviewStatus } from '~/types/creative'

const { t } = useI18n()

export type AgentSkill = {
  id?: number
  title: string
  desc: string
  author: string
  uses: string
  stars?: string
  tag: string
  cover: string
  src?: string
  scene?: string
  howto?: string
  output?: string
  /** 提示词模板（{{prompt}} 占位），「加入创作台」时带进画布 */
  prompt?: string
  favorited?: boolean
  /** 自己创建的私有 Skill：可编辑 / 删除 */
  mine?: boolean
  /** 上架审核状态（API.md 8.3），仅 mine 有意义 */
  reviewStatus?: SkillReviewStatus
  reviewRemark?: string
  /** 同团队成员共享过来的（API.md 10.10）：只能使用，改 / 删 / 上架后端都会拒绝 */
  teamShared?: boolean
  /** teamShared 时的共享者昵称 */
  sharedAuthor?: string
}

const props = defineProps<{
  skill: AgentSkill | null
}>()

const emit = defineEmits<{
  close: []
  /** 收藏状态变化，父组件同步列表 */
  favorite: [id: number, favorited: boolean, stars: number]
  edit: [id: number]
  /** 提交上架 / 撤回成功，父组件刷新「我的」列表 */
  review: [id: number, status: SkillReviewStatus]
}>()

const toast = useToast()
const localePath = useLocalePath()
const { requireLogin } = useRequireLogin()
const { confirm } = useConfirm()
const { growth, load: loadAppConfig } = useStudioAppConfig()
const reviewing = ref(false)

/** 上架状态文案与样式（0 私有 1 待审 2 已上架 3 驳回） */
const REVIEW_LABEL: Record<SkillReviewStatus, { label: string, cls: string }> = {
  0: { label: t('私有'), cls: 'is-private' },
  1: { label: t('审核中'), cls: 'is-pending' },
  2: { label: t('已上架'), cls: 'is-published' },
  3: { label: t('已驳回'), cls: 'is-rejected' },
}
const reviewStatus = computed<SkillReviewStatus>(() => props.skill?.reviewStatus ?? 0)
/** 自己的技能才给编辑 / 上架入口；别人共享过来的只读（API.md 10.10） */
const canManage = computed(() => Boolean(props.skill?.mine && props.skill?.id && !props.skill?.teamShared))
const reviewBadge = computed(() => REVIEW_LABEL[reviewStatus.value] ?? REVIEW_LABEL[0])
const canSubmitReview = computed(() => reviewStatus.value === 0 || reviewStatus.value === 3)
const canWithdrawReview = computed(() => reviewStatus.value === 1 || reviewStatus.value === 2)
const sharePct = computed(() => Math.round((growth.value?.skill_author_share ?? 0) * 100))
const saved = ref(false)
const starsCount = ref(0)
const favoriting = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)

const scene = computed(() => props.skill?.scene || t('{category}、内容成片', { category: props.skill?.tag ?? '' }))
const howto = computed(() => props.skill?.howto || t('一份剧本或一句话，可选人脸/造型参考图'))
const output = computed(() => {
  if (props.skill?.output)
    return props.skill.output
  if (props.skill?.tag === '短剧漫剧')
    return t('角色/道具/场景资产图、逐镜分镜表格、仙侠短剧视频成片')
  return t('角色/道具/场景资产图、逐镜分镜表格、视频成片')
})
const stars = computed(() => starsCount.value ? String(starsCount.value) : (props.skill?.stars || '0'))

watch(() => props.skill, (skill) => {
  saved.value = Boolean(skill?.favorited)
  starsCount.value = 0
  if (!import.meta.client)
    return
  document.body.style.overflow = skill ? 'hidden' : ''
  nextTick(() => {
    const video = videoRef.value
    if (!video)
      return
    video.pause()
    video.currentTime = 0
  })
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.skill)
    emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void loadAppConfig()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (import.meta.client)
    document.body.style.overflow = ''
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

/** 分享：复制 Agent 页带 skill 参数的链接，打开即弹出本 Skill */
function onShare() {
  const url = new URL(window.location.href)
  url.pathname = localePath('/agent')
  url.search = props.skill?.id ? `?skill=${props.skill.id}` : ''
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(url.toString())
    notify(t('链接已复制'), 'success')
    return
  }
  notify(t('当前浏览器不支持复制'), 'error')
}

async function onSave() {
  if (!props.skill?.id || favoriting.value)
    return
  if (!requireLogin())
    return
  favoriting.value = true
  try {
    const res = await skillApi.favorite(props.skill.id)
    if (!res?.success || !res.data) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    saved.value = res.data.favorited
    starsCount.value = res.data.stars
    emit('favorite', props.skill.id, res.data.favorited, res.data.stars)
    notify(
      res.data.favorited ? t('已加入收藏，可在「收藏」中查看') : t('已从收藏中移除'),
      'success',
    )
  }
  finally {
    favoriting.value = false
  }
}

/** 提交上架（API.md 8.3）：私有 / 驳回可提交，审核通过后进入公开市场并按比例分成 */
async function onSubmitReview() {
  if (!props.skill?.id || reviewing.value || !requireLogin())
    return
  if (!(await confirm({
    title: t('提交上架'),
    message: t('上架后所有人都能使用这个 Skill，他人调用时你按 {rate}% 分成，审核通过后自动上架。', { rate: sharePct.value }),
    confirmText: t('提交上架'),
  })))
    return
  reviewing.value = true
  try {
    const res = await skillApi.submit(props.skill.id)
    if (!res?.success) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    notify(t('已提交审核，通过后自动上架'), 'success')
    emit('review', props.skill.id, 1)
  }
  finally {
    reviewing.value = false
  }
}

/** 撤回：已上架 / 待审 → 私有 */
async function onWithdrawReview() {
  if (!props.skill?.id || reviewing.value || !requireLogin())
    return
  if (!(await confirm({
    title: t('撤回'),
    message: reviewStatus.value === 2
      ? t('撤回后 Skill 将从市场下架，不再产生分成，可随时重新提交。')
      : t('撤回后取消本次审核，可随时重新提交。'),
    confirmText: t('撤回'),
    danger: true,
  })))
    return
  reviewing.value = true
  try {
    const res = await skillApi.withdraw(props.skill.id)
    if (!res?.success) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    notify(t('已撤回'), 'success')
    emit('review', props.skill.id, 0)
  }
  finally {
    reviewing.value = false
  }
}

/** 加入创作台：带着 Skill 进入新画布，画布会用提示词模板生成文本节点 */
function onAdd() {
  if (!props.skill?.id)
    return
  if (!requireLogin())
    return
  emit('close')
  void navigateTo(localePath({ path: '/canvas', query: { skill: String(props.skill.id) } }))
}
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        v-if="skill"
        class="studio-modal-mask skill-modal-mask"
        @click.self="emit('close')"
      >
        <section class="skill-modal" role="dialog" aria-modal="true" aria-labelledby="skill-modal-title">
          <div class="skill-modal__top">
            <button type="button" class="skill-modal__close" :aria-label="t('关闭')" @click="emit('close')">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>

            <header class="skill-modal__head">
              <div>
                <h2 id="skill-modal-title">{{ skill.title }}</h2>
                <div class="skill-modal__meta">
                  <span class="skill-modal__author">
                    <i>{{ skill.author.slice(0, 1) }}</i>
                    {{ skill.author }}
                  </span>
                  <span class="skill-modal__dot">·</span>
                  <span>{{ skill.teamShared ? t('团队共享') : skill.mine ? t('我的 Skill') : t(skill.tag) }}</span>
                  <i v-if="skill.teamShared" class="skill-review-badge is-team">
                    <UIcon name="i-lucide-users" class="size-3" />
                    {{ skill.sharedAuthor || t('团队成员') }}
                  </i>
                  <i
                    v-if="canManage"
                    class="skill-review-badge"
                    :class="reviewBadge.cls"
                    :title="reviewStatus === 3 && skill.reviewRemark ? skill.reviewRemark : undefined"
                  >
                    {{ reviewBadge.label }}
                    <UIcon v-if="reviewStatus === 3 && skill.reviewRemark" name="i-lucide-info" class="size-3" />
                  </i>
                  <span>
                    <UIcon name="i-lucide-users" class="size-3.5" />
                    {{ skill.uses }}
                  </span>
                  <span>
                    <UIcon name="i-lucide-star" class="size-3.5" />
                    {{ stars }}
                  </span>
                </div>
              </div>
              <div class="skill-modal__actions">
                <button
                  v-if="canManage && canSubmitReview"
                  type="button"
                  class="studio-icon-btn"
                  :aria-label="t('提交上架')"
                  :disabled="reviewing"
                  @click="onSubmitReview"
                >
                  <UIcon name="i-lucide-upload" class="size-4" />
                  <span class="canvas-tip canvas-tip--down">{{ t('提交上架') }}</span>
                </button>
                <button
                  v-else-if="canManage && canWithdrawReview"
                  type="button"
                  class="studio-icon-btn"
                  :aria-label="t('撤回')"
                  :disabled="reviewing"
                  @click="onWithdrawReview"
                >
                  <UIcon name="i-lucide-undo-2" class="size-4" />
                  <span class="canvas-tip canvas-tip--down">{{ t('撤回') }}</span>
                </button>
                <button v-if="canManage && skill.id" type="button" class="studio-icon-btn" :aria-label="t('编辑')" @click="emit('edit', skill.id)">
                  <UIcon name="i-lucide-pencil" class="size-4" />
                  <span class="canvas-tip canvas-tip--down">{{ t('编辑') }}</span>
                </button>
                <button type="button" class="studio-icon-btn" :aria-label="t('分享')" @click="onShare">
                  <UIcon name="i-lucide-share-2" class="size-4" />
                  <span class="canvas-tip canvas-tip--down">{{ t('分享') }}</span>
                </button>
                <button
                  type="button"
                  class="studio-icon-btn"
                  :class="{ 'is-on': saved }"
                  :aria-label="saved ? t('取消收藏') : t('收藏')"
                  :disabled="favoriting"
                  @click="onSave"
                >
                  <UIcon name="i-lucide-star" class="size-4" />
                  <span class="canvas-tip canvas-tip--down">{{ saved ? t('取消收藏') : t('收藏') }}</span>
                </button>
                <button type="button" class="skill-modal__add" @click="onAdd">
                  {{ t('加入创作台') }}
                </button>
              </div>
            </header>
          </div>

          <div class="skill-modal__body">
            <div class="skill-modal__stage">
              <video
                v-if="skill.src"
                :key="skill.src || skill.cover"
                ref="videoRef"
                :src="skill.src"
                :poster="skill.cover"
                controls
                playsinline
                preload="metadata"
              />
              <img v-else :src="skill.cover" :alt="skill.title">
            </div>

            <div class="skill-modal__intro">
              <h3>{{ t('简介') }}</h3>
              <dl>
                <div>
                  <dt>{{ t('介绍') }}</dt>
                  <dd>{{ skill.desc || t('暂无介绍') }}</dd>
                </div>
                <div>
                  <dt>{{ t('使用场景') }}</dt>
                  <dd>{{ scene }}</dd>
                </div>
                <div>
                  <dt>{{ t('如何使用') }}</dt>
                  <dd>{{ howto }}</dd>
                </div>
                <div>
                  <dt>{{ t('输出内容') }}</dt>
                  <dd>{{ output }}</dd>
                </div>
                <div v-if="skill.mine && skill.prompt">
                  <dt>{{ t('提示词模板') }}</dt>
                  <dd class="skill-modal__prompt">{{ skill.prompt }}</dd>
                </div>
                <div v-if="canManage && reviewStatus === 3 && skill.reviewRemark">
                  <dt>{{ t('驳回原因') }}</dt>
                  <dd class="skill-modal__remark">{{ skill.reviewRemark }}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </ClientOnly>
</template>
