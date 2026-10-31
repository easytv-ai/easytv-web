# EasyTV

AI 视频创作平台的 Web 前端。自由画布、一句话成片、3D 导演台、技能库和项目管理都在这个仓库。

站点：[easytv.ai](https://easytv.ai)

本仓库只做页面、交互和静态资源。登录、生成、计费、存文件都走单独部署的 API。没有后端时，开发服务能起来，但创作相关接口不可用。

## 技术栈

- **框架**：Nuxt 4、Vue 3、TypeScript
- **界面**：Nuxt UI、Tailwind CSS 4
- **画布**：Vue Flow
- **导演台**：TresJS / Three.js
- **剪辑**：FFmpeg.wasm（浏览器里裁剪、拆分、拼接）
- **文案**：`@nuxtjs/i18n`（简体、繁体、英、法、日、俄、越）
- **上线**：Cloudflare Workers

需要 Node.js `>= 22.5.0`，以及一台能访问的 EasyTV API（默认 `http://localhost:3000`）。CI 以 npm 为准。

## 本地开发

```bash
cp .env.example .env.development
npm install
npm run dev
```

开发地址：[http://localhost:3005](http://localhost:3005)。打开 `/` 会 301 到 `/agent`。

`.env.example` 这三项就能跑：

| 变量 | 作用 |
| --- | --- |
| `NUXT_PUBLIC_SITE_NAME` | 站点名 |
| `NUXT_PUBLIC_API_BASE_URL` | 后端 API |
| `NUXT_PUBLIC_SITE_URL` | 本站公开地址（canonical、sitemap、OG） |

生产构建读 `.env.production`。不要提交 `.env.*`。

未登录可以看首页、探索、技能广场。点创作、项目、画布会在当前页弹登录框，不会跳独立登录页。

## 常用脚本

```bash
npm run dev          # 开发，读 .env.development
npm run build        # 生产构建，读 .env.production
npm run generate     # 静态导出
npm run typecheck    # 类型检查
npm test             # Vitest，覆盖 app/**/*.test.ts
npm run preview      # 构建后用 wrangler 本地预览
npm run deploy       # 构建后部署到 Cloudflare
```

## 主要页面

| 路径 | 说明 |
| --- | --- |
| `/agent` | 首页：创作入口 + 精选成片 |
| `/explore` `/studio` `/following` `/rank` | 作品流、推荐、关注、榜单 |
| `/create` | 一句话成片：输入 → 策划案 → 分层生成 → 合成 |
| `/canvas` | 自由画布。`?id=` 打开已有画布，`?project_id=` 从项目新建 |
| `/canvas/director` | 3D 导演台，场景写回同一张画布 |
| `/projects` `/assets` `/subjects` `/prompts` | 项目与素材库 |
| `/skills` | 技能广场 / 我的 / 我创建的 |
| `/campaign` | 活动 |
| `/watch/:id` | 成片播放 |
| `/settings` | 账号、团队、订单、发票、邀请 |
| `/pricing` | 套餐 |

跟练素材在 `public/images/tutorial/`。导演台素体在 `public/director-assets/`，署名要求见该目录说明。

## 目录

```text
app/
  api/           后端接口封装
  components/    画布、导演台、创作台、设置
  composables/   登录、钱包、画布状态
  pages/         路由页面
  utils/         画布、导演台、成片等纯逻辑（单测主要在这）
  middleware/    登录弹窗、控制台代登
i18n/locales/    文案
public/          动图、跟练素材、导演台模型
server/          robots、sitemap、少量边缘接口
```

样式用 `app/assets/css/main.css` 里的 `--ea-*` token，约定见 `DESIGN.md`。

## 部署

Nitro preset 是 `cloudflare_module`，配置在 `wrangler.jsonc`。

```bash
npm run deploy
```

本地先看生产包：

```bash
npm run preview
```
