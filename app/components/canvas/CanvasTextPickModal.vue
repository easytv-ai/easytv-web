<script setup lang="ts">
import promptApi from '~/api/prompt'
import skillApi from '~/api/skill'
import type { Prompt, PromptSourceBrief, Skill } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'
import { promptTemplates } from '~/utils/canvas-templates'

const { t } = useI18n()
const toast = useToast()
const localePath = useLocalePath()
const { isLoggedIn, requireLogin } = useRequireLogin()
const { names: skillCats, load: loadSkillCats } = useContentCategories('skill')

const props = defineProps<{
  open: boolean
  mode: 'skill' | 'template' | 'prompt'
}>()

const emit = defineEmits<{
  close: []
  pick: [text: string, title?: string]
}>()

const loading = ref(false)
const listFailed = ref(false)
const skills = ref<Skill[]>([])
const prompts = ref<Prompt[]>([])
const promptTags = ref<string[]>([])
const promptSources = ref<PromptSourceBrief[]>([])
const keyword = ref('')
const skillNav = ref<'all' | 'mine'>('all')
const skillCat = ref('')
const promptTag = ref('')
const promptSourceId = ref(0)
const editorOpen = ref(false)
const picking = ref<string | number>('')

const templates = computed(() => promptTemplates(t))

const visibleSkillCats = computed(() => skillCats.value.filter(name => name && name !== '发现'))

const filterChips = computed(() => {
  if (props.mode === 'skill' && skillNav.value === 'all') {
    return visibleSkillCats.value.map(cat => ({
      key: cat,
      label: t(cat),
      on: skillCat.value === cat,
      pick: () => selectSkillCat(skillCat.value === cat ? '' : cat),
    }))
  }
  if (props.mode === 'prompt') {
    return promptTags.value.map(tag => ({
      key: tag,
      label: tag,
      on: promptTag.value === tag,
      pick: () => selectPromptTag(tag),
    }))
  }
  return []
})

const chipsEl = ref<HTMLElement | null>(null)
const chipsHasPrev = ref(false)
const chipsHasNext = ref(false)

function updateChipsOverflow() {
  const el = chipsEl.value
  if (!el) {
    chipsHasPrev.value = false
    chipsHasNext.value = false
    return
  }
  chipsHasPrev.value = el.scrollLeft > 2
  chipsHasNext.value = el.scrollWidth - el.clientWidth - el.scrollLeft > 2
}

function scrollChips(dir: 1 | -1) {
  chipsEl.value?.scrollBy({ left: dir * 180, behavior: 'smooth' })
}

type PickItem = {
  key: string | number
  title: string
  desc: string
  /** 提示词库的条目要先拉详情才有正文，所以取文本是个异步函数 */
  take: () => string | Promise<string>
  teamOwner?: string
  cover?: string
  icon?: string
}

function coverOf(url?: string) {
  return resolveMediaUrl(url) || ''
}

function matchesKeyword(title: string, desc: string) {
  const q = keyword.value.trim().toLowerCase()
  if (!q)
    return true
  return title.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
}

function failPickList(message?: string) {
  const current = props.mode === 'prompt' ? prompts.value : skills.value
  listFailed.value = current.length === 0
  toast.add({
    title: message || t('加载失败，请稍后重试'),
    color: 'error',
    close: false,
    progress: false,
    orientation: 'horizontal',
  })
}

async function loadSkills() {
  if (skillNav.value === 'mine' && !isLoggedIn.value) {
    skills.value = []
    listFailed.value = false
    return
  }
  if (!skills.value.length)
    loading.value = true
  listFailed.value = false
  try {
    const res = skillNav.value === 'mine'
      ? await skillApi.mine({
          page: 1,
          page_size: 40,
          keyword: keyword.value.trim() || undefined,
        })
      : await skillApi.list({
          page: 1,
          page_size: 40,
          keyword: keyword.value.trim() || undefined,
          category: skillCat.value || undefined,
        })
    if (!res?.success || !res.data) {
      failPickList(res?.message)
      return
    }
    skills.value = res.data.items
    listFailed.value = false
  }
  catch {
    failPickList()
  }
  finally {
    loading.value = false
  }
}

/** 提示词库（API.md 1.11）：列表不带正文，点中那条才拉详情 */
async function loadPrompts() {
  if (!prompts.value.length)
    loading.value = true
  listFailed.value = false
  try {
    const res = await promptApi.list({
      page: 1,
      page_size: 40,
      keyword: keyword.value.trim() || undefined,
      tag: promptTag.value || undefined,
      source_id: promptSourceId.value || undefined,
    })
    if (!res?.success || !res.data) {
      failPickList(res?.message)
      return
    }
    prompts.value = res.data.items
    listFailed.value = false
  }
  catch {
    failPickList()
  }
  finally {
    loading.value = false
  }
}

function retryPickList() {
  if (props.mode === 'prompt')
    void loadPrompts()
  else
    void loadSkills()
}

async function loadPromptMeta() {
  const [tagRes, sourceRes] = await Promise.all([promptApi.tags(), promptApi.sources()])
  promptTags.value = tagRes?.success && Array.isArray(tagRes.data) ? tagRes.data : []
  promptSources.value = sourceRes?.success && Array.isArray(sourceRes.data) ? sourceRes.data : []
}

function selectSkillNav(nav: 'all' | 'mine') {
  if (nav === 'mine' && !requireLogin())
    return
  skillNav.value = nav
  skillCat.value = ''
  void loadSkills()
}

function selectSkillCat(cat: string) {
  skillNav.value = 'all'
  skillCat.value = cat
  void loadSkills()
}

function selectPromptTag(tag: string) {
  promptTag.value = promptTag.value === tag ? '' : tag
  void loadPrompts()
}

function selectPromptSource(id: number) {
  promptSourceId.value = id
  void loadPrompts()
}

function openCreate() {
  if (!requireLogin())
    return
  editorOpen.value = true
}

function onSkillSaved() {
  editorOpen.value = false
  skillNav.value = 'mine'
  skillCat.value = ''
  void loadSkills()
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(keyword, () => {
  if (!props.open || props.mode === 'template')
    return
  if (searchTimer)
    clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (props.mode === 'skill')
      void loadSkills()
    else if (props.mode === 'prompt')
      void loadPrompts()
  }, 300)
})

watch([() => props.open, () => props.mode], ([open]) => {
  if (!open) {
    editorOpen.value = false
    return
  }
  keyword.value = ''
  skillNav.value = 'all'
  skillCat.value = ''
  promptTag.value = ''
  promptSourceId.value = 0
  if (props.mode === 'skill') {
    void loadSkillCats()
    void loadSkills()
  }
  else if (props.mode === 'prompt') {
    void loadPromptMeta()
    void loadPrompts()
  }
}, { immediate: true })

const items = computed<PickItem[]>(() => {
  if (props.mode === 'skill') {
    return skills.value.map(item => ({
      key: item.id,
      title: item.title,
      desc: item.description || item.category,
      cover: coverOf(item.cover_url),
      take: () => item.prompt || item.description || item.title,
      teamOwner: item.team_shared ? (item.author_nickname || t('团队成员')) : undefined,
    }))
  }
  if (props.mode === 'prompt') {
    return prompts.value.map(item => ({
      key: item.id,
      title: item.title,
      desc: item.tags.join(' · ') || item.source_name || item.category,
      cover: coverOf(item.cover_url || item.result_url),
      take: async () => {
        if (item.content)
          return item.content
        const res = await promptApi.get(item.id)
        return res?.success && res.data?.content ? res.data.content : ''
      },
    }))
  }
  return templates.value
    .filter(item => matchesKeyword(item.title, item.text))
    .map(item => ({
      key: item.id,
      title: item.title,
      desc: item.text.replace(/\n/g, ' '),
      icon: item.icon,
      take: () => item.text,
    }))
})

async function onPick(item: PickItem) {
  if (picking.value)
    return
  picking.value = item.key
  try {
    const text = await item.take()
    if (text)
      emit('pick', text, item.title)
  }
  finally {
    picking.value = ''
  }
}

const heading = computed(() => {
  if (props.mode === 'skill')
    return { title: t('技能'), hint: t('选一个 Skill，提示词会写入当前文本节点') }
  if (props.mode === 'prompt')
    return { title: t('提示词库'), hint: t('选一条提示词，插入到当前文本') }
  return { title: t('模板'), hint: t('选一段模板，插入到当前文本') }
})

const searchPlaceholder = computed(() => {
  if (props.mode === 'skill')
    return t('搜索 Skill')
  if (props.mode === 'prompt')
    return t('搜索提示词')
  return t('搜索模板')
})

const emptyText = computed(() => {
  if (props.mode === 'skill')
    return skillNav.value === 'mine' ? t('你还没有自己的 Skill') : t('还没有可用的 Skill')
  if (props.mode === 'prompt')
    return t('还没有提示词')
  return t('还没有匹配的模板')
})

const emptyHint = computed(() => {
  if (props.mode === 'skill' && skillNav.value === 'mine')
    return t('把常用的提示词保存成 Skill，下次一键带进画布。')
  if (props.mode === 'prompt')
    return t('去提示词库添加，或换个关键词试试')
  return ''
})

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape' && !editorOpen.value) {
    event.stopPropagation()
    emit('close')
  }
}

watch(chipsEl, (el, prev) => {
  prev?.removeEventListener('scroll', updateChipsOverflow)
  if (!el)
    return
  el.addEventListener('scroll', updateChipsOverflow)
  void nextTick(updateChipsOverflow)
})
watch(filterChips, () => void nextTick(updateChipsOverflow))

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  if (searchTimer)
    clearTimeout(searchTimer)
  chipsEl.value?.removeEventListener('scroll', updateChipsOverflow)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="emit('close')" @pointerdown.stop>
      <div class="studio-modal canvas-text-pick" role="dialog" aria-modal="true" aria-labelledby="canvas-text-pick-title">
        <header class="canvas-text-pick__head">
          <div>
            <h2 id="canvas-text-pick-title">{{ heading.title }}</h2>
            <p>{{ heading.hint }}</p>
          </div>
          <div class="canvas-text-pick__head-actions">
            <NuxtLink v-if="mode === 'prompt'" :to="localePath('/prompts')" target="_blank" class="canvas-text-pick__manage">
              {{ t('管理提示词库') }}
              <UIcon name="i-lucide-external-link" class="size-3.5" />
            </NuxtLink>
            <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
        </header>

        <div class="canvas-text-pick__filters">
          <div class="canvas-text-pick__toolbar">
            <nav v-if="mode === 'skill'" class="canvas-text-pick__nav" :aria-label="t('技能分类')">
              <button type="button" :class="{ 'is-on': skillNav === 'all' }" @click="selectSkillNav('all')">
                {{ t('全部 Skill') }}
              </button>
              <button type="button" :class="{ 'is-on': skillNav === 'mine' }" @click="selectSkillNav('mine')">
                {{ t('我的') }}
              </button>
            </nav>
            <nav v-else-if="mode === 'prompt' && promptSources.length" class="canvas-text-pick__nav" :aria-label="t('提示词来源')">
              <button type="button" :class="{ 'is-on': !promptSourceId }" @click="selectPromptSource(0)">
                {{ t('全部') }}
              </button>
              <button
                v-for="src in promptSources"
                :key="src.id"
                type="button"
                :class="{ 'is-on': promptSourceId === src.id }"
                @click="selectPromptSource(src.id)"
              >
                {{ src.name }}
              </button>
            </nav>
            <label class="canvas-text-pick__search">
              <UIcon name="i-lucide-search" class="size-4" />
              <input v-model="keyword" type="search" :placeholder="searchPlaceholder">
            </label>
          </div>

          <div v-if="filterChips.length" class="canvas-text-pick__chips-wrap" :class="{ 'has-prev': chipsHasPrev, 'has-next': chipsHasNext }">
            <button
              v-show="chipsHasPrev"
              type="button"
              class="canvas-text-pick__chips-arrow is-prev"
              :aria-label="t('向左')"
              @click="scrollChips(-1)"
            >
              <UIcon name="i-lucide-chevron-left" class="size-4" />
            </button>
            <div ref="chipsEl" class="canvas-text-pick__chips">
              <button
                v-for="chip in filterChips"
                :key="chip.key"
                type="button"
                :class="{ 'is-on': chip.on }"
                @click="chip.pick"
              >
                {{ chip.label }}
              </button>
            </div>
            <button
              v-show="chipsHasNext"
              type="button"
              class="canvas-text-pick__chips-arrow is-next"
              :aria-label="t('向右')"
              @click="scrollChips(1)"
            >
              <UIcon name="i-lucide-chevron-right" class="size-4" />
            </button>
          </div>
        </div>

        <div class="canvas-text-pick__body" :class="{ 'is-skill': mode === 'skill' }">
          <div v-if="loading" class="canvas-text-pick__skels">
            <div v-for="n in 4" :key="n" class="canvas-text-pick__row is-skel">
              <i class="canvas-text-pick__cover" />
              <span class="canvas-text-pick__copy">
                <USkeleton class="h-3.5 w-2/5" />
                <USkeleton class="mt-2 h-3 w-full" />
              </span>
            </div>
          </div>
          <div v-else-if="listFailed && !items.length && mode !== 'template'" class="canvas-text-pick__empty">
            <strong>{{ t('加载失败，请稍后重试') }}</strong>
            <button type="button" class="canvas-text-pick__empty-link" @click="retryPickList">{{ t('重试') }}</button>
          </div>
          <div v-else-if="!items.length" class="canvas-text-pick__empty">
            <i>
              <UIcon :name="mode === 'skill' ? 'i-lucide-sparkles' : mode === 'prompt' ? 'i-lucide-book-open-text' : 'i-lucide-layout-template'" class="size-5" />
            </i>
            <strong>{{ emptyText }}</strong>
            <p v-if="emptyHint">{{ emptyHint }}</p>
            <NuxtLink v-if="mode === 'prompt'" :to="localePath('/prompts')" target="_blank" class="canvas-text-pick__empty-link">
              {{ t('管理提示词库') }}
              <UIcon name="i-lucide-arrow-right" class="size-3.5" />
            </NuxtLink>
            <button v-else-if="mode === 'skill' && skillNav === 'mine'" type="button" class="canvas-text-pick__empty-link" @click="openCreate">
              {{ t('创建 Skill') }}
            </button>
          </div>
          <template v-else>
            <button
              v-for="item in items"
              :key="item.key"
              type="button"
              class="canvas-text-pick__row"
              :disabled="Boolean(picking)"
              @click="onPick(item)"
            >
              <span v-if="item.cover" class="canvas-text-pick__cover">
                <img :src="item.cover" alt="">
              </span>
              <span v-else class="canvas-text-pick__cover is-icon">
                <UIcon :name="item.icon || 'i-lucide-sparkles'" class="size-5" />
              </span>
              <span class="canvas-text-pick__copy">
                <strong>
                  <span>{{ item.title }}</span>
                  <i v-if="item.teamOwner" class="skill-review-badge is-team">
                    <UIcon name="i-lucide-users" class="size-3" />
                    {{ t('团队共享 · {name}', { name: item.teamOwner }) }}
                  </i>
                </strong>
                <small>{{ picking === item.key ? t('加载中…') : item.desc }}</small>
              </span>
              <em class="canvas-text-pick__use">{{ t('使用') }}</em>
            </button>
          </template>
        </div>

        <button v-if="mode === 'skill'" type="button" class="canvas-text-pick__create" @click="openCreate">
          <UIcon name="i-lucide-plus" class="size-4" />
          {{ t('创建 Skill') }}
          <i class="canvas-text-pick__dot" />
        </button>
      </div>
    </div>
  </Teleport>

  <StudioSkillEditor :open="editorOpen" :skill="null" @close="editorOpen = false" @saved="onSkillSaved" />
</template>
