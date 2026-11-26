import { describe, expect, it } from 'vitest'
import {
  isOssSnapshotableUrl,
  ossImageDisplayUrl,
  ossVideoSnapshotUrl,
  videoCoverUrl,
  promptReverseFrameRanges,
  samplePromptReverseTimes,
  stripFrameTimes,
} from './canvas-video-frame'

describe('samplePromptReverseTimes', () => {
  it('时长为 0 只取首帧', () => {
    expect(samplePromptReverseTimes(0)).toEqual([0])
  })

  it('短片至少两帧且落在片内', () => {
    const times = samplePromptReverseTimes(3)
    expect(times.length).toBeGreaterThanOrEqual(2)
    expect(times[0]).toBe(0)
    expect(times.at(-1)!).toBeLessThan(3)
  })

  it('长片按约 2 秒一帧、不超过上限', () => {
    const times = samplePromptReverseTimes(20, 8)
    expect(times.length).toBe(8)
    expect(times[0]).toBe(0)
  })
})

describe('ossImageDisplayUrl', () => {
  it('公开图片缩小成 webp，视频和签名地址不动', () => {
    const src = 'https://tv-oss.easyapi.com/easytv/a.png'
    expect(ossImageDisplayUrl(src, 960)).toBe(
      `${src}?x-oss-process=image/resize,m_lfit,w_960/quality,q_70/format,webp`,
    )
    expect(ossImageDisplayUrl('https://tv-oss.easyapi.com/easytv/a.mp4')).toBe('https://tv-oss.easyapi.com/easytv/a.mp4')
    expect(ossImageDisplayUrl(`${src}?OSSAccessKeyId=x&Signature=y`)).toBe(`${src}?OSSAccessKeyId=x&Signature=y`)
    expect(ossImageDisplayUrl('/upload/a.png')).toBe('/upload/a.png')
  })
})

describe('ossVideoSnapshotUrl', () => {
  it('给公开 OSS 地址加上截帧参数', () => {
    const src = 'https://tv-oss.easyapi.com/easytv/a.mp4'
    expect(isOssSnapshotableUrl(src)).toBe(true)
    expect(ossVideoSnapshotUrl(src, 1.25, 240)).toBe(
      `${src}?x-oss-process=video/snapshot,t_1250,f_jpg,w_240,h_0,m_fast`,
    )
  })

  it('精确截帧不带 m_fast，避免短片被吸回首个关键帧', () => {
    const src = 'https://tv-oss.easyapi.com/easytv/a.mp4'
    expect(ossVideoSnapshotUrl(src, 2.7, 1280, 'accurate')).toBe(
      `${src}?x-oss-process=video/snapshot,t_2700,f_jpg,w_1280,h_0`,
    )
  })

  it('优先用现成封面，没有就截公开 OSS 的首帧', () => {
    const src = 'https://tv-oss.easyapi.com/easytv/a.mp4'
    expect(videoCoverUrl(src, 'https://cdn.example/cover.jpg')).toBe('https://cdn.example/cover.jpg')
    expect(videoCoverUrl(src, '')).toBe(ossVideoSnapshotUrl(src, 0.04, 160))
    expect(videoCoverUrl('/upload/a.mp4', '')).toBe('')
  })

  it('签名地址和 blob 不改', () => {
    expect(isOssSnapshotableUrl('https://tv-oss.easyapi.com/a.mp4?OSSAccessKeyId=x&Signature=y')).toBe(false)
    expect(ossVideoSnapshotUrl('blob:http://localhost/a', 1)).toBe('')
    expect(ossVideoSnapshotUrl('/upload/a.mp4', 1)).toBe('')
  })
})

describe('stripFrameTimes', () => {
  it('按时长均匀取样，首尾略内收', () => {
    expect(stripFrameTimes(10, 3)).toEqual([0, 4.9, 9.8])
    expect(stripFrameTimes(0, 4)).toEqual([0, 0, 0, 0])
  })
})

describe('promptReverseFrameRanges', () => {
  it('用相邻时刻中点切段并覆盖整段', () => {
    expect(promptReverseFrameRanges([0, 2, 4], 5)).toEqual([
      { index: 1, timeSec: 0, startSec: 0, endSec: 1 },
      { index: 2, timeSec: 2, startSec: 1, endSec: 3 },
      { index: 3, timeSec: 4, startSec: 3, endSec: 5 },
    ])
  })
})
