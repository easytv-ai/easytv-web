import { shallowRef } from 'vue'
import type { CanvasLiveViewport } from './canvas-live-viewport'

/** 线层读这份相机。平移时跟世界层同一组数，不经过 Vue 的视口提交。 */
export type CanvasEdgeCamera = {
  x: number
  y: number
  zoom: number
  moving: boolean
}

export const canvasEdgeCamera = shallowRef<CanvasEdgeCamera>({ x: 0, y: 0, zoom: 1, moving: false })

let drawer: ((camera: CanvasEdgeCamera) => void) | null = null

export function bindCanvasEdgeDrawer(fn: ((camera: CanvasEdgeCamera) => void) | null) {
  drawer = fn
}

export function publishCanvasEdgeCamera(vp: CanvasLiveViewport, moving: boolean) {
  const zoom = vp.zoom || 1
  const cur = canvasEdgeCamera.value
  if (cur.x === vp.x && cur.y === vp.y && cur.zoom === zoom && cur.moving === moving)
    return
  canvasEdgeCamera.value = { x: vp.x, y: vp.y, zoom, moving }
}

/** 同步描一帧。挂在平移写 DOM 的同一拍里，线才不会比卡片晚一帧。 */
export function paintCanvasEdgeCamera() {
  drawer?.(canvasEdgeCamera.value)
}
