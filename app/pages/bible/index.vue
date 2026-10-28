<script setup lang="ts">
import bibleApi from '~/api/bible'
import type { Bible, Episode } from '~/types/creative'
import {
  BIBLE_LIMITS,
  bibleForSave,
  bibleName,
  emptyBible,
  episodeNoLabel,
  factLabel,
  formatImpact,
  impactQueryOf,
  isBibleConflict,
  normalizeBible,
  type ImpactKind,
  type ImpactRow,
} from '~/utils/bible'

const { t } = useI18n()

/**
 * 剧集圣经（API.md 27，复审 G01）：一个项目一份，贯穿全剧的人物关系与知情、道具归属、伏笔线索、事实、每集记录。
 * 路由 /bible?project=ID；表单直接改 bible 对象，「保存」整份提交并带 revision 做乐观锁。
 */
definePageMeta({
  layout: 'studio',
  middleware: 'auth',
  keepalive: false,
})

useHead({ title: () => t('剧集设定') })

const route = useRoute()
const localePath = useLocalePath()
const toast = useToast()
const { confirm } = useConfirm()

const projectId = computed(() => Number(Array.isArray(route.query.project) ? route.query.project[0] : route.query.project) || 0)

function notify(title: string, color: 'neutral' | 'error' | 'success' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const loading = ref(true)
const loadError = ref('')
const bible = ref<Bible>(emptyBible())
const revision = ref(0)
const dirty = ref(false)
const saving = ref(false)
const episodes = ref<Episode[]>([])

function touch() {
  dirty.value = true
}

async function load() {
  if (!projectId.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const [b, e] = await Promise.all([bibleApi.get(projectId.value), bibleApi.episodes(projectId.value)])
    if (!b?.success || !b.data) {
      loadError.value = b?.message || t('剧集设定加载失败')
      return
    }
    bible.value = normalizeBible(b.data.bible)
    revision.value = b.data.revision
    dirty.value = false
    if (e?.success && e.data)
      episodes.value = [...e.data.episodes].sort((x, y) => x.episode_no - y.episode_no)
    else if (e?.message)
      notify(e.message, 'error')
  }
  finally {
    loading.value = false
  }
}

async function save(): Promise<boolean> {
  if (!projectId.value || saving.value)
    return false
  saving.value = true
  try {
    const res = await bibleApi.save(projectId.value, revision.value, bibleForSave(bible.value))
    if (!res?.success || !res.data) {
      // 乐观锁冲突单独提示；引用不存在 / 缺名字等校验原因原样给用户，本地修改保留
      notify(isBibleConflict(res?.message) ? t('剧集设定已在其他地方修改，刷新后再保存') : (res?.message || t('保存失败')), 'error')
      return false
    }
    bible.value = normalizeBible(res.data.bible)
    revision.value = res.data.revision
    dirty.value = false
    notify(t('剧集设定已保存'), 'success')
    return true
  }
  finally {
    saving.value = false
  }
}

async function reload() {
  if (dirty.value && !(await confirm({
    title: t('刷新'),
    message: t('有未保存的修改，刷新会丢弃这些修改。'),
    confirmText: t('刷新'),
    danger: true,
  })))
    return
  await load()
}

onBeforeRouteLeave(async () => {
  if (!dirty.value)
    return true
  return confirm({
    title: t('离开页面'),
    message: t('剧集设定有未保存的修改，离开会丢弃。'),
    confirmText: t('离开'),
    danger: true,
  })
})

// ---- 集目录 ----
const editingNo = ref(0)
const noDraft = ref('')
const savingNo = ref(0)

const newEpisodeHref = computed(() => localePath(`/create?project=${projectId.value}&use_bible=1`))

async function startEditNo(row: Episode) {
  editingNo.value = row.id
  noDraft.value = row.episode_no > 0 ? String(row.episode_no) : ''
  await nextTick()
  const el = document.querySelector<HTMLInputElement>('.bible-catalog__no-input')
  el?.focus()
  el?.select()
}

function cancelEditNo() {
  editingNo.value = 0
}

async function commitNo(row: Episode) {
  if (editingNo.value !== row.id)
    return
  const no = Math.max(0, Math.min(999, Math.round(Number(noDraft.value)) || 0))
  editingNo.value = 0
  if (no === row.episode_no)
    return
  savingNo.value = row.id
  try {
    const res = await bibleApi.setEpisode(row.id, no)
    if (!res?.success) {
      notify(res?.message || t('集号保存失败'), 'error')
      return
    }
    row.episode_no = res.data?.episode_no ?? no
    episodes.value = [...episodes.value].sort((x, y) => x.episode_no - y.episode_no)
  }
  finally {
    savingNo.value = 0
  }
}

// ---- 每集记录（AI 生成并并入圣经）----
const recording = ref(false)
const recordTarget = ref(0)

/** 只有已生成策划案（待确认 / 已建画布）的集才能总结成记录 */
const recordOptions = computed(() => episodes.value
  .filter(e => e.status === 1 || e.status === 2)
  .map(e => ({ value: e.id, label: `${episodeNoLabel(e.episode_no, t)}${e.title ? ` · ${e.title}` : ''}` })))

watch(recordOptions, (list) => {
  if (!list.some(o => o.value === recordTarget.value))
    recordTarget.value = Number(list[0]?.value ?? 0)
}, { immediate: true })

async function generateRecord() {
  if (!recordTarget.value || recording.value)
    return
  // 记录并入的是服务器上的那份设定，本地改动先落库，否则返回的整份圣经会把它冲掉
  if (dirty.value && !(await save()))
    return
  recording.value = true
  try {
    const res = await bibleApi.record(recordTarget.value)
    if (!res?.success || !res.data) {
      notify(res?.message || t('生成记录失败'), 'error')
      return
    }
    bible.value = normalizeBible(res.data.bible)
    revision.value = res.data.revision
    dirty.value = false
    notify(res.data.episode_no > 0
      ? t('已生成第 {n} 集记录，扣 {p} 积分', { n: res.data.episode_no, p: res.data.points })
      : t('已生成本集记录，扣 {p} 积分', { p: res.data.points }), 'success')
  }
  finally {
    recording.value = false
  }
}

/** 新线索 / 事实默认落在最后一集 */
const lastEpisodeNo = computed(() => episodes.value.reduce((max, e) => Math.max(max, e.episode_no), 0))

// ---- 查影响（API.md 27.2）----
const impactOpen = ref(false)
const impactKind = ref<ImpactKind>('character')
const impactValue = ref('')
const impactText = ref('')
const impactBusy = ref(false)
const impactRows = ref<ImpactRow[] | null>(null)
const impactTotal = ref(0)

const impactKindOptions = computed(() => [
  { value: 'character', label: t('人物') },
  { value: 'prop', label: t('道具') },
  { value: 'fact', label: t('事实') },
  { value: 'text', label: t('文本') },
])

const impactValueOptions = computed(() => {
  const kind = impactKind.value
  if (kind === 'character')
    return bible.value.characters.map(c => ({ value: c.key, label: bibleName(bible.value.characters, c.key) }))
  if (kind === 'prop')
    return bible.value.props.map(p => ({ value: p.key, label: bibleName(bible.value.props, p.key) }))
  if (kind === 'fact')
    return bible.value.facts.map(f => ({ value: f.key, label: factLabel(f, 30) }))
  return []
})

watch([impactKind, impactValueOptions], () => {
  if (impactKind.value !== 'text' && !impactValueOptions.value.some(o => o.value === impactValue.value))
    impactValue.value = String(impactValueOptions.value[0]?.value ?? '')
  impactRows.value = null
}, { immediate: true })

function openImpact() {
  impactOpen.value = true
}

async function runImpact() {
  if (!projectId.value || impactBusy.value)
    return
  const query = impactQueryOf(impactKind.value, impactKind.value === 'text' ? impactText.value : impactValue.value)
  if (!query)
    return
  impactBusy.value = true
  try {
    const res = await bibleApi.impact(projectId.value, query)
    if (!res?.success || !res.data) {
      notify(res?.message || t('查影响失败'), 'error')
      return
    }
    impactRows.value = formatImpact(res.data.affected, t)
    impactTotal.value = res.data.episodes
  }
  finally {
    impactBusy.value = false
  }
}

const impactReady = computed(() => impactKind.value === 'text' ? !!impactText.value.trim() : !!impactValue.value)

onMounted(() => void load())
watch(projectId, () => void load())
</script>

<template>
  <section class="projects-page create-page bible-page">
    <header class="create-head">
      <div>
        <h1>{{ t('剧集设定') }}</h1>
        <p>{{ t('贯穿全剧的人物关系与知情、道具归属、伏笔线索与每集记录；新一集生成时沿用，改设定前可先查影响。') }}</p>
      </div>
      <div v-if="projectId" class="bible-head__actions">
        <button type="button" class="studio-chip" :disabled="loading" @click="openImpact">
          <UIcon name="i-lucide-search-check" class="size-4" />
          {{ t('查影响') }}
        </button>
        <NuxtLink :to="newEpisodeHref" class="studio-chip">
          <UIcon name="i-lucide-plus" class="size-4" />
          {{ t('新建一集') }}
        </NuxtLink>
      </div>
    </header>

    <StudioEmpty
      v-if="!projectId"
      :title="t('没有指定项目')"
      :description="t('从项目列表的「更多」菜单进入「剧集设定」。')"
    />
    <StudioLoading v-else-if="loading" />
    <StudioEmpty v-else-if="loadError" :title="loadError" />

    <template v-else>
      <!-- 剧名 / 梗概 -->
      <div class="create-card">
        <div class="plan-editor__grid">
          <label class="publish-field">
            <span>{{ t('剧名') }}</span>
            <input v-model="bible.title" :maxlength="BIBLE_LIMITS.title" :placeholder="t('剧名')" @input="touch">
          </label>
          <label class="publish-field bible-span">
            <span>{{ t('梗概') }}</span>
            <textarea v-model="bible.logline" rows="2" :maxlength="BIBLE_LIMITS.logline" :placeholder="t('一两句话说清这部剧讲什么')" @input="touch" />
          </label>
        </div>
      </div>

      <BibleCatalog
        :episodes="episodes"
        :new-episode-href="newEpisodeHref"
        :editing-no="editingNo"
        :no-draft="noDraft"
        :saving-no="savingNo"
        @update:no-draft="noDraft = $event"
        @edit="startEditNo"
        @commit="commitNo"
        @cancel="cancelEditNo"
      />

      <BibleCharacters :bible="bible" @change="touch" />
      <BibleProps :bible="bible" @change="touch" />
      <BibleThreads :bible="bible" :last-episode-no="lastEpisodeNo" @change="touch" />
      <BibleFacts :bible="bible" :last-episode-no="lastEpisodeNo" @change="touch" />
      <BibleRecords
        v-model:record-target="recordTarget"
        :bible="bible"
        :record-options="recordOptions"
        :recording="recording"
        :saving="saving"
        @generate="generateRecord"
      />

      <footer class="create-foot bible-foot">
        <small v-if="dirty" class="bible-foot__hint">{{ t('有未保存的修改') }}</small>
        <button type="button" class="plan-btn plan-btn--ghost" :disabled="saving || loading" @click="reload">
          {{ t('刷新') }}
        </button>
        <button type="button" class="plan-btn plan-btn--solid" :disabled="saving || !dirty" @click="save">
          {{ saving ? t('保存中…') : t('保存') }}
        </button>
      </footer>
    </template>

    <BibleImpactModal
      v-model:open="impactOpen"
      v-model:kind="impactKind"
      v-model:value="impactValue"
      v-model:text="impactText"
      :kind-options="impactKindOptions"
      :value-options="impactValueOptions"
      :ready="impactReady"
      :busy="impactBusy"
      :rows="impactRows"
      :total="impactTotal"
      @run="runImpact"
    />
  </section>
</template>

<style>
@import '~/assets/css/studio-parts/panels.css';
@import '~/assets/css/studio-parts/growth-pages.css';
@import '~/assets/css/studio.css';
</style>
