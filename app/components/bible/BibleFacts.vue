<script setup lang="ts">
import type { Bible } from '~/types/creative'
import { BIBLE_LIMITS, bibleName, dropFactRefs, knows, newFact, setKnowledge } from '~/utils/bible'

const { t } = useI18n()

const props = defineProps<{
  bible: Bible
  lastEpisodeNo: number
}>()

const emit = defineEmits<{
  change: []
}>()

function addFact() {
  if (props.bible.facts.length >= BIBLE_LIMITS.facts)
    return
  props.bible.facts.push(newFact(props.bible.facts, props.lastEpisodeNo))
  emit('change')
}

function removeFact(index: number) {
  const removed = props.bible.facts.splice(index, 1)[0]
  if (removed)
    dropFactRefs(props.bible, removed.key)
  emit('change')
}

function episodeNoOf(event: Event) {
  const n = Math.round(Number((event.target as HTMLInputElement).value))
  return Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0
}

function toggleKnowledge(charKey: string, factKey: string) {
  setKnowledge(props.bible, charKey, factKey, !knows(props.bible, charKey, factKey))
  emit('change')
}
</script>

<template>
  <div class="create-card plan-editor__block">
    <header class="plan-editor__head">
      <h3>{{ t('事实') }} <small>{{ bible.facts.length }}/{{ BIBLE_LIMITS.facts }}</small></h3>
      <button type="button" class="studio-chip" :disabled="bible.facts.length >= BIBLE_LIMITS.facts" @click="addFact">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加事实') }}
      </button>
    </header>
    <p class="plan-editor__empty">{{ t('区分「观众知道」与「哪些角色知道」：不知情的角色在后续集里不会泄密。') }}</p>
    <article v-for="(f, i) in bible.facts" :key="f.key" class="bible-item">
      <header class="bible-item__head">
        <span class="plan-editor__key">{{ f.key }}</span>
        <input v-model="f.text" class="bible-item__name bible-item__name--wide" :maxlength="BIBLE_LIMITS.factText" :placeholder="t('事实内容，如：手机里有录音')" @input="emit('change')">
        <button type="button" class="plan-editor__remove" :aria-label="t('删除')" @click="removeFact(i)">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </header>
      <div class="bible-inline">
        <label class="bible-no">
          <span>{{ t('揭示于第几集') }}</span>
          <input type="number" min="0" max="999" :value="f.revealed_in || ''" @input="f.revealed_in = episodeNoOf($event); emit('change')">
        </label>
        <label class="create-foot__opt">
          <input v-model="f.audience_knows" type="checkbox" @change="emit('change')">
          <span>{{ t('观众知道') }}</span>
        </label>
      </div>
      <div v-if="bible.characters.length" class="bible-sub">
        <div class="bible-sub__head">
          <span>{{ t('哪些角色知道') }}</span>
        </div>
        <div class="publish-tags">
          <button
            v-for="c in bible.characters"
            :key="c.key"
            type="button"
            :class="{ 'is-on': knows(bible, c.key, f.key) }"
            @click="toggleKnowledge(c.key, f.key)"
          >
            {{ bibleName(bible.characters, c.key) }}
          </button>
        </div>
      </div>
    </article>
  </div>
</template>
