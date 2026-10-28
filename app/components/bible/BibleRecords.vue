<script setup lang="ts">
import type { Bible, BibleEpisode, BiblePropChange } from '~/types/creative'
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'
import { bibleName, episodeNoLabel, factLabel } from '~/utils/bible'

const { t } = useI18n()
const localePath = useLocalePath()

const recordTarget = defineModel<number>('recordTarget', { required: true })

const props = defineProps<{
  bible: Bible
  recordOptions: StudioSelectOption[]
  recording: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  generate: []
}>()

function episodeHref(id: number) {
  return localePath(`/create?screenplay=${id}`)
}

function episodeCharacters(e: BibleEpisode) {
  return e.characters.map(k => bibleName(props.bible.characters, k)).join('、')
}

function episodeFacts(e: BibleEpisode) {
  return e.revealed.map(k => props.bible.facts.find(f => f.key === k)).filter(Boolean).map(f => factLabel(f!, 40)).join('；')
}

function episodeThreads(e: BibleEpisode) {
  return e.open.map(k => props.bible.threads.find(x => x.key === k)?.title || k).join('；')
}

function propChangeLabel(pc: BiblePropChange) {
  const name = bibleName(props.bible.props, pc.prop)
  const holder = pc.holder ? bibleName(props.bible.characters, pc.holder) : t('无人持有')
  return pc.state ? `${name} → ${holder} · ${pc.state}` : `${name} → ${holder}`
}
</script>

<template>
  <div class="create-card plan-editor__block">
    <header class="plan-editor__head">
      <h3>{{ t('每集记录') }} <small>{{ t('{n} 集', { n: bible.episodes.length }) }}</small></h3>
      <div class="bible-record__tools">
        <StudioSelect
          v-if="recordOptions.length"
          v-model="recordTarget"
          size="compact"
          :options="recordOptions"
          :sr-label="t('选择要记录的集')"
        />
        <button type="button" class="studio-chip" :disabled="!recordTarget || recording || saving" @click="emit('generate')">
          <UIcon name="i-lucide-sparkles" class="size-4" />
          {{ recording ? t('生成中…') : t('用 AI 生成本集记录') }}
        </button>
      </div>
    </header>
    <p class="plan-editor__empty">{{ t('用文本模型把该集策划案总结成连续性记录并并入上面的设定（新人物 / 揭示的事实 / 未解的线索 / 道具换手），按文本模型单价扣一次积分。') }}</p>
    <article v-for="e in bible.episodes" :key="e.no" class="bible-item bible-record">
      <header class="bible-item__head">
        <strong>{{ episodeNoLabel(e.no, t) }}</strong>
        <NuxtLink v-if="e.screenplay_id" :to="episodeHref(e.screenplay_id)" class="bible-record__title">{{ e.title || t('未命名') }}</NuxtLink>
        <span v-else class="bible-record__title">{{ e.title || t('未命名') }}</span>
      </header>
      <p v-if="e.summary" class="bible-record__summary">{{ e.summary }}</p>
      <dl class="bible-record__facts">
        <div v-if="e.characters.length"><dt>{{ t('出场') }}</dt><dd>{{ episodeCharacters(e) }}</dd></div>
        <div v-if="e.revealed.length"><dt>{{ t('揭示') }}</dt><dd>{{ episodeFacts(e) }}</dd></div>
        <div v-if="e.open.length"><dt>{{ t('未解') }}</dt><dd>{{ episodeThreads(e) }}</dd></div>
        <div v-if="e.relationships.length"><dt>{{ t('关系变化') }}</dt><dd>{{ e.relationships.join('；') }}</dd></div>
        <div v-if="e.prop_changes.length"><dt>{{ t('道具变化') }}</dt><dd>{{ e.prop_changes.map(propChangeLabel).join('；') }}</dd></div>
      </dl>
    </article>
  </div>
</template>
