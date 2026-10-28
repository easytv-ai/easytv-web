<script setup lang="ts">
/**
 * 口令红包领取弹窗。
 * 两个阶段：输入口令（带实时校验回显）→ 领取成功的红包展示。
 * 领取会同时把账号绑定到该渠道伙伴名下，并建立首充赠送权益。
 */
import bonusCodeApi, { BONUS_REWARD_STATUS, type BonusCodeClaimResult, type BonusCodePreview } from '~/api/bonus-code'
import { formatBonusPreviewText } from '~/utils/bonus-code'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  /** 打开时预填的口令（如注册页带过来的） */
  initialCode?: string
  /** 直接以「已领取成功」状态打开（注册后自动领取的场景） */
  initialResult?: BonusCodeClaimResult | null
}>(), {
  initialCode: '',
  initialResult: null,
})

const emit = defineEmits<{ claimed: [result: BonusCodeClaimResult] }>()

const open = defineModel<boolean>('open', { default: false })

const toast = useToast()

const code = ref('')
const claiming = ref(false)
const previewing = ref(false)
const preview = ref<BonusCodePreview | null>(null)
const previewError = ref('')
const result = ref<BonusCodeClaimResult | null>(null)

/** 成功态：展示红包，而不是输入框 */
const succeeded = computed(() => !!result.value)

const bonusPoints = computed(() => Math.max(0, Math.round(Number(result.value?.bonus_points ?? preview.value?.bonus_points ?? 0))))
const memberDays = computed(() => Math.max(0, Math.round(Number(result.value?.member_days ?? preview.value?.member_days ?? 0))))
const rewardPercent = computed(() => {
  const rate = result.value?.reward_rate ?? preview.value?.first_recharge_rate ?? 0
  return Math.round(rate * 100)
})
/** 首充加赠卡片只在权益仍待生效时展示；已发 / 过期 / 不符合都不再承诺 */
const showRewardCard = computed(() =>
  rewardPercent.value > 0 && (result.value?.reward_status ?? BONUS_REWARD_STATUS.PENDING) === BONUS_REWARD_STATUS.PENDING,
)
const previewText = computed(() => formatBonusPreviewText(preview.value, t))
const rewardExpireText = computed(() => {
  const ts = result.value?.reward_expire_at ?? 0
  if (!ts)
    return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})

watch(open, (v) => {
  if (!v)
    return
  result.value = props.initialResult
  preview.value = null
  previewError.value = ''
  code.value = props.initialCode ?? '' // 赋值触发下面的 watch，自动校验
})

let previewTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 输入停顿后校验，避免每敲一个字都打接口。
 * 走 watch 而非 @input：UInput 不把原生 input 事件透传到内部 <input>。
 */
watch(code, () => {
  if (result.value)
    return // 成功态不再校验
  preview.value = null
  previewError.value = ''
  if (previewTimer)
    clearTimeout(previewTimer)
  if (!code.value.trim())
    return
  previewTimer = setTimeout(() => void runPreview(), 400)
})

async function runPreview() {
  const value = code.value.trim()
  if (!value)
    return
  previewing.value = true
  try {
    const res = await bonusCodeApi.preview(value) as any
    if (res?.success && res.data) {
      preview.value = res.data as BonusCodePreview
      previewError.value = ''
    }
    else {
      preview.value = null
      previewError.value = res?.message ?? t('console.bonusCode.errNotFound')
    }
  }
  catch {
    preview.value = null
    previewError.value = t('console.bonusCode.errNotFound')
  }
  finally {
    previewing.value = false
  }
}

async function submit() {
  const value = code.value.trim()
  if (!value) {
    toast.add({ title: t('console.bonusCode.toastEmpty'), color: 'error' })
    return
  }
  claiming.value = true
  try {
    const res = await bonusCodeApi.claim(value) as any
    if (res?.unauthorized)
      return
    if (!res?.success) {
      previewError.value = res?.message ?? t('console.bonusCode.errGeneric')
      toast.add({ title: previewError.value, color: 'error' })
      return
    }
    result.value = res.data as BonusCodeClaimResult
    emit('claimed', result.value)
  }
  catch {
    // 网络/接口异常也要给反馈，否则按钮转完圈毫无动静，用户以为领到了
    previewError.value = t('console.bonusCode.errGeneric')
    toast.add({ title: previewError.value, color: 'error' })
  }
  finally {
    claiming.value = false
  }
}

function close() {
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'w-[min(94vw,26rem)]' }">
    <template #content>
      <!-- 成功态：红包展示 -->
      <div v-if="succeeded" class="overflow-hidden rounded-[var(--ui-radius)]">
        <div class="relative bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 px-6 pb-10 pt-8 text-center text-white">
          <div class="mx-auto flex size-16 items-center justify-center rounded-full bg-white/20 backdrop-blur">
            <UIcon name="i-lucide-gift" class="size-8" />
          </div>
          <p class="mt-4 text-sm font-medium text-white/90">
            {{ t('console.bonusCode.successTitle') }}
          </p>
          <p v-if="bonusPoints > 0" class="mt-2 text-5xl font-bold tabular-nums tracking-tight">
            {{ bonusPoints }}<span class="ml-1 text-lg font-medium text-white/90">{{ t('console.bonusCode.pointsUnit') }}</span>
          </p>
          <p v-else-if="memberDays > 0" class="mt-2 text-4xl font-bold tabular-nums tracking-tight">
            {{ t('console.bonusCode.memberDaysBig', { days: memberDays }) }}
          </p>
          <p v-else class="mt-2 text-3xl font-bold tracking-tight">
            {{ t('console.bonusCode.firstRechargeTitle', { percent: rewardPercent }) }}
          </p>
          <p v-if="result?.partner_name" class="mt-3 text-xs text-white/80">
            {{ t('console.bonusCode.fromPartner', { name: result.partner_name }) }}
          </p>
        </div>

        <div class="bg-white px-6 py-5 dark:bg-zinc-900">
          <p
            v-if="memberDays > 0 && bonusPoints > 0"
            class="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200"
          >
            <UIcon name="i-lucide-crown" class="size-4 shrink-0 text-amber-500" />
            {{ t('console.bonusCode.memberDaysLine', { days: memberDays }) }}
          </p>
          <div
            v-if="showRewardCard"
            class="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30"
            :class="{ 'mt-3': memberDays > 0 && bonusPoints > 0 }"
          >
            <p class="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <UIcon name="i-lucide-sparkles" class="size-4 shrink-0" />
              {{ t('console.bonusCode.firstRechargeTitle', { percent: rewardPercent }) }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-amber-800/90 dark:text-amber-300/80">
              {{ rewardExpireText
                ? t('console.bonusCode.firstRechargeHintWithDate', { date: rewardExpireText })
                : t('console.bonusCode.firstRechargeHint') }}
            </p>
          </div>

          <UButton block size="lg" class="mt-4 justify-center" @click="close">
            {{ t('console.bonusCode.btnDone') }}
          </UButton>
        </div>
      </div>

      <!-- 输入态 -->
      <div v-else class="p-6">
        <div class="text-center">
          <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-950/40">
            <UIcon name="i-lucide-ticket" class="size-6 text-rose-500" />
          </div>
          <h3 class="mt-3 text-lg font-semibold text-zinc-900 dark:text-white">
            {{ t('console.bonusCode.inputTitle') }}
          </h3>
          <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {{ t('console.bonusCode.inputLead') }}
          </p>
        </div>

        <div class="mt-5">
          <UInput
            v-model="code"
            size="lg"
            class="w-full"
            :placeholder="t('console.bonusCode.inputPlaceholder')"
            :loading="previewing"
            @keyup.enter="submit"
          />

          <!-- 实时校验回显：有效即时告诉用户能拿多少，转化率关键 -->
          <div
            v-if="preview"
            class="mt-2 flex items-start gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
          >
            <UIcon name="i-lucide-circle-check" class="mt-0.5 size-3.5 shrink-0" />
            <span>{{ previewText }}</span>
          </div>
          <p
            v-else-if="previewError"
            class="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
          >
            <UIcon name="i-lucide-circle-alert" class="mt-0.5 size-3.5 shrink-0" />
            <span>{{ previewError }}</span>
          </p>
        </div>

        <p class="mt-3 text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
          {{ t('console.bonusCode.inputNote') }}
        </p>

        <div class="mt-5 flex gap-2">
          <UButton color="neutral" variant="ghost" class="flex-1 justify-center" @click="close">
            {{ t('console.bonusCode.btnCancel') }}
          </UButton>
          <UButton
            class="flex-1 justify-center"
            size="lg"
            :loading="claiming"
            :disabled="!code.trim()"
            @click="submit"
          >
            {{ t('console.bonusCode.btnClaim') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
