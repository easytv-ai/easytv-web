<script setup lang="ts">
import subjectApi from '~/api/subject'
import taskApi from '~/api/task'
import teamApi from '~/api/team'
import { resolveMediaUrl } from '~/utils/media'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import type { Subject, SubjectKind, TaskStatus } from '~/types/creative'

const { t } = useI18n()
const { libraryTabs } = useStudioNav()

/**
 * 主体库（API.md 10.2 F2）：角色 / 场景 / 道具的可复用参考图与描述。
 * 画布与成片向导通过 subject_ids 引用主体，服务端自动并入参考图并补充提示词。
 */
definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  keepalive: true,
})

useHead({ title: t('主体库') })

const toast = useToast()
const { confirm } = useConfirm()
const { refresh: refreshWallet } = useWallet()

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const PAGE_SIZE = 24
const POLL_MS = 3000

const KIND_TABS: { value: SubjectKind, label: string }[] = [
  { value: 'character', label: t('角色') },
  { value: 'scene', label: t('场景') },
  { value: 'prop', label: t('道具') },
]

const KIND_LABEL: Record<SubjectKind, string> = {
  character: t('角色'),
  scene: t('场景'),
  prop: t('道具'),
}

const KIND_ICON: Record<SubjectKind, string> = {
  character: 'i-lucide-user-round',
  scene: 'i-lucide-mountain',
  prop: 'i-lucide-box',
}

const kind = ref<SubjectKind>('character')
const keyword = ref('')
let keywordTimer: number | undefined

const {
  items: subjects,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
  removeById,
  prepend,
} = useStudioPaged<Subject>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await subjectApi.list({ page, page_size: pageSize, kind: kind.value, keyword: q || undefined })
    if (!res?.success || !res.data) {
      notify(res?.message || t('主体库加载失败'), 'error')
      return null
    }
    return { items: (res.data.items ?? []).map(normalize), total: res.data.total }
  },
})

function normalize(row: Subject): Subject {
  return { ...row, refs: Array.isArray(row.refs) ? row.refs : [] }
}

function replaceSubject(row: Subject) {
  const next = normalize(row)
  subjects.value = subjects.value.map(item => item.id === next.id ? next : item)
}

function coverOf(item: Subject) {
  const url = item.cover_url || item.refs?.[0]?.url || ''
  return url ? resolveMediaUrl(url) : ''
}

const preview = ref<{ src: string, caption: string } | null>(null)

function openPreview(src: string, caption: string) {
  if (!src)
    return
  preview.value = { src, caption }
}

// ---- 团队共享开关只在有团队时出现 ----
const hasTeam = ref(false)

async function loadTeam() {
  const res = await teamApi.mine()
  hasTeam.value = Boolean(res?.success && res.data)
}

// ---- 新建 / 编辑 ----
type FormState = { id: number, kind: SubjectKind, name: string, look: string, shared: boolean }

const modalOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive<FormState>({ id: 0, kind: 'character', name: '', look: '', shared: false })

function openCreate() {
  formError.value = ''
  Object.assign(form, { id: 0, kind: kind.value, name: '', look: '', shared: false })
  modalOpen.value = true
}

function openEdit(item: Subject) {
  formError.value = ''
  Object.assign(form, { id: item.id, kind: item.kind, name: item.name, look: item.look || '', shared: item.shared === 1 })
  modalOpen.value = true
}

function closeModal() {
  if (saving.value)
    return
  modalOpen.value = false
}

async function submitForm() {
  const name = form.name.trim()
  if (!name) {
    formError.value = t('请填写主体名称')
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const body = {
      kind: form.kind,
      name,
      look: form.look.trim(),
      shared: (form.shared ? 1 : 0) as 0 | 1,
    }
    const res = form.id ? await subjectApi.update(form.id, body) : await subjectApi.create(body)
    if (!res?.success) {
      formError.value = res?.message || t('保存失败')
      return
    }
    if (form.id) {
      if (res.data)
        replaceSubject(res.data)
      notify(t('已保存'), 'success')
    }
    else {
      notify(t('主体已创建'), 'success')
      if (res.data && res.data.kind === kind.value)
        prepend(normalize(res.data))
      else
        await reload()
    }
    modalOpen.value = false
  }
  finally {
    saving.value = false
  }
}

async function removeSubject(item: Subject) {
  if (!(await confirm({
    title: t('删除主体'),
    message: t('删除「{name}」？画布里已生成的内容不受影响。', { name: item.name }),
    confirmText: t('删除'),
    danger: true,
  })))
    return
  const res = await subjectApi.remove(item.id)
  if (!res?.success) {
    notify(res?.message || t('删除失败'), 'error')
    return
  }
  stopPoll(item.id)
  delete generating[item.id]
  removeById(item.id)
  notify(t('已删除'))
}

// ---- 生成参考图：POST generate → 轮询任务 → 全部结束后 POST sync ----
type GenView = { id: number, label: string, status: TaskStatus, progress: number }

const generating = reactive<Record<number, { views: GenView[] }>>({})
const timers = new Map<number, () => void>()

function settled(status: TaskStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function viewLabel(subjectId: number, nodeId: string, index: number) {
  const prefix = `subject-${subjectId}-`
  const id = String(nodeId || '')
  if (id.startsWith(prefix))
    return id.slice(prefix.length)
  return id || t('视图 {n}', { n: index + 1 })
}

function statusText(view: GenView) {
  if (view.status === 'succeeded')
    return t('已完成')
  if (view.status === 'failed')
    return t('失败')
  if (view.status === 'cancelled')
    return t('已取消')
  if (view.status === 'running')
    return t('{n}%', { n: Math.max(1, Math.min(99, view.progress)) })
  return t('排队中')
}

async function generateRefs(item: Subject) {
  if (generating[item.id])
    return
  if (!String(item.look || '').trim()) {
    notify(t('先补上外观描述再生成参考图'), 'error')
    return
  }
  const res = await subjectApi.generate(item.id)
  const tasks = res?.data?.tasks ?? []
  if (!res?.success || !tasks.length) {
    notify(res?.message || t('生成失败'), 'error')
    return
  }
  generating[item.id] = {
    views: tasks.map((task, i) => ({
      id: task.id,
      label: viewLabel(item.id, task.node_id, i),
      status: task.status,
      progress: Number(task.progress) || 0,
    })),
  }
  notify(t('已提交 {n} 张参考图', { n: tasks.length }))
  void refreshWallet()
  startPoll(item.id)
}

function startPoll(id: number) {
  stopPoll(id)
  timers.set(id, startHiddenAwarePoll(() => { void pollGen(id) }, POLL_MS))
}

function stopPoll(id: number) {
  timers.get(id)?.()
  timers.delete(id)
}

async function pollGen(id: number) {
  const state = generating[id]
  if (!state) {
    stopPoll(id)
    return
  }
  await Promise.all(state.views.map(async (view) => {
    if (settled(view.status))
      return
    const res = await taskApi.get(view.id)
    if (!res?.success || !res.data)
      return
    view.status = res.data.status
    view.progress = Number(res.data.progress) || 0
  }))
  if (!state.views.every(view => settled(view.status)))
    return
  stopPoll(id)
  const failed = state.views.filter(view => view.status !== 'succeeded').length
  delete generating[id]
  const res = await subjectApi.sync(id)
  if (res?.success && res.data?.subject) {
    replaceSubject(res.data.subject)
    notify(failed ? t('{n} 张参考图没生成成功，其余已写回主体', { n: failed }) : t('参考图已写回主体'), failed ? 'error' : 'success')
  }
  else {
    notify(res?.message || t('参考图写回失败'), 'error')
  }
  void refreshWallet()
}

watch(kind, () => void reload())

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => void reload(), 320)
})

onMounted(() => {
  void loadTeam()
  void reload()
})

onBeforeUnmount(() => {
  window.clearTimeout(keywordTimer)
  for (const id of [...timers.keys()])
    stopPoll(id)
})
</script>

<template>
  <section class="projects-page">
    <div class="show-page__inner">
      <div class="projects-stick">
      <header class="projects-toolbar">
        <div class="projects-toolbar__left">
          <h1 class="sr-only">{{ t('主体库') }}</h1>
          <StudioSectionTabs :items="libraryTabs" :label="t('项目')" />
        </div>
        <div class="projects-toolbar__right">
          <label class="projects-search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input v-model="keyword" type="search" :placeholder="t('搜索主体')">
          </label>
          <button type="button" class="projects-tool-btn" @click="openCreate">
            <UIcon name="i-lucide-plus" class="size-4" />
            {{ t('新建主体') }}
          </button>
        </div>
      </header>

      <div class="projects-toolbar" style="padding-top: 0;">
        <div class="projects-toolbar__left" style="gap: 6px;">
          <button
            v-for="tab in KIND_TABS"
            :key="tab.value"
            type="button"
            class="projects-tool-btn"
            :style="kind === tab.value ? 'font-weight:600;' : 'opacity:.7;'"
            @click="kind = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
      </div>

      <p class="create-hint subject-page__hint">{{ t('主体的参考图与描述可在画布和成片向导里复用，引用后会自动带上参考图并补充描述。') }}</p>

      <StudioPaging
        grid-class="subject-grid"
        :loading="busy"
        :error="failed"
        :loading-more="loadingMore"
        :has-more="hasMore"
        :count="subjects.length"
        :empty-title="t('还没有主体')"
        :empty-description="t('把常用的角色、场景与道具存成主体，之后生成时一键引用，人物和场景更稳定。')"
        :load-more="loadMore"
      >
        <template #skeleton>
          <article v-for="n in 6" :key="n" class="subject-card subject-card--skeleton">
            <div class="subject-card__thumb animate-pulse" />
            <div class="subject-card__body">
              <div class="subject-card__head">
                <USkeleton class="h-4 w-28" />
                <USkeleton class="h-3 w-14" />
              </div>
              <USkeleton class="h-3 w-full" />
              <USkeleton class="h-3 w-4/5" />
              <div class="subject-card__actions">
                <USkeleton v-for="i in 3" :key="i" class="subject-card__chip-sk" />
              </div>
            </div>
          </article>
        </template>
        <template #empty>
          <StudioEmpty
            compact
            :title="t('还没有主体')"
            :description="t('把常用的角色、场景与道具存成主体，之后生成时一键引用，人物和场景更稳定。')"
          />
        </template>

        <div class="subject-grid">
          <article v-for="item in subjects" :key="item.id" class="subject-card">
            <div class="subject-card__thumb">
              <button
                v-if="coverOf(item)"
                type="button"
                class="subject-card__zoom"
                :aria-label="t('放大查看')"
                @click="openPreview(coverOf(item), item.name)"
              >
                <img :src="coverOf(item)" :alt="item.name" loading="lazy">
              </button>
              <UIcon v-else :name="KIND_ICON[item.kind]" class="size-8" />
              <span class="subject-card__kind">{{ KIND_LABEL[item.kind] }}</span>
              <span v-if="item.shared === 1" class="subject-card__shared">
                <UIcon name="i-lucide-users" class="size-3" />
                {{ t('团队共享') }}
              </span>
            </div>
            <div class="subject-card__body">
              <div class="subject-card__head">
                <h2 :title="item.name">{{ item.name }}</h2>
                <small>{{ t('引用 {n} 次', { n: item.uses || 0 }) }}</small>
              </div>
              <p v-if="item.look" class="subject-card__look" :title="item.look">{{ item.look }}</p>
              <p v-else class="subject-card__look is-empty">{{ t('还没有外观描述，补上后可生成三视图参考') }}</p>

              <div v-if="item.refs?.length" class="subject-refs">
                <figure v-for="(ref, i) in item.refs" :key="`${ref.asset_id}-${i}`">
                  <button type="button" :aria-label="t('放大查看')" @click="openPreview(resolveMediaUrl(ref.url), ref.label || item.name)">
                    <img :src="resolveMediaUrl(ref.url)" :alt="ref.label" loading="lazy">
                  </button>
                  <figcaption>{{ ref.label || t('视图 {n}', { n: i + 1 }) }}</figcaption>
                </figure>
              </div>

              <ul v-if="generating[item.id]" class="subject-gen">
                <li v-for="view in generating[item.id]!.views" :key="view.id" :class="{ 'is-failed': view.status === 'failed' || view.status === 'cancelled' }">
                  <span>{{ view.label }}</span>
                  <em>{{ statusText(view) }}</em>
                </li>
              </ul>

              <div class="subject-card__actions">
                <button type="button" class="studio-chip" :disabled="!item.mine || Boolean(generating[item.id])" @click="generateRefs(item)">
                  <UIcon :name="generating[item.id] ? 'i-lucide-loader' : 'i-lucide-sparkles'" class="size-4" />
                  {{ generating[item.id] ? t('生成中…') : t('生成参考图') }}
                </button>
                <button type="button" class="studio-chip" :disabled="!item.mine" @click="openEdit(item)">
                  <UIcon name="i-lucide-pencil" class="size-4" />
                  {{ t('编辑') }}
                </button>
                <button type="button" class="studio-chip subject-card__danger" :disabled="!item.mine" @click="removeSubject(item)">
                  <UIcon name="i-lucide-trash-2" class="size-4" />
                  {{ t('删除') }}
                </button>
              </div>
              <small v-if="!item.mine" class="subject-card__note">{{ t('团队成员共享的主体，只能引用') }}</small>
            </div>
          </article>
        </div>
      </StudioPaging>

      <div v-if="modalOpen" class="studio-modal-mask" @click.self="closeModal">
        <div class="studio-modal subject-modal" role="dialog" aria-modal="true" aria-labelledby="subject-modal-title">
          <h2 id="subject-modal-title">{{ form.id ? t('编辑主体') : t('新建主体') }}</h2>
          <label class="publish-field">
            <span>{{ t('名称') }}</span>
            <input v-model="form.name" maxlength="30" :disabled="saving" :placeholder="t('例如：橘猫阿橘')">
          </label>
          <label class="publish-field">
            <span>{{ t('类型') }}</span>
            <div class="publish-tags">
              <button
                v-for="tab in KIND_TABS"
                :key="tab.value"
                type="button"
                :class="{ 'is-on': form.kind === tab.value }"
                :disabled="saving"
                @click="form.kind = tab.value"
              >
                {{ tab.label }}
              </button>
            </div>
          </label>
          <label class="publish-field">
            <span>{{ t('外观描述') }}</span>
            <textarea v-model="form.look" rows="4" maxlength="500" :disabled="saving" :placeholder="t('外貌、服装、材质与配色，用于文生图')" />
            <small class="subject-modal__hint">{{ t('这段描述会用来生成参考图，也会在引用主体时追加到提示词末尾') }}</small>
          </label>
          <label v-if="hasTeam" class="publish-switch">
            <span class="pref-switch"><input v-model="form.shared" type="checkbox" :disabled="saving"><i /></span>
            <span class="publish-switch__text">
              <strong>{{ t('共享给团队') }}</strong>
              <small>{{ t('团队成员都能在自己的画布里引用这个主体') }}</small>
            </span>
          </label>
          <p v-if="formError" class="publish-error">{{ formError }}</p>
          <div class="subject-modal__actions">
            <button type="button" class="plan-btn plan-btn--ghost" :disabled="saving" @click="closeModal">{{ t('取消') }}</button>
            <button type="button" class="plan-btn plan-btn--solid" :disabled="saving" @click="submitForm">{{ saving ? t('保存中…') : t('保存') }}</button>
          </div>
        </div>
      </div>
    </div>

    <CanvasMediaPreview
      :open="!!preview"
      :src="preview?.src || ''"
      kind="image"
      :caption="preview?.caption || ''"
      @close="preview = null"
    />
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
