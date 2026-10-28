<script setup lang="ts">
import type { Bible, BibleThread } from '~/types/creative'
import { BIBLE_LIMITS, newThread } from '~/utils/bible'

const { t } = useI18n()

const props = defineProps<{
  bible: Bible
  lastEpisodeNo: number
}>()

const emit = defineEmits<{
  change: []
}>()

const threadStatusOptions = computed(() => [
  { value: 'open', label: t('未解决') },
  { value: 'resolved', label: t('已解决') },
])

function addThread() {
  if (props.bible.threads.length >= BIBLE_LIMITS.threads)
    return
  props.bible.threads.push(newThread(props.bible.threads, props.lastEpisodeNo))
  emit('change')
}

function removeThread(index: number) {
  props.bible.threads.splice(index, 1)
  emit('change')
}

function setThreadStatus(th: BibleThread, value: string | number) {
  th.status = value === 'resolved' ? 'resolved' : 'open'
  if (th.status === 'open')
    th.resolved_in = 0
  else if (!th.resolved_in)
    th.resolved_in = props.lastEpisodeNo
  emit('change')
}

function episodeNoOf(event: Event) {
  const n = Math.round(Number((event.target as HTMLInputElement).value))
  return Number.isFinite(n) ? Math.max(0, Math.min(999, n)) : 0
}
</script>

<template>
  <div class="create-card plan-editor__block">
    <header class="plan-editor__head">
      <h3>{{ t('线索') }} <small>{{ bible.threads.length }}/{{ BIBLE_LIMITS.threads }}</small></h3>
      <button type="button" class="studio-chip" :disabled="bible.threads.length >= BIBLE_LIMITS.threads" @click="addThread">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加线索') }}
      </button>
    </header>
    <p v-if="!bible.threads.length" class="plan-editor__empty">{{ t('埋下的伏笔和还没回答的问题，开于第几集、解于第几集。') }}</p>
    <article v-for="(th, i) in bible.threads" :key="th.key" class="bible-item">
      <header class="bible-item__head">
        <span class="plan-editor__key">{{ th.key }}</span>
        <input v-model="th.title" class="bible-item__name bible-item__name--wide" :maxlength="BIBLE_LIMITS.threadTitle" :placeholder="t('线索标题，如：录音里到底是谁的声音')" @input="emit('change')">
        <button type="button" class="plan-editor__remove" :aria-label="t('删除')" @click="removeThread(i)">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </header>
      <div class="bible-inline">
        <StudioSelect
          size="compact"
          :model-value="th.status"
          :options="threadStatusOptions"
          :sr-label="t('状态')"
          @update:model-value="setThreadStatus(th, $event)"
        />
        <label class="bible-no">
          <span>{{ t('开于第几集') }}</span>
          <input type="number" min="0" max="999" :value="th.opened_in || ''" @input="th.opened_in = episodeNoOf($event); emit('change')">
        </label>
        <label v-if="th.status === 'resolved'" class="bible-no">
          <span>{{ t('解于第几集') }}</span>
          <input type="number" min="0" max="999" :value="th.resolved_in || ''" @input="th.resolved_in = episodeNoOf($event); emit('change')">
        </label>
      </div>
    </article>
  </div>
</template>
