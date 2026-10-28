import { describe, expect, it } from 'vitest'
import { createCameraPlaybackStore, MAX_TIMELINE_ZOOM, MIN_TIMELINE_ZOOM } from './store'

describe('createCameraPlaybackStore', () => {
  it('播放头不会退到负数 —— 时间轴往左拖过头时会传进负值', () => {
    const store = createCameraPlaybackStore()
    store.setPlayheadTime(-5)
    expect(store.playheadTime.value).toBe(0)
  })

  it('停止要同时暂停并归零', () => {
    const store = createCameraPlaybackStore()
    store.play()
    store.setPlayheadTime(3)
    store.stop()
    expect(store.isPlaying.value).toBe(false)
    expect(store.playheadTime.value).toBe(0)
  })

  it('暂停只停不归零', () => {
    const store = createCameraPlaybackStore()
    store.play()
    store.setPlayheadTime(3)
    store.pause()
    expect(store.isPlaying.value).toBe(false)
    expect(store.playheadTime.value).toBe(3)
  })

  it('三种选中互斥', () => {
    const store = createCameraPlaybackStore()
    store.selectNode({ cameraId: 'c', nodeId: 'n' })
    expect(store.selectedNode.value).not.toBeNull()

    store.selectSegment({ cameraId: 'c', segmentId: 's' })
    expect(store.selectedNode.value).toBeNull()
    expect(store.selectedSegment.value).not.toBeNull()

    store.selectHandle({ cameraId: 'c', segmentId: 's', handle: 'out' })
    expect(store.selectedSegment.value).toBeNull()
    expect(store.selectedHandle.value).not.toBeNull()

    store.clearSelection()
    expect(store.selectedHandle.value).toBeNull()
  })

  it('缩放被夹在上下限内', () => {
    const store = createCameraPlaybackStore()
    store.setTimelineZoom(1)
    expect(store.timelineZoom.value).toBe(MIN_TIMELINE_ZOOM)
    store.setTimelineZoom(9999)
    expect(store.timelineZoom.value).toBe(MAX_TIMELINE_ZOOM)
  })

  it('两个实例互不干扰 —— 一张画布上可以有好几个导演台', () => {
    const a = createCameraPlaybackStore()
    const b = createCameraPlaybackStore()
    a.play()
    a.setPlayheadTime(2)
    expect(b.isPlaying.value).toBe(false)
    expect(b.playheadTime.value).toBe(0)
  })
})
