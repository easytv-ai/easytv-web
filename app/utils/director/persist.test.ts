import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_GRAPH_LIMIT_BYTES,
  CANVAS_GRAPH_WARN_BYTES,
  estimateJsonBytes,
  estimateProjectBytes,
  graphHeavyNames,
  isDirectorProject,
  isGraphNearLimit,
  isGraphOverLimit,
  prepareProjectForSave,
  sanitizeProjectForSave,
  SCENE_SOFT_LIMIT_BYTES,
} from './persist'
import { createDefaultDirectorProject } from './default-project'
import type { DirectorProject } from './schema'

function withCaptures(): DirectorProject {
  const project = createDefaultDirectorProject()
  const dataUrl = `data:image/png;base64,${'A'.repeat(4000)}`
  project.cameras[0]!.captures = [
    { id: 'c1', index: 1, name: '机位01-截图01', dataUrl },
    { id: 'c2', index: 2, name: '机位01-截图02', dataUrl },
  ]
  project.cameras[0]!.lastCaptureUrl = dataUrl
  return project
}

describe('sanitizeProjectForSave', () => {
  it('摘掉机位截图 —— 一张 base64 PNG 就能把整张画布顶过上限', () => {
    const before = estimateProjectBytes(withCaptures())
    const after = sanitizeProjectForSave(withCaptures())

    expect(after.cameras[0]!.captures).toEqual([])
    expect(after.cameras[0]!.lastCaptureUrl).toBeNull()
    expect(estimateProjectBytes(after)).toBeLessThan(before / 2)
  })

  it('已上传的导入模型留着，刷新后还能进场景', () => {
    const project = createDefaultDirectorProject()
    project.assets = [
      { id: 'model1', kind: 'prop', sourceType: 'model', fileName: 'chair.glb', url: 'https://cdn.example/chair.glb', assetSource: 'library' },
    ]
    project.objects.push({
      id: 'model_1',
      name: 'chair',
      kind: 'prop',
      visible: true,
      locked: false,
      assetRefId: 'model1',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    })

    const after = sanitizeProjectForSave(project)
    expect(after.assets.map(item => item.id)).toEqual(['model1'])
    expect(after.objects.find(item => item.id === 'model_1')?.assetRefId).toBe('model1')
  })

  it('摘掉本地 blob 素材：刷新就失效，存下来下次只会加载失败', () => {
    const project = createDefaultDirectorProject()
    project.assets = [
      { id: 'local1', kind: 'panorama', sourceType: 'image', fileName: 'a.jpg', url: 'blob:x', assetSource: 'local' },
      { id: 'remote1', kind: 'panorama', sourceType: 'image', fileName: 'b.jpg', url: 'https://x/b.jpg', assetSource: 'library' },
    ]

    const after = sanitizeProjectForSave(project)
    expect(after.assets.map(item => item.id)).toEqual(['remote1'])
  })

  it('素材被摘掉时引用也断开，不留指向不存在 id 的悬空引用', () => {
    const project = createDefaultDirectorProject()
    project.assets = [
      { id: 'local1', kind: 'panorama', sourceType: 'image', fileName: 'a.jpg', url: 'blob:x', assetSource: 'local' },
    ]
    project.panoramaAssetId = 'local1'
    project.objects[0]!.assetRefId = 'local1'

    const after = sanitizeProjectForSave(project)
    expect(after.panoramaAssetId).toBeNull()
    expect(after.objects[0]!.assetRefId).toBeUndefined()
  })

  it('本地形象图摘掉时 lookAssetId 也断开', () => {
    const project = createDefaultDirectorProject()
    project.assets = [
      { id: 'look1', kind: 'character', sourceType: 'image', fileName: 'face.jpg', url: 'blob:x', assetSource: 'local' },
    ]
    project.objects[0]!.lookAssetId = 'look1'

    const after = sanitizeProjectForSave(project)
    expect(after.assets).toHaveLength(0)
    expect(after.objects[0]!.lookAssetId).toBeUndefined()
  })

  it('已上传的形象图留着', () => {
    const project = createDefaultDirectorProject()
    project.assets = [
      { id: 'look1', kind: 'character', sourceType: 'image', fileName: 'face.jpg', url: 'https://cdn/face.jpg', assetSource: 'library' },
    ]
    project.objects[0]!.lookAssetId = 'look1'

    const after = sanitizeProjectForSave(project)
    expect(after.objects[0]!.lookAssetId).toBe('look1')
    expect(after.assets[0]!.url).toBe('https://cdn/face.jpg')
  })

  it('服务器地址的全景留着，它刷新之后照样能打开', () => {
    const project = createDefaultDirectorProject()
    project.assets = [
      { id: 'remote1', kind: 'panorama', sourceType: 'image', fileName: 'b.jpg', url: 'https://x/b.jpg', assetSource: 'library' },
    ]
    project.panoramaAssetId = 'remote1'

    expect(sanitizeProjectForSave(project).panoramaAssetId).toBe('remote1')
  })

  it('角色、机位、运镜节点这些真正的场景内容一条不少', () => {
    const project = withCaptures()
    const after = sanitizeProjectForSave(project)

    expect(after.objects).toHaveLength(project.objects.length)
    expect(after.cameras).toHaveLength(project.cameras.length)
    expect(after.scene).toEqual(project.scene)
  })
})

describe('estimateProjectBytes', () => {
  it('按 UTF-8 算，中文名字一个字三字节', () => {
    const ascii = createDefaultDirectorProject()
    ascii.objects[0]!.name = 'AAA'
    const chinese = createDefaultDirectorProject()
    chinese.objects[0]!.name = '角色甲'

    expect(estimateProjectBytes(chinese)).toBe(estimateProjectBytes(ascii) + 6)
  })
})

describe('prepareProjectForSave', () => {
  it('默认场景远在软上限之内', () => {
    const result = prepareProjectForSave(createDefaultDirectorProject())
    expect(result.withinLimit).toBe(true)
    expect(result.bytes).toBeLessThan(SCENE_SOFT_LIMIT_BYTES / 10)
  })

  it('带一堆截图的场景，摘干净之后也在限内', () => {
    expect(prepareProjectForSave(withCaptures()).withinLimit).toBe(true)
  })

  it('内容真的超标时如实报出来，不悄悄放过', () => {
    const project = createDefaultDirectorProject()
    project.objects[0]!.name = 'x'.repeat(SCENE_SOFT_LIMIT_BYTES + 10)
    expect(prepareProjectForSave(project).withinLimit).toBe(false)
  })
})

describe('isDirectorProject', () => {
  it('认得出真场景', () => {
    expect(isDirectorProject(createDefaultDirectorProject())).toBe(true)
  })

  it('挡住乱七八糟的值 —— 节点里存的东西不一定是个像样的场景', () => {
    expect(isDirectorProject(null)).toBe(false)
    expect(isDirectorProject('{}')).toBe(false)
    expect(isDirectorProject({})).toBe(false)
    expect(isDirectorProject({ objects: [], cameras: [] })).toBe(false)
  })
})

describe('isGraphOverLimit', () => {
  it('空图画布远低于 2MB，塞满才拦', () => {
    expect(isGraphOverLimit({ nodes: [], edges: [] })).toBe(false)
    expect(estimateJsonBytes({ a: 1 })).toBeGreaterThan(0)
    expect(isGraphOverLimit({ blob: 'x'.repeat(CANVAS_GRAPH_LIMIT_BYTES) })).toBe(true)
  })

  it('画布页和导演台保存前会先量 graph', () => {
    const page = readFileSync('app/pages/canvas/index.vue', 'utf8')
    expect(page).toContain('isGraphOverLimit')
    expect(page).toContain('isGraphNearLimit')
    expect(page).toContain('graphHeavyNames')
    expect(page).toContain("t('canvas.graph.tooLargeDetail'")
    expect(page).toContain("t('canvas.graph.nearLimitDetail'")
    const workspace = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(workspace).toContain('sanitizeGraphForSave')
    const director = readFileSync('app/pages/canvas/director.vue', 'utf8')
    expect(director).toContain('isGraphOverLimit')
    expect(director).toContain('isGraphNearLimit')
    expect(director).toContain('graphHeavyNames')
  })

  it('80% 软预警还没到硬上限', () => {
    expect(isGraphNearLimit({ nodes: [] })).toBe(false)
    expect(isGraphNearLimit({ blob: 'x'.repeat(CANVAS_GRAPH_WARN_BYTES) })).toBe(true)
    expect(isGraphNearLimit({ blob: 'x'.repeat(CANVAS_GRAPH_LIMIT_BYTES) })).toBe(false)
  })

  it('点名体积最大的节点', () => {
    const graph = {
      nodes: [
        { id: 'a', data: { label: '小' } },
        { id: 'b', data: { label: '导演台大场景', scene: 'x'.repeat(800) } },
        { id: 'c', data: { label: '中', prompt: 'y'.repeat(80) } },
      ],
    }
    expect(graphHeavyNames(graph, 1)).toBe('导演台大场景')
  })
})
