<script setup lang="ts">
import type { Bible, BibleCharacter } from '~/types/creative'
import { TTS_VOICES } from '~/utils/plan-dialogue'
import { BIBLE_LIMITS, bibleName, dropCharacterRefs, factLabel, knows, newCharacter, setKnowledge } from '~/utils/bible'

const { t } = useI18n()

const props = defineProps<{
  bible: Bible
}>()

const emit = defineEmits<{
  change: []
}>()

const voiceOptions = computed(() => [
  { value: '', label: t('模型默认音色') },
  ...TTS_VOICES.map(voice => ({ value: voice, label: voice })),
])

function characterOptions(exclude?: string) {
  return [
    { value: '', label: t('选择人物') },
    ...props.bible.characters.filter(c => c.key !== exclude).map(c => ({ value: c.key, label: bibleName(props.bible.characters, c.key) })),
  ]
}

function addCharacter() {
  if (props.bible.characters.length >= BIBLE_LIMITS.characters)
    return
  props.bible.characters.push(newCharacter(props.bible.characters))
  emit('change')
}

function removeCharacter(index: number) {
  const removed = props.bible.characters.splice(index, 1)[0]
  if (removed)
    dropCharacterRefs(props.bible, removed.key)
  emit('change')
}

function setVoice(c: BibleCharacter, value: string | number) {
  c.voice = String(value)
  emit('change')
}

function addRelationship(c: BibleCharacter) {
  c.relationships.push({ to: '', relation: '' })
  emit('change')
}

function removeRelationship(c: BibleCharacter, index: number) {
  c.relationships.splice(index, 1)
  emit('change')
}

function setRelationTo(c: BibleCharacter, index: number, value: string | number) {
  const rel = c.relationships[index]
  if (rel)
    rel.to = String(value)
  emit('change')
}

function toggleKnowledge(charKey: string, factKey: string) {
  setKnowledge(props.bible, charKey, factKey, !knows(props.bible, charKey, factKey))
  emit('change')
}
</script>

<template>
  <div class="create-card plan-editor__block">
    <header class="plan-editor__head">
      <h3>{{ t('人物') }} <small>{{ bible.characters.length }}/{{ BIBLE_LIMITS.characters }}</small></h3>
      <button type="button" class="studio-chip" :disabled="bible.characters.length >= BIBLE_LIMITS.characters" @click="addCharacter">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加人物') }}
      </button>
    </header>
    <p v-if="!bible.characters.length" class="plan-editor__empty">{{ t('还没有人物。也可以先生成一集，再用「用 AI 生成本集记录」把策划案里的人物并进来。') }}</p>
    <article v-for="(c, i) in bible.characters" :key="c.key" class="bible-item">
      <header class="bible-item__head">
        <span class="plan-editor__key">{{ c.key }}</span>
        <input v-model="c.name" class="bible-item__name" :maxlength="BIBLE_LIMITS.name" :placeholder="t('名字')" @input="emit('change')">
        <span class="plan-shot__spacer" />
        <button type="button" class="plan-editor__remove" :aria-label="t('删除')" @click="removeCharacter(i)">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </header>
      <div class="plan-editor__grid">
        <label class="publish-field">
          <span>{{ t('外貌') }}</span>
          <textarea v-model="c.look" rows="2" :maxlength="BIBLE_LIMITS.look" :placeholder="t('外貌与服装提示词')" @input="emit('change')" />
        </label>
        <label class="publish-field">
          <span>{{ t('性格') }}</span>
          <textarea v-model="c.traits" rows="2" :maxlength="BIBLE_LIMITS.traits" :placeholder="t('性格与行事方式')" @input="emit('change')" />
        </label>
      </div>
      <div class="plan-voice">
        <span class="plan-voice__label">{{ t('音色') }}</span>
        <StudioSelect
          size="compact"
          :model-value="c.voice || ''"
          :options="voiceOptions"
          :sr-label="t('音色')"
          @update:model-value="setVoice(c, $event)"
        />
        <input
          v-model="c.voice_style"
          class="plan-voice__style"
          :maxlength="BIBLE_LIMITS.voiceStyle"
          :placeholder="t('说话风格，如：沉稳')"
          @input="emit('change')"
        >
      </div>
      <div class="bible-sub">
        <div class="bible-sub__head">
          <span>{{ t('关系') }}</span>
          <button type="button" class="studio-chip" :disabled="bible.characters.length < 2" @click="addRelationship(c)">
            <UIcon name="i-lucide-plus" class="size-4" />
            {{ t('添加关系') }}
          </button>
        </div>
        <div v-for="(rel, ri) in c.relationships" :key="ri" class="bible-rel">
          <StudioSelect
            size="compact"
            :model-value="rel.to"
            :options="characterOptions(c.key)"
            :sr-label="t('与谁')"
            @update:model-value="setRelationTo(c, ri, $event)"
          />
          <input v-model="rel.relation" :maxlength="BIBLE_LIMITS.relation" :placeholder="t('什么关系，如：前女友，仍有旧情')" @input="emit('change')">
          <button type="button" class="plan-editor__remove" :aria-label="t('删除')" @click="removeRelationship(c, ri)">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </div>
      </div>
      <div v-if="bible.facts.length" class="bible-sub">
        <div class="bible-sub__head">
          <span>{{ t('知道哪些事实') }}</span>
        </div>
        <div class="publish-tags">
          <button
            v-for="f in bible.facts"
            :key="f.key"
            type="button"
            :class="{ 'is-on': knows(bible, c.key, f.key) }"
            :title="f.text"
            @click="toggleKnowledge(c.key, f.key)"
          >
            {{ factLabel(f, 20) }}
          </button>
        </div>
      </div>
    </article>
  </div>
</template>
