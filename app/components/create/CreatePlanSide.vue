<script setup lang="ts">
import type { ScreenplayEstimate } from '~/types/creative'
import type { StudioSelectOption } from '~/components/studio/StudioSelect.vue'

const { t } = useI18n()

const image = defineModel<string>('image', { required: true })
const video = defineModel<string>('video', { required: true })
const audio = defineModel<string>('audio', { required: true })

defineProps<{
  imageOptions: StudioSelectOption[]
  videoOptions: StudioSelectOption[]
  audioOptions: StudioSelectOption[]
  estimate: ScreenplayEstimate | null
  estimating: boolean
  balance: number
}>()

const emit = defineEmits<{
  recharge: []
}>()
</script>

<template>
  <aside class="create-card create-plan__side">
    <h3>{{ t('模型与预估') }}</h3>
    <label class="publish-field">
      <span>{{ t('图片模型') }}</span>
      <StudioSelect
        v-model="image"
        size="compact"
        :options="imageOptions"
        :sr-label="t('图片模型')"
      />
    </label>
    <label class="publish-field">
      <span>{{ t('视频模型') }}</span>
      <StudioSelect
        v-model="video"
        size="compact"
        :options="videoOptions"
        :sr-label="t('视频模型')"
      />
    </label>
    <label class="publish-field">
      <span>{{ t('配音模型') }}</span>
      <StudioSelect
        v-model="audio"
        size="compact"
        :options="audioOptions"
        :sr-label="t('配音模型')"
      />
    </label>
    <dl class="create-estimate" :class="{ 'is-loading': estimating }">
      <div><dt>{{ t('角色图') }}</dt><dd>{{ estimate?.characters ?? '–' }}</dd></div>
      <div><dt>{{ t('分镜图') }}</dt><dd>{{ estimate?.shots_image ?? '–' }}</dd></div>
      <div><dt>{{ t('镜头视频') }}</dt><dd>{{ estimate?.shots_video ?? '–' }}</dd></div>
      <div><dt>{{ t('配音') }}</dt><dd>{{ estimate?.voice ?? '–' }}</dd></div>
      <div class="is-total"><dt>{{ t('预计扣 {n} 积分', { n: estimate?.total ?? 0 }) }}</dt><dd /></div>
    </dl>
    <p class="create-balance">
      {{ t('当前余额 {n} 积分', { n: balance }) }}
      <button v-if="estimate && estimate.total > balance" type="button" @click="emit('recharge')">{{ t('去充值') }}</button>
    </p>
    <p class="create-hint">{{ t('积分在每一层实际生成时扣除，合成不计积分。') }}</p>
  </aside>
</template>
