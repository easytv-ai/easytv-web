<script setup lang="ts">
import { screenplayApi } from '~/api/screenplay'
import type { Screenplay, ScreenplayLine, ScreenplayPlan, ScreenplayShot } from '~/types/creative'
import {
  dialogueSummary,
  dropShotCharacter,
  ensureDialogue,
  joinDialogue,
  MAX_DIALOGUE,
  MAX_EMOTION,
  MAX_LINE_TEXT,
  MAX_STATE,
  MAX_VOICE_STYLE,
  NARRATOR,
  setShotState,
  shotDialogue,
  syncLineFromDialogue,
  TTS_VOICES,
} from '~/utils/plan-dialogue'
import { SCENE_BEAT_MAX } from '~/utils/bible'

const { t } = useI18n()

/**
 * 策划案编辑（API.md 8.2 plan 结构）：标题 / 风格 / 画幅、角色 ≤ 4、场景 ≤ 4、镜头 ≤ 12。
 * 直接改父组件传入的 plan 对象（响应式），父组件负责「保存」。
 * 多语言（API.md 10.4）：选语种后「翻译台词」调 localize，把译文写进 shots[].lines[lang]，可继续手改。
 * 短剧第二批（API.md 25）：角色音色 / 说话风格，每镜对白条目（说话人 + 情绪）、本镜人物状态；
 * 「插入双人对白」只发事件，弹窗与接口调用在父组件（要先保存本地改动）。
 */
const props = defineProps<{
  plan: ScreenplayPlan
  disabled?: boolean
  /** 有 id 才能调用整份翻译 / 正反打模板 */
  screenplayId?: number
  /** 当前台词语种，默认中文 */
  lang?: string
}>()

const emit = defineEmits<{
  change: []
  'update:lang': [code: string]
  /** 整份翻译完成，父组件用新的 screenplay 覆盖本地 plan */
  localized: [row: Screenplay]
  /** 打开正反打模板弹窗（API.md 25.3） */
  'insert-dialogue': []
}>()

const toast = useToast()
const { langs, load: loadLangs, langLabel } = useLangs()
const DEFAULT_LANG = 'zh'
const translating = ref(false)

const lang = computed({
  get: () => props.lang || DEFAULT_LANG,
  set: (value: string) => emit('update:lang', value),
})
const showTranslated = computed(() => lang.value !== DEFAULT_LANG)

async function translateLines() {
  if (!props.screenplayId || translating.value || lang.value === DEFAULT_LANG)
    return
  translating.value = true
  try {
    const res = await screenplayApi.localize(props.screenplayId, lang.value)
    if (!res?.success || !res.data?.screenplay) {
      toast.add({ title: res?.message || t('翻译失败'), color: 'error', close: false, progress: false, orientation: 'horizontal' })
      return
    }
    emit('localized', res.data.screenplay)
    toast.add({ title: t('台词已翻译为{lang}', { lang: langLabel(lang.value) }), color: 'success', close: false, progress: false, orientation: 'horizontal' })
  }
  finally {
    translating.value = false
  }
}

function translatedLine(shot: ScreenplayShot) {
  return shot.lines?.[lang.value] ?? ''
}

function onTranslatedInput(shot: ScreenplayShot, event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!shot.lines)
    shot.lines = {}
  shot.lines[lang.value] = value
  touch()
}

onMounted(() => void loadLangs())

const langOptions = computed(() => langs.value.map(item => ({ value: item.code, label: item.label })))
const sceneOptions = computed(() => [
  { value: '', label: t('未指定场景') },
  ...props.plan.scenes.map(item => ({ value: item.key, label: item.name || item.key })),
])
const voiceOptions = computed(() => [
  { value: '', label: t('模型默认音色') },
  ...TTS_VOICES.map(voice => ({ value: voice, label: voice })),
])

function setShotScene(shot: ScreenplayShot, value: string | number) {
  shot.scene = String(value)
  touch()
}

function setCharacterVoice(index: number, value: string | number) {
  const item = props.plan.characters[index]
  if (!item)
    return
  item.voice = String(value)
  touch()
}

const MAX_CHARACTERS = 4
const MAX_SCENES = 4
const MAX_SHOTS = 12
const ASPECTS = ['16:9', '9:16', '1:1'] as const

function touch() {
  emit('change')
}

function nextKey(prefix: 'c' | 's', list: { key: string }[]) {
  let n = list.length + 1
  while (list.some(item => item.key === `${prefix}${n}`))
    n += 1
  return `${prefix}${n}`
}

function addCharacter() {
  if (props.plan.characters.length >= MAX_CHARACTERS)
    return
  props.plan.characters.push({ key: nextKey('c', props.plan.characters), name: '', look: '', voice: '', voice_style: '' })
  touch()
}

function removeCharacter(index: number) {
  const removed = props.plan.characters.splice(index, 1)[0]
  if (removed) {
    // 人物整体删除：对白说话人改成旁白，否则保存时后端报引用不存在（ErrPlanRef）
    for (const shot of props.plan.shots)
      dropShotCharacter(shot, removed.key, true)
  }
  touch()
}

function addScene() {
  if (props.plan.scenes.length >= MAX_SCENES)
    return
  props.plan.scenes.push({ key: nextKey('s', props.plan.scenes), name: '', look: '', objective: '', conflict: '', turn: '' })
  touch()
}

function removeScene(index: number) {
  const removed = props.plan.scenes.splice(index, 1)[0]
  if (removed) {
    for (const shot of props.plan.shots) {
      if (shot.scene === removed.key)
        shot.scene = props.plan.scenes[0]?.key ?? ''
    }
  }
  touch()
}

/** 只重排展示序号 no；镜头 id 跟着对象走，移动 / 删除都不动它（API.md 24.8） */
function renumber() {
  props.plan.shots.forEach((shot, i) => {
    shot.no = i + 1
  })
}

function addShot() {
  if (props.plan.shots.length >= MAX_SHOTS)
    return
  const last = props.plan.shots[props.plan.shots.length - 1]
  // 不带 id：稳定镜头 id 由服务端保存时发放（API.md 24.8），保存后用返回的 plan 替换本地副本
  const shot: ScreenplayShot = {
    no: props.plan.shots.length + 1,
    scene: last?.scene ?? props.plan.scenes[0]?.key ?? '',
    characters: [],
    prompt: '',
    motion: '',
    line: '',
    dialogue: [],
    seconds: last?.seconds || 5,
  }
  props.plan.shots.push(shot)
  touch()
}

function removeShot(index: number) {
  props.plan.shots.splice(index, 1)
  renumber()
  touch()
}

function moveShot(index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= props.plan.shots.length)
    return
  const list = props.plan.shots
  const [item] = list.splice(index, 1)
  if (item)
    list.splice(target, 0, item)
  renumber()
  touch()
}

function toggleShotCharacter(shot: ScreenplayShot, key: string) {
  if (shot.characters.includes(key))
    dropShotCharacter(shot, key)
  else
    shot.characters = [...shot.characters, key]
  touch()
}

function onSeconds(shot: ScreenplayShot, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  shot.seconds = Math.min(15, Math.max(1, Math.round(raw) || 1))
  touch()
}

const totalSeconds = computed(() => props.plan.shots.reduce((sum, shot) => sum + (Number(shot.seconds) || 0), 0))

function characterName(key: string) {
  const item = props.plan.characters.find(c => c.key === key)
  return item?.name || key
}

// ---- 对白条目（API.md 25.1）----

/** 说话人选项：旁白 + 本镜勾选的人物；数据里引用了没勾选的人物也列出来，避免下拉显示成空 */
function speakerOptions(shot: ScreenplayShot) {
  const keys = [...shot.characters]
  for (const item of shot.dialogue ?? []) {
    if (item.speaker && !keys.includes(item.speaker))
      keys.push(item.speaker)
  }
  return [
    { value: NARRATOR, label: t('旁白') },
    ...keys.map(key => ({ value: key, label: characterName(key) })),
  ]
}

function addLine(shot: ScreenplayShot) {
  const list = ensureDialogue(shot)
  if (list.length >= MAX_DIALOGUE)
    return
  // 缺省说话人：上一条的下一个人物，双人对白时自然交替
  const prev = list[list.length - 1]?.speaker ?? NARRATOR
  const idx = shot.characters.indexOf(prev)
  const speaker = shot.characters.length ? (shot.characters[(idx + 1) % shot.characters.length] ?? NARRATOR) : NARRATOR
  list.push({ speaker, text: '' })
  touch()
}

function removeLine(shot: ScreenplayShot, index: number) {
  ensureDialogue(shot).splice(index, 1)
  syncLineFromDialogue(shot)
  touch()
}

function setLineSpeaker(shot: ScreenplayShot, index: number, value: string | number) {
  const item = ensureDialogue(shot)[index]
  if (!item)
    return
  item.speaker = String(value)
  touch()
}

function onLineText(shot: ScreenplayShot, index: number, event: Event) {
  const item = ensureDialogue(shot)[index]
  if (!item)
    return
  item.text = (event.target as HTMLInputElement).value
  // 同步整句 line（老流程 / 摘要用）；空条目留着让用户继续打字，保存时由 planForSave 去掉
  shot.line = joinDialogue(shot.dialogue ?? [])
  touch()
}

function onLineEmotion(shot: ScreenplayShot, index: number, event: Event) {
  const item = ensureDialogue(shot)[index]
  if (!item)
    return
  const value = (event.target as HTMLInputElement).value.trim()
  if (value)
    item.emotion = value
  else
    delete item.emotion
  touch()
}

function summaryOf(shot: ScreenplayShot) {
  return dialogueSummary(shot, characterName, t('旁白'))
}

function linesOf(shot: ScreenplayShot): ScreenplayLine[] {
  return shot.dialogue?.length ? shot.dialogue : shotDialogue(shot)
}

// ---- 本镜人物状态（API.md 25.2）----
function onState(shot: ScreenplayShot, key: string, event: Event) {
  setShotState(shot, key, (event.target as HTMLInputElement).value)
  touch()
}

const canInsertDialogue = computed(() => Boolean(props.screenplayId) && props.plan.characters.length >= 2 && props.plan.shots.length < MAX_SHOTS)
</script>

<template>
  <div class="plan-editor" :class="{ 'is-disabled': disabled }">
    <section class="plan-editor__block">
      <div class="plan-editor__grid">
        <label class="publish-field">
          <span>{{ t('标题') }}</span>
          <input v-model="plan.title" maxlength="60" :disabled="disabled" :placeholder="t('给作品起个名字')" @input="touch">
        </label>
        <label class="publish-field">
          <span>{{ t('风格') }}</span>
          <input v-model="plan.style" maxlength="60" :disabled="disabled" :placeholder="t('例如：电影感 · 冷色调')" @input="touch">
        </label>
        <label class="publish-field">
          <span>{{ t('画幅') }}</span>
          <div class="publish-tags">
            <button
              v-for="a in ASPECTS"
              :key="a"
              type="button"
              :class="{ 'is-on': plan.aspect === a }"
              :disabled="disabled"
              @click="plan.aspect = a; touch()"
            >
              {{ a }}
            </button>
          </div>
        </label>
      </div>
    </section>

    <section class="plan-editor__block">
      <header class="plan-editor__head">
        <h3>{{ t('角色') }} <small>{{ plan.characters.length }}/{{ MAX_CHARACTERS }}</small></h3>
        <button type="button" class="studio-chip" :disabled="disabled || plan.characters.length >= MAX_CHARACTERS" @click="addCharacter">
          <UIcon name="i-lucide-plus" class="size-4" />
          {{ t('添加角色') }}
        </button>
      </header>
      <p v-if="!plan.characters.length" class="plan-editor__empty">{{ t('没有角色时只生成分镜图') }}</p>
      <div v-for="(c, i) in plan.characters" :key="c.key" class="plan-editor__row plan-editor__row--character">
        <span class="plan-editor__key">{{ c.key }}</span>
        <input v-model="c.name" class="plan-editor__name" maxlength="20" :disabled="disabled" :placeholder="t('角色名')" @input="touch">
        <textarea v-model="c.look" rows="2" maxlength="500" :disabled="disabled" :placeholder="t('外貌与服装提示词')" @input="touch" />
        <button type="button" class="plan-editor__remove" :aria-label="t('删除')" :disabled="disabled" @click="removeCharacter(i)">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <div class="plan-voice">
          <span class="plan-voice__label">{{ t('音色') }}</span>
          <StudioSelect
            size="compact"
            :model-value="c.voice || ''"
            :options="voiceOptions"
            :disabled="disabled"
            :sr-label="t('音色')"
            @update:model-value="setCharacterVoice(i, $event)"
          />
          <input
            v-model="c.voice_style"
            class="plan-voice__style"
            :maxlength="MAX_VOICE_STYLE"
            :disabled="disabled"
            :placeholder="t('说话风格，如：沉稳')"
            @input="touch"
          >
        </div>
      </div>
    </section>

    <section class="plan-editor__block">
      <header class="plan-editor__head">
        <h3>{{ t('场景') }} <small>{{ plan.scenes.length }}/{{ MAX_SCENES }}</small></h3>
        <button type="button" class="studio-chip" :disabled="disabled || plan.scenes.length >= MAX_SCENES" @click="addScene">
          <UIcon name="i-lucide-plus" class="size-4" />
          {{ t('添加场景') }}
        </button>
      </header>
      <div v-for="(s, i) in plan.scenes" :key="s.key" class="plan-editor__row">
        <span class="plan-editor__key">{{ s.key }}</span>
        <input v-model="s.name" class="plan-editor__name" maxlength="20" :disabled="disabled" :placeholder="t('场景名')" @input="touch">
        <textarea v-model="s.look" rows="2" maxlength="500" :disabled="disabled" :placeholder="t('场景提示词')" @input="touch" />
        <button type="button" class="plan-editor__remove" :aria-label="t('删除')" :disabled="disabled" @click="removeScene(i)">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <!-- 场次表（API.md 27.1）：这一场谁想得到什么、被什么挡住、结束时发生了什么 -->
        <div class="plan-beats">
          <label>
            <span>{{ t('目标') }}</span>
            <input v-model="s.objective" :maxlength="SCENE_BEAT_MAX" :disabled="disabled" :placeholder="t('谁想得到什么')" @input="touch">
          </label>
          <label>
            <span>{{ t('阻碍') }}</span>
            <input v-model="s.conflict" :maxlength="SCENE_BEAT_MAX" :disabled="disabled" :placeholder="t('被什么挡住')" @input="touch">
          </label>
          <label>
            <span>{{ t('变化') }}</span>
            <input v-model="s.turn" :maxlength="SCENE_BEAT_MAX" :disabled="disabled" :placeholder="t('结束时发生了什么')" @input="touch">
          </label>
        </div>
      </div>
    </section>

    <section class="plan-editor__block">
      <header class="plan-editor__head">
        <h3>{{ t('镜头') }} <small>{{ plan.shots.length }}/{{ MAX_SHOTS }} · {{ t('共 {n} 秒', { n: totalSeconds }) }}</small></h3>
        <div class="plan-editor__actions">
          <button
            type="button"
            class="studio-chip"
            :disabled="disabled || !canInsertDialogue"
            :title="plan.characters.length < 2 ? t('至少需要两个角色') : ''"
            @click="emit('insert-dialogue')"
          >
            <UIcon name="i-lucide-messages-square" class="size-4" />
            {{ t('插入双人对白') }}
          </button>
          <button type="button" class="studio-chip" :disabled="disabled || plan.shots.length >= MAX_SHOTS" @click="addShot">
            <UIcon name="i-lucide-plus" class="size-4" />
            {{ t('添加镜头') }}
          </button>
        </div>
      </header>
      <div class="plan-lang">
        <span class="plan-lang__label">{{ t('语言') }}</span>
        <StudioSelect
          size="compact"
          :model-value="lang"
          :options="langOptions"
          :disabled="disabled"
          :sr-label="t('语言')"
          @update:model-value="lang = String($event)"
        />
        <button
          type="button"
          class="studio-chip"
          :disabled="disabled || translating || !screenplayId || lang === DEFAULT_LANG"
          @click="translateLines"
        >
          <UIcon name="i-lucide-languages" class="size-4" />
          {{ translating ? t('翻译中…') : t('翻译台词') }}
        </button>
        <small>{{ lang === DEFAULT_LANG ? t('中文即原文，选其它语种后可整份翻译台词') : t('译文会显示在每个镜头台词下方，可继续修改并随策划案保存') }}</small>
      </div>
      <div class="plan-shots">
        <article v-for="(shot, i) in plan.shots" :key="`${shot.no}-${i}`" class="plan-shot">
          <header class="plan-shot__head">
            <strong>#{{ shot.no }}</strong>
            <StudioSelect
              size="compact"
              :model-value="shot.scene"
              :options="sceneOptions"
              :disabled="disabled"
              :sr-label="t('场景')"
              @update:model-value="setShotScene(shot, $event)"
            />
            <label class="plan-shot__seconds">
              <input type="number" min="1" max="15" :value="shot.seconds" :disabled="disabled" @change="onSeconds(shot, $event)">
              <span>{{ t('秒') }}</span>
            </label>
            <span class="plan-shot__spacer" />
            <button type="button" class="plan-editor__icon" :aria-label="t('上移')" :disabled="disabled || i === 0" @click="moveShot(i, -1)">
              <UIcon name="i-lucide-chevron-up" class="size-4" />
            </button>
            <button type="button" class="plan-editor__icon" :aria-label="t('下移')" :disabled="disabled || i === plan.shots.length - 1" @click="moveShot(i, 1)">
              <UIcon name="i-lucide-chevron-down" class="size-4" />
            </button>
            <button type="button" class="plan-editor__icon is-danger" :aria-label="t('删除')" :disabled="disabled || plan.shots.length <= 1" @click="removeShot(i)">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </button>
          </header>
          <p v-if="summaryOf(shot)" class="plan-shot__summary" :title="summaryOf(shot)">{{ summaryOf(shot) }}</p>
          <div v-if="plan.characters.length" class="publish-tags plan-shot__cast">
            <button
              v-for="c in plan.characters"
              :key="c.key"
              type="button"
              :class="{ 'is-on': shot.characters.includes(c.key) }"
              :disabled="disabled"
              @click="toggleShotCharacter(shot, c.key)"
            >
              {{ characterName(c.key) }}
            </button>
          </div>
          <div v-if="shot.characters.length" class="plan-states">
            <label v-for="key in shot.characters" :key="key" class="plan-state">
              <span>{{ t('{name} 本镜状态', { name: characterName(key) }) }}</span>
              <input
                :value="shot.states?.[key] ?? ''"
                :maxlength="MAX_STATE"
                :disabled="disabled"
                :placeholder="t('如：穿病号服，左手缠绷带')"
                @input="onState(shot, key, $event)"
              >
            </label>
          </div>
          <label class="publish-field">
            <span>{{ t('画面提示词') }}</span>
            <textarea v-model="shot.prompt" rows="2" maxlength="800" :disabled="disabled" @input="touch" />
          </label>
          <label class="publish-field">
            <span>{{ t('镜头运动') }}</span>
            <input v-model="shot.motion" maxlength="60" :disabled="disabled" :placeholder="t('例如：缓慢推进')" @input="touch">
          </label>
          <div class="plan-dialogue">
            <div class="plan-dialogue__head">
              <span>{{ t('对白') }} <small>{{ linesOf(shot).length }}/{{ MAX_DIALOGUE }}</small></span>
              <button type="button" class="studio-chip" :disabled="disabled || linesOf(shot).length >= MAX_DIALOGUE" @click="addLine(shot)">
                <UIcon name="i-lucide-plus" class="size-4" />
                {{ t('添加对白') }}
              </button>
            </div>
            <p v-if="!linesOf(shot).length" class="plan-editor__empty">{{ t('没有对白则该镜头不配音') }}</p>
            <div v-for="(item, li) in linesOf(shot)" :key="li" class="plan-dialogue__row">
              <StudioSelect
                size="compact"
                :model-value="item.speaker"
                :options="speakerOptions(shot)"
                :disabled="disabled"
                :sr-label="t('说话人')"
                @update:model-value="setLineSpeaker(shot, li, $event)"
              />
              <input
                class="plan-dialogue__text"
                :value="item.text"
                :maxlength="MAX_LINE_TEXT"
                :disabled="disabled"
                :placeholder="t('台词正文')"
                @input="onLineText(shot, li, $event)"
              >
              <input
                class="plan-dialogue__emotion"
                :value="item.emotion ?? ''"
                :maxlength="MAX_EMOTION"
                :disabled="disabled"
                :placeholder="t('情绪')"
                @input="onLineEmotion(shot, li, $event)"
              >
              <button type="button" class="plan-editor__remove" :aria-label="t('删除')" :disabled="disabled" @click="removeLine(shot, li)">
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </div>
          </div>
          <label v-if="showTranslated" class="publish-field plan-shot__line-i18n">
            <span>{{ t('{lang}台词', { lang: langLabel(lang) }) }}</span>
            <input
              :value="translatedLine(shot)"
              maxlength="200"
              :disabled="disabled"
              :placeholder="t('留空则该语种回落到原文')"
              @input="onTranslatedInput(shot, $event)"
            >
          </label>
        </article>
      </div>
    </section>
  </div>
</template>
