<script setup lang="ts">
import skillApi from '~/api/skill'
import type { AgentSkill } from '~/components/studio/StudioSkillModal.vue'
import type { Skill, SkillReviewStatus } from '~/types/creative'
import { formatCount, resolveMediaUrl } from '~/utils/media'

const { t, locale } = useI18n()

/**
 * 技能库：技能广场（GET /skill，匿名可看）/ 我的技能（加入技能库 = 收藏，GET /user/skill/favorites）/
 * 我创建的（GET /user/skill）。后两个需要登录；加入、新建、编辑、删除也要登录。
 */
definePageMeta({
  layout: 'studio',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: t('技能库') })

const toast = useToast()
const { confirm } = useConfirm()
const route = useRoute()
const { isLoggedIn, requireLogin } = useRequireLogin()

type SkillCard = AgentSkill & { id: number, raw: Skill }
type Tab = 'plaza' | 'fav' | 'mine'

const TABS: { id: Tab, label: string, icon: string }[] = [
  { id: 'plaza', label: '技能广场', icon: 'i-lucide-sparkles' },
  { id: 'fav', label: '我的技能', icon: 'i-lucide-library' },
  { id: 'mine', label: '我创建的', icon: 'i-lucide-user-round' },
]

const ALL_TAG = '全部技能'
const PAGE_SIZE = 24

const selectedSkill = ref<SkillCard | null>(null)
const keyword = ref('')
const activeTab = ref<Tab>('plaza')
const activeTag = ref(ALL_TAG)
const { names: baseTags, load: loadCategories } = useContentCategories('skill')
const favoriting = ref<number | null>(null)
const deleting = ref<number | null>(null)
let keywordTimer: number | undefined

/** GET /skill → 卡片模型（字段映射见 API.md skill 表） */
function toCard(item: Skill): SkillCard {
  return {
    id: item.id,
    raw: item,
    title: item.title,
    desc: item.description,
    // 团队共享的行 author_name 可能为空，退回共享者昵称，别显示成官方
    author: item.author_name || item.author_nickname || 'EasyTV',
    uses: formatCount(item.uses),
    stars: formatCount(item.stars),
    tag: item.category,
    cover: resolveMediaUrl(item.cover_url) || '/images/work-cover.svg',
    src: resolveMediaUrl(item.video_url),
    scene: item.scene || t('{category}、内容成片', { category: item.category }),
    howto: item.howto || undefined,
    output: item.output || undefined,
    prompt: item.prompt,
    favorited: item.favorited,
    mine: item.user_id > 0,
    reviewStatus: item.review_status ?? 0,
    reviewRemark: item.review_remark || '',
    // 同团队成员共享过来的（API.md 10.10）：改 / 删 / 上架后端都会拒绝，只留使用入口
    teamShared: item.team_shared === true,
    sharedAuthor: item.author_nickname || '',
  }
}

/** 「我创建的」卡片上的上架状态角标（API.md 8.3） */
const REVIEW_BADGE: Record<SkillReviewStatus, { label: string, cls: string }> = {
  0: { label: t('私有'), cls: 'is-private' },
  1: { label: t('审核中'), cls: 'is-pending' },
  2: { label: t('已上架'), cls: 'is-published' },
  3: { label: t('已驳回'), cls: 'is-rejected' },
}

function reviewBadge(item: SkillCard) {
  return REVIEW_BADGE[item.reviewStatus ?? 0] ?? REVIEW_BADGE[0]
}

type SkillList = {
  items: SkillCard[]
  page: number
  total: number
  loading: boolean
  loadingMore: boolean
  loaded: boolean
  failed: boolean
}

function emptyList(): SkillList {
  return { items: [], page: 1, total: 0, loading: false, loadingMore: false, loaded: false, failed: false }
}

const lists = reactive<Record<Tab, SkillList>>({
  plaza: emptyList(),
  fav: emptyList(),
  mine: emptyList(),
})
const fetchSeq: Record<Tab, number> = { plaza: 0, fav: 0, mine: 0 }

const currentState = computed(() => lists[activeTab.value])
const currentItems = computed(() => currentState.value.items)
/** 还没成功也还没失败：先出骨架，避免刷新时闪「暂无 Skill」 */
const tabLoading = computed(() => !currentState.value.failed && !currentState.value.loaded && currentItems.value.length === 0)
const tabHasMore = computed(() => currentState.value.loaded && currentItems.value.length < currentState.value.total)

const tags = computed(() => {
  const extra = lists.plaza.items.map(item => item.tag).filter(tag => tag && !baseTags.value.includes(tag))
  return [ALL_TAG, ...baseTags.value, ...Array.from(new Set(extra))]
})

const sectionTitle = computed(() => {
  if (activeTab.value === 'plaza')
    return t(activeTag.value)
  return t(TABS.find(tab => tab.id === activeTab.value)?.label ?? '')
})

const emptyTitle = computed(() => activeTab.value === 'fav' ? t('还没有收藏的 Skill') : activeTab.value === 'mine' ? t('你还没有自己的 Skill') : t('暂无 Skill'))
const emptyDescription = computed(() => activeTab.value === 'fav' ? t('浏览推荐 Skill，收藏后会显示在这里。') : activeTab.value === 'mine' ? t('把常用的提示词保存成 Skill，下次一键带进画布。') : t('换个分类或关键词试试。'))

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function listQuery(tab: Tab, page: number) {
  const q = keyword.value.trim()
  return {
    page,
    page_size: PAGE_SIZE,
    keyword: q || undefined,
    category: tab === 'plaza' && activeTag.value !== ALL_TAG ? activeTag.value : undefined,
  }
}

/** 我的技能 / 我创建的：匿名不打接口（需要 UserAuth），由 selectTab 引导登录 */
function needsAuth(tab: Tab) {
  return tab !== 'plaza'
}

function selectTab(tab: Tab) {
  if (needsAuth(tab) && !requireLogin())
    return
  activeTab.value = tab
}

function selectTag(tag: string) {
  activeTag.value = tag
}

function failList(state: SkillList, reset: boolean, previousPage: number, message?: string) {
  state.page = reset ? previousPage : Math.max(1, state.page - 1)
  state.failed = state.items.length === 0
  notify(message || t('Skill 加载失败'), 'error')
}

async function loadList(tab: Tab, reset: boolean) {
  const state = lists[tab]
  if (needsAuth(tab) && !isLoggedIn.value)
    return
  const previousPage = state.page
  if (reset) {
    state.page = 1
    state.loading = true
    state.loadingMore = false
    state.failed = false
  }
  else {
    state.loadingMore = true
  }
  const seq = ++fetchSeq[tab]
  try {
    const query = listQuery(tab, state.page)
    const res = tab === 'plaza'
      ? await skillApi.list(query)
      : tab === 'fav'
        ? await skillApi.favorites(query)
        : await skillApi.mine(query)
    if (seq !== fetchSeq[tab])
      return
    if (!res?.success || !res.data) {
      failList(state, reset, previousPage, res?.message)
      return
    }
    const cards = (res.data.items ?? []).map(toCard)
    if (reset) {
      state.items = cards
    }
    else {
      const seen = new Set(state.items.map(item => item.id))
      state.items = [...state.items, ...cards.filter(item => !seen.has(item.id))]
    }
    state.total = !reset && !cards.length ? state.items.length : res.data.total
    state.loaded = true
    state.failed = false
  }
  catch {
    if (seq !== fetchSeq[tab])
      return
    failList(state, reset, previousPage)
  }
  finally {
    if (seq === fetchSeq[tab]) {
      state.loading = false
      state.loadingMore = false
    }
  }
}

async function loadMoreCurrent() {
  const tab = activeTab.value
  const state = lists[tab]
  if (!state.loaded || state.loading || state.loadingMore || state.items.length >= state.total)
    return
  state.page += 1
  await loadList(tab, false)
}

watch(activeTab, (tab) => {
  if (!lists[tab].loaded)
    void loadList(tab, true)
})

watch(activeTag, () => {
  lists.plaza.loaded = false
  void loadList('plaza', true)
})

/** 搜索词变了：只重拉当前标签，其他标签切过去时再拉 */
watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    lists.plaza.loaded = false
    lists.fav.loaded = false
    lists.mine.loaded = false
    void loadList(activeTab.value, true)
  }, 320)
})

// ---- 加入 / 移出技能库（POST /user/skill/:id/favorite，切换） ----
function patchCard(items: SkillCard[], id: number, favorited: boolean, stars: number) {
  const item = items.find(s => s.id === id)
  if (!item)
    return null
  item.favorited = favorited
  item.stars = formatCount(stars)
  item.raw.favorited = favorited
  item.raw.stars = stars
  return item
}

function onFavorite(id: number, favorited: boolean, stars: number) {
  const fromPlaza = patchCard(lists.plaza.items, id, favorited, stars)
  const fromMine = patchCard(lists.mine.items, id, favorited, stars)
  if (selectedSkill.value?.id === id) {
    selectedSkill.value.favorited = favorited
    selectedSkill.value.stars = formatCount(stars)
  }
  if (!favorited) {
    const before = lists.fav.items.length
    lists.fav.items = lists.fav.items.filter(s => s.id !== id)
    if (lists.fav.loaded && lists.fav.items.length < before)
      lists.fav.total = Math.max(0, lists.fav.total - 1)
    return
  }
  patchCard(lists.fav.items, id, favorited, stars)
  if (lists.fav.items.some(s => s.id === id))
    return
  const src = fromPlaza || fromMine
  if (!src)
    return
  lists.fav.items = [src, ...lists.fav.items]
  if (lists.fav.loaded)
    lists.fav.total += 1
}

async function toggleLibrary(item: SkillCard) {
  if (favoriting.value || !requireLogin())
    return
  favoriting.value = item.id
  try {
    const res = await skillApi.favorite(item.id)
    if (!res?.success || !res.data) {
      notify(res?.message || t('操作失败'), 'error')
      return
    }
    onFavorite(item.id, res.data.favorited, res.data.stars)
    notify(res.data.favorited ? t('已加入技能库') : t('已移出技能库'), 'success')
  }
  catch {
    notify(t('操作失败'), 'error')
  }
  finally {
    favoriting.value = null
  }
}

// ---- 我创建的：新建 / 编辑 / 删除 ----
const editorOpen = ref(false)
const editing = ref<Skill | null>(null)

function openSkill(item: SkillCard) {
  selectedSkill.value = item
}

function openCreate() {
  if (!requireLogin())
    return
  editing.value = null
  editorOpen.value = true
}

function openEdit(id: number) {
  const item = lists.mine.items.find(s => s.id === id) ?? (selectedSkill.value?.id === id ? selectedSkill.value : null)
  // 共享来的技能只读，入口已隐藏，这里兜一层防止 URL / 弹窗路径漏进来
  if (!item || item.teamShared)
    return
  editing.value = item.raw
  selectedSkill.value = null
  editorOpen.value = true
}

async function onSaved() {
  lists.mine.loaded = false
  activeTab.value = 'mine'
  await loadList('mine', true)
}

/** 弹窗里提交上架 / 撤回后：先本地同步状态，再刷新「我创建的」（拿 submitted_at / remark） */
async function onReviewed(id: number, status: SkillReviewStatus) {
  for (const list of [lists.mine.items, lists.fav.items, lists.plaza.items]) {
    const item = list.find(s => s.id === id)
    if (item) {
      item.reviewStatus = status
      item.reviewRemark = ''
      item.raw.review_status = status
      item.raw.review_remark = ''
    }
  }
  if (selectedSkill.value?.id === id) {
    selectedSkill.value.reviewStatus = status
    selectedSkill.value.reviewRemark = ''
  }
  lists.mine.loaded = false
  if (isLoggedIn.value)
    await loadList('mine', true)
}

async function removeMine(item: SkillCard) {
  if (item.teamShared || deleting.value)
    return
  const ok = await confirm({
    title: t('删除'),
    message: t('删除 Skill「{name}」？', { name: item.title }),
    confirmText: t('删除'),
    danger: true,
  })
  if (!ok || deleting.value)
    return
  deleting.value = item.id
  try {
    const res = await skillApi.remove(item.id)
    if (!res?.success) {
      notify(res?.message || t('删除失败'), 'error')
      return
    }
    const inFav = lists.fav.items.some(s => s.id === item.id)
    lists.mine.items = lists.mine.items.filter(s => s.id !== item.id)
    lists.fav.items = lists.fav.items.filter(s => s.id !== item.id)
    lists.plaza.items = lists.plaza.items.filter(s => s.id !== item.id)
    if (lists.mine.loaded)
      lists.mine.total = Math.max(0, lists.mine.total - 1)
    if (inFav && lists.fav.loaded)
      lists.fav.total = Math.max(0, lists.fav.total - 1)
    notify(t('Skill 已删除'), 'success')
  }
  catch {
    notify(t('删除失败'), 'error')
  }
  finally {
    deleting.value = null
  }
}

/** 榜单等页面通过 /skills?skill=:id 直接打开 Skill 详情 */
async function openSkillFromQuery() {
  const sid = Number(route.query.skill) || 0
  if (!sid)
    return
  const found = lists.plaza.items.find(s => s.id === sid)
  if (found) {
    openSkill(found)
    return
  }
  try {
    const res = await skillApi.get(sid)
    if (res?.success && res.data)
      openSkill(toCard(res.data))
  }
  catch {
    notify(t('Skill 加载失败'), 'error')
  }
}

void loadCategories()
const plazaBoot = loadList('plaza', true)

const tabsEl = ref<HTMLElement | null>(null)
const tabIndicator = reactive({ left: 0, width: 0, ready: false })
let tabsObserver: ResizeObserver | null = null

function syncTabIndicator() {
  const active = tabsEl.value?.querySelector<HTMLElement>('button.is-on')
  if (!active?.offsetWidth)
    return
  tabIndicator.left = active.offsetLeft
  tabIndicator.width = active.offsetWidth
  tabIndicator.ready = true
}

watch([activeTab, locale], async () => {
  await nextTick()
  syncTabIndicator()
})

onMounted(() => {
  void plazaBoot.then(openSkillFromQuery)
  syncTabIndicator()
  if (tabsEl.value) {
    tabsObserver = new ResizeObserver(syncTabIndicator)
    tabsObserver.observe(tabsEl.value)
  }
})

onActivated(syncTabIndicator)

watch(() => route.query.skill, () => {
  void openSkillFromQuery()
})

onBeforeUnmount(() => {
  window.clearTimeout(keywordTimer)
  tabsObserver?.disconnect()
})
</script>

<template>
  <section class="skill-lib">
    <header class="skill-lib__head">
      <div>
        <h1>{{ t('技能库') }}</h1>
        <p>{{ t('把常用提示词、角色设定和创作方法，变成随时可用的能力。') }}</p>
      </div>
      <button type="button" class="plan-btn plan-btn--solid skill-lib__create" @click="openCreate">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('新建 Skill') }}
      </button>
    </header>

    <div class="skill-lib__bar">
      <div ref="tabsEl" class="skill-lib__tabs" :class="{ 'is-ready': tabIndicator.ready }" role="tablist">
        <span
          class="skill-lib__tabs-indicator"
          aria-hidden="true"
          :style="{ width: `${tabIndicator.width}px`, transform: `translateX(${tabIndicator.left}px)` }"
        />
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :class="{ 'is-on': activeTab === tab.id }"
          @click="selectTab(tab.id)"
        >
          <UIcon :name="tab.icon" class="size-4" />
          {{ t(tab.label) }}
        </button>
      </div>
      <label class="projects-search">
        <UIcon name="i-lucide-search" class="size-4" />
        <input v-model="keyword" type="search" :placeholder="t('搜索 Skill')">
      </label>
    </div>

    <div class="skill-lib__body" :class="{ 'has-side': activeTab === 'plaza' }">
      <aside v-if="activeTab === 'plaza'" class="skill-lib__side">
        <h2>{{ t('技能广场分类') }}</h2>
        <nav>
          <button
            v-for="tag in tags"
            :key="tag"
            type="button"
            :class="{ 'is-on': activeTag === tag }"
            @click="selectTag(tag)"
          >
            <UIcon :name="tag === ALL_TAG ? 'i-lucide-layout-grid' : 'i-lucide-folder'" class="size-4" />
            <span class="skill-lib__tag-name">{{ t(tag) }}</span>
          </button>
        </nav>
      </aside>

      <div class="skill-lib__main">
        <div class="skill-lib__section">
          <h2>
            <UIcon name="i-lucide-folder" class="size-4" />
            {{ sectionTitle }}
          </h2>
          <span v-if="currentState.loaded">{{ t('{n} 个', { n: currentState.total }) }}</span>
        </div>

        <StudioPaging
          grid-class="skill-lib__grid"
          :loading="tabLoading"
          :error="currentState.failed"
          :loading-more="currentState.loadingMore"
          :has-more="tabHasMore"
          :count="currentItems.length"
          :empty-title="emptyTitle"
          :empty-description="emptyDescription"
          :load-more="loadMoreCurrent"
        >
          <template #skeleton>
            <article v-for="n in 9" :key="n" class="skill-lib-card skill-lib-card--skeleton" aria-hidden="true">
              <div class="skill-lib-card__top">
                <USkeleton class="size-9 rounded-lg" />
                <USkeleton class="h-4 w-1/2" />
              </div>
              <USkeleton class="mt-3 h-3 w-full" />
              <USkeleton class="mt-2 h-3 w-4/5" />
              <USkeleton class="mt-4 h-9 w-32 rounded-lg" />
            </article>
          </template>
          <div class="skill-lib__grid">
            <article
              v-for="item in currentItems"
              :key="item.id"
              class="skill-lib-card"
              role="button"
              tabindex="0"
              @click="openSkill(item)"
              @keydown.enter="openSkill(item)"
            >
              <div class="skill-lib-card__top">
                <span class="skill-lib-card__icon">
                  <img v-if="item.raw.cover_url" :src="item.cover" :alt="item.title" loading="lazy">
                  <UIcon v-else name="i-lucide-clapperboard" class="size-5" />
                </span>
                <h3>{{ item.title }}</h3>
              </div>
              <p class="skill-lib-card__desc">{{ item.desc || item.prompt }}</p>
              <div class="skill-lib-card__meta">
                <span><UIcon name="i-lucide-heart" class="size-3.5" />{{ item.stars }}</span>
                <span class="skill-lib-card__author">{{ item.author }}</span>
                <em v-if="item.teamShared" class="skill-review-badge is-team">{{ t('团队共享 · {name}', { name: item.sharedAuthor || t('团队成员') }) }}</em>
                <em
                  v-else-if="activeTab === 'mine' && item.mine"
                  class="skill-review-badge"
                  :class="reviewBadge(item).cls"
                  :title="item.reviewStatus === 3 && item.reviewRemark ? item.reviewRemark : undefined"
                >{{ reviewBadge(item).label }}</em>
                <em v-else-if="item.tag" class="skill-lib-card__tag">{{ t(item.tag) }}</em>
              </div>
              <div class="skill-lib-card__foot">
                <template v-if="activeTab === 'mine' && item.mine && !item.teamShared">
                  <button type="button" class="skill-lib-card__btn" @click.stop="openEdit(item.id)">
                    <UIcon name="i-lucide-pencil" class="size-4" />
                    {{ t('编辑') }}
                  </button>
                  <button type="button" class="skill-lib-card__btn is-danger" :disabled="deleting === item.id" @click.stop="removeMine(item)">
                    <UIcon name="i-lucide-trash-2" class="size-4" />
                    {{ deleting === item.id ? t('删除中…') : t('删除') }}
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  class="skill-lib-card__btn"
                  :class="{ 'is-on': item.favorited }"
                  :disabled="favoriting === item.id"
                  @click.stop="toggleLibrary(item)"
                >
                  <UIcon :name="favoriting === item.id ? 'i-lucide-loader-circle' : item.favorited ? 'i-lucide-check' : 'i-lucide-plus'" class="size-4" :class="{ 'animate-spin': favoriting === item.id }" />
                  {{ item.favorited ? t('已加入') : t('加入技能库') }}
                </button>
                <small><UIcon name="i-lucide-users" class="size-3.5" />{{ item.uses }}</small>
              </div>
            </article>
          </div>
        </StudioPaging>
      </div>
    </div>

    <StudioSkillModal :skill="selectedSkill" @close="selectedSkill = null" @favorite="onFavorite" @edit="openEdit" @review="onReviewed" />
    <StudioSkillEditor :open="editorOpen" :skill="editing" @close="editorOpen = false" @saved="onSaved" />
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
</style>
