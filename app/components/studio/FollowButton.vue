<script setup lang="ts">
import followApi from '~/api/follow'

/**
 * 关注按钮（API.md 9.2，M11）：未登录先去登录页。关注和取消关注都先二次确认，确认后乐观切换，失败回滚。
 * 父组件用 v-model 之外的 change 事件同步自己的 following / followers。
 */
const props = withDefaults(defineProps<{
  authorId: number
  following?: boolean
  followers?: number
  /** 确认弹窗里带上作者名 */
  name?: string
  /** default 常规按钮；compact 播放页头部；mini 榜单行内 */
  size?: 'default' | 'compact' | 'mini'
}>(), {
  following: false,
  followers: undefined,
  name: '',
  size: 'default',
})

const emit = defineEmits<{
  change: [following: boolean, followers: number]
}>()

const { t } = useI18n()
const toast = useToast()
const { requireLogin } = useRequireLogin()
const { track } = useTrack()
const { confirm } = useConfirm()

const on = ref(props.following)
const busy = ref(false)
const asking = ref(false)

watch(() => props.following, (next) => {
  if (!busy.value)
    on.value = next
})

const label = computed(() => on.value ? t('已关注') : t('关注'))

async function toggle() {
  if (busy.value || asking.value)
    return
  if (!props.authorId)
    return
  if (!requireLogin())
    return
  const next = !on.value
  const name = props.name.trim()
  asking.value = true
  const ok = await confirm({
    title: next ? t('关注作者') : t('取消关注'),
    message: next
      ? (name ? t('关注「{name}」？对方之后发布的作品会出现在你的关注页。', { name }) : t('关注这位作者？对方之后发布的作品会出现在你的关注页。'))
      : (name ? t('取消关注「{name}」？对方的作品将不再出现在你的关注页。', { name }) : t('取消关注这位作者？对方的作品将不再出现在你的关注页。')),
    confirmText: next ? t('关注') : t('取消关注'),
    danger: !next,
  })
  asking.value = false
  if (!ok || busy.value)
    return
  const before = on.value
  const beforeFollowers = Number(props.followers ?? 0)
  // 乐观更新：先翻状态与粉丝数，失败再回滚
  on.value = !before
  emit('change', on.value, Math.max(0, beforeFollowers + (before ? -1 : 1)))
  busy.value = true
  try {
    const res = await followApi.toggle(props.authorId)
    if (!res?.success || !res.data) {
      on.value = before
      emit('change', before, beforeFollowers)
      toast.add({ title: res?.message || t('操作失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    on.value = !!res.data.following
    emit('change', on.value, Number(res.data.followers ?? 0))
    track('follow_author', { author_id: props.authorId, following: on.value ? 1 : 0 })
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="follow-btn"
    :class="[`follow-btn--${size}`, { 'is-on': on }]"
    :disabled="busy || asking"
    :aria-pressed="on"
    @click.prevent.stop="toggle"
  >
    <UIcon v-if="size !== 'mini'" :name="on ? 'i-lucide-user-round-check' : 'i-lucide-user-round-plus'" class="size-4" />
    {{ label }}
  </button>
</template>
