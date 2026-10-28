<script setup lang="ts">
/**
 * 语言切换：与创作台浮层同一套圆角 / 阴影。
 */
import { canonicalI18nLocaleCode } from '~/utils/i18nLocaleCode'

withDefaults(
  defineProps<{
    compact?: boolean
    variant?: 'button' | 'menu-row'
  }>(),
  { compact: false, variant: 'button' },
)

const { locale, locales, setLocale, t } = useI18n()

const LOCALE_ORDER = ['zh', 'zh-tw', 'en', 'fr', 'ja', 'ru', 'vi'] as const

type LocaleCode = (typeof LOCALE_ORDER)[number]

const localeList = computed(() => {
  const list = locales.value.filter(l => typeof l.code === 'string')
  const byCode = new Map(list.map(l => [String(l.code).toLowerCase(), l]))
  return LOCALE_ORDER.map(code => byCode.get(code)).filter(Boolean) as typeof locales.value
})

const runtimeConfig = useRuntimeConfig()

const activeLocaleCode = computed(() =>
  canonicalI18nLocaleCode(
    String(locale.value),
    locales.value as { code: string; language?: string }[],
    String(runtimeConfig.public.defaultLocale || 'zh'),
  ),
)

const activeLocaleName = computed(() => {
  const found = localeList.value.find(l => l.code === activeLocaleCode.value)
  return found?.name ?? activeLocaleCode.value
})

const menuOpen = ref(false)

function onSelect(code: LocaleCode) {
  menuOpen.value = false
  if (code === activeLocaleCode.value)
    return
  void setLocale(code)
}
</script>

<template>
  <UPopover
    v-model:open="menuOpen"
    :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
    :ui="{ content: 'studio-lang-pop' }"
  >
    <button
      v-if="variant === 'button'"
      type="button"
      class="ea-icon-btn theme-toggle-btn shrink-0"
      :class="compact ? 'h-8 w-8' : 'h-9 w-9'"
      :aria-label="t('lang.menuAria')"
      :aria-expanded="menuOpen"
    >
      <svg
        class="shrink-0 text-current"
        :class="compact ? 'h-[15px] w-[15px]' : 'h-[18px] w-[18px]'"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <text
          x="2"
          y="11"
          fill="currentColor"
          font-size="10"
          font-weight="600"
          font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
        >
          文
        </text>
        <text
          x="13"
          y="21"
          fill="currentColor"
          font-size="12"
          font-weight="700"
          font-family="ui-sans-serif, system-ui, Georgia, serif"
        >
          A
        </text>
      </svg>
      <span class="canvas-tip canvas-tip--down">{{ t('lang.menuAria') }}</span>
    </button>
    <button
      v-else
      type="button"
      class="studio-lang-pop__trigger"
      :aria-label="t('lang.menuAria')"
      :aria-expanded="menuOpen"
    >
      <span class="max-w-[7rem] truncate">{{ activeLocaleName }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-3.5 shrink-0 opacity-60" />
    </button>

    <template #content>
      <div class="studio-lang-pop__list">
        <button
          v-for="item in localeList"
          :key="String(item.code)"
          type="button"
          class="studio-lang-pop__item"
          :class="{ 'is-on': String(item.code) === activeLocaleCode }"
          @click="onSelect(item.code as LocaleCode)"
        >
          <span>{{ item.name ?? item.code }}</span>
          <UIcon
            v-if="String(item.code) === activeLocaleCode"
            name="i-lucide-check"
            class="size-4"
          />
        </button>
      </div>
    </template>
  </UPopover>
</template>
