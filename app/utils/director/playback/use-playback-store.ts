/** 播放 store 的 provide / inject，理由同 use-director-store */
import { inject, provide } from 'vue'
import { CAMERA_PLAYBACK_KEY, type CameraPlaybackStore } from './store'

export function provideCameraPlaybackStore(store: CameraPlaybackStore) {
  provide(CAMERA_PLAYBACK_KEY, store)
}

export function useCameraPlaybackStore(): CameraPlaybackStore {
  const store = inject(CAMERA_PLAYBACK_KEY, null)
  if (!store)
    throw new Error('[director] 组件不在导演台里：外层要先 provideCameraPlaybackStore')
  return store
}
