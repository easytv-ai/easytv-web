<script lang="ts">
export const CREATE_MAX_INPUT = 8000
export const CREATE_SECONDS = [15, 30, 60] as const
export const CREATE_STYLE_PRESETS = ['电影感', '动画', '写实', '国风', '赛博'] as const
</script>

<script setup lang="ts">
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'

const { t } = useI18n()
const localePath = useLocalePath()

const input = defineModel<string>('input', { required: true })
const targetSeconds = defineModel<number>('targetSeconds', { required: true })
const style = defineModel<string>('style', { required: true })
const projectId = defineModel<number>('projectId', { required: true })
const useBible = defineModel<boolean>('useBible', { required: true })
const episodeNo = defineModel<string>('episodeNo', { required: true })

defineProps<{
  loggedIn: boolean
  projectOptions: StudioSelectOption[]
  error: string
}>()

const inputCount = computed(() => input.value.length)

function toggleStyle(preset: string) {
  style.value = style.value.trim() === preset ? '' : preset
}
</script>

<template>
  <div class="create-card">
    <label class="publish-field">
      <span>{{ t('一句话或剧本') }}</span>
      <textarea
        v-model="input"
        class="create-input"
        rows="7"
        :maxlength="CREATE_MAX_INPUT"
        :placeholder="t('例如：一只橘猫在雨夜的东京街头寻找回家的路')"
      />
      <small class="create-counter" :class="{ 'is-over': inputCount > CREATE_MAX_INPUT }">{{ inputCount }} / {{ CREATE_MAX_INPUT }}</small>
    </label>
    <div class="create-row">
      <span class="create-row__label">{{ t('目标时长') }}</span>
      <div class="publish-tags">
        <button v-for="s in CREATE_SECONDS" :key="s" type="button" :class="{ 'is-on': targetSeconds === s }" @click="targetSeconds = s">
          {{ s }} {{ t('秒') }}
        </button>
      </div>
    </div>
    <div class="create-row">
      <span class="create-row__label">{{ t('风格') }}<small>{{ t('选填') }}</small></span>
      <div class="publish-tags">
        <button v-for="p in CREATE_STYLE_PRESETS" :key="p" type="button" :class="{ 'is-on': style.trim() === p }" @click="toggleStyle(p)">
          {{ t(p) }}
        </button>
      </div>
      <input v-model="style" class="create-style" maxlength="60" :placeholder="t('也可以自己描述风格')">
    </div>
    <div v-if="loggedIn && projectOptions.length > 1" class="create-row">
      <span class="create-row__label">{{ t('项目') }}<small>{{ t('选填') }}</small></span>
      <StudioSelect
        v-model="projectId"
        size="compact"
        :options="projectOptions"
        :sr-label="t('项目')"
      />
    </div>
    <div v-if="loggedIn && projectId" class="create-row create-bible-opt">
      <label class="create-foot__opt">
        <input v-model="useBible" type="checkbox">
        <span>{{ t('沿用本项目的剧集设定（人物 / 关系 / 道具 / 线索）') }}</span>
      </label>
      <label class="bible-no">
        <span>{{ t('集号') }}</span>
        <input v-model="episodeNo" type="number" min="1" max="999" :placeholder="t('自动')">
        <span>{{ t('留空 = 自动排到下一集') }}</span>
      </label>
      <NuxtLink :to="localePath(`/bible?project=${projectId}`)" class="studio-chip">
        <UIcon name="i-lucide-book-open" class="size-4" />
        {{ t('剧集设定') }}
      </NuxtLink>
    </div>
    <p v-if="error" class="publish-error">{{ error }}</p>
  </div>
</template>
