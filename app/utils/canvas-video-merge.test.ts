import { describe, expect, it } from 'vitest'
import {
  isMergeResult,
  mergeConcatScript,
  concatOutputTruncated,
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
  trimCopyArgs,
  trimVideoArgs,
  ffmpegClock,
  splitRanges,
  SPLIT_MAX_PARTS,
  extractAudioArgs,
  muteVideoCopyArgs,
  mixBgmFilter,
  mixBgmFade,
  mixBgmVolume,
  mixBgmArgs,
  parseSilenceIntervals,
  keepRanges,
  silenceSelectExpr,
  MIX_BGM_VOLUME_DEFAULT,
  silenceDetectArgs,
  isWholeClipSilence,
  clampCropRect,
  videoCropFilter,
  videoCropArgs,
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

describe('trimVideoArgs', () => {
  it('按起止秒裁切，没有音轨时去掉音频', () => {
    expect(ffmpegClock(1.2)).toBe('1.200')
    expect(trimVideoArgs('cut-in.mp4', 'cut-out.mp4', 1.25, 4.5, true)).toEqual([
      '-i', 'cut-in.mp4',
      '-ss', '1.250',
      '-to', '4.500',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      'cut-out.mp4',
    ])
    expect(trimVideoArgs('cut-in.mp4', 'cut-out.mp4', 0, 2, false)).toContain('-an')
    expect(trimCopyArgs('cut-in.mp4', 'cut-out.mp4', 1.25, 4.5)).toEqual([
      '-ss', '1.250',
      '-to', '4.500',
      '-i', 'cut-in.mp4',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      'cut-out.mp4',
    ])
  })
})

describe('splitRanges', () => {
  it('每个分割点切开一段，首尾相接，顺序就是节点顺序', () => {
    expect(splitRanges([0.5], 10)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ])
    expect(splitRanges([0.75, 0.25], 8)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 6 },
      { start: 6, end: 8 },
    ])
  })

  it('贴边、太密或没有分割点时不切', () => {
    expect(splitRanges([0.01], 10)).toBeNull()
    expect(splitRanges([0.99], 10)).toBeNull()
    expect(splitRanges([], 10)).toBeNull()
    expect(splitRanges([0.5], 0.4)).toBeNull()
    expect(splitRanges([0.5, 0.52], 10)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ])
  })

  it('超过上限时只保留前若干段', () => {
    const ratios = Array.from({ length: 20 }, (_, index) => (index + 1) / 21)
    const ranges = splitRanges(ratios, 21)
    expect(ranges).toHaveLength(SPLIT_MAX_PARTS)
    expect(ranges?.[0]).toEqual({ start: 0, end: 1 })
    expect(ranges?.[SPLIT_MAX_PARTS - 1]?.end).toBe(21)
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

  it('只在体积还停在第一段时才当没接上', () => {
    expect(concatOutputTruncated(5_000_000, [5_000_000, 5_000_000])).toBe(true)
    expect(concatOutputTruncated(9_800_000, [5_000_000, 5_000_000])).toBe(false)
    expect(concatOutputTruncated(12_000_000, [5_000_000, 5_000_000, 5_000_000])).toBe(false)
    expect(concatOutputTruncated(0, [5_000_000, 5_000_000])).toBe(false)
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

describe('分离音轨 / 配乐参数', () => {
  it('抽音轨去掉画面，无声视频优先拷贝画面', () => {
    expect(extractAudioArgs('in.mp4', 'audio.m4a')).toEqual([
      '-i', 'in.mp4', '-vn', '-c:a', 'aac', '-b:a', '192k', 'audio.m4a',
    ])
    expect(muteVideoCopyArgs('in.mp4', 'mute.mp4')).toContain('-an')
    expect(muteVideoCopyArgs('in.mp4', 'mute.mp4')).toContain('-c:v')
  })

  it('有原声时混音，没有原声只留配乐', () => {
    const withAudio = mixBgmFilter(true, 0.2, 8, 2)
    expect(withAudio).toContain('[0:a][bg]amix')
    expect(withAudio).toContain('volume=0.20')
    const musicOnly = mixBgmFilter(false, 0.2, 8, 2)
    expect(musicOnly).not.toContain('amix')
    expect(musicOnly).not.toContain('[0:a]')
  })

  it('配乐音量和尾部淡出跟服务端口径一致', () => {
    expect(mixBgmVolume()).toBe(MIX_BGM_VOLUME_DEFAULT)
    expect(mixBgmVolume(0)).toBe(0.05)
    expect(mixBgmVolume(3)).toBe(1)
    expect(mixBgmFade(10)).toEqual({ start: 8, length: 2 })
    const short = mixBgmFade(2)
    expect(short.start).toBeGreaterThanOrEqual(0)
    expect(short.start + short.length).toBeLessThanOrEqual(2.01)
    const args = mixBgmArgs('v.mp4', 'a.m4a', 'filter', '[a]', 'out.mp4', 10, true)
    expect(args).toContain('-stream_loop')
    expect(args).toContain('-t')
    expect(args[args.indexOf('-t') + 1]).toBe('10.000')
  })
})

describe('去停顿区间', () => {
  it('从 silencedetect 日志解析静音，并按 pad 算出保留段', () => {
    const log = '[silencedetect @ 0x1] silence_start: 1.25\n[silencedetect @ 0x1] silence_end: 2.75 | silence_duration: 1.5\n[silencedetect @ 0x1] silence_start: 3.9\n'
    const silences = parseSilenceIntervals(log, 4)
    expect(silences).toEqual([
      { start: 1.25, end: 2.75 },
      { start: 3.9, end: 4 },
    ])
    const keep = keepRanges(silences, 4, 0.15)
    expect(keep).toEqual([
      { start: 0, end: 1.4 },
      { start: 2.6, end: 4 },
    ])
    expect(silenceSelectExpr(keep!)).toBe('between(t,0.000,1.400)+between(t,2.600,4.000)')
    expect(keepRanges([], 4, 0.15)).toBeNull()
  })

  it('检测阈值必须是负数 dB，不能被时间格式夹成 0', () => {
    const args = silenceDetectArgs('in.mp4')
    const filter = args[args.indexOf('-af') + 1]
    expect(filter).toContain('noise=-35.000dB')
    expect(filter).not.toContain('noise=0.000dB')
    expect(filter).toContain('d=0.600')
  })

  it('整段都被判成静音时不当真去停顿', () => {
    expect(isWholeClipSilence([{ start: 0, end: 8 }], 8)).toBe(true)
    expect(isWholeClipSilence([{ start: 1.25, end: 2.75 }], 8)).toBe(false)
    expect(isWholeClipSilence([{ start: 0, end: 8 }, { start: 9, end: 10 }], 10)).toBe(false)
  })
})

describe('画面裁切滤镜', () => {
  it('归一化框夹到画面内，滤镜按偶数像素裁', () => {
    expect(clampCropRect({ x: -1, y: 0.2, w: 2, h: 0.5 })).toEqual({ x: 0, y: 0.2, w: 1, h: 0.5 })
    const filter = videoCropFilter({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })
    expect(filter).toContain('trunc(iw*0.500000/2)*2')
    expect(filter).toContain('trunc(ih*0.400000/2)*2')
    expect(videoCropArgs('in.mp4', 'out.mp4', filter, true)).toContain('-vf')
    expect(videoCropArgs('in.mp4', 'out.mp4', filter, false)).toContain('-an')
  })
})
