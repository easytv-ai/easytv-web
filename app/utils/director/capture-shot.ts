/**
 * 把当前视口画面记到指定机位上。
 * 视口工具条和机位面板共用这一条，避免两处各写一遍 toDataURL。
 */
export type CaptureShotResult = 'ok' | 'viewport-not-ready' | 'no-camera' | 'tainted' | 'rejected'

export function captureActiveCameraShot(input: {
  canvas: { toDataURL: (type: string) => string } | null
  cameraId: string | null | undefined
  addCaptures: (cameraId: string, dataUrls: string[]) => boolean | void
}): CaptureShotResult {
  if (!input.canvas)
    return 'viewport-not-ready'
  if (!input.cameraId)
    return 'no-camera'
  try {
    const saved = input.addCaptures(input.cameraId, [input.canvas.toDataURL('image/png')])
    if (saved === false)
      return 'rejected'
    return 'ok'
  }
  catch {
    return 'tainted'
  }
}
