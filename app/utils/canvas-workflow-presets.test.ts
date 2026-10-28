import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findWorkflowPreset, groupedWorkflowPresets, WORKFLOW_PRESET_GROUPS, WORKFLOW_PRESETS } from './canvas-workflow-presets'
import { isUsableWorkflowGraph } from './canvas-workflow'
import { CANVAS_NODE_ITEMS, HD_RESOLUTION_ITEMS, isHdNode } from './canvas-node-kinds'

const zhMessages = JSON.parse(readFileSync(resolve(process.cwd(), 'i18n/locales/zh.json'), 'utf8')) as Record<string, unknown>

function teachingText(key: string | undefined) {
  return String(key ?? '').split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object')
      return undefined
    return (value as Record<string, unknown>)[part]
  }, zhMessages)
}

/** 预设只允许用节点菜单里真实存在的 kind；模型 id 必须与 /generation/models 对齐（换模型先确认线上有定价） */
const MENU_KINDS = new Set(CANVAS_NODE_ITEMS.map(item => item.kind as string))
const MODEL_ALLOWLIST = new Set(['qwen-image-2.0', 'qwen-image-edit', 'Kling-2.5'])
/** 结果字段：下游节点不该带（模板是配方不是成品） */
const RESULT_FIELDS = ['content', 'assetId', 'previewUrl', 'taskId', 'taskStatus', 'taskProgress', 'taskError']
/** 场景分组顺序：通用放最前，保持原「官方预设」的第一眼位置 */
const SCENARIO_ORDER = ['generic', 'ecom-product', 'local-life', 'course-knowledge']
/** 口播配方要能跑，Kling-2.5 必须在生产清单里带 native_audio（配方文案里写明了这个前提） */
const TALKING_RECIPES = ['local-talking-first-frame', 'local-two-shot-talking', 'course-talking-shorts']

/** 面板与 Inspector 共用的枚举：直接从 CanvasInspector.vue 抽，避免两边各写一份对不上 */
function inspectorList(name: string): string[] {
  const src = readFileSync(resolve('app/components/canvas/CanvasInspector.vue'), 'utf8')
  const match = src.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))
  if (!match)
    throw new Error(`CanvasInspector.vue 里找不到 ${name}`)
  return [...match[1]!.matchAll(/'([^']+)'/g)].map(item => item[1]!)
}

/**
 * 点数口径（与 canvas-workflow-presets.ts 文件头一致）：图片按张、视频按秒。
 * graphPoints 只算落图 graph 里会真花钱的节点（没写模型的图片节点是上传位，不花钱）。
 */
const IMAGE_POINTS: Record<string, number> = { 'qwen-image-2.0': 11, 'qwen-image-edit': 16 }
const VIDEO_POINT_PER_SECOND = 16
/** 多镜配方走"铺满"口径：微课落图只带 3 镜试片，estimatedPoints 按 36 镜满铺（12 倍） */
const MULTI_SHOT_SCALE: Record<string, number> = { 'course-micro-lesson': 12 }

function graphPoints(preset: (typeof WORKFLOW_PRESETS)[number]) {
  let points = 0
  for (const node of preset.graph.nodes) {
    const data = node.data as { model?: string, params?: { duration?: number } }
    if (node.kind === 'image' && data.model)
      points += IMAGE_POINTS[data.model] ?? 0
    if (node.kind === 'video')
      points += (Number(data.params?.duration) || 0) * VIDEO_POINT_PER_SECOND
  }
  return points
}

describe('行业配方库', () => {
  it('id 唯一，名字与说明都写了', () => {
    const ids = WORKFLOW_PRESETS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of WORKFLOW_PRESETS) {
      expect(preset.name.trim(), preset.id).not.toBe('')
      expect(preset.hint.trim(), preset.id).not.toBe('')
    }
  })

  it('每条配方都带了配方库字段：场景 / 平台规格 / 文案模板 / 教学重点', () => {
    const scenarios = new Set(SCENARIO_ORDER)
    for (const preset of WORKFLOW_PRESETS) {
      expect(preset.scenario, preset.id).toBeTruthy()
      expect(scenarios.has(preset.scenario!), preset.id).toBe(true)
      expect(preset.platform, preset.id).toBeTruthy()
      expect(preset.copyTemplate?.trim(), preset.id).not.toBe('')
      expect(preset.teachingPoint?.trim(), preset.id).not.toBe('')
    }
  })

  it('平台规格是 Inspector 认的枚举：比例取自 RATIO_ITEMS，分辨率取自 VIDEO_RES_ITEMS', () => {
    const ratios = new Set(inspectorList('RATIO_ITEMS'))
    const resolutions = new Set(inspectorList('VIDEO_RES_ITEMS'))
    for (const preset of WORKFLOW_PRESETS) {
      const platform = preset.platform!
      expect(ratios.has(platform.ratio), `${preset.id} 比例 ${platform.ratio}`).toBe(true)
      expect(resolutions.has(platform.resolution), `${preset.id} 分辨率 ${platform.resolution}`).toBe(true)
      expect(Number.isInteger(platform.durationSeconds), preset.id).toBe(true)
      expect(platform.durationSeconds, preset.id).toBeGreaterThan(0)
    }
  })

  it('点数估算是正整数，而且与落图 graph 的单价复算一致（多镜配方按铺满口径）', () => {
    for (const preset of WORKFLOW_PRESETS) {
      const points = preset.estimatedPoints
      expect(Number.isInteger(points), preset.id).toBe(true)
      expect(points!, preset.id).toBeGreaterThan(0)
      const scale = MULTI_SHOT_SCALE[preset.id] ?? 1
      expect(points, `${preset.id} 的估点与 graph 复算不一致`).toBe(graphPoints(preset) * scale)
    }
  })

  it('每个预设都是能落图的 graph：kind 在菜单里、模型在允许清单里', () => {
    for (const preset of WORKFLOW_PRESETS) {
      expect(isUsableWorkflowGraph(preset.graph), preset.id).toBe(true)
      for (const node of preset.graph.nodes) {
        expect(MENU_KINDS.has(node.kind), `${preset.id} 的节点 ${node.id} kind=${node.kind}`).toBe(true)
        const model = (node.data as { model?: string }).model
        if (model)
          expect(MODEL_ALLOWLIST.has(model), `${preset.id} 的节点 ${node.id} model=${model}`).toBe(true)
      }
    }
  })

  it('连线两端都在同一个预设里，而且没有自环', () => {
    for (const preset of WORKFLOW_PRESETS) {
      const ids = new Set(preset.graph.nodes.map(node => node.id))
      for (const edge of preset.graph.edges) {
        expect(ids.has(edge.source), `${preset.id} 连线起点 ${edge.source}`).toBe(true)
        expect(ids.has(edge.target), `${preset.id} 连线终点 ${edge.target}`).toBe(true)
        expect(edge.source === edge.target, `${preset.id} 自环 ${edge.source}`).toBe(false)
      }
    }
  })

  it('带上游的节点不带生成产物', () => {
    for (const preset of WORKFLOW_PRESETS) {
      const withUpstream = new Set(preset.graph.edges.map(edge => edge.target))
      for (const node of preset.graph.nodes.filter(item => withUpstream.has(item.id))) {
        for (const key of RESULT_FIELDS)
          expect(node.data[key], `${preset.id} 的节点 ${node.id} 带了 ${key}`).toBeUndefined()
      }
    }
  })

  it('文本节点都是源节点：讲稿 / 分镜表 / 字幕源带上游就会被当成待清的生成产物', () => {
    for (const preset of WORKFLOW_PRESETS) {
      const withUpstream = new Set(preset.graph.edges.map(edge => edge.target))
      for (const node of preset.graph.nodes.filter(item => item.kind === 'text'))
        expect(withUpstream.has(node.id), `${preset.id} 的文本节点 ${node.id} 有上游`).toBe(false)
    }
  })

  it('字幕源节点正文带 --> 时间轴（成片时间线只认这种文本节点当字幕来源）', () => {
    const srt = WORKFLOW_PRESETS.flatMap(preset => preset.graph.nodes
      .filter(node => node.kind === 'text' && /src|字幕/i.test(String(node.data.label ?? '')))
      .map(node => ({ preset: preset.id, node: node.id, content: String(node.data.content ?? '') })))
    expect(srt.length).toBeGreaterThanOrEqual(2)
    for (const item of srt)
      expect(item.content.includes('-->'), `${item.preset} 的 ${item.node} 不是 SRT 骨架`).toBe(true)
  })

  it('视频节点：生成节点是 Kling-2.5，模式是首帧驱动、口播或首尾帧；高清节点不写生成模型', () => {
    for (const preset of WORKFLOW_PRESETS) {
      for (const node of preset.graph.nodes.filter(item => item.kind === 'video')) {
        const data = node.data as { model?: string, videoMode?: string, params?: Record<string, unknown>, hdParams?: { resolution?: string, interp?: string, slowmo?: string } }
        if (isHdNode(node.data)) {
          expect(data.model, `${preset.id} 的 ${node.id} 高清节点不写生成模型`).toBeUndefined()
          expect((HD_RESOLUTION_ITEMS as readonly string[]).includes(String(data.hdParams?.resolution)), `${preset.id} 的 ${node.id}`).toBe(true)
          expect(data.hdParams?.interp, `${preset.id} 的 ${node.id}`).toBe('none')
          expect(data.hdParams?.slowmo, `${preset.id} 的 ${node.id}`).toBe('1x')
          continue
        }
        expect(data.model, `${preset.id} 的 ${node.id}`).toBe('Kling-2.5')
        expect(['i2v', 'talking', 'fl2v'].includes(String(data.videoMode)), `${preset.id} 的 ${node.id} videoMode=${data.videoMode}`).toBe(true)
        const duration = Number(data.params?.duration)
        expect(duration, `${preset.id} 的 ${node.id}`).toBeGreaterThanOrEqual(3)
        expect(duration, `${preset.id} 的 ${node.id}`).toBeLessThanOrEqual(15)
      }
    }
  })

  it('口播配方：视频节点走 talking，而且都连了首帧图（没连会静默回落成全能参考）', () => {
    const upstreamOf = (preset: (typeof WORKFLOW_PRESETS)[number], id: string) => {
      const byId = new Map(preset.graph.nodes.map(node => [node.id, node]))
      return preset.graph.edges.filter(edge => edge.target === id).map(edge => byId.get(edge.source))
    }
    let talkingCount = 0
    for (const id of TALKING_RECIPES) {
      const preset = findWorkflowPreset(id)!
      expect(preset, id).toBeTruthy()
      const talking = preset.graph.nodes.filter(node => node.kind === 'video' && (node.data as { videoMode?: string }).videoMode === 'talking')
      expect(talking.length, `${id} 没有口播视频节点`).toBeGreaterThanOrEqual(1)
      for (const node of talking) {
        talkingCount += 1
        expect(upstreamOf(preset, node.id).some(item => item?.kind === 'image'), `${id} 的 ${node.id} 没连首帧图`).toBe(true)
      }
    }
    expect(talkingCount).toBe(4)
  })

  it('首尾帧配方：两张上传图按连线顺序进同一个 fl2v 视频（先连的是首帧，后连的是尾帧）', () => {
    const preset = findWorkflowPreset('fl2v-first-last')
    expect(preset).toBeTruthy()
    const video = preset!.graph.nodes.find(node => node.kind === 'video')!
    expect((video.data as { videoMode?: string }).videoMode).toBe('fl2v')
    const incoming = preset!.graph.edges.filter(edge => edge.target === video.id)
    expect(incoming.map(edge => edge.source)).toEqual(['i1', 'i2'])
    for (const id of ['i1', 'i2']) {
      const node = preset!.graph.nodes.find(item => item.id === id)!
      expect(node.kind).toBe('image')
      expect((node.data as { model?: string }).model).toBeUndefined()
    }
    expect(preset!.estimatedPoints).toBe(80)
  })

  it('角色一致性配方：文本 → 定妆图 → 出镜，两处都等用户引用同一个主体', () => {
    const preset = findWorkflowPreset('character-consistency')
    expect(preset).toBeTruthy()
    expect(preset!.platform).toEqual({ ratio: '9:16', durationSeconds: 5, resolution: '1080P' })
    expect(preset!.estimatedPoints).toBe(91)
    expect(preset!.graph.nodes.map(node => node.kind)).toEqual(['text', 'image', 'video'])
    const image = preset!.graph.nodes.find(node => node.kind === 'image')!
    const video = preset!.graph.nodes.find(node => node.kind === 'video')!
    expect((image.data as { model?: string }).model).toBe('qwen-image-2.0')
    expect((video.data as { videoMode?: string }).videoMode).toBe('i2v')
    expect(preset!.graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['t1->i1', 'i1->v1'])
    expect(String(teachingText(preset!.teachingPoint))).toContain('subject_ids')
    expect(preset!.graph.nodes.some(node => Array.isArray((node.data as { subjectIds?: number[] }).subjectIds))).toBe(false)
  })

  it('场景延续配方：一张首帧扇出近景和全景，不写死场景主体编号', () => {
    const preset = findWorkflowPreset('scene-continuity')
    expect(preset).toBeTruthy()
    expect(preset!.estimatedPoints).toBe(171)
    expect(preset!.graph.nodes.map(node => `${node.id}:${node.kind}`)).toEqual(['t1:text', 'i1:image', 'v1:video', 'v2:video'])
    expect(preset!.graph.edges.map(edge => `${edge.source}->${edge.target}`)).toEqual(['t1->i1', 'i1->v1', 'i1->v2'])
    const near = preset!.graph.nodes.find(node => node.id === 'v1')!
    const far = preset!.graph.nodes.find(node => node.id === 'v2')!
    expect((near.data as { videoMode?: string, params?: { ratio?: string } }).videoMode).toBe('i2v')
    expect((near.data as { params?: { ratio?: string } }).params?.ratio).toBe('9:16')
    expect((far.data as { params?: { ratio?: string } }).params?.ratio).toBe('16:9')
    expect(preset!.platform?.shotLine).toBe('近景 9:16 / 全景 16:9')
    expect(String(teachingText(preset!.teachingPoint))).toContain('subject_ids')
    expect(preset!.graph.nodes.some(node => Array.isArray((node.data as { subjectIds?: number[] }).subjectIds))).toBe(false)
  })

  it('出片后再高清：成片连到高清节点，卡片点数只含出片', () => {
    const preset = findWorkflowPreset('clip-then-hd')
    expect(preset).toBeTruthy()
    expect(preset!.estimatedPoints).toBe(91)
    const hd = preset!.graph.nodes.find(node => node.id === 'h1')!
    expect(isHdNode(hd.data)).toBe(true)
    expect((hd.data as { hdParams?: { resolution?: string } }).hdParams?.resolution).toBe('2K')
    expect(preset!.graph.edges.some(edge => edge.source === 'v1' && edge.target === 'h1')).toBe(true)
    const clip = preset!.graph.nodes.find(node => node.id === 'v1')!
    expect((clip.data as { model?: string, videoMode?: string }).model).toBe('Kling-2.5')
    expect((clip.data as { videoMode?: string }).videoMode).toBe('i2v')
    expect(String(teachingText(preset!.teachingPoint))).toContain('upscale')
  })

  it('音视频连线方向：配音轨必须是 video → audio（后端按这个方向把配音挂到镜头上）', () => {
    const audioEdges = WORKFLOW_PRESETS.flatMap(preset => preset.graph.edges
      .filter((edge) => {
        const target = preset.graph.nodes.find(node => node.id === edge.target)
        return target?.kind === 'audio'
      })
      .map((edge) => {
        const source = preset.graph.nodes.find(node => node.id === edge.source)
        return { preset: preset.id, from: source?.kind, to: 'audio' }
      }))
    expect(audioEdges.length).toBeGreaterThanOrEqual(1)
    for (const edge of audioEdges)
      expect(edge.from, `${edge.preset} 的配音轨连线`).toBe('video')
  })
})

describe('配方分组与面板顺序', () => {
  it('分组顺序：通用 → 电商商品 → 本地生活 → 课程知识', () => {
    expect(WORKFLOW_PRESET_GROUPS.map(group => group.scenario)).toEqual(SCENARIO_ORDER)
  })

  it('每条配方都落进某个分组，组内顺序与 WORKFLOW_PRESETS 的声明顺序一致', () => {
    const groups = groupedWorkflowPresets()
    const flattened = groups.flatMap(group => group.items.map(item => item.id))
    expect(flattened).toEqual(WORKFLOW_PRESETS.map(item => item.id))
    // 组标题与说明都写了（渲染时过 t()）
    for (const group of groups) {
      expect(group.label.trim(), group.scenario).not.toBe('')
      expect(group.note.trim(), group.scenario).not.toBe('')
    }
    // 通用组排最前，说明要覆盖现在组里的配方，不再写成「零素材从零起步」
    expect(groups[0]!.scenario).toBe('generic')
    expect(groups[0]!.note).toContain('首尾帧')
    expect(groups[0]!.note).toContain('出片后再高清')
    expect(groups[0]!.note.includes('零素材从零起步')).toBe(false)
    expect(groups[0]!.items.map(item => item.id)).toEqual(['prompt-to-video', 'multi-shot', 'fl2v-first-last', 'character-consistency', 'scene-continuity', 'clip-then-hd'])
  })

  it('空组不渲染：给个只带通用配方的列表，返回的组也只有通用', () => {
    const groups = groupedWorkflowPresets(WORKFLOW_PRESETS.filter(item => item.scenario === 'generic'))
    expect(groups.map(group => group.scenario)).toEqual(['generic'])
  })

  it('迁移：图生视频·首帧驱动与参考图定妆出片已下线，不再进面板', () => {
    expect(findWorkflowPreset('image-to-video')).toBeNull()
    expect(findWorkflowPreset('reference-to-video')).toBeNull()
    expect(WORKFLOW_PRESETS).toHaveLength(12)
  })
})

describe('配方文案的翻译覆盖（t(preset.name) 这类非字面量写法扫不到，单独兜住）', () => {
  const locales = ['zh', 'zh-TW', 'en', 'ja', 'fr', 'ru', 'vi']

  it('配方名 / 说明、分组标题 / 说明都在 7 个语言文件里', () => {
    const keys = new Set<string>()
    for (const preset of WORKFLOW_PRESETS) {
      keys.add(preset.name)
      keys.add(preset.hint)
      if (preset.platform?.shotLine)
        keys.add(preset.platform.shotLine)
    }
    for (const group of WORKFLOW_PRESET_GROUPS) {
      keys.add(group.label)
      keys.add(group.note)
    }
    for (const name of locales) {
      const table = JSON.parse(readFileSync(`i18n/locales/${name}.json`, 'utf8')) as Record<string, unknown>
      const missing = [...keys].filter(key => !(key in table))
      expect(missing, `${name} 缺译文`).toEqual([])
    }
  })

  it('面板的规格行 / 点数行是标准插值 key（zh.json 里必须有，否则回退 key 时不做插值）', () => {
    const zh = JSON.parse(readFileSync('i18n/locales/zh.json', 'utf8')) as Record<string, unknown>
    for (const key of ['{ratio} · {seconds} 秒 · {resolution}', '预计 {n} 点', '预计 {n} 点（高清另计）'])
      expect(key in zh, key).toBe(true)
  })
})
