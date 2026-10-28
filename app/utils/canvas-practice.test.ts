import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  anchorSelector,
  findPracticeScript,
  gateSatisfied,
  PRACTICE_LEVELS,
  PRACTICE_SCRIPTS,
  PRACTICE_REPLAY_KINDS,
  practiceAnchorKey,
  practiceAutoPreparePlan,
  PRACTICE_IMAGE_PROMPT,
  practiceGraphView,
  practiceKindLabel,
  practiceProgress,
  practiceReadyItems,
  practiceReplayFailPatch,
  practiceReplayFor,
  practiceReplayPatch,
  PRACTICE_ROLE_SCRIPT,
  practiceScopedGraphView,
  PRACTICE_SHOT_SCRIPT,
  practiceSpotForNewNode,
  practiceStepSatisfied,
  PRACTICE_VIDEO_PROMPT,
  stepKeyOf,
  stepKindOf,
  type PracticePrepare,
  type PracticeScript,
  type PracticeStep,
} from './canvas-practice'
import { talkingDuration } from './canvas-talking'

describe('practiceSpotForNewNode（跟练新建节点的落点）', () => {
  it('画布空着时不插手：返回 null，由调用方用视口中心', () => {
    expect(practiceSpotForNewNode([])).toBeNull()
  })

  it('已有内容时落到最右节点右边 80px、与最上节点同顶（不再叠在视口中心）', () => {
    const spot = practiceSpotForNewNode([
      { x: 120, y: 300, w: 320, h: 240 },
      { x: 560, y: 200, w: 320, h: 220 },
    ])
    expect(spot).toEqual({ x: 960, y: 200 })
    // 与任何已有节点都不重叠
    for (const box of [{ x: 120, y: 300, w: 320, h: 240 }, { x: 560, y: 200, w: 320, h: 220 }])
      expect(spot!.x).toBeGreaterThanOrEqual(box.x + box.w)
  })

  it('单个节点时同样落在它右侧，且纵向与它同顶', () => {
    expect(practiceSpotForNewNode([{ x: 0, y: 120, w: 320, h: 220 }])).toEqual({ x: 400, y: 120 })
  })
})

const node = (id: string, kind: string, data: Record<string, any> = {}) => ({ id, data: { kind, ...data } })
const viewOf = (nodes: any[], edges: Array<{ source: string, target: string }> = []) => practiceGraphView({ nodes, edges })

describe('practiceGraphView', () => {
  it('扁平化节点与连线，并丢掉指向不存在节点的连线', () => {
    const view = practiceGraphView({
      nodes: [node('i1', 'image', { model: 'qwen-image-2.0', prompt: '猫', content: 'https://cdn/a.png' })],
      edges: [{ source: 'i1', target: 'v9' }],
    })
    expect(view.nodes).toEqual([{
      id: 'i1',
      kind: 'image',
      model: 'qwen-image-2.0',
      prompt: '猫',
      key: '',
      subjects: 0,
      talking: false,
      hasResult: true,
    }])
    expect(view.edges).toEqual([])
  })

  it('文本节点 data 同时有 prompt:"" 与 content:"x" 时，视图 prompt 回落到 content（`??` 会让判据永不满足）', () => {
    const view = practiceGraphView({ nodes: [node('t1', 'text', { prompt: '', content: '一句脚本' })], edges: [] })
    expect(view.nodes[0]!.prompt).toBe('一句脚本')
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'text' }, view)).toBe(true)
  })

  it('跟练给节点起的 practiceKey、主体引用数与台词都进视图', () => {
    const view = practiceGraphView({
      nodes: [
        node('i1', 'image', { practiceKey: 'cast-image', subjectIds: [3, 5] }),
        node('v1', 'video', { practiceKey: 'talk', talking: { script: '一句台词', tone: 'natural', framing: 'close' } }),
        node('v2', 'video', { practiceKey: 'silent', talking: { script: '   ' } }),
      ],
      edges: [],
    })
    expect(view.nodes[0]!.key).toBe('cast-image')
    expect(view.nodes[0]!.subjects).toBe(2)
    expect(view.nodes[1]!.talking).toBe(true)
    // 只有空白的台词不算有台词
    expect(view.nodes[2]!.talking).toBe(false)
  })

  it('文本节点的 content 也算产物，空节点不算', () => {
    const view = practiceGraphView({ nodes: [node('t1', 'text', { content: '一句脚本' }), node('i1', 'image')], edges: [] })
    expect(view.nodes[0]!.hasResult).toBe(true)
    expect(view.nodes[1]!.hasResult).toBe(false)
  })
})

describe('gateSatisfied（只读视图的判据，自动备好计划仍只看它）', () => {
  const view = viewOf([
    node('i1', 'image', { practiceKey: 'cover', model: 'qwen-image-2.0', prompt: '首帧描述' }),
    node('v1', 'video', { practiceKey: 'v-feed', model: 'Kling-2.5' }),
    node('v2', 'video', { practiceKey: 'v-square', model: 'Kling-2.5', talking: { script: '台词' }, subjectIds: [1] }),
    node('t1', 'text', { practiceKey: 'script', prompt: '', content: '两镜脚本' }),
    node('a1', 'audio', { practiceKey: 'voice' }),
  ], [{ source: 'i1', target: 'v1' }, { source: 'i1', target: 'v2' }])

  it('节点数量 / 提示词 / 模型 / 连线 / 产物各自的判据', () => {
    expect(gateSatisfied({ kind: 'node', nodeKind: 'image', atLeast: 1 }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'node', nodeKind: 'audio', atLeast: 1 }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'node', nodeKind: 'video', atLeast: 3 }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'text' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'video' }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'model', nodeKind: 'image', model: 'qwen-image-2.0' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'model', nodeKind: 'image', model: 'Qwen-Image-2.0' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'model', nodeKind: 'video', model: 'kling-2.5' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'model', nodeKind: 'image', model: '别的模型' }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'edge', fromKind: 'image', toKind: 'video' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'edge', fromKind: 'video', toKind: 'image' }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'result', nodeKind: 'image' }, view)).toBe(false)
  })

  it('带 key 的判据只认那个 practiceKey 的节点（多镜 / 多规格剧本靠它认人）', () => {
    expect(gateSatisfied({ kind: 'node', nodeKind: 'video', atLeast: 1, key: 'v-square' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'node', nodeKind: 'video', atLeast: 1, key: 'v-wide' }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'text', key: 'script' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'text', key: '别的脚本' }, view)).toBe(false)
    // 连线判据按 fromKey / toKey 认人：同一张首帧扇出的多条视频互不串
    expect(gateSatisfied({ kind: 'edge', fromKind: 'image', toKind: 'video', fromKey: 'cover', toKey: 'v-feed' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'edge', fromKind: 'image', toKind: 'video', fromKey: 'cover', toKey: 'v-wide' }, view)).toBe(false)
  })

  it('主体引用 / 台词判据（进阶课的主体引用与高阶课的口播都靠它）', () => {
    expect(gateSatisfied({ kind: 'subject', nodeKind: 'video', key: 'v-square' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'subject', nodeKind: 'video', key: 'v-feed' }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'subject', nodeKind: 'video', key: 'v-square', atLeast: 2 }, view)).toBe(false)
    expect(gateSatisfied({ kind: 'talking', nodeKind: 'video', key: 'v-square' }, view)).toBe(true)
    expect(gateSatisfied({ kind: 'talking', nodeKind: 'video', key: 'v-feed' }, view)).toBe(false)
  })

  it('产物判据：带 atLeast 数该 kind 里已有产物的节点数（扇出步要 N 条都跑完）', () => {
    const doneView = viewOf([
      node('v1', 'video', { content: '/images/tutorial/clip.mp4' }),
      node('v2', 'video', { content: '/images/tutorial/clip.mp4' }),
    ])
    expect(gateSatisfied({ kind: 'result', nodeKind: 'video', atLeast: 2 }, doneView)).toBe(true)
    expect(gateSatisfied({ kind: 'result', nodeKind: 'video', atLeast: 3 }, doneView)).toBe(false)
    expect(gateSatisfied({ kind: 'result', nodeKind: 'video' }, doneView)).toBe(true)
  })

  it('demo 判据视图满足不了（演示步的完成态只能由会话 done 给）', () => {
    expect(gateSatisfied({ kind: 'demo' }, view)).toBe(false)
  })

  it('没配判据的步骤一律算做完', () => {
    expect(gateSatisfied(undefined, view)).toBe(true)
  })
})

describe('practiceStepSatisfied（完成态的唯一入口：判据或会话 done）', () => {
  const empty = viewOf([])
  const step = (gate: PracticeStep['gate']): PracticeStep => ({ id: 'x', title: 't', summary: 's', body: 'b', gate })

  it('判据满足就算完成，没满足且没进 done 就不算', () => {
    const withNode = viewOf([node('i1', 'image')])
    expect(practiceStepSatisfied(step({ kind: 'node', nodeKind: 'image', atLeast: 1 }), withNode)).toBe(true)
    expect(practiceStepSatisfied(step({ kind: 'node', nodeKind: 'image', atLeast: 1 }), empty)).toBe(false)
    // 没配判据的过场步在视图上算完成（主按钮走「继续」）
    expect(practiceStepSatisfied(step(undefined), empty)).toBe(true)
    expect(practiceStepSatisfied(null, empty)).toBe(false)
  })

  it('demo 步：宿主演示完写 done 才算完成（引导自己演示的语义）', () => {
    const demo = step({ kind: 'demo' })
    expect(practiceStepSatisfied(demo, empty)).toBe(false)
    expect(practiceStepSatisfied(demo, empty, new Set(['x']))).toBe(true)
  })

  it('跳过（result 步进 done）也算完成：不看画布，进度只增不减', () => {
    const run = step({ kind: 'result', nodeKind: 'video', key: 'talk' })
    expect(practiceStepSatisfied(run, empty)).toBe(false)
    expect(practiceStepSatisfied(run, empty, new Set(['x']))).toBe(true)
    // done 是别的步也不会误伤
    expect(practiceStepSatisfied(run, empty, new Set(['别的步']))).toBe(false)
  })
})

describe('anchorSelector', () => {
  const view = viewOf([node('i1', 'image')])

  it('节点锚点落到该类的第一个节点上，找不到就回落到工具轨', () => {
    expect(anchorSelector('node:image', view)).toBe('[data-id="i1"]')
    expect(anchorSelector('node:video', view)).toBe('[data-guide="tools"]')
  })

  it('data-guide 锚点原样透传，没锚点给 null', () => {
    expect(anchorSelector('inspector-run', view)).toBe('[data-guide="inspector-run"]')
    expect(anchorSelector('inspector-subject', view)).toBe('[data-guide="inspector-subject"]')
    expect(anchorSelector('inspector-talking', view)).toBe('[data-guide="inspector-talking"]')
    expect(anchorSelector('inspector-cam', view)).toBe('[data-guide="inspector-cam"]')
    expect(anchorSelector('inspector-audio', view)).toBe('[data-guide="inspector-audio"]')
    expect(anchorSelector(undefined, view)).toBeNull()
  })
})

describe('practiceAnchorKey（换步 / 换节点时聚光直落的判据）', () => {
  const view = viewOf([node('i1', 'image'), node('v1', 'video')])

  it('步 id + 锚点选择器；换步或换锚点都会变，没锚点也不炸', () => {
    const stepA: PracticeStep = { id: 'a', title: 't', summary: 's', body: 'b', anchor: 'node:image' }
    const stepB: PracticeStep = { id: 'b', title: 't', summary: 's', body: 'b', anchor: 'node:image' }
    expect(practiceAnchorKey(stepA, view)).toBe('a#[data-id="i1"]')
    expect(practiceAnchorKey(stepB, view)).toBe('b#[data-id="i1"]')
    expect(practiceAnchorKey(stepA, view)).not.toBe(practiceAnchorKey(stepB, view))
    // 同类节点的第二张卡出现后锚点身份也跟着变
    expect(practiceAnchorKey(stepA, viewOf([node('i0', 'image'), node('i1', 'image')]))).toBe('a#[data-id="i0"]')
    expect(practiceAnchorKey({ ...stepA, anchor: undefined }, view)).toBe('a#')
    expect(practiceAnchorKey(null, view)).toBe('')
  })
})

describe('practiceScopedGraphView（基线快照：非空画布上不能指错节点）', () => {
  const preset = {
    nodes: [
      node('i1', 'image', { prompt: '用户自己写的图', model: 'qwen-image-2.0', content: 'https://cdn/a.png' }),
      node('v1', 'video', { model: 'Kling-2.5' }),
    ],
    edges: [{ source: 'i1', target: 'v1' }],
  }

  it('没有基线时与 practiceGraphView 等价', () => {
    expect(practiceScopedGraphView(preset)).toEqual(practiceGraphView(preset))
    expect(practiceScopedGraphView(preset, new Set())).toEqual(practiceGraphView(preset))
  })

  it('基线里的 image 不算数：跟练新建的才放行', () => {
    const scoped = practiceScopedGraphView(preset, new Set(['i1']))
    expect(scoped.nodes.map(item => item.id)).toEqual(['v1'])
    expect(gateSatisfied({ kind: 'node', nodeKind: 'image', atLeast: 1 }, scoped)).toBe(false)
    const grown = practiceScopedGraphView({ nodes: [...preset.nodes, node('i2', 'image', { prompt: '跟练填的' })], edges: preset.edges }, new Set(['i1']))
    expect(gateSatisfied({ kind: 'node', nodeKind: 'image', atLeast: 1 }, grown)).toBe(true)
  })

  it('提示词 / 模型 / 主体 / 产物判据都忽略基线节点（prepare 不会写用户的原节点）', () => {
    const scoped = practiceScopedGraphView({ nodes: [preset.nodes[0]!], edges: [] }, new Set(['i1']))
    expect(scoped.nodes).toEqual([])
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'image' }, scoped)).toBe(false)
    expect(gateSatisfied({ kind: 'model', nodeKind: 'image', model: 'qwen-image-2.0' }, scoped)).toBe(false)
    expect(gateSatisfied({ kind: 'result', nodeKind: 'image' }, scoped)).toBe(false)
    const grown = practiceScopedGraphView({
      nodes: [preset.nodes[0]!, node('i2', 'image', { prompt: '跟练填的', model: 'qwen-image-2.0' })],
      edges: [],
    }, new Set(['i1']))
    expect(gateSatisfied({ kind: 'prompt', nodeKind: 'image' }, grown)).toBe(true)
    expect(gateSatisfied({ kind: 'model', nodeKind: 'image', model: 'qwen-image-2.0' }, grown)).toBe(true)
    expect(gateSatisfied({ kind: 'result', nodeKind: 'image' }, grown)).toBe(false)
  })

  it('锚点也指向跟练自己的节点，不指向基线里的同类节点', () => {
    const grown = practiceScopedGraphView({
      nodes: [node('i1', 'image'), node('i2', 'image')],
      edges: [],
    }, new Set(['i1']))
    expect(anchorSelector('node:image', grown)).toBe('[data-id="i2"]')
  })

  it('端点落在基线里的连线一并作废：不会靠用户原有的连线蒙混过关', () => {
    const scoped = practiceScopedGraphView(preset, new Set(['i1']))
    expect(scoped.edges).toEqual([])
    expect(gateSatisfied({ kind: 'edge', fromKind: 'image', toKind: 'video' }, scoped)).toBe(false)
  })
})

describe('stepKindOf / stepKeyOf（宿主定位 inspector 锚点与回放节点）', () => {
  it('每个 inspector-* 锚点的步骤都能推出一个 nodeKind，脚本里不留悬空锚点', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const inspectorSteps = script.steps.filter(s => s.anchor?.startsWith('inspector'))
      expect(inspectorSteps.length, script.id).toBeGreaterThanOrEqual(2)
      for (const step of inspectorSteps)
        expect(stepKindOf(step), `${script.id}/${step.id} 推不出 nodeKind`).toBeTruthy()
    }
  })

  it('判据优先，其次看 prepare；都没有给 null（开场 / 收尾）', () => {
    const script = findPracticeScript('image-video-basics')!
    const byId = new Map(script.steps.map(s => [s.id, s]))
    expect(stepKindOf(byId.get('add-image'))).toBe('image')
    expect(stepKindOf(byId.get('run-image'))).toBe('image')
    expect(stepKindOf(byId.get('run-video'))).toBe('video')
    expect(stepKindOf({ id: 'x', title: 't', summary: 's', body: 'b' })).toBeNull()
    expect(stepKindOf(null)).toBeNull()
  })

  it('stepKeyOf 取 prepare.key 优先、判据 key 兜底（多镜剧本靠它选对节点）', () => {
    const storyboard = findPracticeScript('storyboard-shots')!
    const byId = new Map(storyboard.steps.map(s => [s.id, s]))
    expect(stepKeyOf(byId.get('script'))).toBe('script')
    expect(stepKeyOf(byId.get('shot-1'))).toBe('s1-image')
    expect(stepKeyOf(byId.get('chain-2'))).toBe('s2-video')
    expect(stepKeyOf(byId.get('run-videos'))).toBeNull()
    // 判据里带 key、prepare 没带（生成步）时按判据的 key 定位
    const runStep: PracticeStep = { id: 'r', title: 't', summary: 's', body: 'b', gate: { kind: 'result', nodeKind: 'video', key: 'talk' } }
    expect(stepKeyOf(runStep)).toBe('talk')
    expect(stepKeyOf(null)).toBeNull()
  })
})

describe('practiceKindLabel（清单 / 卡片 / 兜底共用的名字）', () => {
  it('节点类型与主体类型都翻成中文名', () => {
    expect(practiceKindLabel('image')).toBe('图片')
    expect(practiceKindLabel('video')).toBe('视频')
    expect(practiceKindLabel('audio')).toBe('音频')
    expect(practiceKindLabel('text')).toBe('文本')
    expect(practiceKindLabel('character')).toBe('角色')
    expect(practiceKindLabel('scene')).toBe('场景')
    expect(practiceKindLabel('prop')).toBe('道具')
    expect(practiceKindLabel('director')).toBe('3D 导演台')
    expect(practiceKindLabel('别的')).toBe('节点')
  })
})

describe('practiceProgress（常驻清单的进度与打勾）', () => {
  const script = findPracticeScript('image-video-basics')!
  const empty = viewOf([])

  it('开场：六行都在、没人打勾，当前行是 welcome', () => {
    const progress = practiceProgress(script.steps, empty, 0)
    expect(progress.total).toBe(6)
    expect(progress.done).toBe(0)
    expect(progress.items[0]).toEqual({ id: 'welcome', index: 0, state: 'current', checked: false })
    expect(progress.items[5]).toEqual({ id: 'done', index: 5, state: 'todo', checked: false })
  })

  it('当前步的东西已备好 → 当前行立刻打勾，顶部数字跟着变', () => {
    const view = viewOf([node('i1', 'image')])
    const progress = practiceProgress(script.steps, view, 1)
    expect(progress.done).toBe(2)
    expect(progress.items[0]).toEqual({ id: 'welcome', index: 0, state: 'done', checked: true })
    expect(progress.items[1]).toEqual({ id: 'add-image', index: 1, state: 'current', checked: true })
    expect(progress.items[2]?.checked).toBe(false)
  })

  it('当前步判据没满足就不打勾（东西还没备上）', () => {
    const progress = practiceProgress(script.steps, empty, 3)
    expect(progress.done).toBe(3)
    expect(progress.items[3]).toEqual({ id: 'run-image', index: 3, state: 'current', checked: false })
  })

  it('进了会话 done 的步（演示 / 跳过）在清单上也打勾：第 4 参传进去', () => {
    const progress = practiceProgress(script.steps, empty, 3, new Set(['run-image']))
    expect(progress.items[3]?.checked).toBe(true)
    expect(progress.done).toBe(4)
    // 不传 done 时同一行还是没完成（画布上没有产物），顶部数字也少一个
    expect(practiceProgress(script.steps, empty, 3).items[3]?.checked).toBe(false)
    expect(practiceProgress(script.steps, empty, 3).done).toBe(3)
  })

  it('判据是"东西在不在"，跳回前面的步骤时后面的打勾不会缩水', () => {
    const view = viewOf([
      node('i1', 'image', { prompt: '首帧' }),
      node('v1', 'video', { model: 'Kling-2.5' }),
    ], [{ source: 'i1', target: 'v1' }])
    const progress = practiceProgress(script.steps, view, 1)
    expect(progress.items.slice(0, 3).every(item => item.checked)).toBe(true)
    expect(progress.items[3]?.checked).toBe(false)
    expect(progress.done).toBe(3)
  })
})

describe('practiceAutoPreparePlan（进入一步就把到这一步为止欠的都备好）', () => {
  const empty = viewOf([])

  it('只计划到目标步为止，顺序就是依赖顺序', () => {
    const script = findPracticeScript('image-video-basics')!
    const plan = practiceAutoPreparePlan(script.steps, 3, empty)
    expect(plan).toEqual([
      { kind: 'add-node', nodeKind: 'image' },
      { kind: 'add-connect', fromKind: 'image', toKind: 'video' },
      {
        kind: 'image-setup',
        nodeKind: 'image',
        model: 'qwen-image-2.0',
        params: { ratio: '16:9', clarity: '2K', quality: 'std' },
        prompt: PRACTICE_IMAGE_PROMPT,
      },
    ])
  })

  it('从清单直接点最后一行：整条链一次计划齐，多镜剧本的 key 按依赖顺序落', () => {
    const basics = findPracticeScript('image-video-basics')!
    expect(practiceAutoPreparePlan(basics.steps, basics.steps.length - 1, empty).map(item => item.kind))
      .toEqual(['add-node', 'add-connect', 'image-setup', 'video-setup'])

    const storyboard = findPracticeScript('storyboard-shots')!
    const plan = practiceAutoPreparePlan(storyboard.steps, storyboard.steps.length - 1, empty)
    expect(plan.map(item => ('key' in item ? item.key : null)))
      .toEqual(['script', 's1-image', 's2-image', 's1-video', 's2-video'])
  })

  it('判据已满足的步不入列（不会重复建节点 / 重复写）', () => {
    const script = findPracticeScript('image-video-basics')!
    const view = viewOf([node('i1', 'image', { prompt: '用户自己写的' }), node('v1', 'video')], [{ source: 'i1', target: 'v1' }])
    const plan = practiceAutoPreparePlan(script.steps, 3, view)
    // 放节点与连线都已就位，只剩出图那步的 setup
    expect(plan.map(item => item.kind)).toEqual(['image-setup'])
  })

  it('demo 判据不会把演示步的（并不存在的）动作混进计划', () => {
    const camera = findPracticeScript('camera-language')!
    const plan = practiceAutoPreparePlan(camera.steps, camera.steps.length - 1, empty)
    expect(plan.map(item => item.kind)).toEqual(['video-setup'])
  })

  it('空剧本 / 越界的 targetIndex 都不炸', () => {
    const script = findPracticeScript('image-video-basics')!
    expect(practiceAutoPreparePlan([], 3, empty)).toEqual([])
    expect(practiceAutoPreparePlan(script.steps, 99, empty).length).toBeGreaterThan(0)
    expect(practiceAutoPreparePlan(script.steps, -1, empty)).toEqual([])
  })
})

describe('practiceReadyItems（卡片上「跟练已替你布好这一步」的内容）', () => {
  const withApplied = (scriptId: string, stepId: string) => {
    const script = findPracticeScript(scriptId)!
    const step = script.steps.find(item => item.id === stepId)!
    return practiceReadyItems(step, [{ stepId, prep: step.prepare! }])
  }

  it('放节点 / 连线两种动作各一行（沿用旧键）', () => {
    expect(withApplied('image-video-basics', 'add-image')).toEqual([{ kind: 'node', nodeKind: 'image' }])
    expect(withApplied('image-video-basics', 'add-video')).toEqual([{ kind: 'connect', fromKind: 'image', toKind: 'video' }])
  })

  it('setup 类按这一次实际写入的字段拆多行：模型行带参数、主体行带主体名', () => {
    expect(withApplied('image-video-basics', 'run-image')).toEqual([
      { kind: 'model', value: 'qwen-image-2.0 · 16:9 · 2K · std' },
    ])
    expect(withApplied('character-consistency', 'cast-image')).toEqual([
      { kind: 'model', value: 'qwen-image-2.0 · 9:16 · 2K · std' },
      { kind: 'subject', name: '角色' },
    ])
    // 场景课的两条视频各自带场景主体与运镜
    expect(withApplied('scene-continuity', 'near-shot')).toEqual([
      { kind: 'model', value: 'Kling-2.5 · 5 · 1080P · 9:16' },
      { kind: 'subject', name: '场景' },
      { kind: 'camera', moves: '镜头前推' },
    ])
  })

  it('文本行：分镜脚本写「已写好脚本」，角色设定写「已写好正文」', () => {
    expect(withApplied('storyboard-shots', 'script')).toEqual([
      { kind: 'text', text: PRACTICE_SHOT_SCRIPT, asScript: true },
    ])
    expect(withApplied('character-consistency', 'write-role')).toEqual([
      { kind: 'text', text: PRACTICE_ROLE_SCRIPT, asScript: false },
    ])
  })

  it('口播行带台词与自动时长；音频行带秒数；运镜台本一起上行', () => {
    const talking = withApplied('talking-and-audio', 'talking-video')
    expect(talking).toHaveLength(1)
    const talk = talking[0]
    expect(talk?.kind).toBe('talking')
    if (talk?.kind !== 'talking')
      throw new Error('口播那步应当有「已写好台词」那一行')
    expect(talk.script).toContain('查找函数')
    // 自动时长口径与 canvas-talking 一致（中文 3.5 字/秒 + 1 秒收尾，夹 3–15 秒）
    expect(talk.seconds).toBe(talkingDuration(talk.script, null))

    expect(withApplied('talking-and-audio', 'audio-track')).toEqual([{ kind: 'audio', seconds: 5 }])

    const camera = withApplied('camera-language', 'shot')
    const first = camera[0]
    expect(first?.kind).toBe('text')
    if (first?.kind !== 'text')
      throw new Error('运镜台本应当作为文本行上行')
    expect(first.asScript).toBe(true)
    expect(first.text).toBe(PRACTICE_SHOT_SCRIPT)
    expect(camera.at(-1)).toEqual({ kind: 'camera', moves: '镜头前推 · 手持拍摄' })
  })

  it('model:"auto" 是宿主现场解析的占位，不是模型名：卡片不上「模型已选好」那一行', () => {
    const rows = withApplied('talking-and-audio', 'talking-video')
    expect(rows.some(item => item.kind === 'model')).toBe(false)
  })

  it('没有实际执行过的 prepare 就给空数组（卡片宁可少一行也不说跟画布不符的话）', () => {
    const script = findPracticeScript('image-video-basics')!
    const step = script.steps.find(item => item.id === 'run-image')!
    expect(practiceReadyItems(step)).toEqual([])
    expect(practiceReadyItems(step, [])).toEqual([])
    // 别的步执行过的动作不算在这一步头上
    expect(practiceReadyItems(step, [{ stepId: 'add-image', prep: { kind: 'add-node', nodeKind: 'image' } }])).toEqual([])
    expect(practiceReadyItems(null, [{ stepId: 'x', prep: { kind: 'add-node', nodeKind: 'image' } }])).toEqual([])
  })
})

describe('practiceReplayFor（多产物剧本按 key 取回放，取不到就不回放）', () => {
  const replay = {
    simulatedMs: 13000,
    url: '/images/tutorial/clip.mp4',
    failOnce: true,
    byKey: {
      near: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4', failOnce: true },
      far: { simulatedMs: 13000, url: '/images/tutorial/clip.mp4' },
    },
  }

  it('回放只认 image / video / audio：文本节点给 null（不该把产物写到文本节点上）', () => {
    expect(PRACTICE_REPLAY_KINDS).toEqual(['image', 'video', 'audio'])
    expect(practiceReplayFor(replay, 'text', 'near')).toBeNull()
    expect(practiceReplayFor(replay, 'video', 'near')).not.toBeNull()
    expect(practiceReplayFor(null, 'video')).toBeNull()
  })

  it('byKey 命中按 key 那一份；key 不在表里（含没有 key 的节点）一律不给回放', () => {
    expect(practiceReplayFor(replay, 'video', 'near')).toEqual(replay.byKey.near)
    expect(practiceReplayFor(replay, 'video', 'far')?.failOnce).toBeUndefined()
    expect(practiceReplayFor(replay, 'video', '没有的key')).toBeNull()
    expect(practiceReplayFor(replay, 'video')).toBeNull()
    expect(practiceReplayFor(replay, 'video', '')).toBeNull()
  })

  it('单产物步（没有 byKey）才回落到顶层那一份', () => {
    const single = { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' }
    expect(practiceReplayFor(single, 'image', 'cast-image')).toEqual(single)
    expect(practiceReplayFor(single, 'image')).toEqual(single)
  })

  it('产物类型与节点类型不配时给 null：分镜 run-videos 里选图片节点按生成，不会领到别条链的 mp4', () => {
    const storyboard = findPracticeScript('storyboard-shots')!
    const runVideos = storyboard.steps.find(step => step.id === 'run-videos')!
    // 镜头一的首帧图带着自己的 practiceKey（s1-image）：不在 byKey 表里，图片节点也不该吃视频产物
    expect(practiceReplayFor(runVideos.replay, 'image', 's1-image')).toBeNull()
    expect(practiceReplayFor(runVideos.replay, 'video', 's1-video')).not.toBeNull()
    // 类型配得上才回放：图片节点配图片产物、音频节点配音频产物，错配一律 null
    const image = { simulatedMs: 7000, url: '/images/tutorial/frame.jpg' }
    expect(practiceReplayFor(image, 'video', 'x')).toBeNull()
    const voice = { simulatedMs: 4000, url: '/images/tutorial/voice.mp3' }
    expect(practiceReplayFor(voice, 'video', 'voice')).toBeNull()
    expect(practiceReplayFor(voice, 'audio', 'voice')).toEqual(voice)
  })
})

describe('practiceReplayPatch（回放产物写回节点的补丁）', () => {
  it('成功态带产物，且不挂真实任务 / 素材 id', () => {
    const patch = practiceReplayPatch('/images/tutorial/clip.mp4', 'video', '生成失败')
    expect(patch).toMatchObject({
      taskStatus: 'succeeded',
      taskProgress: 100,
      taskError: '',
      content: '/images/tutorial/clip.mp4',
      taskId: undefined,
      assetId: undefined,
    })
  })
})

describe('practiceReplayFailPatch（失败演练的失败态）', () => {
  it('失败态把错误文案写进 taskError，不挂真任务 / 素材 id、也不写产物', () => {
    const patch = practiceReplayFailPatch('video', '回放失败（失败演练）：再点一次生成就会成功')
    expect(patch).toMatchObject({
      taskStatus: 'failed',
      taskError: '回放失败（失败演练）：再点一次生成就会成功',
      taskId: undefined,
      assetId: undefined,
    })
    // 失败态不写产物键（canvasTaskPatch 只在成功态写 content）
    expect('content' in patch).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 剧本层：九条从易到难，图形态各不相同
// ---------------------------------------------------------------------------

/** 一条剧本会建出哪些节点：从 prepare（与 video-setup 的文本上游）推 */
function practiceShape(script: PracticeScript): string {
  const shapes = new Set<string>()
  for (const step of script.steps) {
    const prep = step.prepare
    if (!prep)
      continue
    switch (prep.kind) {
      case 'add-node':
      case 'image-setup':
        shapes.add(`${prep.nodeKind}:${prep.key ?? ''}`)
        break
      case 'add-connect':
        shapes.add(`${prep.fromKind}:${prep.fromKey ?? ''}`)
        shapes.add(`${prep.toKind}:${prep.toKey ?? ''}`)
        break
      case 'add-text':
        shapes.add(`text:${prep.key ?? ''}`)
        break
      case 'video-setup':
        shapes.add('video:' + (prep.key ?? ''))
        if (prep.fromKey)
          shapes.add(`image:${prep.fromKey}`)
        if (prep.textUpstream)
          shapes.add(`text:${prep.textUpstream.key}`)
        break
      case 'audio-setup':
        shapes.add(`audio:${prep.key ?? ''}`)
        break
    }
  }
  return [...shapes].sort().join('|')
}

/** 这一步的回放（byKey 展开成逐产物的一份） */
function practiceReplayTracks(step: PracticeStep) {
  if (!step.replay)
    return []
  const tracks = step.replay.byKey ? Object.values(step.replay.byKey) : [{ simulatedMs: step.replay.simulatedMs, url: step.replay.url, failOnce: step.replay.failOnce }]
  return tracks.map(track => ({ step, kind: stepKindOf(step), track }))
}

const PRACTICE_BODY_ENTER = '跟练不会真的调模型、不花点数；退出会把画布还原成进来那一刻。'
const PRACTICE_BODY_FIRST_RUN = '回放放的是跟练自带的示例素材，不是按你这句提示词真生成的。'
const PRACTICE_BODY_READY = '跟练已经替你把这一步布好了，你只要点生成看回放。'

describe('跟练剧本（九条，从易到难）', () => {
  const ids = [
    'image-video-basics',
    'character-consistency',
    'scene-continuity',
    'storyboard-shots',
    'talking-and-audio',
    'spec-fanout',
    'camera-language',
    'preview-export',
    'multi-clip-compose',
  ]
  const levels: Record<string, string> = {
    'image-video-basics': 'starter',
    'character-consistency': 'advanced',
    'scene-continuity': 'advanced',
    'storyboard-shots': 'advanced',
    'talking-and-audio': 'expert',
    'spec-fanout': 'expert',
    'camera-language': 'expert',
    'preview-export': 'expert',
    'multi-clip-compose': 'expert',
  }
  const stepCounts: Record<string, number> = {
    'image-video-basics': 6,
    'character-consistency': 7,
    'scene-continuity': 7,
    'storyboard-shots': 9,
    'talking-and-audio': 8,
    'spec-fanout': 8,
    'camera-language': 5,
    'preview-export': 5,
    'multi-clip-compose': 8,
  }

  it('九条剧本的 id / 等级 / 步数按设计表来（共 63 步）', () => {
    expect(PRACTICE_SCRIPTS.map(script => script.id)).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
    expect(PRACTICE_SCRIPTS.reduce((sum, script) => sum + script.steps.length, 0)).toBe(63)
    for (const script of PRACTICE_SCRIPTS) {
      expect(script.level, script.id).toBe(levels[script.id])
      expect(script.steps.length, script.id).toBe(stepCounts[script.id])
      expect(script.name.trim(), script.id).not.toBe('')
      expect([...script.name].length, `${script.id} 的剧本名太长`).toBeLessThanOrEqual(20)
      // 剧本提示：一句 ≤30 字（汉字口径：9:16 / 1:1 这类数字与分隔符不算字），开头就是等级
      const levelLabel = PRACTICE_LEVELS.find(item => item.id === script.level)!.label
      expect(script.hint.startsWith(levelLabel), `${script.id} 的提示没写等级`).toBe(true)
      const han = [...script.hint].filter(char => /[\u3000-\u303F\uFF00-\uFFEF\u4E00-\u9FFF]/.test(char)).length
      expect(han, `${script.id} 的提示超过 30 字`).toBeLessThanOrEqual(30)
      expect(script.icon.startsWith('i-lucide-'), script.id).toBe(true)
      expect(script.steps[0]!.id, script.id).toBe('welcome')
      expect(script.steps.at(-1)!.id, script.id).toBe('done')
      // 等级中文名是场景选择卡的分组标题
      expect(PRACTICE_LEVELS.some(item => item.id === script.level)).toBe(true)
    }
    expect(PRACTICE_LEVELS.map(item => item.label)).toEqual(['入门', '进阶', '高阶'])
  })

  it('图形态真的各不相同：每条剧本建出的节点（kind + key）集合互不相同，也不是同一条骨架', () => {
    const shapes = PRACTICE_SCRIPTS.map(script => practiceShape(script))
    expect(new Set(shapes).size, shapes.join('\n')).toBe(PRACTICE_SCRIPTS.length)
    for (const script of PRACTICE_SCRIPTS) {
      const kinds = new Set(practiceShape(script).split('|').map(item => item.split(':')[0]))
      // 每条至少两种节点形态（入门是图片 + 视频）
      expect(kinds.size, script.id).toBeGreaterThanOrEqual(2)
    }
    // 内容方向也真的不同：主体引用 / 音频节点 / 扇出 / 无图片节点各只有对应那几条剧本有
    const shapeOf = (id: string) => practiceShape(findPracticeScript(id)!)
    expect(shapeOf('character-consistency')).toContain('image:cast-image')
    expect(shapeOf('scene-continuity')).toContain('video:near')
    expect(shapeOf('scene-continuity')).toContain('video:far')
    expect(shapeOf('talking-and-audio')).toContain('audio:voice')
    expect(shapeOf('spec-fanout').split('|').filter(item => item.startsWith('video:')).length).toBe(3)
    // 镜头语言没有图片节点（全能参考模式）；预演课用导演台节点，也不建图片
    expect(shapeOf('camera-language').split('|').some(item => item.startsWith('image:'))).toBe(false)
    expect(shapeOf('camera-language')).toContain('text:script')
    expect(shapeOf('preview-export').split('|').some(item => item.startsWith('image:'))).toBe(false)
    expect(shapeOf('preview-export')).toContain('director:stage')
    expect(shapeOf('preview-export')).toContain('video:preview')
    expect(shapeOf('multi-clip-compose')).toContain('image:clip-a')
    expect(shapeOf('multi-clip-compose')).toContain('image:clip-b')
    expect(shapeOf('multi-clip-compose')).toContain('video:take-a')
    expect(shapeOf('multi-clip-compose')).toContain('video:take-b')
  })

  it('九条剧本的步骤序列与设计表逐条一致（id 顺序也是宿主 auto-prepare 的依赖顺序）', () => {
    const stepIds: Record<string, string[]> = {
      'image-video-basics': ['welcome', 'add-image', 'add-video', 'run-image', 'run-video', 'done'],
      'character-consistency': ['welcome', 'write-role', 'cast-image', 'run-image', 'cast-video', 'run-video', 'done'],
      'scene-continuity': ['welcome', 'scene-image', 'run-image', 'near-shot', 'far-shot', 'run-videos', 'done'],
      'storyboard-shots': ['welcome', 'script', 'shot-1', 'shot-2', 'chain-1', 'chain-2', 'run-images', 'run-videos', 'done'],
      'talking-and-audio': ['welcome', 'host-image', 'run-image', 'talking-video', 'run-video', 'audio-track', 'run-audio', 'done'],
      'spec-fanout': ['welcome', 'cover', 'run-image', 'spec-feed', 'spec-square', 'spec-wide', 'run-videos', 'done'],
      'camera-language': ['welcome', 'shot', 'run-video', 'camera-notes', 'done'],
      'preview-export': ['welcome', 'director', 'export-shot', 'run-video', 'done'],
      'multi-clip-compose': ['welcome', 'clip-a', 'run-image', 'take-a', 'clip-b', 'take-b', 'run-videos', 'done'],
    }
    for (const script of PRACTICE_SCRIPTS)
      expect(script.steps.map(step => step.id), script.id).toEqual(stepIds[script.id])
  })

  it('锚点按设计表落位：工具轨 / 出图出片 / 主体 / 口播 / 运镜 / 音频 / 节点', () => {
    const anchors: Array<[string, string, string]> = [
      ['image-video-basics', 'add-image', 'tools'],
      ['image-video-basics', 'add-video', 'tools'],
      ['image-video-basics', 'run-image', 'inspector-run'],
      ['image-video-basics', 'run-video', 'inspector-run'],
      ['image-video-basics', 'done', 'node:video'],
      ['character-consistency', 'write-role', 'tools'],
      ['character-consistency', 'cast-image', 'inspector-subject'],
      ['character-consistency', 'run-image', 'inspector-run'],
      ['character-consistency', 'cast-video', 'inspector-subject'],
      ['character-consistency', 'done', 'node:video'],
      ['scene-continuity', 'scene-image', 'inspector-subject'],
      ['scene-continuity', 'near-shot', 'tools'],
      ['scene-continuity', 'far-shot', 'tools'],
      ['scene-continuity', 'run-videos', 'inspector-run'],
      ['storyboard-shots', 'script', 'tools'],
      ['storyboard-shots', 'shot-1', 'tools'],
      ['storyboard-shots', 'chain-2', 'tools'],
      ['storyboard-shots', 'run-images', 'inspector-run'],
      ['talking-and-audio', 'host-image', 'tools'],
      ['talking-and-audio', 'talking-video', 'inspector-talking'],
      ['talking-and-audio', 'audio-track', 'inspector-audio'],
      ['talking-and-audio', 'run-audio', 'node:audio'],
      ['talking-and-audio', 'done', 'node:audio'],
      ['spec-fanout', 'cover', 'tools'],
      ['spec-fanout', 'spec-wide', 'tools'],
      ['spec-fanout', 'run-videos', 'inspector-run'],
      ['camera-language', 'shot', 'inspector-cam'],
      ['camera-language', 'run-video', 'inspector-run'],
      ['camera-language', 'camera-notes', 'node:video'],
      ['camera-language', 'done', 'node:video'],
      ['preview-export', 'director', 'tools'],
      ['preview-export', 'export-shot', 'inspector-cam'],
      ['preview-export', 'run-video', 'inspector-run'],
      ['preview-export', 'done', 'node:video'],
      ['multi-clip-compose', 'clip-a', 'tools'],
      ['multi-clip-compose', 'run-image', 'inspector-run'],
      ['multi-clip-compose', 'take-a', 'tools'],
      ['multi-clip-compose', 'clip-b', 'tools'],
      ['multi-clip-compose', 'take-b', 'tools'],
      ['multi-clip-compose', 'run-videos', 'inspector-run'],
      ['multi-clip-compose', 'done', 'node:video'],
    ]
    for (const [scriptId, stepId, anchor] of anchors) {
      const step = findPracticeScript(scriptId)!.steps.find(item => item.id === stepId)
      expect(step?.anchor, `${scriptId}/${stepId} 的锚点`).toBe(anchor)
    }
    // 开场步没有锚点（居中卡片）
    for (const script of PRACTICE_SCRIPTS)
      expect(script.steps[0]!.anchor, script.id).toBeUndefined()
  })

  it('每一步都写了标题 / 小字 / 正文，正文是「固定开场句 + 要点（≤60 字）」', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const firstRunIndex = script.steps.findIndex(step => step.gate?.kind === 'result')
      expect(firstRunIndex, script.id).toBeGreaterThan(0)
      script.steps.forEach((step, index) => {
        const where = `${script.id}/${step.id}`
        expect(step.title.trim(), where).not.toBe('')
        expect(step.summary.trim(), where).not.toBe('')
        expect([...step.summary].length, `${where} 的清单小字超过 24 字`).toBeLessThanOrEqual(24)
        const opening = index === 0
          ? PRACTICE_BODY_ENTER
          : index === firstRunIndex ? PRACTICE_BODY_FIRST_RUN : PRACTICE_BODY_READY
        expect(step.body.startsWith(opening), `${where} 的正文没按模板开场`).toBe(true)
        const point = step.body.slice(opening.length)
        expect(point.trim(), where).not.toBe('')
        expect([...point].length, `${where} 的要点超过 60 字`).toBeLessThanOrEqual(60)
      })
    }
  })

  it('每个 result 步都有 gateHint（主按钮禁用时要说得清「等你动手」做什么）', () => {
    for (const script of PRACTICE_SCRIPTS) {
      for (const step of script.steps) {
        if (step.gate?.kind !== 'result')
          continue
        expect(Boolean(step.gateHint?.trim()), `${script.id}/${step.id} 没有 gateHint`).toBe(true)
      }
    }
    // 多产物步的 gateHint 就是设计里那几句
    expect(findPracticeScript('scene-continuity')!.steps.find(s => s.id === 'run-videos')!.gateHint).toBe('两个镜头各点一次生成')
    expect(findPracticeScript('storyboard-shots')!.steps.find(s => s.id === 'run-videos')!.gateHint).toBe('两条链各点一次生成')
    expect(findPracticeScript('storyboard-shots')!.steps.find(s => s.id === 'run-images')!.gateHint).toBe('两张首帧各点一次生成')
    expect(findPracticeScript('spec-fanout')!.steps.find(s => s.id === 'run-videos')!.gateHint).toBe('三条支线各点一次生成')
    expect(findPracticeScript('talking-and-audio')!.steps.find(s => s.id === 'run-video')!.gateHint).toBe('听回放：这条是示例素材，视频没有音轨')
  })

  it('回放：只落在 image / video / audio 节点上，素材只用仓库自带的三份，url 在 /images/tutorial/ 下', () => {
    const expectedAsset: Record<string, string> = { image: 'frame.jpg', video: 'clip.mp4', audio: 'voice.mp3' }
    for (const script of PRACTICE_SCRIPTS) {
      for (const step of script.steps) {
        if (!step.replay)
          continue
        const kind = stepKindOf(step) ?? ''
        expect((PRACTICE_REPLAY_KINDS as readonly string[]).includes(kind), `${script.id}/${step.id} 的回放没有节点类型`).toBe(true)
        for (const { track } of practiceReplayTracks(step)) {
          expect(track.url.startsWith('/images/tutorial/'), `${script.id}/${step.id}`).toBe(true)
          // 节点只认 /images 这类前缀（isMediaUrl），而且素材与节点类型要对得上
          expect(track.url.endsWith(expectedAsset[kind]!), `${script.id}/${step.id} 的 ${kind} 回放指向了 ${track.url}`).toBe(true)
          expect(track.simulatedMs, `${script.id}/${step.id}`).toBeGreaterThanOrEqual(3000)
        }
      }
    }
  })

  it('每条剧本至少一次出片回放；有图片节点的剧本也都有出图回放（镜头语言没有图片节点）', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const kinds = new Set(script.steps.flatMap(step => practiceReplayTracks(step).map(item => item.kind)))
      expect(kinds.has('video'), `${script.id} 没有出片回放`).toBe(true)
      const hasImageNode = practiceShape(script).split('|').some(item => item.startsWith('image:') || item.startsWith('panorama:'))
      expect(kinds.has('image'), `${script.id} 的图片节点没有回放`).toBe(hasImageNode)
      expect(kinds.has('audio'), `${script.id} 有音频节点就该有音频回放`).toBe(script.id === 'talking-and-audio')
    }
  })

  it('失败演练：每条剧本恰有一处 failOnce，落在第一个出片回放的第一份产物上', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const tracks = script.steps.flatMap(step => practiceReplayTracks(step))
      expect(tracks.filter(item => item.track.failOnce).length, `${script.id} 的失败演练不是恰好一次`).toBe(1)
      const firstVideo = tracks.find(item => item.kind === 'video')!
      expect(firstVideo.track.failOnce, `${script.id} 的失败演练不在第一个出片回放上`).toBe(true)
      // 出图与音频回放不演失败态（失败演练只教一次「重试就会成功」）
      for (const item of tracks) {
        if (item.kind !== 'video')
          expect(item.track.failOnce, `${script.id}/${item.step.id}`).toBeUndefined()
      }
      // 出片回放排在出图回放之后（先有图才有片）
      const firstImage = tracks.findIndex(item => item.kind === 'image')
      if (firstImage >= 0)
        expect(firstImage).toBeLessThan(tracks.findIndex(item => item.kind === 'video'))
    }
  })

  it('byKey 的 key 都是该条剧本声明过的 practiceKey（多产物回放不会落在错的节点上）', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const declared = new Set<string>()
      for (const step of script.steps) {
        const prep = step.prepare
        if (prep && 'key' in prep && prep.key)
          declared.add(prep.key)
      }
      for (const step of script.steps) {
        for (const key of Object.keys(step.replay?.byKey ?? {}))
          expect(declared.has(key), `${script.id}/${step.id} 的 byKey:${key} 没有对应的 prepare`).toBe(true)
      }
    }
    // 多产物步必须用 byKey（一个 key 一份），单产物步才用顶层那一份
    const storyboard = findPracticeScript('storyboard-shots')!
    expect(Object.keys(storyboard.steps.find(s => s.id === 'run-videos')!.replay!.byKey!)).toEqual(['s1-video', 's2-video'])
    expect(storyboard.steps.find(s => s.id === 'run-videos')!.replay!.url).toBe('/images/tutorial/clip.mp4')
    // 多产物步的判据要 atLeast 到产物数
    expect(storyboard.steps.find(s => s.id === 'run-videos')!.gate).toEqual({ kind: 'result', nodeKind: 'video', atLeast: 2 })
    expect(findPracticeScript('spec-fanout')!.steps.find(s => s.id === 'run-videos')!.gate).toEqual({ kind: 'result', nodeKind: 'video', atLeast: 3 })
    expect(findPracticeScript('scene-continuity')!.steps.find(s => s.id === 'run-videos')!.gate).toEqual({ kind: 'result', nodeKind: 'video', atLeast: 2 })
  })

  it('demo 步只讲解（不产节点、不产产物、没有回放），showcase 只在收尾步', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const demoSteps = script.steps.filter(step => step.gate?.kind === 'demo')
      for (const step of demoSteps) {
        expect(step.prepare, `${script.id}/${step.id}`).toBeUndefined()
        expect(step.replay, `${script.id}/${step.id}`).toBeUndefined()
        expect(step.showcase, `${script.id}/${step.id}`).toBeUndefined()
        // demo 步的 gateHint 就是视觉卡上「这一步的做法：{what}」里的 what
        expect(Boolean(step.gateHint?.trim()), `${script.id}/${step.id} 没写做法`).toBe(true)
      }
      // 只有镜头语言有一步纯讲解
      expect(demoSteps.map(step => step.id), script.id).toEqual(script.id === 'camera-language' ? ['camera-notes'] : [])
      for (const step of script.steps.slice(0, -1))
        expect(step.showcase, `${script.id}/${step.id} 不该有成片卡`).toBeUndefined()
      expect(script.steps.at(-1)!.showcase, `${script.id} 的收尾步没有成片卡`).toBeTruthy()
    }
  })

  it('成片卡：锚点是它自己那一类节点，url 与同类型的最后一次回放同源，模型 / 参数与 prepare 对得上', () => {
    for (const script of PRACTICE_SCRIPTS) {
      const done = script.steps.at(-1)!
      const show = done.showcase!
      expect(done.anchor, script.id).toBe(`node:${show.nodeKind}`)
      const tracks = script.steps.flatMap(step => practiceReplayTracks(step))
      const sameKind = tracks.filter(item => item.kind === show.nodeKind)
      expect(sameKind.length, `${script.id} 的成片卡没有对应回放`).toBeGreaterThan(0)
      expect(show.url, script.id).toBe(sameKind.at(-1)!.track.url)
      if (show.nodeKind === 'audio') {
        // 音轨没有模型（audio-setup 写 model 会「模型未定价」），成片卡也不假装有
        expect(show.model, script.id).toBe('')
        const audioPrep = script.steps.map(step => step.prepare).find(prep => prep?.kind === 'audio-setup')!
        expect(audioPrep.kind === 'audio-setup' ? audioPrep.params : null).toEqual(show.params)
        continue
      }
      const source = script.steps.map(step => step.prepare).find(prep =>
        prep?.kind === 'video-setup' && prep.model === show.model && prep.prompt === show.prompt && JSON.stringify(prep.params) === JSON.stringify(show.params))
      expect(Boolean(source), `${script.id} 的成片卡与 prepare 不同源`).toBe(true)
    }
  })

  it('判据与 prepare 用到的 nodeKind 都是平台真有的节点类型，模型只用定价表里的两个', () => {
    const nodeKinds = new Set(['text', 'image', 'video', 'audio', 'panorama', 'director'])
    const models = new Set(['qwen-image-2.0', 'Kling-2.5', 'auto'])
    const subjectKinds = new Set(['character', 'scene', 'prop'])
    for (const script of PRACTICE_SCRIPTS) {
      for (const step of script.steps) {
        const gate = step.gate
        if (gate && 'nodeKind' in gate)
          expect(nodeKinds.has(gate.nodeKind), `${script.id}/${step.id} 的判据节点 ${gate.nodeKind}`).toBe(true)
        if (gate?.kind === 'edge') {
          expect(nodeKinds.has(gate.fromKind) && nodeKinds.has(gate.toKind), `${script.id}/${step.id} 的连线判据`).toBe(true)
        }
        const prep = step.prepare
        if (!prep)
          continue
        if (prep.kind === 'image-setup' || prep.kind === 'video-setup' || prep.kind === 'add-node' || prep.kind === 'audio-setup')
          expect(nodeKinds.has(prep.nodeKind), `${script.id}/${step.id} 的 ${prep.nodeKind}`).toBe(true)
        if ((prep.kind === 'image-setup' || prep.kind === 'video-setup') && !models.has(prep.model))
          throw new Error(`${script.id}/${step.id} 的模型 ${prep.model} 不在定价表口径内`)
        if ((prep.kind === 'image-setup' || prep.kind === 'video-setup') && prep.subjectKind)
          expect(subjectKinds.has(prep.subjectKind), `${script.id}/${step.id} 的主体类型`).toBe(true)
        if (prep.kind === 'audio-setup')
          // 音频节点不写模型（允许清单里没有 TTS 模型，写了会「模型未定价」）
          expect('model' in prep).toBe(false)
      }
    }
  })

  it('关键课程要素都在：主体引用 / 口播 / 运镜 / 音频的字段按设计写进 prepare', () => {
    const stepOf = (scriptId: string, stepId: string) => findPracticeScript(scriptId)!.steps.find(step => step.id === stepId)!

    const castImage = stepOf('character-consistency', 'cast-image').prepare
    expect(castImage).toMatchObject({ kind: 'image-setup', nodeKind: 'image', key: 'cast-image', subjectKind: 'character' })
    expect(stepOf('character-consistency', 'cast-video').prepare)
      .toMatchObject({ kind: 'video-setup', key: 'cast-video', fromKey: 'cast-image', subjectKind: 'character' })

    const sceneImage = stepOf('scene-continuity', 'scene-image').prepare
    expect(sceneImage).toMatchObject({ kind: 'image-setup', key: 'scene-image', subjectKind: 'scene' })
    expect(stepOf('scene-continuity', 'near-shot').prepare).toMatchObject({ camera: { moves: ['dolly-in'] }, fromKey: 'scene-image' })
    expect(stepOf('scene-continuity', 'far-shot').prepare).toMatchObject({ camera: { moves: ['pan-right'] }, fromKey: 'scene-image' })

    const talking = stepOf('talking-and-audio', 'talking-video').prepare
    expect(talking).toMatchObject({
      kind: 'video-setup',
      key: 'talk',
      model: 'auto',
      videoMode: 'talking',
      fromKey: 'host-image',
    })
    if (talking?.kind !== 'video-setup')
      throw new Error('口播那步应当是 video-setup')
    expect(talking.talking?.script).toBe('别再用错查找函数：从左往右查不到的值，换一行写法就能取到。')
    expect(talking.talking?.tone).toBe('natural')
    expect(talking.talking?.framing).toBe('medium')
    // 口播不写死时长：由台词自动落档
    expect(talking.params).not.toHaveProperty('duration')
    expect(stepOf('talking-and-audio', 'audio-track').prepare)
      .toMatchObject({ kind: 'audio-setup', key: 'voice', params: { duration: 5, audioKind: 'bgm' } })

    expect(stepOf('multi-clip-compose', 'take-a').prepare)
      .toMatchObject({ kind: 'video-setup', key: 'take-a', fromKey: 'clip-a', videoMode: 'i2v' })
    expect(stepOf('multi-clip-compose', 'take-b').prepare)
      .toMatchObject({ kind: 'video-setup', key: 'take-b', fromKey: 'clip-b', videoMode: 'i2v' })
    expect(stepOf('multi-clip-compose', 'run-videos')!.gate).toEqual({ kind: 'result', nodeKind: 'video', atLeast: 2 })

    const cam = stepOf('camera-language', 'shot').prepare
    if (cam?.kind !== 'video-setup')
      throw new Error('运镜那步应当是 video-setup')
    expect(cam.textUpstream).toEqual({ key: 'script', content: expect.stringContaining('镜头一') })
    expect(cam.camera).toEqual({ moves: ['dolly-in', 'handheld'], fx: 'film' })
    expect(cam.videoMode).toBe('reference')

    const preview = stepOf('preview-export', 'export-shot').prepare
    expect(stepOf('preview-export', 'director').prepare).toEqual({ kind: 'add-node', nodeKind: 'director', key: 'stage' })
    expect(preview).toMatchObject({
      kind: 'video-setup',
      key: 'preview',
      model: 'Kling-2.5',
      videoMode: 'i2v',
      camera: { moves: ['dolly-in'] },
    })
    if (preview?.kind !== 'video-setup')
      throw new Error('预演那步应当是 video-setup')
    expect(preview.fromKey).toBeUndefined()
    expect(preview.textUpstream).toBeUndefined()
    expect(stepOf('preview-export', 'export-shot').body).not.toContain('时间轴点导出预演')
    expect(stepOf('preview-export', 'done').body).toContain('跟练不走真导出')
    expect(stepOf('multi-clip-compose', 'welcome').body).toContain('跟练只练到出片')
    expect(stepOf('multi-clip-compose', 'done').body).toContain('跟练不打开合成')

    // 扇出：三条支线各自的比例落在参数里（同一张首帧）
    const specs = ['spec-feed', 'spec-square', 'spec-wide'].map(stepId => stepOf('spec-fanout', stepId).prepare)
    expect(specs.map(prep => (prep?.kind === 'video-setup' ? prep.params.ratio : null))).toEqual(['9:16', '1:1', '16:9'])
    expect(specs.every(prep => prep?.kind === 'video-setup' && prep.fromKey === 'cover')).toBe(true)
  })

  it('入门课就是「图片 + 视频节点」最小骨架：2 节点 1 边，第一课不掺主体 / 音频', () => {
    const basics = findPracticeScript('image-video-basics')!
    expect(basics.steps.find(step => step.id === 'add-image')!.prepare).toEqual({ kind: 'add-node', nodeKind: 'image' })
    expect(basics.steps.find(step => step.id === 'add-video')!.prepare).toEqual({ kind: 'add-connect', fromKind: 'image', toKind: 'video' })
    expect(basics.steps.find(step => step.id === 'add-video')!.gate).toEqual({ kind: 'edge', fromKind: 'image', toKind: 'video' })
    const kinds = practiceShape(basics).split('|')
    expect(kinds).toEqual(['image:', 'video:'])
    // 入门课用回放那次真跑通的两个模型
    expect(basics.steps.find(step => step.id === 'run-image')!.prepare).toMatchObject({ model: 'qwen-image-2.0' })
    expect(basics.steps.find(step => step.id === 'run-video')!.prepare).toMatchObject({ model: 'Kling-2.5', videoMode: 'i2v' })
  })

  it('进阶三课都带主体 / 多节点，高阶五课各教交付规格 / 口播音频 / 镜头语言 / 预演出片 / 多段合成', () => {
    const shapeOf = (id: string) => new Set(practiceShape(findPracticeScript(id)!).split('|'))
    expect(shapeOf('multi-clip-compose').has('video:take-a')).toBe(true)
    expect(shapeOf('multi-clip-compose').has('video:take-b')).toBe(true)
    // 角色一致性两处引用角色主体（定妆图 + 出镜片）；场景延续三处（首帧 + 两条镜头）带同一份场景参考
    const subjectCounts: Record<string, number> = { 'character-consistency': 2, 'scene-continuity': 3 }
    for (const [id, count] of Object.entries(subjectCounts)) {
      const subjectSteps = findPracticeScript(id)!.steps.filter(step =>
        step.prepare && (step.prepare.kind === 'image-setup' || step.prepare.kind === 'video-setup') && step.prepare.subjectKind)
      expect(subjectSteps.length, id).toBe(count)
    }
    // 分镜：两条链各一套 image → video
    const storyboard = findPracticeScript('storyboard-shots')!.steps.filter(step =>
      step.prepare?.kind === 'video-setup' || step.prepare?.kind === 'image-setup')
    expect(storyboard.map(step => step.id)).toEqual(['shot-1', 'shot-2', 'chain-1', 'chain-2'])
    expect(shapeOf('storyboard-shots').has('text:script')).toBe(true)
    // 扇出 / 一景两镜：一张首帧扇出多条
    expect([...shapeOf('scene-continuity')].filter(item => item.startsWith('video:')).length).toBe(2)
    expect([...shapeOf('spec-fanout')].filter(item => item.startsWith('video:')).length).toBe(3)
  })
})

describe('跟练文案的翻译覆盖（t(step.summary) 这类非字面量写法扫不到，单独兜住）', () => {
  const locales = ['zh-TW', 'en', 'ja', 'fr', 'ru', 'vi']
  const tables = new Map(locales.map(name => [
    name,
    JSON.parse(readFileSync(`i18n/locales/${name}.json`, 'utf8')) as Record<string, unknown>,
  ]))

  it('九条剧本的名字 / 提示、三个等级名、63 步的标题 / 小字 / 正文、以及 gateHint 都进了 6 个外语文件', () => {
    const keys = new Set<string>()
    for (const script of PRACTICE_SCRIPTS) {
      keys.add(script.name)
      keys.add(script.hint)
      for (const step of script.steps) {
        for (const text of [step.title, step.summary, step.body, step.gateHint]) {
          if (text)
            keys.add(text)
        }
      }
    }
    for (const level of PRACTICE_LEVELS)
      keys.add(level.label)
    // 63 步的标题 / 小字 / 正文去重后是 130+ 条（共用的开场句、放节点与连线那几句会合并）；
    // 少一大截就说明漏了整步的文案
    expect(keys.size).toBeGreaterThanOrEqual(130)
    for (const [name, table] of tables) {
      const missing = [...keys].filter(key => !(key in table))
      expect(missing, `${name} 缺译文`).toEqual([])
    }
  })
})
