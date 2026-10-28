<script setup lang="ts">
import subjectApi from '~/api/subject'
import type { Subject, SubjectKind } from '~/types/creative'
import { resolveMediaUrl } from '~/utils/media'

const { t } = useI18n()

/**
 * 主体选择器（API.md 10.2）：给画布节点挑最多 4 个主体，任务请求带 subject_ids，
 * 服务端把主体参考图并入 inputs 并把 look 追加到提示词末尾。
 */
const props = withDefaults(defineProps<{
  open: boolean
  selected?: number[]
  max?: number
}>(), {
  selected: () => [],
  max: 4,
})

const emit = defineEmits<{
  close: []
  /** 选中的主体 id 与对应的主体行（父组件可用来渲染 chip，省一次请求） */
  'update:selected': [ids: number[], rows: Subject[]]
}>()

const toast = useToast()
const localePath = useLocalePath()

const PAGE_SIZE = 18
const KIND_TABS: { value: SubjectKind | '', label: string }[] = [
  { value: '', label: t('全部') },
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

const kind = ref<SubjectKind | ''>('')
const keyword = ref('')
const picked = ref<number[]>([])
let keywordTimer: number | undefined

function notify(title: string, color: 'neutral' | 'error' = 'neutral') {
  toast.add({ title, color, close: false, progress: false, orientation: 'horizontal' })
}

const {
  items: subjects,
  busy,
  failed,
  loadingMore,
  hasMore,
  reload,
  loadMore,
} = useStudioPaged<Subject>({
  pageSize: PAGE_SIZE,
  async fetch(page, pageSize) {
    const q = keyword.value.trim()
    const res = await subjectApi.list({
      page,
      page_size: pageSize,
      keyword: q || undefined,
      ...(kind.value ? { kind: kind.value } : {}),
    })
    if (!res?.success || !res.data) {
      notify(res?.message || t('主体库加载失败'), 'error')
      return null
    }
    return { items: (res.data.items ?? []).map(row => ({ ...row, refs: Array.isArray(row.refs) ? row.refs : [] })), total: res.data.total }
  },
})

const rowById = ref<Record<number, Subject>>({})
const pickedRows = computed(() => picked.value.map(id => rowById.value[id]).filter((item): item is Subject => Boolean(item)))

function coverOf(item: Subject) {
  const url = item.cover_url || item.refs?.[0]?.url || ''
  return url ? resolveMediaUrl(url) : ''
}

function remember(item: Subject) {
  rowById.value = { ...rowById.value, [item.id]: item }
}

function toggle(item: Subject) {
  remember(item)
  if (picked.value.includes(item.id)) {
    picked.value = picked.value.filter(id => id !== item.id)
    return
  }
  if (picked.value.length >= props.max) {
    notify(t('最多引用 {n} 个主体', { n: props.max }), 'error')
    return
  }
  picked.value = [...picked.value, item.id]
}

function confirmPick() {
  emit('update:selected', [...picked.value], [...pickedRows.value])
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    event.stopPropagation()
    emit('close')
  }
}

watch(subjects, (list) => {
  if (!list.length)
    return
  const next = { ...rowById.value }
  for (const row of list)
    next[row.id] = row
  rowById.value = next
})

watch(() => props.open, (open) => {
  if (!open)
    return
  picked.value = [...props.selected]
  keyword.value = ''
  kind.value = ''
  void reload()
}, { immediate: true })

watch(kind, () => {
  if (props.open)
    void reload()
})

watch(keyword, () => {
  window.clearTimeout(keywordTimer)
  keywordTimer = window.setTimeout(() => {
    if (props.open)
      void reload()
  }, 320)
})

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.clearTimeout(keywordTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask asset-picker-mask" @click.self="emit('close')" @pointerdown.stop @keydown.stop>
      <div class="studio-modal asset-picker subject-picker" role="dialog" aria-modal="true" aria-labelledby="subject-picker-title">
        <header class="asset-picker__head">
          <div>
            <h2 id="subject-picker-title">{{ t('引用主体') }}</h2>
            <p>{{ t('引用主体后会自动带上参考图并补充描述') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="asset-picker__bar">
          <div class="asset-picker__tabs">
            <button
              v-for="tab in KIND_TABS"
              :key="tab.value"
              type="button"
              :class="{ 'is-on': kind === tab.value }"
              @click="kind = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
          <label class="projects-search asset-picker__search">
            <UIcon name="i-lucide-search" class="size-4" />
            <input v-model="keyword" type="search" :placeholder="t('搜索主体')">
          </label>
          <NuxtLink :to="localePath('/subjects')" class="subject-picker__manage" target="_blank">
            <UIcon name="i-lucide-library" class="size-4" />
            {{ t('管理主体库') }}
          </NuxtLink>
        </div>

        <div class="asset-picker__body">
          <StudioPaging
            root=".asset-picker__body"
            grid-class="asset-picker__grid"
            compact
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
              <div v-for="n in 6" :key="n" class="asset-picker__item">
                <USkeleton class="asset-picker__thumb" />
                <USkeleton class="mt-2 h-3 w-3/5" />
              </div>
            </template>
            <template #empty>
              <div class="subject-picker__empty">
                <span class="subject-picker__empty-mark">
                  <UIcon name="i-lucide-users-round" class="size-7" />
                </span>
                <strong>{{ t('还没有主体') }}</strong>
                <p>{{ t('把常用的角色、场景与道具存成主体，之后生成时一键引用，人物和场景更稳定。') }}</p>
                <NuxtLink :to="localePath('/subjects')" class="subject-picker__empty-btn" target="_blank">
                  <UIcon name="i-lucide-plus" class="size-4" />
                  {{ t('去主体库新建') }}
                </NuxtLink>
              </div>
            </template>
            <div class="asset-picker__grid">
              <button
                v-for="item in subjects"
                :key="item.id"
                type="button"
                class="asset-picker__item subject-pick"
                :class="{ 'is-on': picked.includes(item.id) }"
                :title="item.look || item.name"
                @click="toggle(item)"
              >
                <span class="asset-picker__thumb">
                  <img v-if="coverOf(item)" :src="coverOf(item)" :alt="item.name" loading="lazy">
                  <UIcon v-else :name="KIND_ICON[item.kind]" class="size-8" />
                  <i>{{ KIND_LABEL[item.kind] }}</i>
                  <span class="asset-picker__check" :class="{ 'is-on': picked.includes(item.id) }">
                    <UIcon v-if="picked.includes(item.id)" name="i-lucide-check" class="size-3.5" />
                  </span>
                </span>
                <span class="asset-picker__name">{{ item.name }}</span>
              </button>
            </div>
          </StudioPaging>
        </div>

        <footer class="subject-picker__foot">
          <div class="subject-picker__picked">
            <span class="subject-picker__count">{{ t('已选 {n}/{max}', { n: picked.length, max: max }) }}</span>
            <div v-if="pickedRows.length" class="subject-picker__minis">
              <button
                v-for="item in pickedRows"
                :key="item.id"
                type="button"
                class="subject-picker__mini"
                :title="item.name"
                :aria-label="t('移除')"
                @click="toggle(item)"
              >
                <img v-if="coverOf(item)" :src="coverOf(item)" :alt="item.name">
                <UIcon v-else :name="KIND_ICON[item.kind]" class="size-3.5" />
              </button>
            </div>
          </div>
          <button type="button" class="subject-picker__clear" :disabled="!picked.length" @click="picked = []">{{ t('清空') }}</button>
          <button type="button" class="asset-picker__ok" @click="confirmPick">{{ t('确定') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
