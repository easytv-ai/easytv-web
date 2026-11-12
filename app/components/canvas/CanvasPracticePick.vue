<script setup lang="ts">
import { PRACTICE_LEVELS, PRACTICE_SCRIPTS, type PracticeScript, type PracticeScriptLevel } from '~/utils/canvas-practice'

withDefaults(defineProps<{
  /** 画布内选课是退出跟练；菜单里只是关掉弹窗 */
  exit?: boolean
}>(), {
  exit: false,
})

const emit = defineEmits<{
  pick: [id: string]
  close: []
}>()

const { t } = useI18n()
const expertOpen = ref(false)

const starter = computed(() => PRACTICE_SCRIPTS.filter(item => item.level === 'starter'))
const advanced = computed(() => PRACTICE_SCRIPTS.filter(item => item.level === 'advanced'))
const expert = computed(() => PRACTICE_SCRIPTS.filter(item => item.level === 'expert'))

function levelLabel(level: PracticeScriptLevel) {
  return PRACTICE_LEVELS.find(item => item.id === level)?.label ?? level
}

function metaOf(item: PracticeScript) {
  return t('canvas.practice.meta', { level: t(levelLabel(item.level)), n: item.steps.length })
}
</script>

<template>
  <div
    class="studio-modal-mask canvas-practice-pick"
    role="dialog"
    aria-modal="true"
    aria-labelledby="canvas-practice-pick-title"
    @click.self="emit('close')"
    @pointerdown.stop
  >
    <div class="studio-modal canvas-practice-pick__modal">
      <header class="canvas-practice-pick__head">
        <div>
          <p class="canvas-practice-pick__kicker">{{ t('canvas.practice.kicker') }}</p>
          <h2 id="canvas-practice-pick-title">{{ t('新手跟练') }}</h2>
          <p>{{ t('canvas.practice.lead') }}</p>
        </div>
        <button
          type="button"
          class="trash-modal__close"
          :aria-label="exit ? t('退出跟练') : t('关闭')"
          :title="exit ? t('退出并还原画布') : t('关闭')"
          @click="emit('close')"
        >
          <UIcon name="i-lucide-x" class="size-5" />
        </button>
      </header>
      <div class="canvas-practice-pick__body">
        <section v-if="starter.length" class="canvas-practice-pick__section">
          <h3>{{ t('canvas.practice.startHere') }}</h3>
          <button
            v-for="item in starter"
            :key="item.id"
            type="button"
            class="canvas-practice-pick__card is-featured"
            :aria-label="t('跟练场景：{name}', { name: t(item.name) })"
            @click="emit('pick', item.id)"
          >
            <span class="canvas-practice-pick__thumb" data-level="starter">
              <UIcon :name="item.icon" class="size-7" />
            </span>
            <span class="canvas-practice-pick__copy">
              <i>{{ t('canvas.practice.recommended') }}</i>
              <b>{{ t(item.name) }}</b>
              <em>{{ t(item.hint) }}</em>
              <small>{{ metaOf(item) }}</small>
            </span>
          </button>
        </section>
        <section v-if="advanced.length" class="canvas-practice-pick__section">
          <h3>{{ t(levelLabel('advanced')) }}</h3>
          <div class="canvas-practice-pick__grid">
            <button
              v-for="item in advanced"
              :key="item.id"
              type="button"
              class="canvas-practice-pick__card"
              :aria-label="t('跟练场景：{name}', { name: t(item.name) })"
              @click="emit('pick', item.id)"
            >
              <span class="canvas-practice-pick__thumb" data-level="advanced">
                <UIcon :name="item.icon" class="size-6" />
              </span>
              <span class="canvas-practice-pick__copy">
                <b>{{ t(item.name) }}</b>
                <em>{{ t(item.hint) }}</em>
                <small>{{ metaOf(item) }}</small>
              </span>
            </button>
          </div>
        </section>
        <section v-if="expert.length" class="canvas-practice-pick__section">
          <button
            type="button"
            class="canvas-practice-pick__more"
            :aria-expanded="expertOpen"
            @click="expertOpen = !expertOpen"
          >
            {{ t('canvas.practice.more', { n: expert.length }) }}
            <UIcon :name="expertOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4" />
          </button>
          <div v-if="expertOpen" class="canvas-practice-pick__grid">
            <button
              v-for="item in expert"
              :key="item.id"
              type="button"
              class="canvas-practice-pick__card"
              :aria-label="t('跟练场景：{name}', { name: t(item.name) })"
              @click="emit('pick', item.id)"
            >
              <span class="canvas-practice-pick__thumb" data-level="expert">
                <UIcon :name="item.icon" class="size-6" />
              </span>
              <span class="canvas-practice-pick__copy">
                <b>{{ t(item.name) }}</b>
                <em>{{ t(item.hint) }}</em>
                <small>{{ metaOf(item) }}</small>
              </span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
