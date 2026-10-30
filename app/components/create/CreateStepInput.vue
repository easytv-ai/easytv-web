<script lang="ts">
export const CREATE_MAX_INPUT = 8000
export const CREATE_SECONDS = [15, 30, 60] as const
export const CREATE_STYLE_PRESETS = ['电影感', '动画', '写实', '国风', '赛博'] as const
</script>

<script setup lang="ts">
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'

const { t } = useI18n()
const localePath = useLocalePath()
const { confirm } = useConfirm()

const input = defineModel<string>('input', { required: true })
const targetSeconds = defineModel<number>('targetSeconds', { required: true })
const style = defineModel<string>('style', { required: true })
const projectId = defineModel<number>('projectId', { required: true })
const useBible = defineModel<boolean>('useBible', { required: true })
const episodeNo = defineModel<string>('episodeNo', { required: true })

const props = defineProps<{
  loggedIn: boolean
  projectOptions: StudioSelectOption[]
  error: string
  submitting: boolean
}>()

const emit = defineEmits<{
  submit: []
}>()

const STYLE_ICONS: Record<(typeof CREATE_STYLE_PRESETS)[number], string> = {
  电影感: 'i-lucide-clapperboard',
  动画: 'i-lucide-sparkles',
  写实: 'i-lucide-camera',
  国风: 'i-lucide-mountain',
  赛博: 'i-lucide-cpu',
}

type Idea = { key: string, style: (typeof CREATE_STYLE_PRESETS)[number] }
const IDEAS: Idea[] = [
  { key: 'suspense', style: '电影感' },
  { key: 'healing', style: '动画' },
  { key: 'scifi', style: '赛博' },
  { key: 'wuxia', style: '国风' },
  { key: 'family', style: '写实' },
  { key: 'ad', style: '电影感' },
]

const inputRef = ref<HTMLTextAreaElement | null>(null)
const inputCount = computed(() => input.value.length)
const canSubmit = computed(() => !props.submitting && Boolean(input.value.trim()))

function toggleStyle(preset: string) {
  style.value = style.value.trim() === preset ? '' : preset
}

function submit() {
  if (canSubmit.value)
    emit('submit')
}

async function useIdea(idea: Idea) {
  const text = t(`create.input.ideas.${idea.key}.text`)
  const current = input.value.trim()
  if (current && current !== text) {
    const ok = await confirm({
      title: t('create.input.replaceTitle'),
      message: t('create.input.replaceMessage'),
      confirmText: t('create.input.replaceConfirm'),
      cancelText: t('取消'),
    })
    if (!ok)
      return
  }
  input.value = text
  if (!style.value.trim())
    style.value = idea.style
  inputRef.value?.focus()
}
</script>

<template>
  <div class="create-start">
    <div class="create-composer" :class="{ 'is-error': Boolean(error) }">
      <label class="create-composer__label" for="create-input">
        {{ t('一句话或剧本') }}<i aria-hidden="true">*</i>
      </label>
      <textarea
        id="create-input"
        ref="inputRef"
        v-model="input"
        class="create-composer__input"
        rows="5"
        required
        :maxlength="CREATE_MAX_INPUT"
        :placeholder="t('例如：一只橘猫在雨夜的东京街头寻找回家的路')"
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      />
      <div class="create-composer__bar">
        <div class="create-composer__opts">
          <div class="create-seg" role="radiogroup" :aria-label="t('目标时长')">
            <span class="create-seg__label">
              <UIcon name="i-lucide-timer" class="size-4" />
              {{ t('目标时长') }}
            </span>
            <button
              v-for="s in CREATE_SECONDS"
              :key="s"
              type="button"
              role="radio"
              :aria-checked="targetSeconds === s"
              :class="{ 'is-on': targetSeconds === s }"
              @click="targetSeconds = s"
            >
              {{ s }} {{ t('秒') }}
            </button>
          </div>
          <div v-if="loggedIn && projectOptions.length > 1" class="create-pill">
            <span class="create-seg__label">
              <UIcon name="i-lucide-folder" class="size-4" />
              {{ t('项目') }}<small>{{ t('选填') }}</small>
            </span>
            <StudioSelect
              v-model="projectId"
              size="compact"
              :options="projectOptions"
              :sr-label="t('项目')"
            />
          </div>
        </div>
        <div class="create-composer__send">
          <small class="create-counter" :class="{ 'is-over': inputCount > CREATE_MAX_INPUT }">
            {{ inputCount }} / {{ CREATE_MAX_INPUT }}
          </small>
          <button
            type="button"
            class="create-composer__submit"
            :disabled="!canSubmit"
            :title="t('create.input.shortcut')"
            @click="submit"
          >
            <UIcon :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'" class="size-4" :class="{ 'animate-spin': submitting }" />
            <span>{{ submitting ? t('生成中…') : t('生成策划案') }}</span>
          </button>
        </div>
      </div>
      <div v-if="loggedIn && projectId" class="create-composer__bible create-bible-opt">
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
    </div>
    <p v-if="error" class="publish-error create-start__error" role="alert">{{ error }}</p>

    <section class="create-block">
      <header class="create-block__head">
        <h2>{{ t('风格') }}<small>{{ t('选填') }}</small></h2>
      </header>
      <div class="create-styles">
        <button
          v-for="(p, i) in CREATE_STYLE_PRESETS"
          :key="p"
          type="button"
          class="create-style-tile"
          :class="[`is-s${i}`, { 'is-on': style.trim() === p }]"
          :aria-pressed="style.trim() === p"
          @click="toggleStyle(p)"
        >
          <UIcon :name="STYLE_ICONS[p]" class="create-style-tile__icon" />
          <span>{{ t(p) }}</span>
          <UIcon v-if="style.trim() === p" name="i-lucide-circle-check" class="create-style-tile__check" />
        </button>
      </div>
      <input v-model="style" class="create-style" maxlength="60" :placeholder="t('也可以自己描述风格')">
    </section>

    <section class="create-block">
      <header class="create-block__head">
        <h2>{{ t('create.input.ideasTitle') }}</h2>
        <small>{{ t('create.input.ideasHint') }}</small>
      </header>
      <div class="create-ideas">
        <button v-for="idea in IDEAS" :key="idea.key" type="button" class="create-idea" @click="useIdea(idea)">
          <span class="create-idea__tag">{{ t(`create.input.ideas.${idea.key}.tag`) }}</span>
          <p>{{ t(`create.input.ideas.${idea.key}.text`) }}</p>
          <span class="create-idea__use">
            {{ t('create.input.use') }}
            <UIcon name="i-lucide-arrow-right" class="size-3.5" />
          </span>
        </button>
      </div>
    </section>
  </div>
</template>
