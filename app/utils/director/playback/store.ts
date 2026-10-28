/**
 * 运镜播放与时间轴的 UI 状态（复刻自 open-director 的 cameraPlaybackStore.ts，MIT）。
 *
 * 刻意不并进 directorStore：播放头每帧都在变，走 commit 的话每帧都要复制一份
 * 完整的 project，撤销栈也会被灌满 —— 撤销一次只退一帧。
 * 这里全是会话级 UI 状态，不进撤销、不随场景保存，所以用普通的 ref 就够，
 * 不需要那套不可变提交的机制。
 *
 * 和 directorStore 一样做成工厂：画布上可以有多个导演台节点，各自一条时间轴。
 */
import { computed, ref, shallowRef, type InjectionKey } from 'vue'

export interface PlaybackNodeSelection {
  cameraId: string
  nodeId: string
}

export interface PlaybackSegmentSelection {
  cameraId: string
  segmentId: string
}

export interface PlaybackHandleSelection {
  cameraId: string
  segmentId: string
  /** out 是起点那头的手柄，in 是终点那头的 */
  handle: 'out' | 'in'
}

/** 时间轴缩放：一秒占多少像素 */
export const MIN_TIMELINE_ZOOM = 20
export const MAX_TIMELINE_ZOOM = 320
export const DEFAULT_TIMELINE_ZOOM = 80

export function createCameraPlaybackStore() {
  const playheadTime = ref(0)
  const isPlaying = ref(false)
  const selectedNode = ref<PlaybackNodeSelection | null>(null)
  const selectedSegment = ref<PlaybackSegmentSelection | null>(null)
  const selectedHandle = ref<PlaybackHandleSelection | null>(null)
  const timelineZoom = ref(DEFAULT_TIMELINE_ZOOM)
  /** 导出录制中：这期间要挡住会打断录制的操作 */
  const isExporting = ref(false)
  /**
   * 视口的 canvas，由视口自己登记。
   *
   * 导出录制要对着这块画布开 captureStream。不用全局选择器找：一张画布上可以有
   * 好几个导演台节点，选择器会抓到第一个，录出来是别人的镜头。
   * three 的对象和 DOM 元素一律 shallowRef，别让 Vue 去深代理它。
   */
  const canvas = shallowRef<HTMLCanvasElement | null>(null)
  /** 视口登记的深度 / 白模渲染。彩色截图用不到 */
  const controlPass = shallowRef<((output: 'depth' | 'matte') => string) | null>(null)

  /** 三种选中互斥：时间轴上同时高亮一个节点和一段运动只会让人分不清在改哪个 */
  function clearSelection() {
    selectedNode.value = null
    selectedSegment.value = null
    selectedHandle.value = null
  }

  return {
    playheadTime: computed(() => playheadTime.value),
    isPlaying: computed(() => isPlaying.value),
    isExporting: computed(() => isExporting.value),
    canvas: computed(() => canvas.value),
    controlPass: computed(() => controlPass.value),
    selectedNode: computed(() => selectedNode.value),
    selectedSegment: computed(() => selectedSegment.value),
    selectedHandle: computed(() => selectedHandle.value),
    timelineZoom: computed(() => timelineZoom.value),

    setPlayheadTime: (time: number) => {
      playheadTime.value = Math.max(0, time)
    },
    play: () => {
      isPlaying.value = true
    },
    pause: () => {
      isPlaying.value = false
    },
    /** 停止并回到开头，和播放器上那个方块按钮一致 */
    stop: () => {
      isPlaying.value = false
      playheadTime.value = 0
    },
    setExporting: (value: boolean) => {
      isExporting.value = value
    },
    setCanvas: (element: HTMLCanvasElement | null) => {
      canvas.value = element
    },
    setControlPass: (fn: ((output: 'depth' | 'matte') => string) | null) => {
      controlPass.value = fn
    },

    selectNode: (selection: PlaybackNodeSelection | null) => {
      clearSelection()
      selectedNode.value = selection
    },
    selectSegment: (selection: PlaybackSegmentSelection | null) => {
      clearSelection()
      selectedSegment.value = selection
    },
    selectHandle: (selection: PlaybackHandleSelection | null) => {
      clearSelection()
      selectedHandle.value = selection
    },
    clearSelection,

    setTimelineZoom: (zoom: number) => {
      timelineZoom.value = Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoom))
    },
  }
}

export type CameraPlaybackStore = ReturnType<typeof createCameraPlaybackStore>

export const CAMERA_PLAYBACK_KEY: InjectionKey<CameraPlaybackStore> = Symbol('camera-playback')
