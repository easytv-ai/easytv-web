<script setup lang="ts">
import type { Episode } from '~/types/creative'
import { episodeNoLabel, episodeStatusLabel } from '~/utils/bible'

const { t } = useI18n()
const localePath = useLocalePath()

defineProps<{
  episodes: Episode[]
  newEpisodeHref: string
  editingNo: number
  noDraft: string
  savingNo: number
}>()

const emit = defineEmits<{
  'update:noDraft': [value: string]
  edit: [row: Episode]
  commit: [row: Episode]
  cancel: []
}>()

function episodeHref(id: number) {
  return localePath(`/create?screenplay=${id}`)
}
</script>

<template>
  <div class="create-card">
    <header class="plan-editor__head">
      <h3>{{ t('集目录') }}</h3>
      <NuxtLink v-if="episodes.length" :to="newEpisodeHref" class="studio-chip">
        <UIcon name="i-lucide-plus" class="size-4" />
        {{ t('新建一集') }}
      </NuxtLink>
    </header>
    <NuxtLink v-if="!episodes.length" :to="newEpisodeHref" class="bible-empty">
      <UIcon name="i-lucide-plus" class="size-4" />
      {{ t('新建一集') }}
    </NuxtLink>
    <div v-else class="bible-catalog">
      <table>
        <thead>
          <tr>
            <th>{{ t('集号') }}</th>
            <th>{{ t('标题') }}</th>
            <th>{{ t('状态') }}</th>
            <th class="num">{{ t('场数') }}</th>
            <th class="num">{{ t('镜数') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in episodes" :key="row.id">
            <td class="bible-catalog__no">
              <input
                v-if="editingNo === row.id"
                :value="noDraft"
                class="bible-catalog__no-input"
                type="number"
                min="0"
                max="999"
                @input="emit('update:noDraft', ($event.target as HTMLInputElement).value)"
                @blur="emit('commit', row)"
                @keydown.enter.prevent="emit('commit', row)"
                @keydown.esc.prevent="emit('cancel')"
              >
              <button
                v-else
                type="button"
                class="bible-catalog__no-btn"
                :disabled="savingNo === row.id"
                :title="t('点击修改集号')"
                @click="emit('edit', row)"
              >
                {{ episodeNoLabel(row.episode_no, t) }}
                <UIcon name="i-lucide-pencil" class="size-3" />
              </button>
            </td>
            <td class="bible-catalog__title">
              <NuxtLink :to="episodeHref(row.id)">{{ row.title || t('未命名') }}</NuxtLink>
            </td>
            <td>
              <span class="bible-status" :class="`is-${row.status === -1 ? 'failed' : row.status}`">{{ episodeStatusLabel(row.status, t) }}</span>
              <small v-if="row.stale" class="bible-stale">{{ t('画布待同步') }}</small>
            </td>
            <td class="num">{{ row.scenes }}</td>
            <td class="num">{{ row.shots }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
