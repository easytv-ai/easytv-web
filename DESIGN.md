# Design Tokens

EasyTV Web styles everything through CSS custom properties. There is exactly
one place where colours, radii and shadows are defined:
[`app/assets/css/variables.css`](app/assets/css/variables.css). Business
styles reference `var(--…)` and never contain colour literals.

## Layers

| Layer | Prefix | Purpose |
| --- | --- | --- |
| Tailwind `@theme` | `--color-*` | Palette that generates utility classes. Neutral scale is Slate; brand colour is cyan `#18c1d6`. |
| Nuxt UI semantic tokens | `--ui-*` | Bridges Nuxt UI components to the palette (`--ui-primary`, `--ui-bg`, …). |
| Site tokens | `--ea-*` | Brand, surfaces, text, radii, shadows used by EasyTV components. Light and dark values live side by side. |
| Page tokens | `--models-*` | Scoped overrides for the model marketplace page; bridge back to `--ea-*`. |

Reference direction is top-down: `--ea-*` reads `--color-*`, never the other
way round. Changing the brand colour or the dark theme means editing
`variables.css` only.

## Principles

- **Light-first, dark-ready.** White canvas, hairline borders, soft shadows,
  brand colour reserved for calls to action and links. Dark mode is toggled by
  the `.dark` class on `<html>` and remembered in `localStorage` (`easytv-theme`).
- **Typography.** Geist Variable (self-hosted via `@fontsource-variable/geist`)
  with Inter and the system sans stack as fallbacks. Headings are tight,
  slightly negative letter-spacing; body text keeps default tracking.
- **Spacing and radius.** Tailwind's 4px scale; cards use `--ea-radius-lg`,
  controls `--ea-radius-md`. Avoid one-off pixel values.
- **Motion.** Theme switches run a clip-path wipe (`ea-theme-wipe`, 420 ms) and
  temporarily disable other transitions via `.theme-transition-disable` so
  large pages do not stutter.
- **Icons.** Lucide through Nuxt UI, plus `@lobehub/icons-static-svg` for model
  vendor marks.

## Adding a component

1. Pick existing `--ea-*` tokens. If none fits, add one to `variables.css`
   with both light and dark values and a short comment.
2. Use Nuxt UI primitives (`UButton`, `UModal`, …) where they exist; theme them
   through `app.config.ts` slots rather than overriding styles inline.
3. Keep copy in `i18n/locales/*.json` with structured keys (see
   [CONTRIBUTING.md](CONTRIBUTING.md#translations)).
4. Check both themes and a 375 px viewport before opening the pull request.
