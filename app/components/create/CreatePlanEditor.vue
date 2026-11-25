<script setup lang="ts">
import { screenplayApi } from '~/api/screenplay'
import type { Screenplay, ScreenplayLine, ScreenplayPlan, ScreenplayShot } from '~/types/creative'
import {
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
 * 短剧（API.md 25）：角色音色 / 说话风格，每镜对白条目（说话人 + 情绪）、本镜人物状态；
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
/** 与 model.PlanShotMinSeconds / PlanShotMaxSeconds 一致。超出区间保存时会被收边界，不能按输入原样留下。 */
const MIN_SHOT_SECONDS = 3
const MAX_SHOT_SECONDS = 10
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
  shotIndex.value = props.plan.shots.length - 1
  pane.value = 'shots'
  touch()
}

function removeShot(index: number) {
  if (props.plan.shots.length <= 1)
    return
  props.plan.shots.splice(index, 1)
  renumber()
  if (shotIndex.value > index || shotIndex.value >= props.plan.shots.length)
    shotIndex.value = Math.max(0, shotIndex.value - 1)
  touch()
}

const dragFrom = ref(-1)
const dragOver = ref(-1)
/** 系统默认的拖动图是透明的，会把下面的镜头和场景名透出来 */
let dragGhost: HTMLElement | null = null

function clearDragGhost() {
  dragGhost?.remove()
  dragGhost = null
}

/** 把镜头从 from 放到 to。先删再按原下标插入，落点就是松手的那一行 */
function reorderShot(from: number, to: number) {
  if (props.disabled || from === to || from < 0 || to < 0)
    return
  const list = props.plan.shots
  if (from >= list.length || to >= list.length)
    return
  const [item] = list.splice(from, 1)
  if (!item)
    return
  list.splice(to, 0, item)
  renumber()
  const selected = shotIndex.value
  if (selected === from)
    shotIndex.value = to
  else if (from < to && selected > from && selected <= to)
    shotIndex.value = selected - 1
  else if (from > to && selected >= to && selected < from)
    shotIndex.value = selected + 1
  touch()
}

function onReelDragStart(index: number, event: DragEvent) {
  if (props.disabled)
    return
  const row = event.currentTarget
  if (row instanceof HTMLElement && event.dataTransfer) {
    clearDragGhost()
    const ghost = row.cloneNode(true) as HTMLElement
    ghost.classList.remove('is-on', 'is-drag', 'is-over')
    ghost.classList.add('plan-reel__ghost')
    ghost.style.width = `${row.offsetWidth}px`
    document.body.appendChild(ghost)
    event.dataTransfer.setDragImage(ghost, 20, Math.round(row.offsetHeight / 2))
    dragGhost = ghost
    event.dataTransfer.setData('text/plain', String(index))
    event.dataTransfer.effectAllowed = 'move'
  }
  dragFrom.value = index
}

function onReelDragOver(index: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
  dragOver.value = index
}

function onReelDrop(index: number) {
  reorderShot(dragFrom.value, index)
  dragFrom.value = -1
  dragOver.value = -1
  clearDragGhost()
}

function onReelDragEnd() {
  dragFrom.value = -1
  dragOver.value = -1
  clearDragGhost()
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
  shot.seconds = Math.min(MAX_SHOT_SECONDS, Math.max(MIN_SHOT_SECONDS, Math.round(raw) || MIN_SHOT_SECONDS))
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

function linesOf(shot: ScreenplayShot): ScreenplayLine[] {
  return shot.dialogue?.length ? shot.dialogue : shotDialogue(shot)
}

// ---- 本镜人物状态（API.md 25.2）----
function onState(shot: ScreenplayShot, key: string, event: Event) {
  setShotState(shot, key, (event.target as HTMLInputElement).value)
  touch()
}

const canInsertDialogue = computed(() => Boolean(props.screenplayId) && props.plan.characters.length >= 2 && props.plan.shots.length < MAX_SHOTS)

/** 一次只改一件事：镜头是默认工作区，角色和场景各自一页 */
const pane = ref<'shots' | 'characters' | 'scenes'>('shots')
const shotIndex = ref(0)
const statesOpen = ref(false)
/** 四个角色色相拉开，只用于名字首字，不进数据色 */
const CAST_HUES = [24, 200, 152, 332]

const openShot = computed(() => props.plan.shots[shotIndex.value] ?? null)

watch(shotIndex, (index) => {
  const shot = props.plan.shots[index]
  statesOpen.value = Boolean(shot?.characters.some(key => (shot.states?.[key] ?? '').trim()))
}, { immediate: true })

watch(() => props.plan.shots.length, (count) => {
  if (shotIndex.value >= count)
    shotIndex.value = Math.max(0, count - 1)
})

function sceneLabel(key: string) {
  if (!key)
    return t('未指定场景')
  return props.plan.scenes.find(item => item.key === key)?.name || key
}

function speakerLabel(key: string) {
  if (!key || key === 'narrator')
    return t('旁白')
  return characterName(key)
}

function shotBlurb(shot: ScreenplayShot) {
  const line = linesOf(shot).find(item => item.text.trim())
  if (line)
    return `${speakerLabel(line.speaker)}：${line.text.trim()}`
  return shot.prompt.trim()
}

function shotNo(shot: ScreenplayShot) {
  return String(shot.no).padStart(2, '0')
}

function initialOf(name: string, key: string) {
  const text = name.trim() || key
  return text.slice(0, 1) || '?'
}

function castHue(key: string) {
  const index = props.plan.characters.findIndex(item => item.key === key)
  return CAST_HUES[(index < 0 ? 0 : index) % CAST_HUES.length]
}

/** 连续同一场景的镜头收成一组，换场才再写一次场景名 */
const reelGroups = computed(() => {
  const groups: { key: string, label: string, items: { shot: ScreenplayShot, index: number }[] }[] = []
  props.plan.shots.forEach((shot, index) => {
    const key = shot.scene || ''
    const last = groups[groups.length - 1]
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: sceneLabel(key), items: [] }
      groups.push(group)
    }
    group.items.push({ shot, index })
  })
  return groups
})

function selectShot(index: number) {
  shotIndex.value = index
}
</script>

<template>
  <div class="plan-editor" :class="{ 'is-disabled': disabled }">
    <header class="plan-mast">
      <input
        v-model="plan.title"
        class="plan-mast__title"
        maxlength="60"
        :disabled="disabled"
        :placeholder="t('给作品起个名字')"
        :aria-label="t('标题')"
        @input="touch"
      >
      <input
        v-model="plan.style"
        class="plan-mast__style"
        maxlength="60"
        :disabled="disabled"
        :placeholder="t('例如：电影感 · 冷色调')"
        :aria-label="t('风格')"
        @input="touch"
      >
      <div class="plan-mast__row">
        <div class="publish-tags" role="group" :aria-label="t('画幅')">
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
        <p class="plan-mast__meta num">{{ t('共 {n} 秒', { n: totalSeconds }) }}</p>
      </div>
    </header>

    <div class="plan-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="pane === 'shots'" :class="{ 'is-on': pane === 'shots' }" @click="pane = 'shots'">
        {{ t('镜头') }}
        <small class="num">{{ plan.shots.length }}/{{ MAX_SHOTS }}</small>
      </button>
      <button type="button" role="tab" :aria-selected="pane === 'characters'" :class="{ 'is-on': pane === 'characters' }" @click="pane = 'characters'">
        {{ t('角色') }}
        <small class="num">{{ plan.characters.length }}/{{ MAX_CHARACTERS }}</small>
      </button>
      <button type="button" role="tab" :aria-selected="pane === 'scenes'" :class="{ 'is-on': pane === 'scenes' }" @click="pane = 'scenes'">
        {{ t('场景') }}
        <small class="num">{{ plan.scenes.length }}/{{ MAX_SCENES }}</small>
      </button>
    </div>

    <div class="plan-toolbar">
      <div v-if="pane === 'shots'" class="plan-lang">
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
          :title="lang === DEFAULT_LANG ? t('中文即原文，选其它语种后可整份翻译台词') : t('译文会显示在每个镜头台词下方，可继续修改并随策划案保存')"
          @click="translateLines"
        >
          <UIcon name="i-lucide-languages" class="size-4" />
          {{ translating ? t('翻译中…') : t('翻译台词') }}
        </button>
      </div>
      <button v-else-if="pane === 'characters'" type="button" class="studio-chip" :disabled="disabled || plan.characters.length >= MAX_CHARACTERS" @click="addCharacter">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加角色') }}
      </button>
      <button v-else type="button" class="studio-chip" :disabled="disabled || plan.scenes.length >= MAX_SCENES" @click="addScene">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('添加场景') }}
      </button>
    </div>

    <div class="plan-stage">
      <div v-if="pane === 'shots'" class="plan-board">
        <div class="plan-reel">
          <div class="plan-reel__scroll">
            <section v-for="group in reelGroups" :key="`${group.key}-${group.items[0]?.index}`" class="plan-reel__group">
              <h3>{{ group.label }}</h3>
              <div
                v-for="item in group.items"
                :key="item.shot.id || item.index"
                class="plan-reel__item"
                :class="{
                  'is-on': item.index === shotIndex,
                  'is-drag': dragFrom === item.index,
                  'is-before': dragOver === item.index && dragFrom > item.index,
                  'is-after': dragOver === item.index && dragFrom < item.index,
                }"
                :draggable="!disabled"
                role="button"
                tabindex="0"
                :aria-current="item.index === shotIndex ? 'true' : undefined"
                :title="t('拖拽排序')"
                @click="selectShot(item.index)"
                @keydown.enter.prevent="selectShot(item.index)"
                @keydown.space.prevent="selectShot(item.index)"
                @dragstart="onReelDragStart(item.index, $event)"
                @dragover="onReelDragOver(item.index, $event)"
                @drop.prevent="onReelDrop(item.index)"
                @dragend="onReelDragEnd"
              >
                <span class="plan-reel__grip" aria-hidden="true">
                  <UIcon name="i-lucide-grip-vertical" class="size-3.5" />
                </span>
                <span class="plan-reel__no num">{{ shotNo(item.shot) }}</span>
                <span class="plan-reel__body">
                  <span class="plan-reel__line" :class="{ 'is-empty': !shotBlurb(item.shot) }">{{ shotBlurb(item.shot) || t('还没有画面') }}</span>
                  <span class="plan-reel__sub">
                    <span class="num">{{ item.shot.seconds }}{{ t('秒') }}</span>
                    <span v-if="item.shot.characters.length" class="plan-reel__cast">
                      <i
                        v-for="key in item.shot.characters"
                        :key="key"
                        :style="{ '--hue': castHue(key) }"
                      >{{ initialOf(characterName(key), key) }}</i>
                    </span>
                  </span>
                </span>
              </div>
            </section>
            <p v-if="!plan.shots.length" class="plan-editor__empty">{{ t('还没有镜头') }}</p>
          </div>
          <div class="plan-reel__foot">
            <button type="button" class="studio-chip" :disabled="disabled || plan.shots.length >= MAX_SHOTS" @click="addShot">
              <UIcon name="i-lucide-plus" class="size-4" />
              {{ t('添加镜头') }}
            </button>
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
          </div>
        </div>

        <article v-if="openShot" :key="openShot.id || openShot.no" class="plan-shot-page">
          <header class="plan-shot__head">
            <strong class="num">{{ t('镜头') }} {{ shotNo(openShot) }}</strong>
            <StudioSelect
              size="compact"
              :model-value="openShot.scene"
              :options="sceneOptions"
              :disabled="disabled"
              :sr-label="t('场景')"
              @update:model-value="setShotScene(openShot, $event)"
            />
            <label class="plan-shot__seconds">
              <input type="number" :min="MIN_SHOT_SECONDS" :max="MAX_SHOT_SECONDS" :value="openShot.seconds" :disabled="disabled" :title="t('每镜 {min}–{max} 秒', { min: MIN_SHOT_SECONDS, max: MAX_SHOT_SECONDS })" @wheel="holdNumberWheel" @change="onSeconds(openShot, $event)">
              <span>{{ t('秒') }}</span>
            </label>
            <span class="plan-shot__spacer" />
            <button type="button" class="plan-editor__icon is-danger" :aria-label="t('删除')" :disabled="disabled || plan.shots.length <= 1" @click="removeShot(shotIndex)">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </button>
          </header>

          <label class="publish-field plan-shot-page__prompt">
            <span>{{ t('画面提示词') }}</span>
            <textarea v-model="openShot.prompt" rows="4" maxlength="800" :disabled="disabled" :placeholder="t('这一镜里看得见什么')" @input="touch" />
          </label>
          <label class="publish-field">
            <span>{{ t('镜头运动') }}</span>
            <input v-model="openShot.motion" maxlength="60" :disabled="disabled" :placeholder="t('例如：缓慢推进')" @input="touch">
          </label>

          <div v-if="plan.characters.length" class="plan-shot-page__cast">
            <span>{{ t('出场') }}</span>
            <div class="publish-tags">
              <button
                v-for="c in plan.characters"
                :key="c.key"
                type="button"
                :class="{ 'is-on': openShot.characters.includes(c.key) }"
                :disabled="disabled"
                @click="toggleShotCharacter(openShot, c.key)"
              >
                <i class="plan-mark" :style="{ '--hue': castHue(c.key) }">{{ initialOf(c.name, c.key) }}</i>
                {{ characterName(c.key) }}
              </button>
            </div>
          </div>

          <div v-if="openShot.characters.length" class="plan-states-fold">
            <button type="button" class="plan-states-fold__toggle" :aria-expanded="statesOpen" @click="statesOpen = !statesOpen">
              <UIcon :name="statesOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-4" />
              {{ t('本镜状态') }}
            </button>
            <div v-if="statesOpen" class="plan-states">
              <label v-for="key in openShot.characters" :key="key" class="plan-state">
                <span>{{ t('{name} 本镜状态', { name: characterName(key) }) }}</span>
                <input
                  :value="openShot.states?.[key] ?? ''"
                  :maxlength="MAX_STATE"
                  :disabled="disabled"
                  :placeholder="t('如：穿病号服，左手缠绷带')"
                  @input="onState(openShot, key, $event)"
                >
              </label>
            </div>
          </div>

          <div class="plan-dialogue">
            <div class="plan-dialogue__head">
              <span>{{ t('对白') }} <small class="num">{{ linesOf(openShot).length }}/{{ MAX_DIALOGUE }}</small></span>
              <button type="button" class="studio-chip" :disabled="disabled || linesOf(openShot).length >= MAX_DIALOGUE" @click="addLine(openShot)">
                <UIcon name="i-lucide-plus" class="size-4" />
                {{ t('添加对白') }}
              </button>
            </div>
            <p v-if="!linesOf(openShot).length" class="plan-editor__empty">{{ t('没有对白则该镜头不配音') }}</p>
            <div v-for="(item, li) in linesOf(openShot)" :key="li" class="plan-dialogue__row">
              <StudioSelect
                size="compact"
                :model-value="item.speaker"
                :options="speakerOptions(openShot)"
                :disabled="disabled"
                :sr-label="t('说话人')"
                @update:model-value="setLineSpeaker(openShot, li, $event)"
              />
              <input
                class="plan-dialogue__text"
                :value="item.text"
                :maxlength="MAX_LINE_TEXT"
                :disabled="disabled"
                :placeholder="t('台词正文')"
                @input="onLineText(openShot, li, $event)"
              >
              <input
                class="plan-dialogue__emotion"
                :value="item.emotion ?? ''"
                :maxlength="MAX_EMOTION"
                :disabled="disabled"
                :placeholder="t('情绪')"
                @input="onLineEmotion(openShot, li, $event)"
              >
              <button type="button" class="plan-editor__icon is-danger" :aria-label="t('删除')" :disabled="disabled" @click="removeLine(openShot, li)">
                <UIcon name="i-lucide-trash-2" class="size-4" />
              </button>
            </div>
          </div>

          <label v-if="showTranslated" class="publish-field plan-shot__line-i18n">
            <span>{{ t('{lang}台词', { lang: langLabel(lang) }) }}</span>
            <input
              :value="translatedLine(openShot)"
              maxlength="200"
              :disabled="disabled"
              :placeholder="t('留空则该语种回落到原文')"
              @input="onTranslatedInput(openShot, $event)"
            >
          </label>
        </article>
      </div>

      <section v-else-if="pane === 'characters'" class="plan-people">
        <p v-if="!plan.characters.length" class="plan-editor__empty">{{ t('没有角色时只生成分镜图') }}</p>
        <article v-for="(c, i) in plan.characters" :key="c.key" class="plan-card">
          <header class="plan-card__bar">
            <i class="plan-mark" :style="{ '--hue': castHue(c.key) }">{{ initialOf(c.name, c.key) }}</i>
            <input v-model="c.name" class="plan-card__name" maxlength="20" :disabled="disabled" :placeholder="t('角色名')" @input="touch">
            <button type="button" class="plan-editor__icon is-danger" :aria-label="t('删除')" :disabled="disabled" @click="removeCharacter(i)">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </button>
          </header>
          <textarea v-model="c.look" class="plan-card__look" rows="2" maxlength="500" :disabled="disabled" :placeholder="t('外貌与服装提示词')" @input="touch" />
          <div class="plan-card__meta plan-voice">
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
        </article>
      </section>

      <section v-else class="plan-people">
        <p v-if="!plan.scenes.length" class="plan-editor__empty">{{ t('还没有场景') }}</p>
        <article v-for="(s, i) in plan.scenes" :key="s.key" class="plan-card">
          <header class="plan-card__bar">
            <span class="plan-card__key num">{{ String(i + 1).padStart(2, '0') }}</span>
            <input v-model="s.name" class="plan-card__name" maxlength="20" :disabled="disabled" :placeholder="t('场景名')" @input="touch">
            <button type="button" class="plan-editor__icon is-danger" :aria-label="t('删除')" :disabled="disabled" @click="removeScene(i)">
              <UIcon name="i-lucide-trash-2" class="size-4" />
            </button>
          </header>
          <textarea v-model="s.look" class="plan-card__look" rows="2" maxlength="500" :disabled="disabled" :placeholder="t('场景提示词')" @input="touch" />
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
        </article>
      </section>
    </div>
  </div>
</template>
