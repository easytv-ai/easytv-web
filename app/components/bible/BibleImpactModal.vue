<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalePath } from '#imports'
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'
import type { Episode } from '~/types/creative'
import { episodeNoLabel, episodeStatusLabel } from '~/utils/bible'
import type { ImpactKind, ImpactRow } from '~/utils/bible'

const { t } = useI18n()
const localePath = useLocalePath()

const open = defineModel<boolean>('open', { required: true })
const kind = defineModel<ImpactKind>('kind', { required: true })
const value = defineModel<string>('value', { required: true })
const text = defineModel<string>('text', { required: true })

const props = defineProps<{
  kindOptions: StudioSelectOption[]
  valueOptions: StudioSelectOption[]
  ready: boolean
  busy: boolean
  rows: ImpactRow[] | null
  total: number
  episodes: Episode[]
}>()

const checked = computed(() => [...props.episodes].sort((a, b) => a.episode_no - b.episode_no || a.id - b.id))

const needsEntry = computed(() => props.kind !== 'text' && props.valueOptions.length === 0)

const kindName = computed(() => {
  if (props.kind === 'prop')
    return t('道具')
  if (props.kind === 'fact')
    return t('事实')
  return t('人物')
})

function hitOf(id: number) {
  return props.rows?.find(row => row.screenplay_id === id)
}

function quietReason(ep: Episode) {
  if (ep.status === -1)
    return t('策划案没有生成成功，没有场和镜可查')
  if (!ep.shots)
    return t('这一集还没有镜头')
  return t('没有写到')
}

const emit = defineEmits<{
  run: []
}>()

function episodeHref(id: number) {
  return localePath(`/create?screenplay=${id}`)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    open.value = false
  }
}

const dialog = ref<HTMLElement | null>(null)

watch(open, async (isOpen) => {
  if (!isOpen)
    return
  await nextTick()
  const field = dialog.value?.querySelector<HTMLElement>('.bible-impact__text')
    || dialog.value?.querySelector<HTMLElement>('.bible-impact__run')
  field?.focus()
})

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="open = false">
      <div ref="dialog" class="bible-impact" role="dialog" aria-modal="true" aria-labelledby="bible-impact-title">
        <header class="trash-modal__head">
          <div>
            <h2 id="bible-impact-title">{{ t('查影响') }}</h2>
            <p>{{ t('改一个人物 / 道具 / 事实前，先看哪些集、场、镜会受影响（以已保存的设定为准）。') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="open = false">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="bible-impact__form">
          <StudioSelect
            v-model="kind"
            size="compact"
            :options="kindOptions"
            :sr-label="t('类型')"
          />
          <input
            v-if="kind === 'text'"
            v-model="text"
            class="bible-impact__text"
            maxlength="100"
            :placeholder="t('输入要查的文本，如：录音')"
            @keydown.enter.prevent="emit('run')"
          >
          <StudioSelect
            v-else-if="valueOptions.length"
            v-model="value"
            size="compact"
            :options="valueOptions"
            :sr-label="t('对象')"
          />
          <p v-else class="bible-impact__empty">{{ t('这一类还没有条目') }}</p>
          <button type="button" class="plan-btn plan-btn--solid bible-impact__run" :disabled="!ready || busy" @click="emit('run')">
            {{ busy ? t('查询中…') : t('查影响') }}
          </button>
        </div>
        <div class="bible-impact__result">
          <div v-if="!rows" class="bible-impact__wait">
            <p v-if="needsEntry">{{ t('还没有{name}。先在这一页添加并保存，再查它写进了哪些集。', { name: kindName }) }}</p>
            <p v-else-if="!checked.length">{{ t('这个项目还没有集。先生成一集策划案，才查得到影响。') }}</p>
            <p v-else>{{ t('选好之后点查影响。下面是要扫的集。') }}</p>
            <p v-if="needsEntry" class="bible-impact__note">{{ t('也可以改成文本，查一段原文。') }}</p>
          </div>
          <div v-if="rows" class="bible-impact__stats">
            <div>
              <strong>{{ total }}</strong>
              <span>{{ t('查过的集') }}</span>
            </div>
            <div :class="{ 'is-hit': rows.length > 0 }">
              <strong>{{ rows.length }}</strong>
              <span>{{ t('受影响') }}</span>
            </div>
          </div>
          <ul v-if="checked.length" class="bible-impact__list">
            <li v-for="ep in checked" :key="ep.id" :class="{ 'is-hit': !!hitOf(ep.id) }">
              <div class="bible-impact__row">
                <NuxtLink :to="episodeHref(ep.id)">{{ episodeNoLabel(ep.episode_no, t) }} {{ ep.title || t('未命名') }}</NuxtLink>
                <span class="bible-impact__status" :class="`is-${ep.status === -1 ? 'failed' : ep.status}`">{{ episodeStatusLabel(ep.status, t) }}</span>
              </div>
              <p v-if="rows && hitOf(ep.id)">
                <template v-if="hitOf(ep.id)?.scenes">{{ hitOf(ep.id)?.scenes }}</template>
                <template v-if="hitOf(ep.id)?.shots"> · {{ hitOf(ep.id)?.shots }}</template>
                <template v-if="hitOf(ep.id)?.why"> · {{ hitOf(ep.id)?.why }}</template>
              </p>
              <p v-else-if="rows">{{ quietReason(ep) }}</p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
