import { describe, expect, it, vi } from 'vitest'
import { capturePreviewFrames, readPreviewFrames } from './preview-capture'
import type { PreviewFramePlan } from './preview-frames'

function frame(shotIndex: number, time: number): PreviewFramePlan {
  return { shotIndex, time, label: `镜子${shotIndex + 1}-${time.toFixed(2)}s.png` }
}

describe('预演帧读取', () => {
  it('先拨播放头再等画面，然后才读像素', async () => {
    const order: string[] = []
    const frames = await readPreviewFrames({
      frames: [frame(0, 0), frame(0, 2)],
      seek: (time) => { order.push(`seek:${time}`) },
      settle: async () => { order.push('settle') },
      read: () => {
        order.push('read')
        return `data:${order.length}`
      },
    })
    expect(order).toEqual(['seek:0', 'settle', 'read', 'seek:2', 'settle', 'read'])
    expect(frames.map(item => item.dataUrl)).toEqual(['data:3', 'data:6'])
    expect(frames[1]!.label).toBe('镜子1-2.00s.png')
  })

  it('没有运镜节点时不截图', async () => {
    const seek = vi.fn()
    const result = await capturePreviewFrames({
      camera: { nodes: [] },
      playback: {
        canvas: { value: { toDataURL: () => 'data:image/png,x' } },
        pause: () => {},
        setPlayheadTime: seek,
        setExporting: () => {},
      },
      setViewMode: () => {},
      previousViewMode: 'director',
    })
    expect(result).toEqual({ ok: false, message: '先在机位视角按 K 记一个运镜节点' })
    expect(seek).not.toHaveBeenCalled()
  })

  it('视口还没挂上画布时不截图', async () => {
    const result = await capturePreviewFrames({
      camera: { nodes: [{ id: 'a', time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], fov: 50 }] },
      playback: {
        canvas: { value: null },
        pause: () => {},
        setPlayheadTime: () => {},
        setExporting: () => {},
      },
      setViewMode: () => {},
      previousViewMode: 'director',
    })
    expect(result).toEqual({ ok: false, message: '视口还没准备好' })
  })

  it('间隔采样按计划拨播放头，一镜超过 6 帧就抽成 6 帧', async () => {
    const seek = vi.fn()
    const result = await capturePreviewFrames({
      camera: {
        nodes: [
          { id: 'a', time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], fov: 50 },
          { id: 'b', time: 2, position: [0, 0, 2], rotation: [0, 0, 0, 1], fov: 50 },
        ],
      },
      sampling: { mode: 'interval', seconds: 0.25 },
      settle: async () => {},
      playback: {
        canvas: { value: { toDataURL: () => 'data:image/png,x' } },
        pause: () => {},
        setPlayheadTime: seek,
        setExporting: () => {},
      },
      setViewMode: () => {},
      previousViewMode: 'director',
    })
    expect(result.ok).toBe(true)
    expect(seek.mock.calls.map(call => call[0])).toEqual([0, 0.4, 0.8, 1.2, 1.6, 2])
  })

  it('深度没有渲染函数时不截图，有了就改文件名', async () => {
    const camera = {
      nodes: [{
        id: 'a',
        time: 0,
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        fov: 50,
      }],
    }
    const playback = {
      canvas: { value: { toDataURL: () => 'data:image/png,color' } },
      pause: () => {},
      setPlayheadTime: () => {},
      setExporting: () => {},
    }
    const missing = await capturePreviewFrames({
      camera,
      output: 'depth',
      settle: async () => {},
      playback,
      setViewMode: () => {},
      previousViewMode: 'director',
    })
    expect(missing).toEqual({ ok: false, message: '视口还没准备好' })

    const result = await capturePreviewFrames({
      camera,
      output: 'depth',
      settle: async () => {},
      readPass: () => 'data:image/png,depth',
      playback,
      setViewMode: () => {},
      previousViewMode: 'director',
    })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.frames[0]!.label).toBe('镜子1-0.00s-深度.png')
  })

  it('取消后不再读后面的帧', async () => {
    const ctrl = new AbortController()
    const seek: number[] = []
    const pending = readPreviewFrames({
      frames: [frame(0, 0), frame(0, 1), frame(0, 2)],
      seek: (time) => {
        seek.push(time)
        if (time === 1)
          ctrl.abort()
      },
      settle: async () => {},
      read: () => 'data',
      signal: ctrl.signal,
    })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(seek).toEqual([0, 1])
  })

  it('截图被取消时写成已取消，不当成跨域失败', async () => {
    const ctrl = new AbortController()
    const result = await capturePreviewFrames({
      camera: {
        nodes: [
          { id: 'a', time: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], fov: 50 },
          { id: 'b', time: 2, position: [0, 0, 2], rotation: [0, 0, 0, 1], fov: 50 },
        ],
      },
      settle: async () => { ctrl.abort() },
      signal: ctrl.signal,
      playback: {
        canvas: { value: { toDataURL: () => 'data:image/png,x' } },
        pause: () => {},
        setPlayheadTime: () => {},
        setExporting: () => {},
      },
      setViewMode: () => {},
      previousViewMode: 'director',
    })
    expect(result).toEqual({ ok: false, message: '已取消导出预演' })
  })
})
