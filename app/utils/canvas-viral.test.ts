import { describe, expect, it } from 'vitest'
import type { GenerationModel } from '~/types/creative'
import { buildViralPrompt, buildViralShotPrompt, hasVideoReference, parseViralBreakdown, pickViralModel, syncViralPromptRefs, trimViralStructure, viralCarryRefs, viralDuration, viralExtraRefCount, viralMappedEntities, viralModels, viralRatio, viralResolution } from './canvas-viral'

function model(name: string, extra: Partial<GenerationModel> = {}): GenerationModel {
  return {
    provider: 'easyapi',
    model: name,
    type: 'video',
    label: name,
    unit: 'second',
    points_per_unit: 3,
    member_points_per_unit: 2,
    priced: true,
    abilities: ['video_reference'],
    ...extra,
  } as GenerationModel
}

describe('viralModels / hasVideoReference', () => {
  it('只留视频、已定价、能吃参考视频的模型；abilities 兼容逗号串', () => {
    const list = [
      model('seedance-2.0'),
      model('hailuo-02', { abilities: [] }),
      model('kling-o1', { abilities: 'native_audio,video_reference' as unknown as string[] }),
      model('wan2.6-r2v', { priced: false }),
      model('gpt-image-2', { type: 'image' }),
    ]
    expect(viralModels(list).map(item => item.model)).toEqual(['seedance-2.0', 'kling-o1'])
    expect(hasVideoReference({ abilities: 'upscale' })).toBe(false)
    expect(hasVideoReference(null)).toBe(false)
  })
})

describe('pickViralModel', () => {
  const list = [model('seedance-2.0'), model('kling-o1'), model('wan2.6-r2v')]

  it('上次用过的优先，其次运营配的默认，最后清单第一个', () => {
    expect(pickViralModel(list, { remembered: 'wan2.6-r2v', configModel: 'kling-o1' })?.model).toBe('wan2.6-r2v')
    expect(pickViralModel(list, { configModel: 'kling-o1' })?.model).toBe('kling-o1')
    expect(pickViralModel(list)?.model).toBe('seedance-2.0')
  })

  it('偏好不在可选清单里就跳过；清单为空返回 null', () => {
    expect(pickViralModel(list, { remembered: 'hailuo-02', configModel: 'sora-2' })?.model).toBe('seedance-2.0')
    expect(pickViralModel([model('hailuo-02', { abilities: [] })])).toBeNull()
  })
})

describe('viralDuration', () => {
  it('落到最接近原片时长的档，相等距离取更长的', () => {
    expect(viralDuration(6.2, [5, 10, 15])).toBe(5)
    expect(viralDuration(7.5, [5, 10, 15])).toBe(10)
    expect(viralDuration(30, [4, 8, 12])).toBe(12)
  })

  it('没有档位时四舍五入并夹在 3~15 秒', () => {
    expect(viralDuration(7.4, [])).toBe(7)
    expect(viralDuration(1, null)).toBe(3)
    expect(viralDuration(40, undefined)).toBe(15)
  })

  it('原片时长读不到时取最短档 / 5 秒', () => {
    expect(viralDuration(0, [8, 4, 12])).toBe(4)
    expect(viralDuration(Number.NaN, [])).toBe(5)
  })
})

describe('viralRatio / viralResolution', () => {
  it('按像素尺寸落到最接近的常用比例', () => {
    expect(viralRatio(1920, 1080)).toBe('16:9')
    expect(viralRatio(720, 1280)).toBe('9:16')
    expect(viralRatio(1000, 1000)).toBe('1:1')
    expect(viralRatio(0, 0)).toBe('16:9')
  })

  it('分辨率优先 720P，其次 1080P，再取清单第一个；没清单不传', () => {
    expect(viralResolution(['512P', '768P', '1080P'])).toBe('1080P')
    expect(viralResolution(['720p', '1080P'])).toBe('720P')
    expect(viralResolution(['480P'])).toBe('480P')
    expect(viralResolution([])).toBe('')
  })
})

describe('trimViralStructure / buildViralPrompt', () => {
  const structure = '_Timestamped prompts_\n\n- 0-3s：远景，城市夜景，缓慢推进\n- 3-6s：中景，主角回头，手持跟拍\n'

  it('去掉标题与空行，按整行截断', () => {
    expect(trimViralStructure(structure)).toBe('- 0-3s：远景，城市夜景，缓慢推进\n- 3-6s：中景，主角回头，手持跟拍')
    expect(trimViralStructure(structure, 20)).toBe('- 0-3s：远景，城市夜景，缓慢推进')
    expect(trimViralStructure('')).toBe('')
  })

  it('有结构时逐段照搬并附上结构，写明参考数与时长', () => {
    const prompt = buildViralPrompt({ locale: 'zh', structure, refCount: 2, durationSec: 6 })
    expect(prompt).toContain('按下面的分镜结构复刻')
    expect(prompt).toContain('2 个参考素材')
    expect(prompt).toContain('总时长约 6 秒')
    expect(prompt).toContain('- 3-6s：中景')
    expect(prompt).not.toContain('_Timestamped prompts_')
  })

  it('没有结构时退回整体描述；没有参考素材时允许重新设计主体', () => {
    const prompt = buildViralPrompt({ locale: 'zh-TW', refCount: 0, durationSec: 5.4 })
    expect(prompt).toContain('参考这条爆款视频的分镜结构')
    expect(prompt).toContain('可以重新设计')
    expect(prompt).toContain('总时长约 5 秒')
  })

  it('非中文界面出英文提示词', () => {
    const prompt = buildViralPrompt({ locale: 'en', structure, refCount: 1, durationSec: 6 })
    expect(prompt).toMatch(/^Recreate a new video that follows the shot structure below/)
    expect(prompt).toContain('1 provided reference asset')
    expect(prompt).toContain('Original shot structure:')
  })
})

describe('viralExtraRefCount / syncViralPromptRefs', () => {
  const zh = buildViralPrompt({ locale: 'zh', structure: '- 0-3s：远景', refCount: 2, durationSec: 6 })

  it('记下原片资产时，只数原片以外的参考素材', () => {
    expect(viralExtraRefCount([
      { asset_id: 9, role: 'reference_video' },
      { asset_id: 3, role: 'reference' },
      { asset_id: 4, role: 'reference_audio' },
      { asset_id: 5, role: 'style' },
    ], 9)).toBe(2)
    expect(viralExtraRefCount([{ asset_id: 9, role: 'reference_video' }], 9)).toBe(0)
  })

  it('旧节点没记下原片时，有参考视频就减一条', () => {
    expect(viralExtraRefCount([
      { asset_id: 9, role: 'reference_video' },
      { asset_id: 3, role: 'reference' },
    ])).toBe(1)
    expect(viralExtraRefCount([{ asset_id: 3, role: 'reference' }])).toBe(1)
  })

  it('再生成时按当次数量改那一句；没有额外素材就改成可以重新设计', () => {
    expect(syncViralPromptRefs(zh, 1)).toContain('1 个参考素材')
    expect(syncViralPromptRefs(zh, 1)).not.toContain('2 个参考素材')
    const none = syncViralPromptRefs(zh, 0)
    expect(none).toContain('可以重新设计')
    expect(none).not.toContain('参考素材替换')
    expect(syncViralPromptRefs(none, 3)).toContain('3 个参考素材')
  })

  it('英文提示词同样改写；普通提示词不动', () => {
    const en = buildViralPrompt({ locale: 'en', refCount: 2, durationSec: 5 })
    expect(syncViralPromptRefs(en, 0)).toContain('may be redesigned')
    expect(syncViralPromptRefs(en, 0)).not.toContain('2 provided')
    expect(syncViralPromptRefs('一只猫在跑', 0)).toBe('一只猫在跑')
  })
})

describe('viralCarryRefs', () => {
  it('连线的再连边，上传的放进参考列表；原片和重复资产不挂第二次', () => {
    const carry = viralCarryRefs({
      sourceAssetId: 9,
      connected: [
        { id: 'image-1', assetId: 3 },
        { id: 'video-1', assetId: 9 },
        { id: 'audio-1', assetId: 4 },
        { id: 'image-2', assetId: 8 },
      ],
      uploaded: [
        { assetId: 3, url: 'https://cdn/a.png', name: '图' },
        { assetId: 5, url: 'https://cdn/b.mp4', name: '片' },
        { assetId: 6, url: 'https://cdn/c.png' },
      ],
      usedAssetIds: [9, 3, 4, 5],
    })
    expect(carry.linkIds).toEqual(['image-1', 'audio-1'])
    expect(carry.refItems).toEqual([{ assetId: 5, url: 'https://cdn/b.mp4', name: '片' }])
  })
})

describe('parseViralBreakdown', () => {
  it('读 JSON 里的分镜和可替换对象，超过 8 镜只留前面的', () => {
    const shots = Array.from({ length: 10 }, (_, index) => `{"start":${index},"end":${index + 1},"text":"镜${index + 1}"}`).join(',')
    const parsed = parseViralBreakdown(`说明\n{"shots":[${shots}],"roles":[{"name":"女孩","note":"黄外套"}],"scenes":["公路"],"elements":[{"name":"路牌"}]}`, 12)
    expect(parsed?.shots).toHaveLength(8)
    expect(parsed?.shots[0]).toMatchObject({ start: 0, end: 1, text: '镜1' })
    expect(parsed?.entities.map(item => `${item.kind}:${item.name}`)).toEqual(['role:女孩', 'scene:公路', 'element:路牌'])
  })

  it('模型没给 JSON 时按时间轴列表拆镜', () => {
    const parsed = parseViralBreakdown('_Timestamped prompts_\n- 0-3s：推近脸\n- 3-6s：拉远到公路', 6)
    expect(parsed?.shots).toEqual([
      { start: 0, end: 3, text: '推近脸' },
      { start: 3, end: 6, text: '拉远到公路' },
    ])
    expect(parsed?.entities).toEqual([])
  })

  it('没有分镜就返回空', () => {
    expect(parseViralBreakdown('看不清', 5)).toBeNull()
  })
})

describe('buildViralShotPrompt', () => {
  it('替换素材按参考图序号写进这一镜，和映射顺序一致', () => {
    const entities = [
      { id: 'role-1', kind: 'role' as const, name: '女孩', note: '', assetId: 3, url: 'a' },
      { id: 'scene-1', kind: 'scene' as const, name: '公路', note: '' },
    ]
    const prompt = buildViralShotPrompt({
      locale: 'zh',
      shot: { start: 0, end: 3, text: '推近' },
      entities,
      extra: '改成黄昏',
    })
    expect(prompt).toContain('0-3s')
    expect(prompt).toContain('参考图1替换角色「女孩」')
    expect(prompt).not.toContain('公路')
    expect(prompt).toContain('改成黄昏')
    expect(viralMappedEntities(entities).map(item => item.assetId)).toEqual([3])
  })
})
