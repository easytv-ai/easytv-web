/**
 * 导演台中间视口的亮/暗影棚色。
 *
 * 场景里默认天空是 #000000，表示「跟着站点主题走」，不是永远纯黑。
 * 用户在右侧改过天空颜色之后，就按他们选的色画，不再跟主题切。
 */

export const DIRECTOR_STUDIO_DARK = {
  sky: '#161618',
  ground: '#303640',
  gridCell: '#2a3140',
  gridSection: '#3c5070',
  cameraLine: '#7dd3fc',
  cameraSelected: '#38bdf8',
  cameraFill: '#0ea5e9',
  cameraFrustumFill: '#38bdf8',
} as const

export const DIRECTOR_STUDIO_LIGHT = {
  sky: '#e4e4e7',
  ground: '#d4d4d8',
  gridCell: '#c4c4cc',
  gridSection: '#a1a1aa',
  cameraLine: '#1d4ed8',
  cameraSelected: '#1e3a8a',
  cameraFill: '#2563eb',
  cameraFrustumFill: '#2563eb',
} as const

export function isThemeLinkedBackground(color?: string | null) {
  const value = (color ?? '').trim().toLowerCase()
  return !value || value === '#000' || value === '#000000'
}

export function resolveDirectorStudioLook(isDark: boolean, backgroundColor?: string | null) {
  const preset = isDark ? DIRECTOR_STUDIO_DARK : DIRECTOR_STUDIO_LIGHT
  return {
    sky: isThemeLinkedBackground(backgroundColor) ? preset.sky : backgroundColor!.trim(),
    ground: preset.ground,
    gridCell: preset.gridCell,
    gridSection: preset.gridSection,
    cameraLine: preset.cameraLine,
    cameraSelected: preset.cameraSelected,
    cameraFill: preset.cameraFill,
    cameraFrustumFill: preset.cameraFrustumFill,
  }
}
