<script setup lang="ts">
import skillApi from '~/api/skill'
import creatorApi from '~/api/creator'
import type { AgentSkill } from '~/components/studio/StudioSkillModal.vue'
import type { Asset, CreatorLeaderboardItem, Skill, SkillReviewStatus, Style } from '~/types/creative'
import { formatCount, resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/** 技能页匿名可看（GET /skill 走 TryUserAuth）；收藏 / 我的 / 创建 / 加入创作台需要登录 */
definePageMeta({
  layout: 'studio',
  // 列表页缓存实例：从详情页返回时保留已加载的数据与滚动位置
  keepalive: true,
})

useHead({ title: 'EasyTV Agent' })

const toast = useToast()
const { confirm } = useConfirm()
const route = useRoute()
const { isLoggedIn, requireLogin } = useRequireLogin()

type SkillCard = AgentSkill & { id: number, raw: Skill }

const selectedSkill = ref<SkillCard | null>(null)

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

/** 「我的」卡片上的上架状态角标（API.md 8.3） */
const REVIEW_BADGE: Record<SkillReviewStatus, { label: string, cls: string }> = {
  0: { label: t('私有'), cls: 'is-private' },
  1: { label: t('审核中'), cls: 'is-pending' },
  2: { label: t('已上架'), cls: 'is-published' },
  3: { label: t('已驳回'), cls: 'is-rejected' },
}

function reviewBadge(item: SkillCard) {
  return REVIEW_BADGE[item.reviewStatus ?? 0] ?? REVIEW_BADGE[0]
}

function openSkill(item: SkillCard) {
  selectedSkill.value = item
}

const keyword = ref('')
type Tab = 'skill' | 'fav' | 'mine'
const activeTab = ref<Tab>('skill')
const REC_TAG = '推荐'
const activeTag = ref(REC_TAG)
const { names: baseTags, load: loadCategories } = useContentCategories('skill')
const PAGE_SIZE = 24

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
  skill: emptyList(),
  fav: emptyList(),
  mine: emptyList(),
})
const fetchSeq: Record<Tab, number> = { skill: 0, fav: 0, mine: 0 }
let keywordTimer: number | undefined

const currentState = computed(() => lists[activeTab.value])
const currentItems = computed(() => currentState.value.items)
const currentList = computed(() => currentItems.value)
/** 还没成功也还没失败：先出骨架，避免刷新时闪「暂无 Skill」 */
const tabLoading = computed(() => !currentState.value.failed && !currentState.value.loaded && currentItems.value.length === 0)
const tabLoadingMore = computed(() => currentState.value.loadingMore)
const tabFailed = computed(() => currentState.value.failed)
const tabHasMore = computed(() => currentState.value.loaded && currentItems.value.length < currentState.value.total)

const tags = computed(() => {
  const extra = lists.skill.items.map(item => item.tag).filter(tag => tag && !baseTags.value.includes(tag))
  return [REC_TAG, ...baseTags.value, ...Array.from(new Set(extra))]
})

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

function listQuery(tab: Tab, page: number) {
  const q = keyword.value.trim()
  return {
    page,
    page_size: PAGE_SIZE,
    keyword: q || undefined,
    category: tab === 'skill' && activeTag.value !== REC_TAG ? activeTag.value : undefined,
  }
}

/** 收藏 / 我的：匿名不打接口（需要 UserAuth），由 selectTab 引导登录 */
function needsAuth(tab: Tab) {
  return tab !== 'skill'
}

function selectTab(tab: Tab) {
  if (needsAuth(tab) && !requireLogin())
    return
  activeTab.value = tab
}

function failSkillList(state: SkillList, reset: boolean, previousPage: number, message?: string) {
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
    if (state.loading || state.loadingMore) {
      state.page = Math.max(1, state.page - 1)
      return
    }
    state.loadingMore = true
  }
  const seq = ++fetchSeq[tab]
  try {
    const query = listQuery(tab, state.page)
    const res = tab === 'skill'
      ? await skillApi.list(query)
      : tab === 'fav'
        ? await skillApi.favorites(query)
        : await skillApi.mine(query)
    if (seq !== fetchSeq[tab])
      return
    if (!res?.success || !res.data) {
      failSkillList(state, reset, previousPage, res?.message)
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
    failSkillList(state, reset, previousPage)
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
  if (!state.loaded || state.loading || state.loadingMore)
    return
  if (state.items.length >= state.total)
    return
  state.page += 1
  await loadList(tab, false)
}

watch(activeTab, (tab) => {
  if (!lists[tab].loaded)
    void loadList(tab, true)
})

watch(activeTag, () => {
  lists.skill.loaded = false
  if (activeTab.value === 'skill')
    void loadList('skill', true)
})

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    lists.skill.loaded = false
    lists.fav.loaded = false
    lists.mine.loaded = false
    void loadList(activeTab.value, true)
  }, 320)
})

/** 弹窗里收藏 / 取消收藏后同步三个列表 */
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
  const fromSkill = patchCard(lists.skill.items, id, favorited, stars)
  const fromMine = patchCard(lists.mine.items, id, favorited, stars)
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
  const src = fromSkill || fromMine
  if (!src)
    return
  lists.fav.items = [src, ...lists.fav.items]
  if (lists.fav.loaded)
    lists.fav.total += 1
}

// ---- 我的 Skill：新建 / 编辑 / 删除 ----
const editorOpen = ref(false)
const editing = ref<Skill | null>(null)
const deleting = ref<number | null>(null)

function openCreate() {
  if (!requireLogin())
    return
  editing.value = null
  editorOpen.value = true
}

function openEdit(id: number) {
  const item = lists.mine.items.find(s => s.id === id)
  // 共享来的技能只读，入口已隐藏，这里兜一层防止 URL / 弹窗路径漏进来
  if (item?.teamShared)
    return
  editing.value = item?.raw ?? null
  selectedSkill.value = null
  editorOpen.value = true
}

async function onSaved() {
  lists.mine.loaded = false
  activeTab.value = 'mine'
  await loadList('mine', true)
}

/** 弹窗里提交上架 / 撤回后：先本地同步状态，再刷新「我的」列表（拿 submitted_at / remark） */
async function onReviewed(id: number, status: SkillReviewStatus) {
  for (const list of [lists.mine.items, lists.fav.items, lists.skill.items]) {
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

// ---- 创作者榜（GET /creator/leaderboard，公开，只展示前 5）----
type LeaderPeriod = 'week' | 'month'
const leaderPeriod = ref<LeaderPeriod>('week')
const leaderItems = ref<CreatorLeaderboardItem[]>([])
const leaderLoading = ref(false)
const leaderFailed = ref(false)
const leaderShown = ref('')
let leaderSeq = 0

async function loadLeaderboard(period: LeaderPeriod) {
  const seq = ++leaderSeq
  leaderLoading.value = true
  leaderFailed.value = false
  try {
    const res = await creatorApi.leaderboard(period)
    if (seq !== leaderSeq)
      return
    if (!res?.success || !res.data) {
      if (leaderShown.value !== period)
        leaderItems.value = []
      leaderFailed.value = leaderItems.value.length === 0
      if (leaderFailed.value)
        notify(res?.message || t('加载失败，请稍后重试'), 'error')
      return
    }
    leaderItems.value = (res.data.items ?? []).slice(0, 5)
    leaderShown.value = period
    leaderFailed.value = false
  }
  catch {
    if (seq !== leaderSeq)
      return
    if (leaderShown.value !== period)
      leaderItems.value = []
    leaderFailed.value = leaderItems.value.length === 0
    if (leaderFailed.value)
      notify(t('加载失败，请稍后重试'), 'error')
  }
  finally {
    if (seq === leaderSeq)
      leaderLoading.value = false
  }
}

function selectLeaderPeriod(period: LeaderPeriod) {
  if (leaderPeriod.value === period)
    return
  leaderPeriod.value = period
  void loadLeaderboard(period)
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
    lists.skill.items = lists.skill.items.filter(s => s.id !== item.id)
    if (lists.mine.loaded)
      lists.mine.total = Math.max(0, lists.mine.total - 1)
    if (inFav && lists.fav.loaded)
      lists.fav.total = Math.max(0, lists.fav.total - 1)
    notify(t('Skill 已删除'))
  }
  finally {
    deleting.value = null
  }
}

// ---- 风格库 / 资产：交给画布同一套输入栏
const entryChat = ref<any>(null)
const styleOpen = ref(false)
const styleEditOpen = ref(false)
const styleEditTarget = ref<Style | null>(null)
const styleMineVersion = ref(0)
const pickerOpen = ref(false)

function onStylePick(style: Style) {
  entryChat.value?.applyStyle({ name: style.name, prompt: style.prompt || style.name, cover_url: style.cover_url })
  styleOpen.value = false
}

function onStyleCreate() {
  styleEditTarget.value = null
  styleEditOpen.value = true
}

function onStyleEdit(style: Style) {
  styleEditTarget.value = style
  styleEditOpen.value = true
}

function onStyleSaved() {
  styleMineVersion.value++
  styleEditOpen.value = false
}

function onAssetPicked(assets: Asset[]) {
  pickerOpen.value = false
  if (assets?.length)
    entryChat.value?.addAssetAttachments(assets)
}

void loadCategories()
void loadLeaderboard(leaderPeriod.value)
const skillBoot = loadList('skill', true)

onMounted(() => {
  void skillBoot.then(() => {
    const sid = Number(route.query.skill) || 0
    if (!sid)
      return
    const found = lists.skill.items.find(s => s.id === sid)
    if (found)
      openSkill(found)
    else
      void skillApi.get(sid).then((res) => {
        if (res?.success && res.data)
          openSkill(toCard(res.data))
      })
  })
})

onBeforeUnmount(() => {
  window.clearTimeout(keywordTimer)
})

</script>

<template>
  <section class="agent-page">
    <div class="agent-hero">
      <h1>{{ t('canvas.chat.skill.ready') }}<em>{{ t('canvas.chat.skill.readyEm') }}</em></h1>
      <CanvasChat
        ref="entryChat"
        entry
        :canvas-id="0"
        @open-style="styleOpen = true"
        @pick-asset="pickerOpen = true"
        @create-skill="openCreate"
      />
    </div>

    <div class="agent-nav">
      <div class="agent-tabs">
        <button type="button" :class="{ 'is-on': activeTab === 'skill' }" @click="selectTab('skill')">Skill</button>
        <button type="button" :class="{ 'is-on': activeTab === 'fav' }" @click="selectTab('fav')">{{ t('收藏') }}</button>
        <button type="button" :class="{ 'is-on': activeTab === 'mine' }" @click="selectTab('mine')">{{ t('我的') }}</button>
      </div>

      <div class="agent-filters">
        <div v-if="activeTab === 'skill'" class="agent-tags">
          <button
            v-for="tag in tags"
            :key="tag"
            type="button"
            :class="{ 'is-on': activeTag === tag }"
            @click="activeTag = tag"
          >
            {{ t(tag) }}
          </button>
        </div>
        <button v-else-if="activeTab === 'mine'" type="button" class="projects-tool-btn" @click="openCreate">
          <UIcon name="i-lucide-plus" class="size-4" />
          {{ t('新建 Skill') }}
        </button>
        <span v-else />
        <label class="agent-search">
          <UIcon name="i-lucide-search" class="size-4" />
          <input
            v-model="keyword"
            type="search"
            :placeholder="t('搜索 Skill')"
          >
        </label>
      </div>
    </div>

    <section v-if="activeTab === 'skill' && (leaderItems.length || leaderLoading || leaderFailed)" class="agent-leader" :aria-label="t('创作者榜')">
      <div class="agent-leader__head">
        <strong>
          <UIcon name="i-lucide-trophy" class="size-4" />
          {{ leaderPeriod === 'week' ? t('本周创作者榜') : t('本月创作者榜') }}
        </strong>
        <span class="agent-leader__toggle">
          <button type="button" :class="{ 'is-on': leaderPeriod === 'week' }" @click="selectLeaderPeriod('week')">{{ t('周') }}</button>
          <button type="button" :class="{ 'is-on': leaderPeriod === 'month' }" @click="selectLeaderPeriod('month')">{{ t('月') }}</button>
        </span>
      </div>
      <ol v-if="leaderItems.length" class="agent-leader__list">
        <li v-for="(row, idx) in leaderItems" :key="row.user_id">
          <i class="agent-leader__rank" :class="{ 'is-top': idx < 3 }">{{ idx + 1 }}</i>
          <b class="agent-leader__name">{{ row.nickname || `#${row.user_id}` }}</b>
          <small>{{ t('{n} 个技能', { n: row.skills }) }} · {{ t('{n} 次调用', { n: formatCount(row.calls) }) }}</small>
        </li>
      </ol>
      <div v-else-if="leaderLoading" class="agent-leader__list agent-leader__list--skel">
        <USkeleton v-for="n in 5" :key="n" class="h-5 w-full" />
      </div>
      <p v-else class="agent-pop__empty">{{ t('加载失败，请稍后重试') }}</p>
    </section>

    <StudioPaging
      :loading="tabLoading"
      :error="tabFailed"
      :loading-more="tabLoadingMore"
      :has-more="tabHasMore"
      :count="currentItems.length"
      :empty-title="activeTab === 'fav' ? t('还没有收藏的 Skill') : activeTab === 'mine' ? t('你还没有自己的 Skill') : t('暂无 Skill')"
      :empty-description="activeTab === 'fav' ? t('浏览推荐 Skill，收藏后会显示在这里。') : activeTab === 'mine' ? t('把常用的提示词保存成 Skill，下次一键带进画布。') : t('换个分类或关键词试试。')"
      :load-more="loadMoreCurrent"
    >
      <template #skeleton>
        <article v-for="n in 8" :key="n" class="skill-card skill-card--skeleton" aria-hidden="true">
          <USkeleton class="h-[84px] w-[112px] shrink-0 rounded-[10px]" />
          <div class="skill-card__body">
            <USkeleton class="h-3.5 w-3/5" />
            <USkeleton class="mt-2 h-3 w-full" />
            <USkeleton class="mt-1.5 h-3 w-4/5" />
            <div class="skill-card__meta">
              <USkeleton class="h-3 w-24" />
              <USkeleton class="h-3 w-10" />
            </div>
          </div>
        </article>
      </template>
      <div class="agent-grid">
        <div
          v-for="item in currentList"
          :key="item.id"
          class="skill-card"
          role="button"
          tabindex="0"
          @click="openSkill(item)"
          @keydown.enter="openSkill(item)"
        >
          <div class="skill-card__cover">
            <img :src="item.cover" :alt="item.title">
            <span>{{ item.raw.graph_nodes > 0 ? t('画布模板') : item.mine && !item.teamShared ? t('我的') : t('视频') }}</span>
            <i v-if="item.favorited" class="skill-card__fav"><UIcon name="i-lucide-star" class="size-3.5" /></i>
            <em v-if="item.teamShared" class="skill-card__review skill-review-badge is-team">
              <UIcon name="i-lucide-users" class="size-3" />
              {{ t('团队共享 · {name}', { name: item.sharedAuthor || t('团队成员') }) }}
            </em>
            <em
              v-else-if="item.mine && activeTab === 'mine'"
              class="skill-card__review skill-review-badge"
              :class="reviewBadge(item).cls"
              :title="item.reviewStatus === 3 && item.reviewRemark ? item.reviewRemark : undefined"
            >{{ reviewBadge(item).label }}</em>
          </div>
          <div class="skill-card__body">
            <h3>{{ item.title }}</h3>
            <p>{{ item.desc || item.prompt }}</p>
            <div class="skill-card__meta">
              <span class="skill-card__author">
                <i>{{ item.author.slice(0, 1) }}</i>
                {{ item.author }}
              </span>
              <span v-if="item.mine && !item.teamShared" class="skill-card__ops">
                <button type="button" :aria-label="t('编辑')" @click.stop="openEdit(item.id)">
                  <UIcon name="i-lucide-pencil" class="size-3.5" />
                  <span class="canvas-tip canvas-tip--up">{{ t('编辑') }}</span>
                </button>
                <button type="button" :aria-label="t('删除')" :disabled="deleting === item.id" @click.stop="removeMine(item)">
                  <UIcon name="i-lucide-trash-2" class="size-3.5" />
                  <span class="canvas-tip canvas-tip--up">{{ t('删除') }}</span>
                </button>
              </span>
              <span v-else class="skill-card__uses">
                <UIcon name="i-lucide-users" class="size-3.5" />
                {{ item.uses }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </StudioPaging>

    <StudioSkillModal :skill="selectedSkill" @close="selectedSkill = null" @favorite="onFavorite" @edit="openEdit" @review="onReviewed" />
    <StudioSkillEditor :open="editorOpen" :skill="editing" @close="editorOpen = false" @saved="onSaved" />
    <ClientOnly>
      <CanvasAssetPicker
        :open="pickerOpen"
        :title="t('从资产库选择')"
        @close="pickerOpen = false"
        @pick="onAssetPicked"
      />
      <CanvasStyleLibrary
        v-if="styleOpen"
        :open="styleOpen"
        :locked="styleEditOpen"
        :mine-version="styleMineVersion"
        @close="styleOpen = false"
        @pick="onStylePick"
        @clear="entryChat?.applyStyle(null)"
        @create="onStyleCreate"
        @edit="onStyleEdit"
      />
      <CanvasStyleEditModal
        v-if="styleEditOpen"
        :open="styleEditOpen"
        :editing="styleEditTarget"
        @close="styleEditOpen = false"
        @saved="onStyleSaved"
      />
    </ClientOnly>
  </section>
</template>
<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio-parts/canvas.css';
@import '~/assets/css/studio-parts/features.css';
</style>
