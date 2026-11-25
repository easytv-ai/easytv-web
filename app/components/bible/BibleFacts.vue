<script setup lang="ts">
import type { Bible } from '~/types/creative'
import { BIBLE_LIMITS, bibleName, dropFactRefs, factLabel, knows, newFact, setKnowledge } from '~/utils/bible'

const { t } = useI18n()
const { confirm } = useConfirm()
const root = ref<HTMLElement | null>(null)

const props = defineProps<{
  bible: Bible
  lastEpisodeNo: number
}>()

const emit = defineEmits<{
  change: []
}>()

async function addFact() {
  if (props.bible.facts.length >= BIBLE_LIMITS.facts)
    return
  props.bible.facts.push(newFact(props.bible.facts, props.lastEpisodeNo))
  emit('change')
  await nextTick()
  const fields = root.value?.querySelectorAll<HTMLInputElement>('.bible-item__name')
  fields?.[fields.length - 1]?.focus()
}

async function removeFact(index: number) {
  const removed = props.bible.facts[index]
  if (!removed)
    return
  if (!(await confirm({
    title: t('删除'),
    message: t('bible.fact.remove', { name: factLabel(removed, 30) }),
    confirmText: t('删除'),
    danger: true,
  })))
    return
  props.bible.facts.splice(index, 1)
  dropFactRefs(props.bible, removed.key)
  emit('change')
}

function episodeNoOf(event: Event) {
  const n = Math.round(Number((event.target as HTMLInputElement).value))
  return Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0
}

function holdNumberWheel(event: WheelEvent) {
  if (event.currentTarget === document.activeElement)
    event.preventDefault()
}

function toggleKnowledge(charKey: string, factKey: string) {
  setKnowledge(props.bible, charKey, factKey, !knows(props.bible, charKey, factKey))
  emit('change')
}
</script>

<template>
  <div ref="root" class="create-card plan-editor__block">
    <header class="plan-editor__head">
      <h3>{{ t('事实') }}<small class="num">{{ bible.facts.length }}/{{ BIBLE_LIMITS.facts }}</small></h3>
      <button v-if="bible.facts.length" type="button" class="studio-chip" :disabled="bible.facts.length >= BIBLE_LIMITS.facts" @click="addFact">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加事实') }}
      </button>
    </header>
    <button v-if="!bible.facts.length" type="button" class="bible-empty" @click="addFact">
      <UIcon name="i-lucide-plus" class="size-4" />
      {{ t('添加事实') }}
    </button>
    <article v-for="(f, i) in bible.facts" :key="f.key" class="bible-item">
      <header class="bible-item__head">
        <span class="plan-editor__key">{{ f.key }}</span>
        <input v-model="f.text" class="bible-item__name bible-item__name--wide" :maxlength="BIBLE_LIMITS.factText" :placeholder="t('事实内容，如：手机里有录音')" @input="emit('change')">
        <button type="button" class="plan-editor__icon is-danger" :aria-label="t('删除')" @click="removeFact(i)">
          <UIcon name="i-lucide-trash-2" class="size-4" />
        </button>
      </header>
      <div class="bible-fact__meta">
        <label class="bible-no">
          <span>{{ t('揭示于第几集') }}</span>
          <input type="number" min="0" max="999" :value="f.revealed_in || ''" @wheel="holdNumberWheel" @input="f.revealed_in = episodeNoOf($event); emit('change')">
        </label>
        <button
          type="button"
          class="bible-tag"
          :class="{ 'is-on': f.audience_knows }"
          :aria-pressed="f.audience_knows"
          @click="f.audience_knows = !f.audience_knows; emit('change')"
        >
          {{ t('观众知道') }}
        </button>
      </div>
      <div v-if="bible.characters.length" class="bible-fact__who">
        <span>{{ t('哪些角色知道') }}</span>
        <div class="publish-tags">
          <button
            v-for="c in bible.characters"
            :key="c.key"
            type="button"
            :class="{ 'is-on': knows(bible, c.key, f.key) }"
            :aria-pressed="knows(bible, c.key, f.key)"
            @click="toggleKnowledge(c.key, f.key)"
          >
            {{ bibleName(bible.characters, c.key) }}
          </button>
        </div>
      </div>
    </article>
  </div>
</template>
