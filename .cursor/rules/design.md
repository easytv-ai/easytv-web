# 设计规范（Cursor 规则）

编写 UI 代码前请阅读 **`DESIGN-SYSTEM.md`**，视觉参考 [OpenRouter](https://openrouter.ai/)，品牌主色 EasyAPI 青 `#18c1d6`。

## Token 与样式

- 颜色、圆角、阴影统一使用 `app/assets/css/main.css` 中的 `--ea-*` 变量
- 优先使用已定义工具类：`.ea-btn-*`、`.ea-header`、`.ea-nav-link`、`.ea-card-light`、`.ea-menu-panel`、`.ea-segment`、`.ea-page-hero`
- Nuxt UI 按钮：主 CTA 用 `color="primary"` + `.ea-btn--primary`；避免蓝紫渐变
- 深色模式背景用 Slate `#0f172a`（`--ea-bg`），禁止 `dark:bg-black` / `#0a0a0a`

## 禁止项

- 营销/导航 CTA 禁止使用 Tailwind 蓝紫渐变（`from-blue-* to-purple-*`、`from-indigo-*`）
- 禁止硬编码 `#2563EB`、`#6366F1`、`#8B5CF6` 等旧品牌色
- 禁止主按钮使用近黑 `#0a0a0a` 背景
- 禁止头像、注册按钮使用渐变背景

## 布局约定

- **官网顶栏**：Logo + 中间导航 + 右侧（语言、主题、通知、头像/登录）
- **控制台**：左侧栏（品牌 + 菜单）+ 右侧顶栏/内容；语言/主题在头像菜单内
- 容器：`.ea-container`（max-width 1280px）

## 组件约定

- 全局顶栏：`app/components/site/SiteHeader.vue`
- 控制台头像菜单：`app/components/site/SiteUserMenuPanel.vue`
- 主题切换逻辑：`app/composables/useTheme.ts`（system / light / dark）

## 字体

Geist（CDN）→ Inter → 系统 sans；不要引入第二套展示字体。
