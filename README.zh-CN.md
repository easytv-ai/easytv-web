<div align="center">

# EasyTV Web

**[EasyTV](https://easytv.ai) 创作台 —— 开源的 AI 短剧创作平台。**

[![CI](https://github.com/easytv-ai/easytv-web/actions/workflows/ci.yml/badge.svg)](https://github.com/easytv-ai/easytv-web/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt.js&logoColor=white)](https://nuxt.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · [简体中文](README.zh-CN.md) · [线上站点](https://easytv.ai) · [后端](https://github.com/easytv-ai/easytv-api)

</div>

EasyTV Web 是创作者在浏览器里把一句话变成成片短剧的前端：节点画布承载剧本、分镜、图像、视频与音频；3D 导演台负责走位与机位；一句话成片流水线自动策划、生成、合成。

本仓库只包含页面、交互与静态资源。登录、生成、计费、存储由 [`easytv-api`](https://github.com/easytv-ai/easytv-api) 提供，运营后台在 [`easytv-manage`](https://github.com/easytv-ai/easytv-manage)。

## 亮点

- **自由画布** —— Vue Flow 节点覆盖文本、图像、视频、音频、合成，带版本历史、只读分享与 AI 助手面板。
- **一句话成片** —— 输入一句话，审阅策划案，分层生成，拿到带字幕与 BGM 的成片。
- **3D 导演台** —— TresJS / Three.js 场景摆放角色与机位，结果写回同一张画布。
- **浏览器内剪辑** —— FFmpeg.wasm 在本地完成裁剪、拆分、拼接，不经服务端。
- **社区** —— 探索流、关注、榜单、评论，每部作品有公开播放页。
- **技能与提示词** —— 可复用的技能模板与提示词库。
- **七种语言** —— 简体 / 繁体中文、英、法、日、俄、越。
- **边缘部署** —— Nuxt 4 + Cloudflare Workers 预设，也能跑在任意 Node 主机。

## 快速开始

需要 Node.js 22.5+ 与 [pnpm](https://pnpm.io) 10+（`corepack enable` 会安装 `package.json` 里锁定的版本）。

```bash
git clone https://github.com/easytv-ai/easytv-web.git
cd easytv-web
pnpm install
cp .env.example .env.development
pnpm dev          # http://localhost:3005
```

没有后端时首页、探索、技能广场可以打开，创作功能会弹出登录框。把 `NUXT_PUBLIC_API_BASE_URL` 指向运行中的 [`easytv-api`](https://github.com/easytv-ai/easytv-api)（默认 8383 端口）即可解锁全部功能。

## 配置

所有变量都是公开运行时配置（`NUXT_PUBLIC_*`）。开发读 `.env.development`，生产构建读 `.env.production`。两者都不入库，以 `.env.example` 为准。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NUXT_PUBLIC_API_BASE_URL` | 是 | `easytv-api` 地址 |
| `NUXT_PUBLIC_SITE_URL` | 生产必填 | 本站公开地址：canonical、sitemap、OG 图片 |
| `NUXT_PUBLIC_SITE_NAME` | 否 | 界面与 meta 里的站点名（默认 `EasyTV`） |
| `NUXT_PUBLIC_MEDIA_HOSTS` | 否 | 服务端媒体代理额外放行的域名，逗号分隔，如 OSS / CDN 域名。接口域名与本站域名默认放行。 |
| `NUXT_PUBLIC_CONTACT_EMAIL` | 否 | 协议 / 隐私 / AI 规范页展示的联系邮箱，留空不展示。 |

`/legal/*` 下的法务文案是示例文本，上线前请按自身业务与所在地法律审阅。

## 常用脚本

```bash
pnpm dev          # 开发，读 .env.development
pnpm build        # 生产构建，读 .env.production
pnpm generate     # 静态导出
pnpm typecheck    # vue-tsc
pnpm test             # vitest，覆盖 app/**/*.test.ts
pnpm preview      # 构建 + wrangler dev
pnpm deploy       # 构建 + wrangler deploy
```

## 路由

| 路径 | 说明 |
| --- | --- |
| `/agent` | 首页：创作入口 + 精选成片（`/` 301 到这里） |
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
| `/legal/*` | 协议、隐私、AI 规范 |

## 目录

```
app/
  api/           后端接口封装
  components/    画布、导演台、创作流程、设置
  composables/   登录、钱包、画布状态
  pages/         路由页面
  utils/         纯逻辑（画布、导演台、合成），单测主要在这
  middleware/    登录弹窗、控制台代登
  content/legal/ 法务文案
i18n/locales/    七个语种
public/          跟练素材、导演台模型（署名见 public/director-assets/README.md）
server/          robots、sitemap、媒体代理（server/utils/media-hosts.ts）
```

样式基于 Tailwind CSS 4 与 Nuxt UI，令牌 `--ea-*` 定义在 `app/assets/css/variables.css`，约定见 [`DESIGN.md`](DESIGN.md)。

## 部署

Nitro 预设是 `cloudflare_module`（`wrangler.jsonc`）：

```bash
cp .env.example .env.production   # 填生产值
pnpm deploy
```

要跑在 Node 服务器上，用 `NITRO_PRESET=node-server pnpm build` 构建，再 `node .output/server/index.mjs` 启动。

### Docker

每次推送 `master` 与每个版本标签都会向 GHCR 发布多架构镜像，所有 `NUXT_PUBLIC_*` 变量都可以在运行时设置：

```bash
docker run -d -p 3005:3005 \
  -e NUXT_PUBLIC_API_BASE_URL=https://api.example.com \
  -e NUXT_PUBLIC_SITE_URL=https://studio.example.com \
  ghcr.io/easytv-ai/easytv-web:latest
```

[`easytv-api`](https://github.com/easytv-ai/easytv-api) 里的 `docker-compose.yml` 用 `docker compose --profile full up -d` 可以一次拉起整套服务。

## 参与贡献

欢迎用中文或英文提 Issue 和 PR。工作流程、多语言规则与提交规范见 [CONTRIBUTING.md](CONTRIBUTING.md)，漏洞报告见 [SECURITY.md](SECURITY.md)，变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 相关项目

| 仓库 | 说明 |
| --- | --- |
| [easytv-api](https://github.com/easytv-ai/easytv-api) | Go 后端：鉴权、画布、智能体、合成、计费 |
| [easytv-manage](https://github.com/easytv-ai/easytv-manage) | 运营后台 |
| [easytv-website](https://github.com/easytv-ai/easytv-website) | 项目官网 |

## 开源协议

[GNU Affero General Public License v3.0](LICENSE)。

导演台是 [open-director](https://github.com/x1n9/open-director)（MIT）的 Vue 移植，文件头标注了对应的上游文件。`public/director-assets/` 下的 UE 素体模型单独授权，见同目录的 license 文件并保留署名。
