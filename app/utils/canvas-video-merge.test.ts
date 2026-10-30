import { describe, expect, it } from 'vitest'
import {
  isMergeResult,
  mergeConcatScript,
  mergeDurationShort,
  mergeReadableUrl,
  mergeReencodeArgs,
  mergeResultOrigin,
  mergeShotIndex,
  mergeToTsArgs,
  mergeTsConcatArgs,
  mergeVideoOrder,
  parseClockDuration,
  forwardMergeProgress,
} from './canvas-video-merge'

describe('mergeVideoOrder', () => {
  it('有分镜序号时按序号，没有序号的排在后面', () => {
    const items = [
      { id: 'c', shotIndex: undefined, x: 0, y: 0 },
      { id: 'b', shotIndex: 2, x: 0, y: 400 },
      { id: 'a', shotIndex: 1, x: 800, y: 0 },
    ]
    expect(mergeVideoOrder(items).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('没有序号时先按从上到下，再从左到右', () => {
    const items = [
      { id: 'c', x: 10, y: 200 },
      { id: 'b', x: 400, y: 0 },
      { id: 'a', x: 0, y: 0 },
    ]
    expect(mergeVideoOrder(items).map(item => item.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeReadableUrl', () => {
  const origin = 'http://localhost:3005'

  it('OSS 地址改走本站代理', () => {
    const url = 'https://tv-oss.easyapi.com/easytv/a.mp4'
    expect(mergeReadableUrl(url, origin)).toBe(`/api/canvas-media?url=${encodeURIComponent(url)}`)
  })

  it('本站、blob 和 data 保持原地址', () => {
    expect(mergeReadableUrl('/videos/a.mp4', origin)).toBe(`${origin}/videos/a.mp4`)
    expect(mergeReadableUrl('blob:http://localhost:3005/abc', origin)).toBe('blob:http://localhost:3005/abc')
    expect(mergeReadableUrl('data:video/mp4;base64,AA', origin)).toBe('data:video/mp4;base64,AA')
  })
})

describe('isMergeResult', () => {
  it('已有成片地址的拼接结果不再当生成节点', () => {
    expect(isMergeResult({
      content: 'https://tv-oss.easyapi.com/easytv/a.mp4',
      params: { videoEditOperation: 'concat' },
    })).toBe(true)
    expect(isMergeResult({ content: '', params: { videoEditOperation: 'concat' } })).toBe(false)
    expect(isMergeResult({ content: 'https://tv-oss.easyapi.com/easytv/a.mp4', params: {} })).toBe(false)
  })
})

describe('mergeShotIndex', () => {
  it('预演帧序号优先于参数', () => {
    expect(mergeShotIndex({ previewFrame: { shotIndex: 3 }, params: { shotIndex: 1 } })).toBe(3)
  })

  it('没有序号时不编一个', () => {
    expect(mergeShotIndex({ params: {} })).toBeUndefined()
    expect(mergeShotIndex(null)).toBeUndefined()
  })
})

describe('concat 参数', () => {
  it('成片再拼接时先收成连续时间轴', () => {
    expect(mergeConcatScript(['input-0.mp4', 'input-1.mp4'])).toBe("file 'input-0.mp4'\nfile 'input-1.mp4'")
    expect(mergeToTsArgs('input-0.mp4', 'part-0.ts', 'h264_mp4toannexb')).toEqual([
      '-fflags', '+genpts', '-i', 'input-0.mp4', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
      '-bsf:v', 'h264_mp4toannexb', '-muxdelay', '0', '-muxpreload', '0', '-f', 'mpegts', 'part-0.ts',
    ])
    expect(mergeTsConcatArgs(['part-0.ts', 'part-1.ts'], true)).toEqual([
      '-i', 'concat:part-0.ts|part-1.ts', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
      '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', 'merged.mp4',
    ])
  })

  it('转码时每段从零计时', () => {
    const withAudio = mergeReencodeArgs(['input-0.mp4', 'input-1.mp4'], true)
    const silent = mergeReencodeArgs(['input-0.mp4', 'input-1.mp4'], false)
    expect(withAudio[withAudio.indexOf('-filter_complex') + 1]).toContain('concat=n=2:v=1:a=1[v][a]')
    expect(silent[silent.indexOf('-filter_complex') + 1]).toContain('concat=n=2:v=1:a=0[v]')
    expect(withAudio[withAudio.indexOf('-filter_complex') + 1]).toContain('setpts=PTS-STARTPTS')
  })

  it('成片时长明显短于各段之和时判定没接上', () => {
    expect(parseClockDuration('Duration: 00:00:12.50, start: 0.000000')).toBe(12.5)
    expect(mergeDurationShort([5, 5, 5, 5, 5], 20)).toBe(true)
    expect(mergeDurationShort([5, 5, 5, 5], 20)).toBe(false)
    expect(mergeDurationShort([5, 5, 5, 5, 5], 24.8)).toBe(false)
    expect(mergeDurationShort([0, 0], 0)).toBe(false)
  })

  it('进度百分比不会往回跳', () => {
    expect(forwardMergeProgress(null, 55)).toBe(55)
    expect(forwardMergeProgress(99, 55)).toBe(99)
    expect(forwardMergeProgress(55, 72)).toBe(72)
  })

  it('成片落在最右侧视频的右边', () => {
    expect(mergeResultOrigin([
      { x: 0, y: 40, w: 200 },
      { x: 300, y: 0, w: 180 },
    ])).toEqual({ x: 600, y: 0 })
  })
})
