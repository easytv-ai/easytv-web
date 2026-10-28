<script setup lang="ts">
import PlanBoard from '~/components/pricing/PlanBoard.vue'

const { t } = useI18n()

const { pricingOpen, pricingTab, closePricing } = usePricingModal()
const boardRef = ref<{ isConfirmOpen?: () => boolean } | null>(null)
const canDismiss = ref(false)

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !pricingOpen.value)
    return
  if (boardRef.value?.isConfirmOpen?.())
    return
  closePricing()
}

function onMaskClick() {
  if (canDismiss.value && !boardRef.value?.isConfirmOpen?.())
    closePricing()
}

watch(pricingOpen, (open) => {
  if (!import.meta.client)
    return
  document.body.style.overflow = open ? 'hidden' : ''
  canDismiss.value = false
  if (open)
    window.setTimeout(() => { canDismiss.value = true }, 80)
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (import.meta.client)
    document.body.style.overflow = ''
})
</script>

<template>
  <ClientOnly>
    <Teleport to="body">
      <Transition name="plan-modal">
        <div
          v-if="pricingOpen"
          class="plan-modal-mask"
          @click.self="onMaskClick"
        >
          <div
            class="plan-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-modal-title"
          >
            <button
              type="button"
              class="plan-modal__close"
              :aria-label="t('关闭')"
              @click="closePricing"
            >
              <UIcon name="i-lucide-x" class="size-5" />
            </button>
            <div class="plan-modal__body">
              <PlanBoard ref="boardRef" v-model:tab="pricingTab" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </ClientOnly>
</template>
