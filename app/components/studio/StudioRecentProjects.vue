<script setup lang="ts">
import projectApi from '~/api/project'
import type { Project } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

/** 首页「最近项目」：新建入口 + 最近更新的几个项目，入口到项目页。未登录不请求、不展示，避免 401 弹出登录框。 */
const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { confirm } = useConfirm()
const { isLoggedIn } = useAuth()
const { openNewProject, openProject } = useStudioNav()
const { isTeam, teams, loadTeams } = useWorkspace()

const LIMIT = 4
const projects = ref<Project[]>([])
const loaded = ref(false)
const failed = ref(false)

function reset() {
  projects.value = []
  loaded.value = false
  failed.value = false
}

async function load() {
  if (!isLoggedIn.value)
    return
  failed.value = false
  try {
    const res = await projectApi.list({ page: 1, page_size: LIMIT })
    if (!res?.success || !res.data) {
      failed.value = projects.value.length === 0
      toast.add({ title: res?.message || t('加载失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    projects.value = res.data.items
    failed.value = false
  }
  catch {
    failed.value = projects.value.length === 0
    toast.add({ title: t('加载失败，请稍后重试'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
  }
  finally {
    loaded.value = true
  }
}

function fmtDate(ts: number) {
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const menuFor = ref<number | null>(null)
const movingId = ref(0)
const commentOpen = ref(false)
const commentTarget = ref<Project | null>(null)
const renameOpen = ref(false)
const renameTarget = ref<Project | null>(null)
const renameName = ref('')
const renaming = ref(false)
const renameInput = ref<HTMLInputElement | null>(null)
const canRename = computed(() => !!renameName.value.trim() && !renaming.value)

function hasMenu(item: Project) {
  return Boolean(item.can_edit || item.can_delete || item.can_move || !item.permission)
}
function canRenameProject(item: Project) {
  return !item.permission || item.permission === 'owner'
}
function canRemove(item: Project) {
  return item.can_delete ?? !item.team_shared
}

function toggleMenu(id: number) {
  menuFor.value = menuFor.value === id ? null : id
}

function onDocumentClick(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.projects-card__menu, .projects-card__more'))
    menuFor.value = null
}

function openComments(item: Project) {
  menuFor.value = null
  commentTarget.value = item
  commentOpen.value = true
}

function closeComments() {
  commentOpen.value = false
}

function onOpenCountChange(projectId: number, delta: number) {
  const row = projects.value.find(item => item.id === projectId)
  if (row)
    row.open_comments = Math.max(0, (row.open_comments || 0) + delta)
}

function openBible(item: Project) {
  menuFor.value = null
  void navigateTo(localePath(`/bible?project=${item.id}`))
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
    await load()
    notify(toTeam ? t('已移到团队「{team}」，切到团队空间可以看到', { team: target!.name }) : t('已移回个人空间'))
  }
  finally {
    movingId.value = 0
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
  await load()
  notify(t('已移到回收站'))
}

// 登录态只有客户端知道（服务端渲染恒为未登录），首帧与服务端保持一致，挂载后再显示，避免 hydration 不一致
const mounted = ref(false)
const shown = computed(() => mounted.value && isLoggedIn.value)

onMounted(() => {
  mounted.value = true
  document.addEventListener('click', onDocumentClick)
  void loadTeams()
  if (isLoggedIn.value)
    void load()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})

watch(isLoggedIn, (on) => {
  if (on)
    void load()
  else
    reset()
})

// 首页 keepalive：从画布回来时刷新最近项目
onActivated(() => {
  if (isLoggedIn.value && loaded.value)
    void load()
})
</script>

<template>
  <section v-if="shown" class="show-page__inner recent" :aria-label="t('最近项目')">
    <header class="recent__head">
      <h2>{{ t('最近项目') }}</h2>
      <NuxtLink :to="localePath('/projects')" class="recent__all">
        {{ t('全部项目') }}
        <UIcon name="i-lucide-chevron-right" class="size-3.5" />
      </NuxtLink>
    </header>
    <div class="recent__grid">
      <button type="button" class="projects-card projects-card--create" @click="openNewProject">
        <span class="projects-card__thumb">
          <span class="projects-card__plus">
            <UIcon name="i-lucide-plus" class="size-7" />
          </span>
        </span>
        <span class="projects-card__meta">
          <span class="projects-card__title">{{ t('新建项目') }}</span>
        </span>
      </button>
      <template v-if="loaded">
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
              <span class="projects-card__title">{{ item.name }}</span>
              <span class="projects-card__sub">{{ fmtDate(item.updated_at) }}</span>
            </div>
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
        <p v-if="failed && !projects.length" class="recent__empty">
          {{ t('加载失败，请稍后重试') }}
          <button type="button" class="recent__all" @click="load">{{ t('重试') }}</button>
        </p>
        <p v-else-if="!projects.length" class="recent__empty">{{ t('还没有项目，从新建开始。') }}</p>
      </template>
      <template v-else>
        <article v-for="n in 4" :key="n" class="projects-card projects-card--skeleton" aria-hidden="true">
          <USkeleton class="projects-card__thumb" />
          <div class="projects-card__meta">
            <div class="projects-card__text">
              <USkeleton class="h-3.5 w-3/5" />
              <USkeleton class="mt-1.5 h-3 w-2/5" />
            </div>
          </div>
        </article>
      </template>
    </div>

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
        <div class="studio-confirm" role="dialog" aria-modal="true" aria-labelledby="recent-rename-title">
          <header class="studio-confirm__head">
            <span class="studio-confirm__icon" aria-hidden="true">
              <UIcon name="i-lucide-pencil" class="size-4" />
            </span>
            <h2 id="recent-rename-title">{{ t('重命名') }}</h2>
            <button type="button" class="studio-confirm__close" :aria-label="t('关闭')" :disabled="renaming" @click="closeRename">
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
            <button type="button" class="studio-confirm__btn is-primary" :disabled="!canRename" @click="submitRename">
              {{ t('确定') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
