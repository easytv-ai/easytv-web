<script setup lang="ts">
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'
import type { ImpactKind, ImpactRow } from '~/utils/bible'

const { t } = useI18n()
const localePath = useLocalePath()

const open = defineModel<boolean>('open', { required: true })
const kind = defineModel<ImpactKind>('kind', { required: true })
const value = defineModel<string>('value', { required: true })
const text = defineModel<string>('text', { required: true })

defineProps<{
  kindOptions: StudioSelectOption[]
  valueOptions: StudioSelectOption[]
  ready: boolean
  busy: boolean
  rows: ImpactRow[] | null
  total: number
}>()

const emit = defineEmits<{
  run: []
}>()

function episodeHref(id: number) {
  return localePath(`/create?screenplay=${id}`)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="studio-modal-mask" @click.self="open = false">
      <div class="bible-impact" role="dialog" aria-modal="true" aria-labelledby="bible-impact-title">
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
          <span v-else class="plan-editor__empty">{{ t('这一类还没有条目') }}</span>
          <button type="button" class="plan-btn plan-btn--solid bible-impact__run" :disabled="!ready || busy" @click="emit('run')">
            {{ busy ? t('查询中…') : t('查影响') }}
          </button>
        </div>
        <div v-if="rows" class="bible-impact__result">
          <p class="create-hint">{{ t('查了 {n} 集，{m} 集受影响', { n: total, m: rows.length }) }}</p>
          <ul v-if="rows.length" class="bible-impact__list">
            <li v-for="row in rows" :key="row.screenplay_id">
              <NuxtLink :to="episodeHref(row.screenplay_id)">{{ row.head }}</NuxtLink>
              <span v-if="row.scenes"> · {{ row.scenes }}</span>
              <span v-if="row.shots"> · {{ row.shots }}</span>
              <em v-if="row.why"> · {{ row.why }}</em>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>
