<script setup lang="ts">
import {
  buildCameraPrompt,
  CAMERA_APERTURES,
  CAMERA_BODIES,
  CAMERA_FOCALS,
  CAMERA_LENSES,
  DEFAULT_CAMERA_SETUP,
  findAperture,
  findBody,
  findFocal,
  findLens,
  normalizeCameraSetup,
  type CameraSetup,
} from '~/utils/canvas-camera'

const props = defineProps<{
  open: boolean
  /** 节点上已存的配置，未配置传 null */
  value?: Partial<CameraSetup> | null
}>()

const emit = defineEmits<{
  close: []
  apply: [setup: CameraSetup]
  /** 清掉节点上的摄影配置 */
  clear: []
}>()

const { t } = useI18n()

/** 弹窗里先改草稿，点「应用」才写回节点，避免每次点击都进一条撤销历史 */
const draft = ref<CameraSetup>(normalizeCameraSetup(props.value))

watch(() => props.open, (open) => {
  if (!open)
    return
  const next = normalizeCameraSetup(props.value)
  // 第一次打开还没配过，默认就是开启状态，省一次点击
  draft.value = { ...next, on: props.value ? next.on : true }
}, { immediate: true })

const previewPrompt = computed(() => buildCameraPrompt({ ...draft.value, on: true }))
const bodyPick = computed(() => findBody(draft.value.body))
const lensPick = computed(() => findLens(draft.value.lens))
const focalPick = computed(() => findFocal(draft.value.focal))
const aperturePick = computed(() => findAperture(draft.value.aperture))

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => window.removeEventListener('keydown', onKey, true))

function reset() {
  draft.value = { ...DEFAULT_CAMERA_SETUP, on: draft.value.on }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask asset-picker-mask"
      @click.self="emit('close')"
      @pointerdown.stop
    >
      <div class="studio-modal canvas-camera" role="dialog" aria-modal="true" :aria-label="t('摄影配置')">
        <header class="asset-picker__head">
          <div>
            <h2>{{ t('摄影配置') }}</h2>
            <p>{{ t('机身、镜头、焦段和光圈会拼成一段提示词，追加到生成提示词末尾') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>

        <div class="canvas-camera__body" :class="{ 'is-off': !draft.on }">
          <label class="canvas-camera__enable">
            <span>
              <strong>{{ t('在提示词中使用摄影配置') }}</strong>
              <small>{{ t('关掉后配置仍保留，生成时不拼进提示词') }}</small>
            </span>
            <span class="canvas-camera__toggle">
              <input v-model="draft.on" type="checkbox">
              <i />
            </span>
          </label>

          <div class="canvas-camera__summary">
            <span>{{ bodyPick?.name }}</span>
            <span>{{ lensPick?.name }}</span>
            <span>{{ draft.focal }}mm · {{ focalPick ? t(focalPick.tier) : '' }}</span>
            <span>f/{{ draft.aperture }} · {{ aperturePick ? t(aperturePick.tier) : '' }}</span>
          </div>

          <section class="canvas-camera__sec">
            <h3>{{ t('机身') }}</h3>
            <div class="canvas-camera__cards">
              <button
                v-for="item in CAMERA_BODIES"
                :key="item.id"
                type="button"
                :class="{ 'is-on': draft.body === item.id }"
                :title="t(item.useCase)"
                @click="draft.body = item.id"
              >
                <UIcon v-if="draft.body === item.id" name="i-lucide-check" class="size-3.5 canvas-camera__tick" />
                <strong>{{ item.name }}</strong>
                <em>{{ t(item.label) }}</em>
                <small>{{ t(item.desc) }}</small>
              </button>
            </div>
          </section>

          <section class="canvas-camera__sec">
            <h3>{{ t('镜头') }}</h3>
            <div class="canvas-camera__cards">
              <button
                v-for="item in CAMERA_LENSES"
                :key="item.id"
                type="button"
                :class="{ 'is-on': draft.lens === item.id }"
                :title="t(item.useCase)"
                @click="draft.lens = item.id"
              >
                <UIcon v-if="draft.lens === item.id" name="i-lucide-check" class="size-3.5 canvas-camera__tick" />
                <strong>{{ item.name }}</strong>
                <em>{{ t(item.label) }}</em>
                <small>{{ t(item.desc) }}</small>
              </button>
            </div>
          </section>

          <section class="canvas-camera__sec">
            <h3>{{ t('焦段') }}</h3>
            <div class="canvas-camera__pills">
              <button
                v-for="item in CAMERA_FOCALS"
                :key="item.value"
                type="button"
                :class="{ 'is-on': draft.focal === item.value }"
                :title="`${t(item.desc)} · ${t(item.useCase)}`"
                @click="draft.focal = item.value"
              >
                <b>{{ item.value }}mm</b>
                <i>{{ t(item.tier) }}</i>
              </button>
            </div>
          </section>

          <section class="canvas-camera__sec">
            <h3>{{ t('光圈') }}</h3>
            <div class="canvas-camera__pills">
              <button
                v-for="item in CAMERA_APERTURES"
                :key="item.value"
                type="button"
                :class="{ 'is-on': draft.aperture === item.value }"
                :title="`${t(item.desc)} · ${t(item.useCase)}`"
                @click="draft.aperture = item.value"
              >
                <b>f/{{ item.value }}</b>
                <i>{{ t(item.tier) }}</i>
              </button>
            </div>
          </section>

          <section class="canvas-camera__sec">
            <h3>{{ t('生成的提示词片段') }}</h3>
            <p class="canvas-camera__preview">{{ previewPrompt }}</p>
          </section>
        </div>

        <footer class="canvas-camera__foot">
          <button type="button" class="canvas-camera__ghost" @click="reset()">
            {{ t('恢复默认') }}
          </button>
          <span class="canvas-camera__grow" />
          <button type="button" class="canvas-camera__ghost" @click="emit('clear')">
            {{ t('清除配置') }}
          </button>
          <button type="button" class="asset-picker__ok" @click="emit('apply', { ...draft })">
            {{ t('应用') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
