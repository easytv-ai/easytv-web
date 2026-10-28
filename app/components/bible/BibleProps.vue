<script setup lang="ts">
import type { Bible } from '~/types/creative'
import { BIBLE_LIMITS, bibleName, newProp } from '~/utils/bible'

const { t } = useI18n()

const props = defineProps<{
  bible: Bible
}>()

const emit = defineEmits<{
  change: []
}>()

const holderOptions = computed(() => [
  { value: '', label: t('无人持有') },
  ...props.bible.characters.map(c => ({ value: c.key, label: bibleName(props.bible.characters, c.key) })),
])

function addProp() {
  if (props.bible.props.length >= BIBLE_LIMITS.props)
    return
  props.bible.props.push(newProp(props.bible.props))
  emit('change')
}

function removeProp(index: number) {
  props.bible.props.splice(index, 1)
  emit('change')
}

function setHolder(index: number, value: string | number) {
  const item = props.bible.props[index]
  if (!item)
    return
  item.holder = String(value)
  emit('change')
}
</script>

<template>
  <div class="create-card plan-editor__block">
    <header class="plan-editor__head">
      <h3>{{ t('道具') }} <small>{{ bible.props.length }}/{{ BIBLE_LIMITS.props }}</small></h3>
      <button type="button" class="studio-chip" :disabled="bible.props.length >= BIBLE_LIMITS.props" @click="addProp">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加道具') }}
      </button>
    </header>
    <p v-if="!bible.props.length" class="plan-editor__empty">{{ t('关键道具现在在谁手里、什么状态，换手时记一笔。') }}</p>
    <article v-for="(p, i) in bible.props" :key="p.key" class="bible-item">
      <header class="bible-item__head">
        <span class="plan-editor__key">{{ p.key }}</span>
        <input v-model="p.name" class="bible-item__name" :maxlength="BIBLE_LIMITS.propName" :placeholder="t('道具名')" @input="emit('change')">
        <span class="plan-shot__spacer" />
        <button type="button" class="plan-editor__remove" :aria-label="t('删除')" @click="removeProp(i)">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
      </header>
      <div class="plan-editor__grid">
        <label class="publish-field">
          <span>{{ t('持有人') }}</span>
          <StudioSelect
            size="compact"
            :model-value="p.holder"
            :options="holderOptions"
            :sr-label="t('持有人')"
            @update:model-value="setHolder(i, $event)"
          />
        </label>
        <label class="publish-field">
          <span>{{ t('状态') }}</span>
          <input v-model="p.state" :maxlength="BIBLE_LIMITS.propState" :placeholder="t('如：屏幕碎了')" @input="emit('change')">
        </label>
        <label class="publish-field">
          <span>{{ t('备注') }}</span>
          <input v-model="p.note" :maxlength="BIBLE_LIMITS.note" :placeholder="t('选填')" @input="emit('change')">
        </label>
      </div>
    </article>
  </div>
</template>
