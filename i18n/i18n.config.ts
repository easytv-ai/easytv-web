/**
 * vue-i18n 运行时配置（@nuxtjs/i18n 自动加载 i18n/i18n.config.ts）。
 *
 * 创作台文案以中文原文作 key（见 scripts/i18n-studio.py），因此：
 * - 回退链：zh-tw / ja / en → zh；fr / ru / vi → en → zh
 * - 关闭缺词告警，缺译时直接显示中文原文
 */
export default defineI18nConfig(() => ({
  legacy: false,
  missingWarn: false,
  fallbackWarn: false,
  fallbackLocale: {
    'zh-tw': ['zh'],
    'ja': ['zh'],
    'en': ['zh'],
    'fr': ['en', 'zh'],
    'ru': ['en', 'zh'],
    'vi': ['en', 'zh'],
    'default': ['zh'],
  },
}))
