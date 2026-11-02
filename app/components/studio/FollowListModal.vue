<script setup lang="ts">
import followApi from '~/api/follow'
import type { FollowedAuthor } from '~/types/creative'

/**
 * 自己主页点「关注」：用已有 GET /user/follow/authors 列出我关注的人。
 * 取关后从名单拿掉，并通知主页改 following_count。
 */
const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  change: [followingCountDelta: number]
}>()

const { t } = useI18n()
const localePath = useLocalePath()
const { state: confirmState } = useConfirm()

const PAGE_SIZE = 20
const list = useStudioPaged<FollowedAuthor>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await followApi.authors({ page, page_size: pageSize })
    if (!res?.success || !res.data)
      return null
    return res.data
  },
})

watch(() => props.open, (open) => {
  if (open)
    void list.reload()
})

function close() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.open || confirmState.value.open)
    return
  close()
}

function onFollowChange(row: FollowedAuthor, following: boolean, followers: number) {
  row.is_following = following
  row.followers = followers
  if (following)
    return
  list.removeById(row.id)
  emit('change', -1)
}

function gotoAuthor() {
  close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="close">
      <div class="follow-list-modal" role="dialog" aria-modal="true" aria-labelledby="follow-list-title">
        <header class="follow-list-modal__head">
          <h2 id="follow-list-title">{{ t('关注') }}</h2>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="close">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="follow-list-modal__body">
          <StudioPaging
            grid-class="follow-authors"
            root=".follow-list-modal__body"
            compact
            :loading="list.busy.value"
            :error="list.failed.value"
            :loading-more="list.loadingMore.value"
            :has-more="list.hasMore.value"
            :count="list.items.value.length"
            :load-more="list.loadMore"
          >
            <template #skeleton>
              <div v-for="n in 5" :key="n" class="follow-author-row" aria-hidden="true">
                <USkeleton class="size-10 shrink-0 rounded-full" />
                <div class="follow-author-row__main">
                  <USkeleton class="h-3.5 w-24" />
                  <USkeleton class="mt-1.5 h-3 w-16" />
                </div>
              </div>
            </template>
            <template #empty>
              <StudioEmpty
                compact
                :title="t('还没有关注的作者')"
                :description="t('在成片列表里点头像进作者主页，关注后新作会出现在这里。')"
              >
                <NuxtLink :to="localePath('/explore')" class="plan-btn plan-btn--solid" @click="close">{{ t('去逛逛成片') }}</NuxtLink>
              </StudioEmpty>
            </template>
            <div class="follow-authors">
              <div v-for="row in list.items.value" :key="row.id" class="follow-author-row">
                <NuxtLink :to="localePath(`/author/${row.id}`)" class="follow-author-row__avatar" @click="gotoAuthor">{{ (row.nickname || '#').slice(0, 1) }}</NuxtLink>
                <div class="follow-author-row__main">
                  <NuxtLink :to="localePath(`/author/${row.id}`)" class="follow-author-row__name" @click="gotoAuthor">{{ row.nickname || `#${row.id}` }}</NuxtLink>
                  <small>{{ t('{n} 部作品', { n: row.works }) }} · {{ t('{n} 位粉丝', { n: row.followers }) }}</small>
                </div>
                <StudioFollowButton
                  :author-id="row.id"
                  :name="row.nickname || ''"
                  :following="row.is_following"
                  :followers="row.followers"
                  size="compact"
                  @change="(on, followers) => onFollowChange(row, on, followers)"
                />
              </div>
            </div>
          </StudioPaging>
        </div>
      </div>
    </div>
  </Teleport>
</template>
