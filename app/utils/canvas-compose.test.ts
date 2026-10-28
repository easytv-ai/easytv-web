import { describe, expect, it } from 'vitest'
import {
  COMPOSE_MAX,
  COMPOSE_MIN,
  composeClipDuration,
  composeClipSeconds,
  composeEstimateSeconds,
  composeGuessAspect,
  composeNodeSize,
  composeOrder,
  composeReady,
  composeTimeline,
  type ComposeSource,
} from './canvas-compose'

const clip = (id: string, x: number, y: number, extra: Partial<ComposeSource> = {}): ComposeSource => ({
  id,
  assetId: Number(id.replace(/\D/g, '')) || 1,
  url: `https://cdn/${id}.mp4`,
  label: id,
  x,
  y,
  w: 320,
  h: 220,
  duration: 5,
  ...extra,
})

describe('composeReady', () => {
  it('要都是带资产的视频节点，且在 2~24 条之间', () => {
    const video = (assetId: number) => ({ kind: 'video', assetId })
    expect(composeReady([video(1)])).toBe(false)
    expect(composeReady([video(1), video(2)])).toBe(true)
    expect(composeReady([video(1), { kind: 'image', assetId: 2 }])).toBe(false)
    expect(composeReady([video(1), video(0)])).toBe(false)
    expect(composeReady(Array.from({ length: COMPOSE_MAX + 1 }, (_, i) => video(i + 1)))).toBe(false)
    expect(COMPOSE_MIN).toBe(2)
    expect(COMPOSE_MAX).toBe(24)
  })
})

describe('composeOrder / 时长 / 画幅', () => {
  it('阅读顺序与分镜组拼接相同：先按行、行内从左到右', () => {
    expect(composeOrder([clip('c', 700, 0), clip('a', 0, 0), clip('d', 0, 300), clip('b', 350, 0)]).map(item => item.id))
      .toEqual(['a', 'b', 'c', 'd'])
  })

  it('节点时长只认正数 params.duration', () => {
    expect(composeClipDuration({ duration: 8 })).toBe(8)
    expect(composeClipDuration({ duration: 0 })).toBe(0)
    expect(composeClipDuration({ duration: 'x' })).toBe(0)
    expect(composeClipDuration(null)).toBe(0)
  })

  it('没写时长的按 5 秒估总长', () => {
    expect(composeEstimateSeconds([{ duration: 4 }, { duration: 0 }, { duration: 3.2 }])).toBe(12.2)
  })

  it('入出点按成片时间线同一套规则裁切', () => {
    expect(composeClipSeconds({ duration: 8, trimIn: 1, trimOut: 4 })).toBe(3)
    expect(composeClipSeconds({ duration: 8, trimIn: 0, trimOut: 0 })).toBe(8)
    expect(composeEstimateSeconds([{ duration: 8, trimIn: 1, trimOut: 4 }, { duration: 5 }])).toBe(8)
  })

  it('画幅按节点比例猜，3:4 与 9:16 都走竖版', () => {
    expect(composeGuessAspect('9:16')).toBe('9:16')
    expect(composeGuessAspect('3:4')).toBe('9:16')
    expect(composeGuessAspect('1:1')).toBe('1:1')
    expect(composeGuessAspect('16:9')).toBe('16:9')
    expect(composeGuessAspect('')).toBe('16:9')
  })

  it('结果节点按成片画幅定高', () => {
    const wide = composeNodeSize('16:9')
    const tall = composeNodeSize('9:16')
    const square = composeNodeSize('1:1')
    expect(wide.w).toBeGreaterThan(wide.h)
    expect(tall.h).toBeGreaterThan(tall.w)
    expect(square.w).toBe(square.h)
  })
})

describe('composeTimeline', () => {
  it('按传入顺序写 clips，BGM 关掉时音量为 0', () => {
    const ordered = [clip('video-2', 400, 0, { assetId: 22, duration: 6 }), clip('video-1', 0, 0, { assetId: 11 })]
    const tl = composeTimeline(ordered, {
      aspect: '9:16',
      resolution: '1080p',
      subtitles: true,
      voice: false,
      lang: 'en',
      bgmAssetId: 0,
      bgmVolume: 0.4,
      preview: false,
      package: false,
    })
    expect(tl.aspect).toBe('9:16')
    expect(tl.resolution).toBe('1080p')
    expect(tl.subtitles).toBe(true)
    expect(tl.voice).toBe(false)
    expect(tl.lang).toBe('en')
    expect(tl.bgm_asset_id).toBe(0)
    expect(tl.bgm_volume).toBe(0)
    expect(tl.clips.map(item => item.node_id)).toEqual(['video-2', 'video-1'])
    expect(tl.clips.map(item => item.asset_id)).toEqual([22, 11])
    expect(tl.clips.every(item => item.enabled && item.voice_mode === 'off' && item.id.startsWith('c_'))).toBe(true)
    expect(tl.clips.every(item => item.in === 0 && item.out === 0)).toBe(true)
    expect(tl.subtitle_node_id).toBeUndefined()
  })

  it('入出点写进这次合成的时间线快照', () => {
    const tl = composeTimeline([clip('video-1', 0, 0, { assetId: 11, duration: 8, trimIn: 1.5, trimOut: 6 })], {
      aspect: '16:9',
      resolution: '1080p',
      subtitles: false,
      voice: true,
      lang: 'zh',
      bgmAssetId: 0,
      bgmVolume: 0.2,
      preview: false,
      package: false,
    })
    expect(tl.clips[0]!.in).toBe(1.5)
    expect(tl.clips[0]!.out).toBe(6)
  })

  it('有 BGM 和字幕节点时写进时间线', () => {
    const tl = composeTimeline([clip('video-1', 0, 0)], {
      aspect: '16:9',
      resolution: '720p',
      subtitles: true,
      voice: true,
      lang: 'zh',
      bgmAssetId: 88,
      bgmVolume: 0,
      subtitleNodeId: 'text-3',
      preview: true,
      package: false,
    })
    expect(tl.bgm_asset_id).toBe(88)
    expect(tl.bgm_volume).toBe(0.2)
    expect(tl.clips[0]!.voice_mode).toBe('mix')
    expect(tl.subtitle_node_id).toBe('text-3')
  })
})
