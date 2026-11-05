<div align="center">

# EasyTV Web

**Creator studio of [EasyTV](https://easytv.ai) — the open-source AI short-drama platform.**

[![CI](https://github.com/easytv-ai/easytv-web/actions/workflows/ci.yml/badge.svg)](https://github.com/easytv-ai/easytv-web/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![License: Commercial](https://img.shields.io/badge/License-Commercial-orange.svg)](COMMERCIAL-LICENSE.md)
[![Nuxt 4](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt.js&logoColor=white)](https://nuxt.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](README.md) · [简体中文](README.zh-CN.md) · [Live site](https://easytv.ai) · [Backend](https://github.com/easytv-ai/easytv-api)

</div>

EasyTV Web is the browser front end where creators turn a one-line idea into a
finished short drama: a node-based canvas for scripts, storyboards, images,
video and audio; a 3D director stage for blocking and camera work; and a
one-sentence-to-film pipeline that plans, generates and composes automatically.

This repository contains pages, interactions and static assets only. Login,
generation, billing and storage are served by
[`easytv-api`](https://github.com/easytv-ai/easytv-api); the admin console is
[`easytv-manage`](https://github.com/easytv-ai/easytv-manage).

## Highlights

- **Free canvas** — Vue Flow nodes for text, image, video, audio and compose
  steps, with version history, read-only sharing and an AI assistant panel.
- **One-sentence-to-film** — type a premise, review the plan, generate layer by
  layer, get a composed film with subtitles and BGM.
- **3D director stage** — TresJS / Three.js scene for staging characters and
  cameras, written back into the same canvas.
- **In-browser editing** — FFmpeg.wasm trims, splits and concatenates clips
  without a round-trip to the server.
- **Community** — explore feed, follows, rankings, comments and a public
  player page per work.
- **Skills & prompts** — reusable skill templates and a prompt library.
- **Seven locales** — Simplified / Traditional Chinese, English, French,
  Japanese, Russian, Vietnamese.
- **Edge-ready** — Nuxt 4 with the Cloudflare Workers preset; also runs on any
  Node host.

## Quick Start

Requires Node.js 22.5+ and [pnpm](https://pnpm.io) 10+ (`corepack enable` installs the pinned version).

```bash
git clone https://github.com/easytv-ai/easytv-web.git
cd easytv-web
pnpm install
cp .env.example .env.development
pnpm dev          # http://localhost:3005
```

Without a backend the public pages (home, explore, skills) render; creation
features open a sign-in dialog. Point `NUXT_PUBLIC_API_BASE_URL` at a running
[`easytv-api`](https://github.com/easytv-ai/easytv-api) (default port 8383) to
enable everything.

## Configuration

All variables are public runtime config (`NUXT_PUBLIC_*`). Development reads
`.env.development`, production builds read `.env.production`. Never commit
either; `.env.example` is the reference.

| Variable | Required | Description |
| --- | --- | --- |
| `NUXT_PUBLIC_API_BASE_URL` | yes | Base URL of `easytv-api` |
| `NUXT_PUBLIC_SITE_URL` | yes in prod | Public URL of this site: canonical links, sitemap, Open Graph images |
| `NUXT_PUBLIC_SITE_NAME` | no | Site name in UI and meta tags (default `EasyTV`) |
| `NUXT_PUBLIC_MEDIA_HOSTS` | no | Extra hostnames (comma separated) the server-side media proxy may fetch, e.g. your OSS / CDN domain. The API and site hosts are always allowed. |
| `NUXT_PUBLIC_CONTACT_EMAIL` | no | Contact address shown on the terms, privacy and AI-guidelines pages. Empty hides the address. |

The legal pages under `/legal/*` are sample texts. Review them against your own
business and jurisdiction before going live.

## Scripts

```bash
pnpm dev          # dev server, reads .env.development
pnpm build        # production build, reads .env.production
pnpm generate     # static export
pnpm typecheck    # vue-tsc
pnpm test             # vitest, app/**/*.test.ts
pnpm preview      # build + wrangler dev
pnpm deploy       # build + wrangler deploy
```

## Routes

| Path | Description |
| --- | --- |
| `/agent` | Home: creation entry + featured works (`/` redirects here) |
| `/explore` `/studio` `/following` `/rank` | Feed, recommendations, following, rankings |
| `/create` | One-sentence-to-film: premise → plan → layered generation → compose |
| `/canvas` | Free canvas. `?id=` opens a canvas, `?project_id=` creates one in a project |
| `/canvas/director` | 3D director stage, writes back to the same canvas |
| `/projects` `/assets` `/subjects` `/prompts` | Projects and libraries |
| `/skills` | Skill marketplace / mine / created by me |
| `/campaign` | Campaigns |
| `/watch/:id` | Public player |
| `/settings` | Account, team, orders, invoices, invites |
| `/pricing` | Plans |
| `/legal/*` | Terms, privacy, AI guidelines |

## Project Layout

```
app/
  api/           typed wrappers around the backend
  components/    canvas, director, creation flow, settings
  composables/   auth, wallet, canvas state
  pages/         routes
  utils/         pure logic (canvas, director, compose) – most unit tests live here
  middleware/    sign-in dialog, console impersonation
  content/legal/ legal copy
i18n/locales/    seven locale files
public/          tutorials, director assets (see public/director-assets/README.md for attribution)
server/          robots, sitemap, media proxies (server/utils/media-hosts.ts)
```

Styling uses Tailwind CSS 4 and Nuxt UI on top of the `--ea-*` design tokens
defined in `app/assets/css/variables.css`; see [`DESIGN.md`](DESIGN.md).

## Deployment

The Nitro preset is `cloudflare_module` (`wrangler.jsonc`):

```bash
cp .env.example .env.production   # fill in production values
pnpm deploy
```

To run on a Node server instead, build with `NITRO_PRESET=node-server pnpm build`
and start `node .output/server/index.mjs`.

### Docker

A multi-arch image is published to GHCR on every push to `master` and every
release tag. All `NUXT_PUBLIC_*` variables can be set at run time:

```bash
docker run -d -p 3005:3005 \
  -e NUXT_PUBLIC_API_BASE_URL=https://api.example.com \
  -e NUXT_PUBLIC_SITE_URL=https://studio.example.com \
  ghcr.io/easytv-ai/easytv-web:latest
```

The `docker-compose.yml` in [`easytv-api`](https://github.com/easytv-ai/easytv-api)
starts the whole stack with `docker compose --profile full up -d`.

## Contributing

Issues and pull requests are welcome, in English or Chinese. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the i18n rules and commit
conventions, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
Release notes live in [CHANGELOG.md](CHANGELOG.md).

## Related Projects

| Repository | Description |
| --- | --- |
| [easytv-api](https://github.com/easytv-ai/easytv-api) | Go backend: auth, canvas, agent, compose, billing |
| [easytv-manage](https://github.com/easytv-ai/easytv-manage) | Admin console |
| [easytv-website](https://github.com/easytv-ai/easytv-website) | Project website |

## License

EasyTV Web is **dual-licensed**:

| You want to… | Use |
| --- | --- |
| Study, modify, or self-host and you will follow AGPL-3.0 (including publishing corresponding source if you offer a modified version as a network service) | [GNU Affero GPL v3.0](LICENSE) |
| Ship a closed-source product, or host a modified version as SaaS / white-label **without** those AGPL obligations | [Commercial License](COMMERCIAL-LICENSE.md) |

The commercial terms in the repo are a template. They apply only after you and
the EasyTV copyright holders sign an Order. Write to
[leida@easyapi.com](mailto:leida@easyapi.com) with `[LICENSE] easytv-web` in
the subject. [简体中文译本](COMMERCIAL-LICENSE.zh-CN.md) is provided for
convenience; the English text governs.

The director stage is a Vue port of [open-director](https://github.com/x1n9/open-director)
(MIT); file headers reference the upstream files. The UE mannequin model in
`public/director-assets/` is licensed separately — see the license file beside
it and keep the attribution. A commercial license does not relicense those
third-party parts.
