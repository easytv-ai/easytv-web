<script setup lang="ts">
import workApi from '~/api/work'
import type { Work } from '~/types/creative'

/**
 * 成片卡片右上角喜欢：点一下切换点赞（POST /user/work/:id/like），未登录先去登录。
 * 直接改传入的 work.liked / like_count，列表不用再自己同步。
 */
const props = defineProps<{
  work: Work
}>()

const { t } = useI18n()
const toast = useToast()
const { requireLogin } = useRequireLogin()
const liking = ref(false)

const liked = computed(() => Boolean(props.work.liked))
const count = computed(() => Number(props.work.like_count || 0))
const label = computed(() => liked.value ? t('取消喜欢') : t('喜欢'))

async function toggle(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  if (liking.value)
    return
  if (!requireLogin())
    return
  const beforeLiked = Boolean(props.work.liked)
  const beforeCount = Number(props.work.like_count || 0)
  props.work.liked = !beforeLiked
  props.work.like_count = Math.max(0, beforeCount + (beforeLiked ? -1 : 1))
  liking.value = true
  try {
    const res = await workApi.like(props.work.id)
    if (!res?.success || !res.data) {
      props.work.liked = beforeLiked
      props.work.like_count = beforeCount
      toast.add({ title: res?.message || t('操作失败'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    props.work.liked = res.data.liked
    props.work.like_count = res.data.like_count
  }
  finally {
    liking.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="show-card__likes"
    :class="{ 'is-on': liked }"
    :aria-label="label"
    :disabled="liking"
    @click="toggle"
  >
    <svg class="show-card__likes-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
    <span>{{ count }}</span>
  </button>
</template>
