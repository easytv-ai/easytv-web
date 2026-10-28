import { describe, expect, it } from 'vitest'
import type { MediaAction, MediaOutput } from '~/types/creative'
import {
  MEDIA_ACTION_MISSING_REASON,
  MEDIA_BAR_ACTIONS,
  firstMediaOutput,
  mediaActionIfListed,
  mediaActionState,
  mediaBarItemState,
  mediaGridLayout,
  mediaJobTaskState,
  mediaOutputPatch,
  mediaOutputWarning,
  mediaOutputsOf,
  mediaSourceRef,
  pickMediaSourceNode,
  rangeToSeconds,
  ratioToSeconds,
  retakeSegmentOutputs,
  retakeSegmentRange,
  retakeSegmentSeconds,
  splitAvOutputs,
  storyboardOutputs,
} from './canvas-media-job'

const actions: MediaAction[] = [
  { action: 'trim', label: '片段截取', engine: 'local', source: ['video'], outputs: ['same'], available: true, free: true },
  { action: 'remove_subtitle', label: '智能去字幕', engine: 'model', source: ['video'], outputs: ['video'], available: false, reason: '暂未接入智能去字幕模型，请联系运营', free: false },
]

describe('mediaActionState', () => {
  it('清单还没拉到时按可用处理', () => {
    expect(mediaActionState([], 'trim')).toEqual({ available: true, reason: '', known: false })
    expect(mediaActionState(null, 'trim').available).toBe(true)
  })

  it('本地动作可用', () => {
    expect(mediaActionState(actions, 'trim')).toEqual({ available: true, reason: '', known: true })
  })

  it('没接模型的动作带后端原因', () => {
    expect(mediaActionState(actions, 'remove_subtitle')).toEqual({
      available: false,
      reason: '暂未接入智能去字幕模型，请联系运营',
      known: true,
    })
  })

  it('清单里没有的动作按未开放处理', () => {
    expect(mediaActionState(actions, 'matting')).toEqual({ available: false, reason: MEDIA_ACTION_MISSING_REASON, known: false })
  })

  it('工具条按钮按映射查，没映射的按钮永远可用', () => {
    expect(mediaBarItemState(actions, 'clip-cut').available).toBe(true)
    expect(mediaBarItemState(actions, 'box-subtitles').available).toBe(false)
    expect(mediaBarItemState(actions, 'download').available).toBe(true)
    expect(MEDIA_BAR_ACTIONS.depth).toBe('depth_extract')
    expect(MEDIA_BAR_ACTIONS['video-split']).toBe('split')
    expect(MEDIA_BAR_ACTIONS['grid-split']).toBe('grid_split')
    expect(MEDIA_BAR_ACTIONS['smart-extend']).toBe('extend')
    expect(mediaBarItemState(actions, 'depth').available).toBe(false)
    expect(mediaBarItemState([], 'depth').available).toBe(true)
  })

  it('独立接口：清单里没有这条就放行，有就听清单', () => {
    expect(mediaActionIfListed([], 'compose').available).toBe(true)
    expect(mediaActionIfListed(actions, 'compose').available).toBe(true)
    expect(mediaActionIfListed([
      ...actions,
      { action: 'compose', label: '合成一条', engine: 'existing', source: ['video'], outputs: ['video'], available: false, reason: '该功能已被关闭', free: false },
    ], 'compose')).toEqual({ available: false, reason: '该功能已被关闭', known: true })
  })

  it('主体动作按钮按映射查清单，没映射的按钮永远可用', () => {
    // 清单里没有 subject_remove → 未开放
    expect(mediaBarItemState(actions, 'remove-subject').available).toBe(false)
    // 没映射到动作的按钮永远可用
    expect(mediaBarItemState(actions, 'viral-remake').available).toBe(true)
  })
})

describe('比例 → 秒', () => {
  it('ratioToSeconds 乘时长并保留两位小数', () => {
    expect(ratioToSeconds(0.5, 10)).toBe(5)
    expect(ratioToSeconds(1 / 3, 10)).toBe(3.33)
  })

  it('比例越界会被夹到 0~1，时长无效按 0', () => {
    expect(ratioToSeconds(1.5, 10)).toBe(10)
    expect(ratioToSeconds(-1, 10)).toBe(0)
    expect(ratioToSeconds(0.5, Number.NaN)).toBe(0)
  })

  it('rangeToSeconds 时长未知或区间太短返回 null', () => {
    expect(rangeToSeconds({ start: 0.2, end: 0.6 }, 0)).toBeNull()
    expect(rangeToSeconds({ start: 0.2, end: 0.21 }, 5, 0.5)).toBeNull()
    expect(rangeToSeconds({ start: 0.2, end: 0.6 }, 10)).toEqual({ start: 2, end: 6 })
  })

  it('rangeToSeconds 起止倒置也能换算', () => {
    expect(rangeToSeconds({ start: 0.6, end: 0.2 }, 10)).toEqual({ start: 2, end: 6 })
  })

  it('retakeSegmentSeconds 用节点存的探测时长，段长不足 0.5 秒返回 null', () => {
    expect(retakeSegmentSeconds({ sourceId: 'v1', sourceLabel: '', start: 0.1, end: 0.5, total: 5, duration: 8 })).toEqual({ start: 0.8, end: 4 })
    expect(retakeSegmentSeconds({ sourceId: 'v1', sourceLabel: '', start: 0.1, end: 0.14, total: 5, duration: 8 })).toBeNull()
    expect(retakeSegmentSeconds({ sourceId: 'v1', sourceLabel: '', start: 0, end: 1, total: 5 })).toBeNull()
  })
})

describe('mediaJobTaskState', () => {
  it('0/1/2/-1 分别映射到 pending/running/succeeded/failed', () => {
    expect(mediaJobTaskState({ status: 0, progress: 0, error: '' })).toEqual({ taskStatus: 'pending', taskProgress: 0, taskError: '' })
    expect(mediaJobTaskState({ status: 1, progress: 40, error: '' })).toEqual({ taskStatus: 'running', taskProgress: 40, taskError: '' })
    expect(mediaJobTaskState({ status: 2, progress: 100, error: '' })).toEqual({ taskStatus: 'succeeded', taskProgress: 100, taskError: '' })
    expect(mediaJobTaskState({ status: -1, progress: 30, error: '这段素材没有音轨' })).toEqual({ taskStatus: 'failed', taskProgress: 30, taskError: '这段素材没有音轨' })
  })

  it('失败没带 error 时用兜底文案', () => {
    expect(mediaJobTaskState({ status: -1, progress: 0, error: '' }, '处理失败').taskError).toBe('处理失败')
  })
})

describe('outputs → 节点', () => {
  const outputs: MediaOutput[] = [
    { asset_id: 11, url: 'https://cdn/a.m4a', type: 'audio', name: 'a.m4a', label: '音轨' },
    { asset_id: 12, url: 'https://cdn/v.mp4', type: 'video', name: 'v.mp4', label: '无声' },
  ]

  it('mediaOutputsOf 兼容字符串与空 outputs，回退到 output_url', () => {
    expect(mediaOutputsOf({ outputs: JSON.stringify(outputs) as unknown as MediaOutput[], output_url: '', output_asset_id: 0 })).toHaveLength(2)
    expect(mediaOutputsOf({ outputs: null as unknown as MediaOutput[], output_url: 'https://cdn/x.mp4', output_asset_id: 9 })).toEqual([
      { asset_id: 9, url: 'https://cdn/x.mp4', type: '', name: '' },
    ])
    expect(mediaOutputsOf(null)).toEqual([])
  })

  it('mediaOutputPatch 写 content 与 assetId', () => {
    expect(mediaOutputPatch(outputs[0])).toEqual({ content: 'https://cdn/a.m4a', assetId: 11 })
    expect(mediaOutputPatch({ asset_id: 0, url: '', type: 'text', name: '', task_id: 5 })).toEqual({})
  })

  it('splitAvOutputs 分出音轨与无声视频', () => {
    const { audio, video } = splitAvOutputs(outputs)
    expect(audio?.asset_id).toBe(11)
    expect(video?.asset_id).toBe(12)
    expect(firstMediaOutput(outputs)?.asset_id).toBe(11)
  })

  it('storyboardOutputs 分出帧与解读任务', () => {
    const list: MediaOutput[] = [
      { asset_id: 1, url: 'https://cdn/f1.jpg', type: 'image', name: 'f1' },
      { asset_id: 2, url: 'https://cdn/f2.jpg', type: 'image', name: 'f2' },
      { asset_id: 0, url: '', type: 'text', name: '', label: '解读', task_id: 77 },
    ]
    expect(storyboardOutputs(list)).toEqual({ frames: list.slice(0, 2), analysisTaskId: 77 })
    expect(storyboardOutputs(list.slice(0, 2)).analysisTaskId).toBe(0)
  })

  it('retakeSegmentOutputs 第一条是成片，第二条是重拍片段', () => {
    const list: MediaOutput[] = [
      { asset_id: 1, url: 'https://cdn/full.mp4', type: 'video', name: 'full', label: '重拍成片' },
      { asset_id: 2, url: 'https://cdn/seg.mp4', type: 'video', name: 'seg', label: '重拍片段' },
    ]
    expect(retakeSegmentOutputs(list).full?.asset_id).toBe(1)
    expect(retakeSegmentOutputs(list).segment?.asset_id).toBe(2)
    expect(retakeSegmentOutputs([]).full).toBeNull()
  })
})

describe('mediaGridLayout', () => {
  it('4 帧排 2 列，6 帧排 3 列', () => {
    expect(mediaGridLayout(4, { x: 0, y: 0 }, { w: 100, h: 60 }, 10)).toEqual({
      cols: 2,
      rows: 2,
      positions: [{ x: 0, y: 0 }, { x: 110, y: 0 }, { x: 0, y: 70 }, { x: 110, y: 70 }],
    })
    expect(mediaGridLayout(6, { x: 5, y: 5 }, { w: 100, h: 60 }).cols).toBe(3)
    expect(mediaGridLayout(0, { x: 0, y: 0 }, { w: 1, h: 1 })).toEqual({ cols: 1, rows: 0, positions: [] })
  })
})

describe('retakeSegmentRange', () => {
  it('时长未知时退回比例，服务端换算', () => {
    expect(retakeSegmentRange({ sourceId: 'v1', sourceLabel: '', start: 0.35, end: 0.72, total: 5, duration: 0 }))
      .toEqual({ start_ratio: 0.35, end_ratio: 0.72 })
  })
  it('时长已知时给秒数', () => {
    expect(retakeSegmentRange({ sourceId: 'v1', sourceLabel: '', start: 0.1, end: 0.5, total: 5, duration: 8 }))
      .toEqual({ start: 0.8, end: 4 })
  })
  it('时长已知但段太短返回 null', () => {
    expect(retakeSegmentRange({ sourceId: 'v1', sourceLabel: '', start: 0.1, end: 0.12, total: 5, duration: 8 })).toBeNull()
  })
})

describe('mediaSourceRef', () => {
  it('优先资产 id，没有再退回任务 id', () => {
    expect(mediaSourceRef({ assetId: 7, taskId: 9 })).toEqual({ asset_id: 7 })
    expect(mediaSourceRef({ taskId: 9 })).toEqual({ task_id: 9 })
    expect(mediaSourceRef({})).toBeNull()
  })
})

describe('mediaOutputWarning', () => {
  const t = (key: string, params?: Record<string, string | number>) => {
    if (key === 'canvas.media.transcribeTruncated')
      return `only ${params?.n}`
    if (key === 'canvas.media.noSilence')
      return 'no pause'
    if (key === 'canvas.media.transcribeNoTimestamps')
      return 'no timestamps'
    if (key === 'canvas.media.warningFallback')
      return 'generic'
    return key
  }

  it('把已知后端警告映射成词条，其余走通用提示', () => {
    expect(mediaOutputWarning('', t)).toBe('')
    expect(mediaOutputWarning('只转了前 20 分钟', t)).toBe('only 20')
    expect(mediaOutputWarning('素材长 40 分钟，只转写了前 20 分钟', t)).toBe('only 20')
    expect(mediaOutputWarning('没检测到停顿', t)).toBe('no pause')
    expect(mediaOutputWarning('没有检测到可去掉的停顿', t)).toBe('no pause')
    expect(mediaOutputWarning('网关未返回时间戳，字幕时间按句均分，请校对', t)).toBe('no timestamps')
    expect(mediaOutputWarning('engine timeout on slice 3', t)).toBe('generic')
  })

  it('优先按 warning_code 映射，不依赖中文原文', () => {
    expect(mediaOutputWarning('', t, { code: 'transcribe_truncated', params: { minutes: 15 } })).toBe('only 15')
    expect(mediaOutputWarning('', t, { code: 'transcribe_truncated' })).toBe('only 20')
    expect(mediaOutputWarning('', t, { code: 'transcribe_no_timestamps' })).toBe('no timestamps')
    expect(mediaOutputWarning('', t, { code: 'no_silence' })).toBe('no pause')
  })
})

describe('pickMediaSourceNode', () => {
  it('sourceId 命中内容节点时用它，否则用上游，再否则用自己', () => {
    const nodes = [
      { id: 'a' },
      { id: 'b' },
      { id: 'self' },
    ]
    const find = (id: string) => nodes.find(item => item.id === id)
    const isContent = (item?: { id: string }): item is { id: string } => Boolean(item)
    expect(pickMediaSourceNode({ id: 'self' }, 'a', find, [], isContent).id).toBe('a')
    expect(pickMediaSourceNode({ id: 'self' }, '', find, [{ source: 'b', target: 'self' }], isContent).id).toBe('b')
    expect(pickMediaSourceNode({ id: 'self' }, '', find, [], isContent).id).toBe('self')
  })
})
