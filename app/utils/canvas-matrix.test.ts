import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  findMatrixPlatform,
  MATRIX_PLATFORMS,
  MATRIX_VERSION_MAX,
  matrixBatchItems,
  matrixDuration,
  matrixEligibility,
  matrixLabel,
  matrixLangKey,
  matrixLatestUnsubmitted,
  matrixNextOrigin,
  matrixNodeIds,
  MATRIX_PLACE_SHIFT,
  matrixPlaceGraph,
  matrixPlan,
  matrixPlanFromDerived,
  matrixPlatformSpec,
  matrixPoints,
  matrixSameLang,
  matrixResolution,
  matrixVersionSpec,
  type MatrixPlan,
  type MatrixSource,
} from './canvas-matrix'
import { talkingDuration } from './canvas-talking'
import { isUsableWorkflowGraph } from './canvas-workflow'
import type { LangOption } from '~/types/creative'

/** 面板与 Inspector 共用的枚举：直接从 CanvasInspector.vue 抽，避免两边各写一份对不上 */
function inspectorList(name: string): string[] {
  const src = readFileSync('app/components/canvas/CanvasInspector.vue', 'utf8')
  const match = src.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))
  if (!match)
    throw new Error(`CanvasInspector.vue 里找不到 ${name}`)
  return [...match[1]!.matchAll(/'([^']+)'/g)].map(item => item[1]!)
}

function imageSource(patch: Partial<MatrixSource> = {}): MatrixSource {
  return {
    id: 'image-1',
    kind: 'image',
    label: '商品图',
    prompt: '干净浅灰背景的商品正面图',
    model: 'qwen-image-2.0',
    params: { quality: 'std', clarity: '2K' },
    data: { kind: 'image', label: '商品图', prompt: '干净浅灰背景的商品正面图', model: 'qwen-image-2.0', quality: 'std' },
    assetId: 42,
    content: 'https://cdn.example.com/p.png',
    ...patch,
  }
}

function videoSource(patch: Partial<MatrixSource> = {}): MatrixSource {
  return {
    id: 'video-1',
    kind: 'video',
    label: '成片',
    prompt: '镜头缓慢前推，雨滴落在猫毛上',
    model: 'Kling-2.5',
    params: { duration: 5, resolution: '1080P' },
    data: { kind: 'video', label: '成片', prompt: '镜头缓慢前推', model: 'Kling-2.5', videoMode: 'i2v' },
    assetId: 7,
    content: 'https://cdn.example.com/v.mp4',
    images: [{ id: 'image-9', assetId: 42 }],
    ...patch,
  }
}

const LANGS: LangOption[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
]

function inputsOf(plan: MatrixPlan, ids = plan.versions.map((_, i) => `n${i}`)) {
  return matrixBatchItems(plan, ids)[0]!.inputs
}

describe('平台规格库', () => {
  it('至少覆盖 9:16 竖版与 16:9 横版，比例 / 分辨率都在 Inspector 的枚举里', () => {
    const ratios = new Set(inspectorList('RATIO_ITEMS'))
    const resolutions = new Set(inspectorList('VIDEO_RES_ITEMS'))
    expect(MATRIX_PLATFORMS.map(item => item.id)).toContain('vertical-9x16')
    expect(MATRIX_PLATFORMS.map(item => item.id)).toContain('horizontal-16x9')
    for (const platform of MATRIX_PLATFORMS) {
      expect(ratios.has(platform.ratio), `${platform.id} 比例 ${platform.ratio}`).toBe(true)
      expect(resolutions.has(platform.resolution), `${platform.id} 分辨率`).toBe(true)
      expect(Number.isInteger(platform.durationSeconds), platform.id).toBe(true)
      expect(platform.label.trim(), platform.id).not.toBe('')
      expect(platform.hint.trim(), platform.id).not.toBe('')
    }
  })

  it('id 唯一，能按 id 找到', () => {
    const ids = MATRIX_PLATFORMS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(findMatrixPlatform('vertical-9x16')?.ratio).toBe('9:16')
    expect(findMatrixPlatform('nope')).toBeNull()
  })

  it('3:4 标了降级，其余规格不标（降级要在界面上注明，不能当严格 3:4 卖）', () => {
    const degraded = MATRIX_PLATFORMS.filter(item => item.degraded)
    expect(degraded.map(item => item.id)).toEqual(['portrait-3x4'])
    expect(degraded[0]!.degraded).toContain('9:16')
  })

  it('一次派生的上限是个正整数（面板按它拦人）', () => {
    expect(Number.isInteger(MATRIX_VERSION_MAX)).toBe(true)
    expect(MATRIX_VERSION_MAX).toBeGreaterThan(0)
  })
})

describe('源节点资格', () => {
  it('图片 / 视频且已出片、有提示词与模型才放行', () => {
    expect(matrixEligibility(imageSource())).toEqual({ ok: true, kind: 'image' })
    expect(matrixEligibility(videoSource())).toEqual({ ok: true, kind: 'video' })
  })

  it('每种拦截都给出能照做的原因', () => {
    expect(matrixEligibility({ ...imageSource(), kind: 'audio' })).toEqual({ ok: false, reason: '一稿多版只支持图片与视频节点' })
    expect(matrixEligibility({ ...imageSource(), assetId: 0 })).toEqual({ ok: false, reason: '这个节点还没出片：先生成一次，拿到产物再派生' })
    expect(matrixEligibility({ ...imageSource(), content: '' }).ok).toBe(false)
    expect(matrixEligibility({ ...imageSource(), prompt: '  ' })).toEqual({ ok: false, reason: '这个节点还没有提示词：先补上提示词再派生' })
    expect(matrixEligibility({ ...imageSource(), model: '' })).toEqual({ ok: false, reason: '这个节点还没选模型：在节点面板里选好模型再派生' })
  })
})

describe('时长档回落', () => {
  it('取第一个 ≥ 需求的档，档位不够用最长档，并如实说明（说明是带插值的 key + 参数）', () => {
    expect(matrixDuration(5, [5, 10, 15])).toEqual({ seconds: 5, degraded: '', degradedParams: {} })
    expect(matrixDuration(3, [5, 10])).toEqual({
      seconds: 5,
      degraded: '这个视频模型没有 {wanted} 秒档，已按最近的一档 {hit} 秒提交',
      degradedParams: { wanted: 3, hit: 5 },
    })
    expect(matrixDuration(15, [5, 10])).toEqual({
      seconds: 10,
      degraded: '这个视频模型最长 {hit} 秒，已按最长档提交',
      degradedParams: { hit: 10 },
    })
  })

  it('模型没声明档位就按规格值提交', () => {
    expect(matrixDuration(5, [])).toEqual({ seconds: 5, degraded: '', degradedParams: {} })
    expect(matrixDuration(0, undefined)).toEqual({ seconds: 1, degraded: '', degradedParams: {} })
  })
})

describe('版本组合', () => {
  it('图片源：规格 × 语种铺开，参数带比例、沿用清晰度，产物字段清空', () => {
    const plan = matrixPlan({
      source: imageSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!, findMatrixPlatform('horizontal-16x9')!],
      langs: [],
      batchId: 'mx-1',
    })
    expect(plan.versions).toHaveLength(2)
    expect(plan.versions.map(item => item.params)).toEqual([
      { count: 1, ratio: '9:16', quality: 'std', clarity: '2K' },
      { count: 1, ratio: '16:9', quality: 'std', clarity: '2K' },
    ])
    expect(plan.versions[0]!.data.matrix).toEqual({
      batchId: 'mx-1',
      sourceId: 'image-1',
      sourceLabel: '商品图',
      platformId: 'vertical-9x16',
      ratio: '9:16',
      resolution: '',
      durationSeconds: 0,
    })
    expect(plan.versions[0]!.label).toBe('商品图 · 竖版 9:16')
    expect(plan.versions[1]!.label).toBe('商品图 · 横版 16:9')
    for (const version of plan.versions) {
      for (const key of ['content', 'assetId', 'taskId', 'taskStatus', 'taskError'])
        expect(version.data[key], key).toBeUndefined()
      expect(version.data.model).toBe('qwen-image-2.0')
      expect(version.data.kind).toBe('image')
    }
  })

  it('多语言：同一规格 × 每种语言各一版，提示词用译文、标记带语种', () => {
    const plan = matrixPlan({
      source: imageSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: LANGS,
      prompts: { zh: '干净浅灰背景的商品正面图', en: 'Product front shot on a clean grey background', ja: '清潔なグレー背景の商品正面' },
      batchId: 'mx-2',
    })
    expect(plan.versions).toHaveLength(3)
    expect(plan.versions.map(item => item.prompt)).toEqual([
      '干净浅灰背景的商品正面图',
      'Product front shot on a clean grey background',
      '清潔なグレー背景の商品正面',
    ])
    expect(plan.versions.map(item => item.data.matrix.lang)).toEqual(['zh', 'en', 'ja'])
    expect(plan.versions[1]!.label).toBe('商品图 · 竖版 9:16 · English')
    expect(matrixVersionSpec(plan.versions[1]!, 'image')).toBe('9:16 · English')
    expect(plan.versions[1]!.params.ratio).toBe('9:16')
  })

  it('缺译文就回落源提示词（不静默塞空串）', () => {
    const plan = matrixPlan({
      source: imageSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [{ code: 'fr', label: 'Français' }],
      prompts: {},
      batchId: 'mx-3',
    })
    expect(plan.versions[0]!.prompt).toBe('干净浅灰背景的商品正面图')
    expect(plan.versions[0]!.data.matrix.lang).toBe('fr')
  })

  it('视频源：参数带模式 / 分辨率 / 时长与音频，首帧图是锚点不重复落图', () => {
    const plan = matrixPlan({
      source: videoSource(),
      platforms: [findMatrixPlatform('horizontal-16x9')!],
      langs: [],
      durations: [5, 10],
      batchId: 'mx-4',
    })
    expect(plan.versions[0]!.params).toEqual({ count: 1, mode: 'i2v', ratio: '16:9', resolution: '1080P', duration: 5, audio: true })
    expect(matrixVersionSpec(plan.versions[0]!, 'video')).toBe('16:9 · 1080P · 5s')
    expect(plan.graph.nodes.map(node => node.id)).toEqual(['src', 'img1', 'v1'])
    expect(plan.graph.edges).toEqual([{ source: 'img1', target: 'v1', sourceHandle: 'out', targetHandle: 'in' }])
  })

  it('口播视频源：带 preset / 台词拼提示词 / 台词的自动时长；没有首帧按全能参考', () => {
    const talking = matrixPlan({
      source: videoSource({
        prompt: '门头招牌清晰',
        data: { kind: 'video', label: '口播成片', prompt: '门头招牌清晰', model: 'Kling-2.5', videoMode: 'talking', talking: { script: '「城市这家店，人均三十」', tone: 'warm', framing: 'medium' } },
      }),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      durations: [5, 10, 15],
      batchId: 'mx-5',
    })
    // 与 CanvasInspector 的口播分支同形：mode 映射成 i2v、强制出声、带 preset，提示词由台词拼出来
    expect(talking.versions[0]!.params).toMatchObject({ mode: 'i2v', audio: true, preset: 'talking', resolution: '1080P' })
    expect(talking.versions[0]!.params.duration).toBe(talkingDuration('「城市这家店，人均三十」', [5, 10, 15]))
    expect(talking.versions[0]!.prompt).toContain('「城市这家店，人均三十」')
    expect(talking.versions[0]!.prompt).toContain('中景')
    expect(talking.versions[0]!.prompt).toContain('门头招牌清晰')
    expect(talking.versions[0]!.params.mode).not.toBe('talking')
    // 手动档仍在模型档位里才生效
    const manual = matrixPlan({
      source: videoSource({ data: { kind: 'video', prompt: '画面补充', model: 'Kling-2.5', videoMode: 'talking', talking: { script: '台词', duration: 10 } } }),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      durations: [5, 10, 15],
      batchId: 'mx-5b',
    })
    expect(manual.versions[0]!.params.duration).toBe(10)
    const noFrame = matrixPlan({
      source: videoSource({ images: [], data: { kind: 'video', label: '口播成片', prompt: '', model: 'Kling-2.5', videoMode: 'talking', talking: { script: '台词' } } }),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      batchId: 'mx-6',
    })
    expect(noFrame.versions[0]!.params).toMatchObject({ mode: 'reference', audio: true, preset: 'talking' })
    expect(noFrame.graph.edges).toEqual([])
  })

  it('口播源的多语言翻的是台词：提示词用台词译文拼，节点仍是口播节点', () => {
    const plan = matrixPlan({
      source: videoSource({ data: { kind: 'video', prompt: '画面补充', model: 'Kling-2.5', videoMode: 'talking', talking: { script: '「欢迎光临」' } } }),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [{ code: 'en', label: 'English' }],
      prompts: { en: '不该用这句提示词' },
      talkingScripts: { en: 'Welcome in' },
      batchId: 'mx-6b',
    })
    expect(plan.versions[0]!.prompt).toContain('Welcome in')
    expect(plan.versions[0]!.prompt).not.toContain('「欢迎光临」')
    expect(plan.versions[0]!.prompt).not.toContain('不该用这句提示词')
    expect(plan.versions[0]!.data.talking).toMatchObject({ script: '「欢迎光临」' })
    expect(plan.versions[0]!.params.preset).toBe('talking')
  })

  it('只有台词的口播节点也能派生（提示词为空不算缺料）', () => {
    expect(matrixEligibility({ ...videoSource(), prompt: '', talking: { script: '只有台词' } }).ok).toBe(true)
    expect(matrixEligibility({ ...videoSource(), prompt: '', talking: { script: '' } }).ok).toBe(false)
  })

  it('图片源的图当派生的参考图；3:4 的降级说明落到版本上', () => {
    const plan = matrixPlan({
      source: imageSource({ images: [{ id: 'image-0', assetId: 11 }] }),
      platforms: [findMatrixPlatform('portrait-3x4')!],
      langs: [],
      batchId: 'mx-7',
    })
    expect(plan.graph.edges).toEqual([{ source: 'src', target: 'v1', sourceHandle: 'out', targetHandle: 'in' }])
    expect(plan.versions[0]!.notes.map(note => note.text)).toEqual([findMatrixPlatform('portrait-3x4')!.degraded])
  })

  it('分辨率按目标模型声明的档位回落，并把回落写进版本与节点标记', () => {
    const fallback = matrixPlan({
      source: videoSource(),
      platforms: [findMatrixPlatform('horizontal-16x9')!],
      langs: [],
      resolutions: ['720P'],
      batchId: 'mx-7b',
    })
    expect(fallback.versions[0]!.params.resolution).toBe('720P')
    expect(fallback.versions[0]!.data.matrix.resolution).toBe('720P')
    expect(matrixVersionSpec(fallback.versions[0]!, 'video')).toBe('16:9 · 720P · 5s')
    expect(fallback.versions[0]!.notes.map(note => note.text)).toContain(matrixResolution('1080P', ['720P']).note!.text)
    expect(matrixResolution('1080P', ['720P']).note!.params).toEqual({ want: '1080P', got: '720P' })
    // 模型声明里就有 / 模型没声明：都不回落、不加说明
    const exact = matrixPlan({
      source: videoSource(),
      platforms: [findMatrixPlatform('horizontal-16x9')!],
      langs: [],
      resolutions: ['720P', '1080P'],
      batchId: 'mx-7c',
    })
    expect(exact.versions[0]!.params.resolution).toBe('1080P')
    expect(exact.versions[0]!.notes).toEqual([])
    expect(matrixResolution('1080P', []).note).toBeNull()
    expect(matrixResolution('1080P', undefined).resolution).toBe('1080P')
  })

  it('落图 graph 是能用的工作流格式：节点在、边两端都在图里、没有自环', () => {
    const plan = matrixPlan({
      source: videoSource(),
      platforms: MATRIX_PLATFORMS,
      langs: [],
      batchId: 'mx-8',
    })
    expect(isUsableWorkflowGraph(plan.graph)).toBe(true)
    expect(plan.graph.nodes).toHaveLength(2 + MATRIX_PLATFORMS.length)
    const ids = new Set(plan.graph.nodes.map(node => node.id))
    for (const edge of plan.graph.edges) {
      expect(ids.has(edge.source), edge.source).toBe(true)
      expect(ids.has(edge.target), edge.target).toBe(true)
      expect(edge.source === edge.target).toBe(false)
    }
  })
})

describe('落图（复用 placeWorkflowGraph / workflowNodesToFlow）', () => {
  const plan = matrixPlan({
    source: videoSource(),
    platforms: [findMatrixPlatform('vertical-9x16')!, findMatrixPlatform('horizontal-16x9')!],
    langs: LANGS.slice(0, 2),
    prompts: { zh: 'zh 提示词', en: 'en prompt' },
    batchId: 'mx-9',
  })

  it('锚点复用既有 id 且不落图，派生节点拿新 id、边连到源节点的上游', () => {
    let seq = 0
    const placed = matrixPlaceGraph(plan, { x: 100, y: 200 }, kind => `new-${kind}-${++seq}`)
    // 落图只落派生节点：源视频与首帧图都是既有节点，不复制
    expect(placed.nodes.map(node => node.id)).toEqual(['new-video-1', 'new-video-2', 'new-video-3', 'new-video-4'])
    expect(placed.derived).toEqual(['new-video-1', 'new-video-2', 'new-video-3', 'new-video-4'])
    // 规格为行、语种为列：2 列 × 2 行，落在源节点右侧
    expect(placed.nodes.map(node => node.position)).toEqual([
      { x: 100 + 320 + 96, y: 200 },
      { x: 100 + 320 + 96 + 360, y: 200 },
      { x: 100 + 320 + 96, y: 200 + 220 + 32 },
      { x: 100 + 320 + 96 + 360, y: 200 + 220 + 32 },
    ])
    expect(placed.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual([
      'image-9->new-video-1',
      'image-9->new-video-2',
      'image-9->new-video-3',
      'image-9->new-video-4',
    ])
    expect(placed.nodes[0]!.data.matrix.sourceId).toBe('video-1')
    expect(placed.nodes[0]!.data.prompt).toBe('zh 提示词')
    expect(placed.nodes[3]!.data.prompt).toBe('en prompt')
  })

  it('图片源：源节点是锚点，边从源图连到每条版本', () => {
    const imagePlan = matrixPlan({
      source: imageSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      batchId: 'mx-10',
    })
    const placed = matrixPlaceGraph(imagePlan, { x: 0, y: 0 }, kind => `new-${kind}`)
    expect(placed.nodes.map(node => node.id)).toEqual(['new-image'])
    expect(placed.derived).toEqual(['new-image'])
    expect(placed.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['image-1->new-image'])
  })
})

describe('批量条目与点数', () => {
  it('条目与 create 向导同形：layer=matrix、count=1、输入带源图资产', () => {
    const plan = matrixPlan({
      source: imageSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      batchId: 'mx-11',
    })
    const items = matrixBatchItems(plan, ['image-7'])
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      node_id: 'image-7',
      layer: 'matrix',
      type: 'image',
      model: 'qwen-image-2.0',
      prompt: '干净浅灰背景的商品正面图',
      params: { count: 1, ratio: '9:16', quality: 'std', clarity: '2K' },
      inputs: [{ asset_id: 42, role: 'image' }],
      depends: [],
    })
  })

  it('视频源的条目：参考素材按类型分角色（图片 reference、视频 reference_video）', () => {
    const source = videoSource({
      images: [{ id: 'image-9', assetId: 42 }],
      data: { kind: 'video', model: 'Kling-2.5', videoMode: 'reference', refItems: [{ assetId: 51, url: 'https://cdn.example.com/a.mp4' }, { assetId: 52, url: 'https://cdn.example.com/b.png' }] },
    })
    const plan = matrixPlan({
      source,
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      batchId: 'mx-12',
    })
    expect(inputsOf(plan)).toEqual([
      { asset_id: 42, role: 'reference' },
      { asset_id: 52, role: 'reference' },
      { asset_id: 51, role: 'reference_video' },
    ])
  })

  it('首帧驱动的视频源：首帧走 first_frame', () => {
    const source = videoSource()
    const plan = matrixPlan({
      source,
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      batchId: 'mx-12b',
    })
    expect(inputsOf(plan)).toEqual([{ asset_id: 42, role: 'first_frame' }])
  })

  it('点数：逐条估价求和，图片按条、视频按秒由调用方的 estimate 决定', () => {
    const plan = matrixPlan({
      source: imageSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!, findMatrixPlatform('horizontal-16x9')!],
      langs: LANGS.slice(0, 2),
      batchId: 'mx-13',
    })
    expect(matrixPoints(plan, () => 11)).toEqual({ total: 44, byVersion: [11, 11, 11, 11] })
    const video = matrixPlan({
      source: videoSource(),
      platforms: [findMatrixPlatform('vertical-9x16')!],
      langs: [],
      batchId: 'mx-14',
    })
    expect(matrixPoints(video, (_model, params) => 16 * (Number(params.duration) || 0))).toEqual({ total: 80, byVersion: [80] })
  })
})

describe('来源标记与标题', () => {
  it('同一源再派生一轮时整组往右错开', () => {
    const origin = { x: 100, y: 40 }
    expect(matrixNextOrigin(origin, [{ data: {} }])).toEqual(origin)
    expect(matrixNextOrigin(origin, [
      { data: { matrix: { batchId: 'mx-a' } } },
      { data: { matrix: { batchId: 'mx-a' } } },
      { data: { matrix: { batchId: 'mx-b' } } },
    ])).toEqual({ x: 100 + MATRIX_PLACE_SHIFT * 2, y: 40 })
  })

  it('按批次号收派生节点（回滚 / 分组用）', () => {
    const nodes = [
      { id: 'image-1', data: {} },
      { id: 'image-2', data: { matrix: { batchId: 'mx-a' } } },
      { id: 'video-3', data: { matrix: { batchId: 'mx-a' } } },
      { id: 'video-4', data: { matrix: { batchId: 'mx-b' } } },
    ]
    expect(matrixNodeIds(nodes, 'mx-a')).toEqual(['image-2', 'video-3'])
    expect(matrixNodeIds(nodes, 'nope')).toEqual([])
  })

  it('标题拼装：源名 · 规格（· 语种），源名为空时不出现空串段', () => {
    expect(matrixLabel('商品图', MATRIX_PLATFORMS[0]!, null)).toBe('商品图 · 竖版 9:16')
    expect(matrixLabel('', MATRIX_PLATFORMS[0]!, { code: 'en', label: 'English' })).toBe('版本 · 竖版 9:16 · English')
  })
})

describe('面板与驱动器的接口（源码级兜底：这两处不是纯逻辑，只能扫）', () => {
  const panel = readFileSync('app/components/canvas/CanvasMatrixPanel.vue', 'utf8')
  const driver = readFileSync('app/composables/useCanvasMatrix.ts', 'utf8')

  it('面板用居中弹窗外壳（canvas-wf + studio-modal），点遮罩可关', () => {
    expect(panel).toContain('class="canvas-wf canvas-matrix')
    expect(panel).toContain('studio-modal-mask')
    expect(panel).toContain('trash-modal__close')
    expect(panel).toContain('@pointerdown.stop')
    expect(panel).toContain('@click.self="closePanel()"')
  })

  it('面板复用既有语言与估价口径：useLangs + matrixPoints + matrixPlan', () => {
    expect(panel).toMatch(/useLangs\(\)/)
    expect(panel).toContain('matrixPoints(')
    expect(panel).toContain('matrixPlan(')
    expect(panel).toContain('subtitleApi.translate')
    expect(driver).toContain('budget_points')
  })

  it('驱动器复用既有能力：既有落图 / 打组 / create-batch / 批量接口与动作', () => {
    expect(driver).toContain('matrixPlaceGraph')
    expect(driver).toContain('matrixNextOrigin')
    expect(driver).toContain('batchNodePatches')
    expect(driver).toContain('batchActive')
    expect(driver).toContain('matrixBatchItems')
    expect(driver).toContain('batchApi.create')
    expect(driver).toContain('batchApi.action')
    expect(driver).toContain('opts.groupNodeList')
  })

  it('提交批量前先把画布存过（服务端要求条目 node_id 在已存 graph 里），并在进画布时恢复批次', () => {
    expect(driver).toContain('ensurePersisted')
    expect(driver).toContain('canvasApi.get')
    expect(driver).toMatch(/async function restore\(\)/)
    expect(driver).toContain('MATRIX_BATCH_LAYER')
    // 页面把保存能力交给画布（新画布也会在这一步被建出来）
    const page = readFileSync('app/pages/canvas/index.vue', 'utf8')
    expect(page).toContain(':request-save="save"')
    const workspace = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(workspace).toContain('matrixRestore')
    expect(workspace).toContain('saveCanvas: async () => { await props.requestSave?.() }')
  })

  it('面板打开时补拉模型清单：没有它估价永远是 0，不能只等 Inspector 去拉', () => {
    const workspace = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(workspace).toMatch(/taskApi\.models\(\)/)
    expect(workspace).toContain('matrixModelsLoading')
  })
})

describe('文案的翻译覆盖（t(platform.label) / t(eligibility.reason) 这类非字面量写法扫不到，单独兜住）', () => {
  const locales = ['zh', 'zh-TW', 'en', 'ja', 'fr', 'ru', 'vi']
  const tables = new Map(locales.map(name => [
    name,
    JSON.parse(readFileSync(`i18n/locales/${name}.json`, 'utf8')) as Record<string, unknown>,
  ]))

  /** 矩阵自己产出的中文文案：规格标签 / 说明 / 降级说明 + 拦截原因 + 时长档 / 分辨率回落说明 */
  function matrixKeys() {
    const keys = new Set<string>()
    for (const platform of MATRIX_PLATFORMS) {
      keys.add(platform.label)
      keys.add(platform.hint)
      if (platform.degraded)
        keys.add(platform.degraded)
    }
    for (const bad of [
      { ...imageSource(), kind: 'audio' },
      { ...imageSource(), assetId: 0 },
      { ...imageSource(), content: '' },
      { ...imageSource(), prompt: '' },
      { ...imageSource(), model: '' },
    ]) {
      const verdict = matrixEligibility(bad)
      if (!verdict.ok)
        keys.add(verdict.reason)
    }
    for (const note of [matrixDuration(3, [5, 10]).degraded, matrixDuration(15, [5, 10]).degraded]) {
      if (note)
        keys.add(note)
    }
    const resolutionNote = matrixResolution('1080P', ['720P']).note
    if (resolutionNote)
      keys.add(resolutionNote.text)
    return keys
  }

  it('规格文案、拦截原因、时长 / 分辨率回落说明都在 6 个外语文件里（zh 直接回落中文原文）', () => {
    const keys = matrixKeys()
    expect(keys.size).toBeGreaterThanOrEqual(16)
    for (const [name, table] of tables) {
      if (name === 'zh')
        continue
      const missing = [...keys].filter(key => !(key in table))
      expect(missing, `${name} 缺译文`).toEqual([])
    }
  })

  it('面板里的口播说明与分辨率回落说明也进了 7 个文件（模板里的字面量 key，独立兜一层）', () => {
    const keys = [
      '口播节点：派生版本带上同一份台词与口播预设，多语言时翻的是台词。',
      '回滚这次派生？',
      '会取消还在跑的批次，并从画布拿走这次派生的节点。已经生成完的版本也会一起删掉。',
      '确认回滚',
      '服务端生成中：成功 {ok} 个，失败 {failed} 个，共 {total} 个，已用 {spent} 点',
      '这次派生还没提交生成：节点已在画布上，可重试提交',
      '批次还在生成中，先取消或等它结束再派生',
      '这次派生的节点还在画布上，先回滚或重试提交',
      '批次生成中…',
      '先回滚或重试提交',
    ]
    for (const [name, table] of tables) {
      const missing = keys.filter(key => !(key in table))
      expect(missing, `${name} 缺译文`).toEqual([])
    }
  })

  it('带插值的键在 zh.json 里也有（缺了就原样露出 {wanted} 这种槽位）', () => {
    const keys = [...matrixKeys()].filter(key => key.includes('{'))
    expect(keys.length).toBeGreaterThanOrEqual(2)
    const zh = tables.get('zh')!
    const missing = keys.filter(key => !(key in zh))
    expect(missing).toEqual([])
  })

  it('翻译不丢占位符：译文里的槽位是键的子集，且带插值的键译完仍有槽位', () => {
    for (const key of matrixKeys()) {
      const need = new Set([...key.matchAll(/\{(\w+)\}/g)].map(item => item[1]!))
      for (const [name, table] of tables) {
        const text = String(table[key] ?? '')
        if (!text)
          continue
        const got = [...text.matchAll(/\{(\w+)\}/g)].map(item => item[1]!)
        for (const slot of got)
          expect(need.has(slot), `${name} 的「${key}」多了占位符 {${slot}}`).toBe(true)
        if (need.size)
          expect(got.length, `${name} 的「${key}」丢了占位符`).toBeGreaterThan(0)
      }
    }
  })
})

describe('一稿多版提交窗口', () => {
  const panel = readFileSync('app/components/canvas/CanvasMatrixPanel.vue', 'utf8')
  const driver = readFileSync('app/composables/useCanvasMatrix.ts', 'utf8')

  it('工作区把派生 run.busy 传给面板，面板自己也认 run.busy', () => {
    const workspace = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(workspace).toContain(':busy="Boolean(matrixRun?.busy)"')
    expect(panel).toContain('props.busy || Boolean(props.run?.busy)')
  })

  it('plan 跟 labels 挂在 run 上：关面板再开还能重试，版本名不靠下标硬对齐', () => {
    expect(driver).toContain('plan: MatrixPlan | null')
    expect(driver).toContain('labels: Record<string, string>')
    expect(driver).toContain('function nodeLabels(')
    expect(panel).not.toContain('const lastPlan')
    expect(panel).toContain('props.run?.plan')
    expect(panel).toContain('props.run?.labels')
    expect(panel).toContain('function runVersionLabel(')
  })

  it('busy 包住落图 + 保存复核 + 提交，finally 在 create 之后才放下', () => {
    const derive = driver.slice(driver.indexOf('async function derive('), driver.indexOf('async function resubmit('))
    expect(derive.indexOf('ensurePersisted')).toBeGreaterThan(derive.indexOf('try {'))
    expect(derive.indexOf('batchApi.create')).toBeGreaterThan(derive.indexOf('ensurePersisted'))
    expect(derive.indexOf('finally')).toBeGreaterThan(derive.indexOf('batchApi.create'))
    expect(derive).toContain('patchState({ busy: false })')
  })

  it('先弹确认再翻译；关掉面板会作废进行中的翻译；确认框打开时 Esc 不关面板', () => {
    const submit = panel.slice(panel.indexOf('async function submit('), panel.indexOf('function onResubmit('))
    expect(submit.indexOf('await confirm(')).toBeGreaterThan(0)
    expect(submit.indexOf('await confirm(')).toBeLessThan(submit.indexOf('translatePrompts()'))
    expect(panel).toContain('function abortTranslate(')
    expect(panel).toContain('confirmState.value.open')
    expect(panel).toContain('const codes = [...pickedLangs.value]')
  })

  it('回滚先二次确认（会取消批次并删节点），提交中不能点', () => {
    expect(panel).toContain('function onRollback(')
    expect(panel).toContain("t('回滚这次派生？')")
    expect(panel).toContain('danger: true')
    expect(panel).toContain('@click="onRollback()"')
    expect(panel).toContain(':disabled="submitting" @click="onRollback()"')
  })

  it('图片源规格只写比例；同源语种跳过翻译；打开后面板不跟画布选中走', () => {
    expect(panel).toContain('matrixPlatformSpec(platform, source?.kind || \'image\')')
    expect(panel).toContain('matrixSameLang(code, String(locale.value || \'\'))')
    expect(panel).toContain('sourceId.value = defaultSource()')
    expect(panel).not.toContain('watch(() => props.selectedId')
  })

  it('批次还在跑或节点未提交时不能再派生，表单和主按钮一起锁', () => {
    const derive = driver.slice(driver.indexOf('async function derive('), driver.indexOf('async function resubmit('))
    expect(derive).toContain('batchActive(run.value?.batch)')
    expect(derive).toContain("t('批次还在生成中，先取消或等它结束再派生')")
    expect(derive).toContain("t('这次派生的节点还在画布上，先回滚或重试提交')")
    expect(panel).toContain('const placedPending')
    expect(panel).toContain('const deriveLocked')
    expect(panel).toContain(':disabled="deriveLocked"')
    expect(panel).toContain("t('批次生成中…')")
  })

  it('刷新后能从画布节点还原未提交的 plan，进度拆开成功 / 失败', () => {
    expect(driver).toContain('function restoreUnsubmitted(')
    expect(driver).toContain('matrixPlanFromDerived(')
    expect(driver).toContain('matrixLatestUnsubmitted(')
    const workspace = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(workspace).toContain('sourceOf:')
    expect(panel).toContain('成功 {ok} 个，失败 {failed} 个，共 {total} 个')
  })
})

describe('平台规格行与同源语种', () => {
  it('图片源只写比例，视频源带分辨率和秒数', () => {
    const vertical = findMatrixPlatform('vertical-9x16')!
    expect(matrixPlatformSpec(vertical, 'image')).toBe('9:16')
    expect(matrixPlatformSpec(vertical, 'video')).toBe('9:16 · 1080P · 5s')
  })

  it('zh / zh-CN 算同一语种，zh-TW 和 en 分开', () => {
    expect(matrixLangKey('zh-CN')).toBe('zh')
    expect(matrixSameLang('zh', 'zh-CN')).toBe(true)
    expect(matrixSameLang('zh', 'zh-TW')).toBe(false)
    expect(matrixSameLang('en', 'en-US')).toBe(true)
    expect(matrixSameLang('en', 'ja')).toBe(false)
  })
})

describe('未提交派生从节点还原', () => {
  it('只认还没挂 task 的最近一批，按规格顺序还原 plan', () => {
    const source = imageSource()
    const plan = matrixPlan({
      source,
      platforms: [findMatrixPlatform('horizontal-16x9')!, findMatrixPlatform('vertical-9x16')!],
      langs: [{ code: 'en', label: 'English' }],
      batchId: 'mx-z',
      prompts: { en: 'front view of a product on a pale gray backdrop' },
    })
    const nodes = plan.versions.map((version, index) => ({
      id: `image-${index + 2}`,
      data: version.data,
    })).reverse()
    expect(matrixLatestUnsubmitted([{ id: 'old', data: { matrix: { batchId: 'mx-a' }, taskId: 9 } }, ...nodes])?.batchId).toBe('mx-z')
    const restored = matrixPlanFromDerived(source, nodes, 'mx-z')
    expect(restored?.versions.map(item => item.data.matrix.platformId)).toEqual(['vertical-9x16', 'horizontal-16x9'])
    expect(matrixBatchItems(restored!, ['image-3', 'image-2']).map(item => item.prompt)).toEqual([
      'front view of a product on a pale gray backdrop',
      'front view of a product on a pale gray backdrop',
    ])
  })

  it('整批都挂了 task 就不算未提交', () => {
    expect(matrixLatestUnsubmitted([
      { id: 'image-2', data: { matrix: { batchId: 'mx-1', sourceId: 'image-1' }, taskId: 3 } },
    ])).toBeNull()
  })
})
