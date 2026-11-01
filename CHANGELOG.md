# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Dockerfile` (Node server preset, runtime-configurable `NUXT_PUBLIC_*`) and multi-arch images on GHCR.
- `SUPPORT.md`, release-notes categories (`.github/release.yml`), label sync, stale bot, Conventional Commits PR-title check and OpenSSF Scorecard workflow.
- Open-source governance: AGPL-3.0 license, contributing guide, code of
  conduct, security policy, issue and pull request templates, Dependabot and
  GitHub Actions CI.
- `NUXT_PUBLIC_MEDIA_HOSTS` and `NUXT_PUBLIC_CONTACT_EMAIL` runtime configuration for self-hosters.

### Changed

- Server-side media proxies build their allow-list from runtime configuration instead of hard-coded easytv.ai / easyapi.com hosts.
- Legal pages read the contact address from configuration instead of a hard-coded mailbox.
- Single package manager (pnpm, `pnpm-lock.yaml`); removed the stale `package-lock.json` and `yarn.lock`, editor configs, build output and the hosted site's search-engine verification file from git.
- README rewritten for contributors and self-hosters (English + 简体中文); `DESIGN.md` replaced by a token reference for this project.

[Unreleased]: https://github.com/easytv-ai/easytv-web/commits/master
