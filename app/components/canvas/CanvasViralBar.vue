<script setup lang="ts">
import type { ViralEntityKind, ViralPlan } from '~/utils/canvas-viral'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  open: boolean
  /** confirm 先拉片；review 替换素材后再按分镜生成 */
  stage?: 'confirm' | 'review'
  /** 这一步的预估积分。null 表示原片时长还在读 */
  points?: number | null
  durationReady?: boolean
  plan?: ViralPlan | null
  submitting?: boolean
  /** 进行中的阶段：analyze 拉片，generate 按分镜提交 */
  step?: '' | 'analyze' | 'generate'
  panelStyle?: Record<string, string> | null
}>(), {
  stage: 'confirm',
  points: null,
  durationReady: false,
  plan: null,
  submitting: false,
  step: '',
  panelStyle: null,
})

const emit = defineEmits<{
  close: []
  submit: []
  reset: []
  pick: [id: string]
  clear: [id: string]
  extra: [text: string]
  shot: [index: number, text: string]
  commit: []
}>()

const KIND_LABEL: Record<ViralEntityKind, string> = {
  role: '角色',
  scene: '场景',
  element: '元素',
}

const stepText = computed(() => {
  if (props.step === 'analyze')
    return t('正在拉片…')
  if (props.step === 'generate')
    return t('正在按分镜提交…')
  return ''
})

const sendDisabled = computed(() => {
  if (props.submitting)
    return true
  if (props.stage === 'confirm')
    return !props.durationReady
  return !props.plan?.shots.length
})

const pointsText = computed(() => props.points === null ? '…' : String(props.points))

function onSubmit() {
  if (sendDisabled.value)
    return
  emit('submit')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && panelStyle"
      class="canvas-viral nodrag nopan nowheel"
      :class="{ 'is-review': stage === 'review' }"
      :style="panelStyle"
      @pointerdown.stop
      @dblclick.stop
    >
      <div class="canvas-viral__pill">
        <button type="button" class="canvas-viral__x" :aria-label="t('关闭')" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-4" />
        </button>
        <span class="canvas-viral__title">{{ t('爆款复刻') }}</span>
        <button type="button" class="canvas-viral__info" :aria-label="t('功能说明')">
          <UIcon name="i-lucide-info" class="size-4" />
          <span class="canvas-tip canvas-tip--up">{{ t('先拉片，再替换角色、场景和元素，最后按分镜生成') }}</span>
        </button>
        <span v-if="stepText" class="canvas-viral__step">{{ stepText }}</span>
        <span class="canvas-viral__cost" :title="t('积分')">
          <UIcon name="i-lucide-sparkles" class="size-4" />
          {{ pointsText }}
        </span>
        <button
          type="button"
          class="canvas-viral__send"
          :aria-label="stage === 'review' ? t('按分镜生成') : t('开始复刻')"
          :disabled="sendDisabled"
          @click="onSubmit"
        >
          <UIcon
            :name="submitting ? 'i-lucide-loader-circle' : 'i-lucide-arrow-up'"
            class="size-4"
            :class="{ 'animate-spin': submitting }"
          />
        </button>
      </div>

      <section v-if="stage === 'review' && plan" class="canvas-viral__review" :aria-label="t('拉片结果')">
        <p class="canvas-viral__hint">
          {{ t('拉片完成。替换角色、场景或元素后再生成，每个镜头会单独出一条视频') }}
        </p>
        <div v-if="plan.entities.length" class="canvas-viral__entities">
          <div v-for="entity in plan.entities" :key="entity.id" class="canvas-viral__entity">
            <button type="button" class="canvas-viral__entity-main" :disabled="submitting" @click="emit('pick', entity.id)">
              <img v-if="entity.url" :src="entity.url" alt="" class="canvas-viral__thumb">
              <span v-else class="canvas-viral__thumb canvas-viral__thumb--empty">{{ t(KIND_LABEL[entity.kind]) }}</span>
              <span class="canvas-viral__entity-copy">
                <span class="canvas-viral__entity-name">{{ entity.name }}</span>
                <span class="canvas-viral__entity-note">{{ entity.assetName || entity.note || t('换素材') }}</span>
              </span>
            </button>
            <button
              v-if="entity.assetId"
              type="button"
              class="canvas-viral__entity-clear"
              :aria-label="t('清除替换')"
              :disabled="submitting"
              @click="emit('clear', entity.id)"
            >
              <UIcon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>
        </div>
        <p v-else class="canvas-viral__hint">
          {{ t('这次拉片没有标出可替换对象，可以直接按分镜生成') }}
        </p>
        <label class="canvas-viral__extra">
          <span>{{ t('额外要求') }}</span>
          <input
            :value="plan.extra"
            type="text"
            maxlength="300"
            :disabled="submitting"
            :placeholder="t('可选，例如改成黄昏、换成另一套衣服')"
            @input="emit('extra', ($event.target as HTMLInputElement).value)"
            @change="emit('commit')"
          >
        </label>
        <ol class="canvas-viral__shots">
          <li v-for="(shot, index) in plan.shots" :key="`${shot.start}-${shot.end}-${index}`">
            <span>{{ shot.start }}-{{ shot.end }}s</span>
            <textarea
              :value="shot.text"
              rows="2"
              maxlength="400"
              :disabled="submitting"
              :aria-label="t('镜头 {n}', { n: index + 1 })"
              @input="emit('shot', index, ($event.target as HTMLTextAreaElement).value)"
              @change="emit('commit')"
            />
          </li>
        </ol>
        <div class="canvas-viral__review-foot">
          <button type="button" class="canvas-viral__reset" :disabled="submitting" @click="emit('reset')">
            {{ t('重新拉片') }}
          </button>
          <span>{{ t('生成完成后，选中这些镜头即可拼接成片') }}</span>
        </div>
      </section>
    </div>
  </Teleport>
</template>
