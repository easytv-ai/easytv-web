<script setup lang="ts">
const { t } = useI18n()
const { state, settle } = useConfirm()
const confirmBtn = ref<HTMLButtonElement | null>(null)

const title = computed(() => state.value.title || t('请确认'))
const confirmText = computed(() => state.value.confirmText || t('确定'))
const cancelText = computed(() => state.value.cancelText || t('取消'))

watch(() => state.value.open, async (open) => {
  if (!open)
    return
  await nextTick()
  confirmBtn.value?.focus()
})

function onKeydown(event: KeyboardEvent) {
  if (!state.value.open)
    return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    settle(false)
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    event.stopImmediatePropagation()
    settle(true)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      class="studio-modal-mask studio-confirm-mask"
      @click.self="settle(false)"
      @pointerdown.stop
    >
      <div
        class="studio-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="studio-confirm-title"
        aria-describedby="studio-confirm-desc"
      >
        <header class="studio-confirm__head">
          <span class="studio-confirm__icon" :class="{ 'is-danger': state.danger }" aria-hidden="true">
            <UIcon :name="state.danger ? 'i-lucide-alert-circle' : 'i-lucide-info'" class="size-4" />
          </span>
          <h2 id="studio-confirm-title">{{ title }}</h2>
          <button
            type="button"
            class="studio-confirm__close"
            :aria-label="t('关闭')"
            @click="settle(false)"
          >
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <p id="studio-confirm-desc">{{ state.message }}</p>
        <div class="studio-confirm__actions">
          <button type="button" class="studio-confirm__btn" @click="settle(false)">
            {{ cancelText }}
          </button>
          <button
            ref="confirmBtn"
            type="button"
            class="studio-confirm__btn"
            :class="state.danger ? 'is-danger' : 'is-primary'"
            @click="settle(true)"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
