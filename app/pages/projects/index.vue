<script setup lang="ts">
import projectApi from '~/api/project'
import type { Project } from '~/types/creative'

const { t } = useI18n()
const { libraryTabs } = useStudioNav()

definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('项目') })

const toast = useToast()
const localePath = useLocalePath()
const { openNewProject, openProject } = useStudioNav()

/** 剧集设定（API.md 27）：项目级的人物关系 / 道具 / 线索 / 每集记录 */
function openBible(item: Project) {
  menuFor.value = null
  void navigateTo(localePath(`/bible?project=${item.id}`))
}
const { confirm } = useConfirm()
const route = useRoute()
const { isTeam, teams, currentTeam, canGenerate, loadTeams } = useWorkspace()

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const keyword = ref('')
const menuFor = ref<number | null>(null)
const PAGE_SIZE = 24
const TRASH_PAGE_SIZE = 18
let keywordTimer: number | undefined

const {
  items: projects,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
  removeById,
} = useStudioPaged<Project>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await projectApi.list({
      page,
      page_size: pageSize,
      keyword: q || undefined,
    })
    if (!res?.success || !res.data) {
      notify(res?.message || t('项目列表加载失败'), 'error')
      return null
    }
    return res.data
  },
})

/** 批注抽屉：卡片角标与站内信深链（/projects?id=&comment=1）都从这里进 */
const commentOpen = ref(false)
const commentTarget = ref<Project | null>(null)

function openComments(item: Project) {
  menuFor.value = null
  commentTarget.value = item
  commentOpen.value = true
}

function closeComments() {
  commentOpen.value = false
}

/**
 * 抽屉里发表 / 解决 / 删除批注后同步卡片角标。
 * 目标项目可能已经不在当前 tab 的列表里（比如从站内信深链进来），找不到就只更新抽屉里的那份。
 */
function onOpenCountChange(projectId: number, delta: number) {
  const apply = (row: Project) => {
    row.open_comments = Math.max(0, (row.open_comments || 0) + delta)
  }
  const row = projects.value.find(item => item.id === projectId)
  if (row)
    apply(row)
  else if (commentTarget.value?.id === projectId)
    apply(commentTarget.value)
}

const {
  items: trashItems,
  busy: trashBusy,
  failed: trashFailed,
  loadingMore: trashLoadingMore,
  hasMore: trashHasMore,
  reload: reloadTrash,
  loadMore: loadMoreTrash,
} = useStudioPaged<Project>({
  pageSize: TRASH_PAGE_SIZE,
  async fetch(page, pageSize) {
    const res = await projectApi.trash({ page, page_size: pageSize })
    if (!res?.success || !res.data) {
      notify(res?.message || t('回收站加载失败'), 'error')
      return null
    }
    return res.data
  },
})

const renameOpen = ref(false)
const renameTarget = ref<Project | null>(null)
const renameName = ref('')
const renaming = ref(false)
const renameInput = ref<HTMLInputElement | null>(null)
const canRename = computed(() => !!renameName.value.trim() && !renaming.value)

const trashOpen = ref(false)
const selectedTrash = ref<number[]>([])
const restoring = ref(false)

const allTrashSelected = computed(() =>
  trashItems.value.length > 0 && selectedTrash.value.length === trashItems.value.length,
)

/** 团队空间里查看者不能新建；个人空间都能建 */
const canCreate = computed(() => canGenerate.value)
/** 卡片有没有「更多」菜单：能改、能删或能移动 */
function hasMenu(item: Project) {
  return Boolean(item.can_edit || item.can_delete || item.can_move || !item.permission)
}
/** 改名只给作者（后端 PUT /user/project/:id 按作者校验） */
function canRenameProject(item: Project) {
  return !item.permission || item.permission === 'owner'
}
function canRemove(item: Project) {
  return item.can_delete ?? !item.team_shared
}
const movingId = ref(0)

/** 个人空间：移到团队；团队空间：移回个人空间（仅作者，API.md 20.4） */
async function moveProject(item: Project) {
  menuFor.value = null
  if (movingId.value)
    return
  const toTeam = !isTeam.value
  const target = toTeam ? teams.value[0] : null
  if (toTeam && !target) {
    notify(t('你还不在团队里，先在头像菜单里创建或加入团队'), 'error')
    return
  }
  if (!(await confirm({
    title: toTeam ? t('移到团队') : t('移回个人空间'),
    message: toTeam
      ? t('把「{name}」移到团队「{team}」？队友将能按权限查看和编辑，之后在团队空间生成花团队积分。', { name: item.name, team: target!.name })
      : t('把「{name}」移回个人空间？队友将不再能看到它，之后生成花你自己的积分。', { name: item.name }),
    confirmText: toTeam ? t('移到团队') : t('移回个人空间'),
  })))
    return
  movingId.value = item.id
  try {
    const res = await projectApi.move(item.id, toTeam ? target!.id : 0)
    if (!res?.success) {
      notify(res?.message || t('移动失败'), 'error')
      return
    }
    removeById(item.id)
    notify(toTeam ? t('已移到团队「{team}」，切到团队空间可以看到', { team: target!.name }) : t('已移回个人空间'))
  }
  finally {
    movingId.value = 0
  }
}

function formatDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function daysLeft(deletedAt: string | null) {
  if (!deletedAt)
    return 30
  const deleted = new Date(deletedAt).getTime()
  if (!Number.isFinite(deleted))
    return 30
  const left = 30 - Math.floor((Date.now() - deleted) / 86400000)
  return Math.max(0, left)
}

function toggleMenu(id: number) {
  menuFor.value = menuFor.value === id ? null : id
}

async function openRename(item: Project) {
  menuFor.value = null
  renameTarget.value = item
  renameName.value = item.name
  renameOpen.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

function closeRename() {
  if (renaming.value)
    return
  renameOpen.value = false
  renameTarget.value = null
}

async function submitRename() {
  const item = renameTarget.value
  if (!item || renaming.value)
    return
  const name = renameName.value.trim()
  if (!name)
    return
  if (name === item.name) {
    closeRename()
    return
  }
  renaming.value = true
  try {
    const res = await projectApi.update(item.id, { name })
    if (!res?.success) {
      notify(res?.message || t('重命名失败'), 'error')
      return
    }
    item.name = name
    renameOpen.value = false
    renameTarget.value = null
  }
  finally {
    renaming.value = false
  }
}

async function removeProject(item: Project) {
  menuFor.value = null
  if (!(await confirm({
    title: t('移到回收站'),
    message: t('将「{name}」移到回收站？30 天内可恢复。', { name: item.name }),
    confirmText: t('移到回收站'),
    danger: true,
  })))
    return
  const res = await projectApi.remove(item.id)
  if (!res?.success) {
    notify(res?.message || t('删除失败'), 'error')
    return
  }
  removeById(item.id)
  notify(t('已移到回收站'))
}

async function openTrash() {
  trashOpen.value = true
  selectedTrash.value = []
  await reloadTrash()
}

function toggleTrashItem(id: number) {
  if (selectedTrash.value.includes(id))
    selectedTrash.value = selectedTrash.value.filter(item => item !== id)
  else
    selectedTrash.value = [...selectedTrash.value, id]
}

function toggleAllTrash() {
  selectedTrash.value = allTrashSelected.value ? [] : trashItems.value.map(item => item.id)
}

function closeTrash() {
  trashOpen.value = false
  selectedTrash.value = []
}

async function restoreTrash() {
  if (!selectedTrash.value.length || restoring.value)
    return
  restoring.value = true
  try {
    const results = await Promise.all(selectedTrash.value.map(id => projectApi.restore(id)))
    const failed = results.filter(r => !r?.success).length
    if (failed)
      notify(t('{n} 个项目恢复失败', { n: failed }), 'error')
    else
      notify(t('已恢复'))
    closeTrash()
    await reload()
  }
  finally {
    restoring.value = false
  }
}

function onDocumentClick(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.projects-card__menu, .projects-card__more'))
    menuFor.value = null
}

function onRenameKeydown(event: KeyboardEvent) {
  if (!renameOpen.value)
    return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeRename()
  }
}

/**
 * 站内信「项目收到新批注」跳回来时带 ?id=&comment=1。
 * 队友的项目不在「我的项目」列表里，列表找不到就单独拉一次详情，避免深链落空。
 */
async function openCommentsFromQuery() {
  if (route.query.comment !== '1')
    return
  const id = Number(route.query.id)
  if (!Number.isFinite(id) || id <= 0)
    return
  const row = projects.value.find(item => item.id === id)
  if (row) {
    openComments(row)
    return
  }
  const res = await projectApi.get(id)
  if (res?.success && res.data?.project)
    openComments(res.data.project)
}

onMounted(() => {
  void loadTeams()
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onRenameKeydown, true)
  void reload().then(() => openCommentsFromQuery())
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('keydown', onRenameKeydown, true)
  window.clearTimeout(keywordTimer)
})

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    void reload()
  }, 320)
})
</script>

<template>
  <section class="projects-page">
    <div class="show-page__inner">
      <div class="projects-stick">
      <header class="projects-toolbar">
      <div class="projects-toolbar__left">
        <h1 class="sr-only">{{ t('项目') }}</h1>
        <StudioSectionTabs :items="libraryTabs" :label="t('项目')" />
        <ClientOnly>
          <span v-if="isTeam" class="projects-space">
            <UIcon name="i-lucide-users" class="size-3.5" />
            {{ currentTeam?.name || t('团队空间') }}
          </span>
        </ClientOnly>
      </div>
      <div class="projects-toolbar__right">
        <label class="projects-search">
          <UIcon name="i-lucide-search" class="size-4" />
          <input
            v-model="keyword"
            type="search"
            :placeholder="t('搜索项目')"
          >
        </label>
        <button type="button" class="projects-tool-btn" @click="openTrash">
          <UIcon name="i-lucide-trash-2" class="size-4" />
          {{ t('回收站') }}
        </button>
      </div>
    </header>
      </div>

    <StudioPaging
      grid-class="projects-grid"
      :loading="busy"
      :error="failed"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :count="projects.length"
      :empty-title="isTeam ? t('团队里还没有项目') : t('暂无项目')"
      :empty-description="isTeam
        ? t('新建项目，或在个人空间的项目菜单里「移到团队」。')
        : t('还没有项目。点击「新建」开始第一个创作。')"
      :load-more="loadMore"
    >
      <template #skeleton>
        <article v-for="n in 8" :key="n" class="projects-card projects-card--skeleton">
          <USkeleton class="projects-card__thumb" />
          <div class="projects-card__meta">
            <div class="projects-card__text">
              <USkeleton class="h-3.5 w-3/5" />
              <USkeleton class="mt-1.5 h-3 w-2/5" />
            </div>
          </div>
        </article>
      </template>
      <template #empty>
        <div v-if="canCreate" class="projects-grid">
          <button type="button" class="projects-card projects-card--create" @click="openNewProject">
            <span class="projects-card__thumb">
              <span class="projects-card__plus">
                <UIcon name="i-lucide-plus" class="size-7" />
              </span>
            </span>
            <span class="projects-card__meta">
              <span class="projects-card__title">{{ t('创建新的视频项目') }}</span>
            </span>
          </button>
        </div>
        <StudioEmpty
          compact
          :title="isTeam ? t('团队里还没有项目') : t('暂无项目')"
          :description="isTeam
            ? t('新建项目，或在个人空间的项目菜单里「移到团队」。')
            : t('还没有项目。点击「新建」开始第一个创作。')"
        />
      </template>
      <div class="projects-grid">
        <button v-if="canCreate" type="button" class="projects-card projects-card--create" @click="openNewProject">
          <span class="projects-card__thumb">
            <span class="projects-card__plus">
              <UIcon name="i-lucide-plus" class="size-7" />
            </span>
          </span>
          <span class="projects-card__meta">
            <span class="projects-card__title">{{ t('创建新的视频项目') }}</span>
          </span>
        </button>

        <article v-for="item in projects" :key="item.id" class="projects-card">
          <button type="button" class="projects-card__thumb" @click="openProject(item)">
            <img v-if="item.cover_url" :src="resolveMediaUrl(item.cover_url)" :alt="item.name">
            <UIcon v-else name="i-lucide-workflow" class="projects-card__ph" />
          </button>
          <span v-if="item.team_shared" class="projects-card__owner">
            <UIcon name="i-lucide-users" class="size-3" />
            {{ item.owner_nickname || t('队友') }}
          </span>
          <button
            v-if="item.open_comments > 0"
            type="button"
            class="projects-card__flag"
            :aria-label="t('查看批注')"
            @click.stop="openComments(item)"
          >
            <UIcon name="i-lucide-message-square" class="size-3" />
            {{ item.open_comments }}
          </button>
          <div class="projects-card__meta">
            <div class="projects-card__text">
              <h2 class="projects-card__title">{{ item.name }}</h2>
              <p class="projects-card__sub">{{ formatDate(item.updated_at) }}</p>
            </div>
            <!-- 没有可操作项（团队里的查看者）只留批注入口 -->
            <button
              v-if="!hasMenu(item)"
              type="button"
              class="projects-card__more"
              :aria-label="t('批注')"
              @click.stop="openComments(item)"
            >
              <UIcon name="i-lucide-message-square" class="size-4" />
              <span class="canvas-tip canvas-tip--up">{{ t('批注') }}</span>
            </button>
            <button v-else type="button" class="projects-card__more" :class="{ 'is-on': menuFor === item.id }" :aria-label="t('更多')" @click.stop="toggleMenu(item.id)">
              <UIcon name="i-lucide-ellipsis" class="size-4" />
              <span class="canvas-tip canvas-tip--up">{{ t('更多') }}</span>
            </button>
          </div>
          <div v-if="hasMenu(item) && menuFor === item.id" class="projects-card__menu" @click.stop>
            <button type="button" @click="openProject(item)">
              <UIcon name="i-lucide-external-link" class="size-4" />
              {{ t('打开') }}
            </button>
            <button type="button" @click="openComments(item)">
              <UIcon name="i-lucide-message-square" class="size-4" />
              {{ t('批注') }}
            </button>
            <button type="button" @click="openBible(item)">
              <UIcon name="i-lucide-book-open" class="size-4" />
              {{ t('剧集设定') }}
            </button>
            <button v-if="canRenameProject(item)" type="button" @click="openRename(item)">
              <UIcon name="i-lucide-pencil" class="size-4" />
              {{ t('重命名') }}
            </button>
            <button v-if="item.can_move && (isTeam || teams.length)" type="button" :disabled="movingId === item.id" @click="moveProject(item)">
              <UIcon :name="isTeam ? 'i-lucide-user-round' : 'i-lucide-users'" class="size-4" />
              {{ isTeam ? t('移回个人空间') : t('移到团队') }}
            </button>
            <button v-if="canRemove(item)" type="button" class="is-danger" @click="removeProject(item)">
              <UIcon name="i-lucide-trash-2" class="size-4" />
              {{ t('删除') }}
            </button>
          </div>
        </article>
      </div>
    </StudioPaging>

    <ProjectCommentPanel
      :open="commentOpen"
      :project="commentTarget"
      @close="closeComments"
      @open-count-change="onOpenCountChange"
    />

    <Teleport to="body">
      <div
        v-if="renameOpen"
        class="studio-modal-mask studio-confirm-mask"
        @click.self="closeRename"
        @pointerdown.stop
      >
        <div
          class="studio-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-title"
        >
          <header class="studio-confirm__head">
            <span class="studio-confirm__icon" aria-hidden="true">
              <UIcon name="i-lucide-pencil" class="size-4" />
            </span>
            <h2 id="rename-title">{{ t('重命名') }}</h2>
            <button
              type="button"
              class="studio-confirm__close"
              :aria-label="t('关闭')"
              :disabled="renaming"
              @click="closeRename"
            >
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </header>
          <label class="publish-field">
            <span>{{ t('项目名称') }}</span>
            <input
              ref="renameInput"
              v-model="renameName"
              type="text"
              maxlength="60"
              :placeholder="t('项目名称')"
              :disabled="renaming"
              @keydown.enter.prevent="submitRename"
            >
          </label>
          <div class="studio-confirm__actions">
            <button type="button" class="studio-confirm__btn" :disabled="renaming" @click="closeRename">
              {{ t('取消') }}
            </button>
            <button
              type="button"
              class="studio-confirm__btn is-primary"
              :disabled="!canRename"
              @click="submitRename"
            >
              {{ t('确定') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <div v-if="trashOpen" class="studio-modal-mask" @click.self="closeTrash">
      <div class="trash-modal" role="dialog" aria-modal="true" aria-labelledby="trash-title">
        <header class="trash-modal__head">
          <div>
            <h2 id="trash-title">{{ t('回收站') }}</h2>
            <p>{{ t('仅显示最近 30 天内删除的内容') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="closeTrash">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="trash-modal__body">
          <StudioPaging
            root=".trash-modal__body"
            grid-class="trash-grid"
            compact
            :loading="trashBusy"
            :error="trashFailed"
            :loading-more="trashLoadingMore"
            :has-more="trashHasMore"
            :count="trashItems.length"
            :empty-title="t('回收站是空的')"
            :empty-description="t('最近 30 天删除的内容会出现在这里。')"
            :load-more="loadMoreTrash"
          >
            <template #skeleton>
              <article v-for="n in 6" :key="n" class="trash-card trash-card--skeleton" aria-hidden="true">
                <USkeleton class="trash-card__thumb" />
                <USkeleton class="mt-2 h-3.5 w-3/5" />
                <USkeleton class="mt-1.5 h-3 w-2/5" />
              </article>
            </template>
            <div class="trash-grid">
              <article v-for="item in trashItems" :key="item.id" class="trash-card" :class="{ 'is-on': selectedTrash.includes(item.id) }">
                <button type="button" class="trash-card__thumb" @click="toggleTrashItem(item.id)">
                  <img v-if="item.cover_url" :src="resolveMediaUrl(item.cover_url)" :alt="item.name">
                  <UIcon v-else name="i-lucide-workflow" class="projects-card__ph" />
                  <span class="trash-check" :class="{ 'is-on': selectedTrash.includes(item.id) }" />
                </button>
                <h3>{{ item.name }}</h3>
                <p>{{ t('剩余 {n} 天', { n: daysLeft(item.deleted_at) }) }}</p>
              </article>
            </div>
          </StudioPaging>
        </div>

        <footer class="trash-modal__foot">
          <label class="trash-modal__count">
            <input
              type="checkbox"
              :checked="allTrashSelected"
              :disabled="!trashItems.length"
              @change="toggleAllTrash"
            >
            <span
              class="trash-check trash-check--plain"
              :class="{
                'is-on': allTrashSelected,
                'is-mix': selectedTrash.length > 0 && !allTrashSelected,
              }"
            />
            {{ t('已选择 {n} 项', { n: selectedTrash.length }) }}
          </label>
          <button
            type="button"
            class="trash-modal__restore"
            :disabled="!selectedTrash.length || restoring"
            @click="restoreTrash"
          >
            {{ t('恢复') }}
          </button>
        </footer>
      </div>
    </div>
    </div>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
