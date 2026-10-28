<script setup lang="ts">
/**
 * 角色属性面板（复刻自 open-director 的 CharacterPanel.tsx，MIT）。
 *
 * 单个角色和群众组共用这个面板：同样的字段，只是提交到不同的 store 动作。
 * 选中的到底是哪一种由 resolveCharacterSelection 判定。
 */
import { computed, ref } from 'vue'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { resolveCharacterSelection } from '~/utils/director/panel-selection'
import { MANNEQUIN_POSE_PRESETS } from '~/utils/director/pose-presets'
import { BODY_OFFSET_Y_CONTROL, BODY_OFFSET_Y_RANGE, POSE_CONTROL_GROUPS, POSE_CONTROL_RANGE } from '~/utils/director/pose-controls'
import type { DirectorTransform, PosePresetId } from '~/utils/director/schema'
import {
  CHARACTER_LOOK_ACCEPT,
  characterLookFileError,
} from '~/utils/director/character-look'
import assetApi from '~/api/asset'
import { resolveMediaUrl } from '~/utils/media'
import DirectorPanelCard from './DirectorPanelCard.vue'
import DirectorTextField from './DirectorTextField.vue'
import DirectorTransformFields from './DirectorTransformFields.vue'
import DirectorColorField from './DirectorColorField.vue'
import DirectorRangeField from './DirectorRangeField.vue'
import DirectorSection from './DirectorSection.vue'

const { t } = useI18n()
const store = useDirectorStore()

const activeTab = ref('properties')

const tabs = computed(() => [
  { id: 'properties', label: t('属性') },
  { id: 'pose', label: t('姿势') },
])

const selection = computed(() => resolveCharacterSelection(store.state.value))

/** 群众组的改动要走整组的动作，不然只动了锚点那一个人 */
const crowdId = computed(() => selection.value?.crowdId ?? null)

const writeBlocked = computed(() => {
  if (store.readonly.value)
    return true
  const current = selection.value
  if (!current)
    return false
  if (current.crowdId)
    return store.project.value.objects.some(item => item.crowdId === current.crowdId && item.locked)
  return Boolean(current.role.locked)
})

function onNameChange(name: string) {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.updateCrowdLabel(crowdId.value, name)
  else
    store.updateObjectName(current.role.id, name)
}

function onTransform(patch: Partial<DirectorTransform>) {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.updateCrowdTransform(crowdId.value, patch)
  else
    store.updateObjectTransform(current.role.id, patch)
}

function onUniformScale(value: number) {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.updateCrowdUniformScale(crowdId.value, value)
  else
    store.updateUniformScale(current.role.id, value)
}

function onColor(color: string) {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.updateCrowdColor(crowdId.value, color)
  else
    store.updateObjectColor(current.role.id, color)
}

function onPreset(presetId: PosePresetId) {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.applyCrowdPosePreset(crowdId.value, presetId)
  else
    store.applyPosePreset(current.role.id, presetId)
}

function onPoseControl(key: string, value: number) {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.updateCrowdPoseControl(crowdId.value, key, value)
  else
    store.updatePoseControl(current.role.id, key, value)
}

function controlValue(key: string) {
  return selection.value?.role.characterRig?.controls[key] ?? 0
}

const lookInput = ref<HTMLInputElement | null>(null)
const lookUploading = ref(false)

const lookAsset = computed(() => {
  const id = selection.value?.role.lookAssetId
  if (!id)
    return null
  return store.project.value.assets.find(item => item.id === id && item.sourceType === 'image') ?? null
})

function pickLook() {
  if (lookUploading.value || writeBlocked.value)
    return
  lookInput.value?.click()
}

async function onLookFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (writeBlocked.value) {
    useToast().add({ title: t(store.readonly.value ? '只读画布不能修改' : 'canvas.lock.lock'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    return
  }
  const current = selection.value
  if (!file || !current)
    return
  const error = characterLookFileError(file)
  if (error) {
    useToast().add({ title: t(error), color: 'error', close: false, progress: false, orientation: 'horizontal' })
    return
  }

  lookUploading.value = true
  const localUrl = URL.createObjectURL(file)
  const input = { url: localUrl, fileName: file.name, assetSource: 'local' as const }
  if (crowdId.value)
    store.bindCrowdLook(crowdId.value, input)
  else
    store.bindCharacterLook(current.role.id, input)

  try {
    const res = await assetApi.upload(file)
    const uploaded = res?.success ? String(res.data?.url || '').trim() : ''
    const assetId = store.project.value.objects.find(item => item.id === current.role.id)?.lookAssetId
    if (uploaded && assetId) {
      store.updateImportedAsset(assetId, { url: uploaded, assetSource: 'library' })
      URL.revokeObjectURL(localUrl)
      useToast().add({ title: t('形象已保存，刷新后还能看到'), color: 'success', close: false, progress: false, orientation: 'horizontal' })
    }
    else {
      useToast().add({ title: res?.message || t('形象上传失败，刷新页面后会从场景里消失'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
    }
  }
  catch {
    useToast().add({ title: t('形象上传失败，刷新页面后会从场景里消失'), color: 'neutral', close: false, progress: false, orientation: 'horizontal' })
  }
  finally {
    lookUploading.value = false
  }
}

function clearLook() {
  if (writeBlocked.value)
    return
  const current = selection.value
  if (!current)
    return
  if (crowdId.value)
    store.clearCrowdLook(crowdId.value)
  else
    store.clearCharacterLook(current.role.id)
}
</script>

<template>
  <DirectorPanelCard
    v-if="selection"
    :title="t('角色')"
    :sr-label="t('角色属性面板')"
    :tabs="tabs"
    :active-tab="activeTab"
    :disabled="writeBlocked"
    @update:active-tab="activeTab = $event"
  >
    <template #head-extra>
      <slot name="head-extra" />
    </template>
    <template v-if="activeTab === 'properties'">
      <DirectorTextField
        :label="t('名称')"
        :sr-label="t('角色名称')"
        :model-value="selection.name"
        @update:model-value="onNameChange"
      />

      <DirectorTransformFields
        :transform="selection.transform"
        :sr-prefix="t('角色')"
        @update="onTransform"
        @uniform-scale="onUniformScale"
      />

      <DirectorColorField
        :label="t('颜色')"
        :sr-label="t('角色颜色')"
        :model-value="selection.color"
        @update:model-value="onColor"
      />

      <DirectorSection :title="t('形象')">
        <input
          ref="lookInput"
          type="file"
          class="sr-only"
          :accept="CHARACTER_LOOK_ACCEPT"
          @change="onLookFile"
        >
        <div class="director-look">
          <img
            v-if="lookAsset?.url"
            class="director-look__thumb"
            :src="resolveMediaUrl(lookAsset.url)"
            :alt="lookAsset.fileName"
          >
          <span v-else class="director-look__thumb is-empty" aria-hidden="true" />
          <div class="director-look__actions">
            <button type="button" class="director-look__btn" :disabled="lookUploading || store.readonly.value" @click="pickLook()">
              {{ lookUploading ? t('导入中…') : lookAsset ? t('更换形象') : t('绑定形象') }}
            </button>
            <button v-if="lookAsset" type="button" class="director-look__btn" :disabled="store.readonly.value" @click="clearLook()">
              {{ t('去掉形象') }}
            </button>
            <p class="director-panel__hint">{{ t('图顺着正面曲面贴在上半身，背面不会再印一张') }}</p>
          </div>
        </div>
      </DirectorSection>
    </template>

    <template v-else>
      <!-- 导入的模型没有标准骨骼时没法摆姿势，给一句说明而不是一堆拖了没反应的滑块 -->
      <p v-if="!selection.role.characterRig" class="director-panel__hint">
        {{ t('这个模型没有识别到标准人形骨骼，暂时不能编辑姿势。') }}
      </p>

      <template v-else>
        <DirectorSection :title="t('姿势预设')">
          <div class="director-preset-grid">
            <button
              v-for="preset in MANNEQUIN_POSE_PRESETS"
              :key="preset.id"
              type="button"
              :class="{ 'is-active': selection.role.characterRig?.posePresetId === preset.id }"
              @click="onPreset(preset.id)"
            >
              {{ t(preset.label) }}
            </button>
          </div>
        </DirectorSection>

        <DirectorSection :title="t('姿势调节')">
          <DirectorRangeField
            :label="t(BODY_OFFSET_Y_CONTROL.label)"
            :sr-label="t('蹲下高度')"
            :model-value="controlValue(BODY_OFFSET_Y_CONTROL.key)"
            :min="BODY_OFFSET_Y_RANGE.min"
            :max="BODY_OFFSET_Y_RANGE.max"
            :step="BODY_OFFSET_Y_RANGE.step"
            suffix="m"
            @update:model-value="onPoseControl(BODY_OFFSET_Y_CONTROL.key, $event)"
          />
          <p class="director-panel__hint">{{ t('负值把人往下带，脚不会陷进地里。单位是米。') }}</p>
          <section v-for="group in POSE_CONTROL_GROUPS" :key="group.title" class="director-pose-group">
            <h4>{{ t(group.title) }}</h4>
            <DirectorRangeField
              v-for="control in group.controls"
              :key="control.key"
              :label="t(control.label)"
              :sr-label="`${t(group.title)} · ${t(control.label)}`"
              :model-value="controlValue(control.key)"
              :min="POSE_CONTROL_RANGE.min"
              :max="POSE_CONTROL_RANGE.max"
              :step="POSE_CONTROL_RANGE.step"
              suffix="°"
              @update:model-value="onPoseControl(control.key, $event)"
            />
          </section>
        </DirectorSection>
      </template>
    </template>
  </DirectorPanelCard>
</template>
