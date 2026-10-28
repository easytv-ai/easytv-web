/**
 * 跟练在画布上的宿主：开会话、拍快照、按剧本布节点、退出时还原。
 * 会话状态和回放仍在 useCanvasPractice，这里只搬工作区里那一段胶水。
 *
 * 四条容易静默失效的约定（都不报错，只是整段行为不生效）：
 * - 基线 / viewport / inspectorOpen / historySuspended 必须是 ref：computed 读快照不会变脏，
 *   宿主写布尔快照也打不开挂起；传参一侧同理（viewport.value 传进去就再读不到当前缩放）；
 * - 写入规则与落点只在跟练作用域（view）里挑节点，落点却要扫全量 nodes（避开用户原有节点）；
 * - reveal 与自动备好的每一步都要重查会话仍在，退出瞬间在飞的循环不能再往画布写：
 *   相机补间由 camera.cancel() 收口，且退出时绝不补最后一帧（那会把 loadGraph 还原的视口又挪走）；
 * - 相机补间在飞时锚点元素每帧都在动，不能拿移动中的矩形算位移（见 revealPracticeAnchor）。
 */
import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useCanvasCameraGlide } from '~/composables/useCanvasCameraGlide'
import { useCanvasPractice } from '~/composables/useCanvasPractice'
import {
  anchorSelector,
  gateSatisfied,
  practiceAutoPreparePlan,
  practiceKindLabel,
  practiceNodeOfKind,
  practiceReplayPatch,
  practiceScopedGraphView,
  practiceScopedNodeOf,
  practiceSpotForNewNode,
  stepKeyOf,
  stepKindOf,
  type PracticePrepare,
  type PracticeStep,
} from '~/utils/canvas-practice'
import { CAMERA_GLIDE_MS, canvasRevealShift } from '~/utils/canvas-viewport-tween'
import { DEFAULT_CAMERA_SETUP } from '~/utils/canvas-camera'
import { normalizeTalkingData, talkingDuration } from '~/utils/canvas-talking'
import { absPosition, isContentNode as isFlowContentNode, nodeSize, type CanvasFlowNode } from '~/utils/canvas-group'
import { canvasFlowPaneRect } from '~/utils/canvas-panel-layout'
import type { CanvasNodeData, CanvasNodeKind } from '~/utils/canvas-node-kinds'
import type { CanvasGraph, GenerationModel } from '~/types/creative'
import { resolveCatalogModelId } from '~/utils/canvas-catalog-model'

/**
 * demo 步（纯讲解）演示完之后停的一拍（ms）：让人真看到演示，清单的勾与主按钮（都读 session.done）也才推得动。
 * 见设计 §3.0 的 `{ kind:'demo' }`：宿主在「备好 + 定位 + 停一拍」之后才把 step.id 写进 session.done。
 */
const PRACTICE_DEMO_BEAT_MS = 800

/** reveal 找不到目标时最多再等几帧（新节点渲染晚于 store 写入） */
const REVEAL_MAX_WAIT_FRAMES = 3

export function useCanvasPracticeHost(opts: {
  nodes: Ref<any[]>
  edges: Ref<any[]>
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
  canEditCanvas: (action: '生成') => boolean
  getGraph: () => CanvasGraph
  loadGraph: (graph: CanvasGraph | null | undefined, opts?: { keepHistory?: boolean }) => void
  addNode: (kind: CanvasNodeKind, x: number, y: number) => string | false | null | undefined
  addNodeAtCenter: (kind: CanvasNodeKind) => string | false | null | undefined
  findNode: (id: string) => any | undefined
  linkNodes: (edge: { source: string, target: string, sourceHandle: string, targetHandle: string }) => void
  isContentNode: (node: any) => boolean
  setCenter: (x: number, y: number, opts: { zoom: number }) => void
  setViewport: (vp: { x: number, y: number, zoom: number }) => void
  viewport: Ref<{ x: number, y: number, zoom: number }>
  inspectorOpen: Ref<boolean>
  historySuspended: Ref<boolean>
  /** 现场解析一个主体引用（主体库为空时返回 null，宿主写 session.notice 后照常继续） */
  resolveSubject: (kind: 'character' | 'scene' | 'prop') => Promise<{ id: number, version: number } | null>
  /** 现场解析一个带原生出声能力的视频模型（清单里没有时返回 null，口播退回按首帧驱动演示） */
  resolveTalkingModel: () => string | null
}) {
  const practice = useCanvasPractice({
    updateNodeData: opts.updateNodeData,
    notify: opts.notify,
    t: opts.t,
  })
  /** 与检查器同一份 GET /generation/models：备好时把剧本 id 对到清单真 id */
  const generationModels = useState<GenerationModel[]>('generation-models', () => [])

  function resolvePrepModel(wanted: string, type: 'image' | 'video') {
    if (!wanted || wanted === 'auto')
      return wanted
    return resolveCatalogModelId(wanted, generationModels.value, { type, preferPriced: true })
  }

  function noteAppliedPrep(stepId: string, prep: PracticePrepare, model?: string) {
    if (model && 'model' in prep && prep.model !== model)
      noteApplied(stepId, { ...prep, model })
    else
      noteApplied(stepId, prep)
  }
  const session = practice.session
  /** 进来之前的画布：退出时原样还原，跟练数据一个字节都不留在画布上 */
  let graphSnapshot: CanvasGraph | null = null
  /**
   * 进来那一刻画布上已有的节点 id（基线）。跟练是在用户自己的画布上跑的，
   * 判据 / 兜底 / 高亮只看“跟练期间新增的节点”：预置节点永不计入、永不被写，
   * 用户自己在跟练里新建的（不在基线里）照常放行。退出随快照还原后清空。
   */
  const practiceBaselineIds = ref<Set<string>>(new Set())
  /**
   * 判据与高亮都读它：跟练作用域内的扁平视图（基线节点已被滤掉）。
   * 基线是 ref、不是普通变量——普通变量在 computed 里被读不会让它变脏，
   * 非空画布上进跟练时过滤会整段失效（判据立刻满足、兜底写进用户自己的节点）。
   */
  const view = computed(() => practiceScopedGraphView(
    { nodes: opts.nodes.value, edges: opts.edges.value },
    practiceBaselineIds.value,
  ))
  /**
   * 相机补间：reveal 与成片居中都走它，宿主把它作为返回值成员暴露（Workspace 要给
   * @move-start / @node-click / @node-drag-start 绑 cancel：用户接管时镜头不再抢画面）。
   */
  const camera = useCanvasCameraGlide({
    viewport: opts.viewport,
    setViewport: opts.setViewport,
  })
  /** 画布外的入口（账号菜单 / 帮助弹窗）置位这个 useState 即开始跟练 */
  const wanted = useState('canvas-practice-open', () => false)
  /** 3 步新手引导（CanvasGuideTour）的开关：跟练与它是两套同 z-index 的聚光浮层，进跟练先把那边关掉 */
  const canvasGuideOpen = useState('canvas-guide-open', () => false)

  watch(wanted, (on) => {
    if (!on)
      return
    wanted.value = false
    start()
  }, { immediate: true })

  // 会话一结束（退出 / 跨画布被复位），在飞的补间立刻停手：它已经不能再写视口了
  watch(() => session.value.active, (on) => {
    if (!on)
      camera.cancel()
  })

  onScopeDispose(() => {
    // 跨画布串会话的静默失效点：会话还活着就换到了另一张画布，这里把回放停掉、会话复位
    practice.stopReplay()
    if (session.value.active)
      practice.exit()
  })

  /**
   * 进跟练：先把沙盒架上，再让用户选场景（scriptId 为空停在选择卡上）。
   * 带 scriptId 调用（以后"照这个练一遍"的入口）就直接进那条剧本。
   */
  function start(scriptId = '') {
    if (!opts.canEditCanvas('生成'))
      return
    if (session.value.active)
      return
    graphSnapshot = opts.getGraph()
    practiceBaselineIds.value = new Set(opts.nodes.value.map(n => n.id))
    // 跟练期间的操作不进用户的历史栈：退出后 Ctrl+Z 还能回到跟练前的编辑状态
    opts.historySuspended.value = true
    // 两套聚光浮层（引导 / 跟练）同层，开一套就关另一套，别让卡片互压
    canvasGuideOpen.value = false
    // Inspector 全程紧凑态：展开成大面板会盖住画布，锚点靠「选中节点 + 紧凑态里的 data-guide」定位
    opts.inspectorOpen.value = false
    practice.start(scriptId)
    // 不再弹「跟练开始 / 先选一个场景」的通知：文案与选课卡正文逐字重复，而且浏览器验收发现
    // 这条 toast 正好压在选课卡右上角，把卡头的「退出跟练」按钮整块盖住（选课卡是无锚点兜底定位、
    // 不吃禁区，躲不开）——宁可少一条重复提示，也要保证卡上的按钮永远点得到。
  }

  /** 场景选择卡上挑了一条剧本：挂上它并进入第 0 步（沙盒与基线不动，它们按"进跟练那一刻"算） */
  function selectScript(scriptId: string) {
    if (!session.value.active || !scriptId)
      return
    practice.selectScript(scriptId)
    // 同上：进入剧本不弹重复通知，说明一律进卡片正文
    // stepIndex 停在 0，步骤监听不会自己触发：显式进一次第 0 步（自动备好 / 锚点高亮都在那里面）
    void nextTick(() => enterPracticeStep())
  }

  /**
   * 退出：停掉在飞的回放 → 停掉在飞的补间 → 还原画布 → 结束会话（页面那边同时恢复保存机）。
   * 只有还原这一条路：没有「留在画布上继续做 / 真跑一次」那种半保留的走法。
   */
  function exit() {
    practice.stopReplay()
    // 补间必须先停：退出会 loadGraph 还原视口，补间若在还原之后落地一帧会把视口又挪走
    camera.cancel()
    if (graphSnapshot) {
      // keepHistory：撤销栈就停在跟练前那张图上，压掉它 Ctrl+Z 就回不去了
      opts.loadGraph(graphSnapshot, { keepHistory: true })
    }
    graphSnapshot = null
    practiceBaselineIds.value = new Set()
    opts.historySuspended.value = false
    practice.exit()
    opts.notify(opts.t('已退出跟练，画布已还原'))
  }

  /** 写一条如实说明（主体库为空 / 清单里没有带原生出声的模型），卡片上以提示行显示 */
  function writeNotice(text: string) {
    if (!text || !session.value.active)
      return
    session.value = { ...session.value, notice: text }
  }

  /** 把 session.done 写进去：判据之外的完成通道（demo 步与「跳过这一步」共用） */
  function markStepDone(stepId: string) {
    if (!stepId || session.value.done.includes(stepId))
      return
    session.value = { ...session.value, done: [...session.value.done, stepId] }
  }

  /**
   * demo 步（纯讲解）在 reveal 之后停一拍再落 session.done。
   * 定时器跨会话要认 seq：退一次再进一次，上一场的定时器不能往新会话里写。
   */
  function markDemoDone(stepId: string) {
    if (!stepId || session.value.done.includes(stepId))
      return
    const seq = session.value.seq
    setTimeout(() => {
      if (!session.value.active || session.value.seq !== seq)
        return
      markStepDone(stepId)
    }, PRACTICE_DEMO_BEAT_MS)
  }

  /** result 步的逃生口（Tour 底栏的「跳过这一步」）：写 done 再前进；进度只增不减，但不写产物 */
  function skipStep() {
    const step = practice.currentStep()
    if (!step || !session.value.active)
      return
    markStepDone(step.id)
    practice.next()
  }

  /** 记录一条真正执行过的 prepare：卡片上的「跟练已替你布好这一步」由它反推，不再由剧本静态推导 */
  function noteApplied(stepId: string, prep: PracticePrepare) {
    if (!stepId)
      return
    const key = 'key' in prep ? String(prep.key || '') : ''
    const rest = session.value.applied.filter((item) => {
      if (item.stepId !== stepId || item.prep.kind !== prep.kind)
        return true
      const itemKey = 'key' in item.prep ? String(item.prep.key || '') : ''
      return itemKey !== key
    })
    session.value = { ...session.value, applied: [...rest, { stepId, prep }] }
  }

  /** 建节点失败（正常不会发生）：如实说一句，别让卡片的 ready 行凭剧本瞎承诺 */
  function noticePlaceNode(kind: string) {
    writeNotice(opts.t('先在画布上放一个{kind}节点', { kind: opts.t(practiceKindLabel(kind)) }))
  }

  /** 跟练作用域内按 key 定位节点：key 为空时取该 kind 的第一个（基线里预置的节点不算） */
  function practiceScopeNode(kind: string, key?: string): CanvasFlowNode | undefined {
    const hit = practiceScopedNodeOf(view.value, kind, key)
    const node = hit ? opts.findNode(hit.id) : undefined
    return isFlowContentNode(node) ? node : undefined
  }

  /** 按 practiceKey 定位（不限 kind）：fromKey / textUpstream.key 只给了 key，没给 kind */
  function practiceScopeNodeByKey(key?: string): CanvasFlowNode | undefined {
    if (!key)
      return undefined
    const hit = view.value.nodes.find(node => node.key === key)
    const node = hit ? opts.findNode(hit.id) : undefined
    return isFlowContentNode(node) ? node : undefined
  }

  /** 选中某个节点（只选中、不展开面板）：紧凑态 Inspector 里的 data-guide 锚点靠它挂出来 */
  function focusPracticeNode(node?: CanvasFlowNode) {
    if (!node)
      return
    for (const item of opts.nodes.value)
      item.selected = false
    node.selected = true
  }

  /** 新节点的落点：有上游就放它右侧 80px（与 graphOriginPoint 同口径），否则避开已有节点、画布空着才用视口中心 */
  function practiceNewNodeSpot(from?: CanvasFlowNode): { x: number, y: number } | null {
    if (from) {
      const abs = absPosition(from, opts.nodes.value)
      return { x: abs.x + nodeSize(from).w + 80, y: abs.y }
    }
    const boxes = opts.nodes.value
      .filter(node => opts.isContentNode(node))
      .map((node) => {
        const abs = absPosition(node as CanvasFlowNode, opts.nodes.value)
        const box = nodeSize(node as CanvasFlowNode)
        return { x: abs.x, y: abs.y, w: box.w, h: box.h }
      })
    return practiceSpotForNewNode(boxes)
  }

  /**
   * 按 kind 建一个跟练节点，并在**同一拍**写 practiceKey。
   * 为什么不拆成两步：下一次 practiceScopeNode 读的是 view（computed 自 nodes ref），
   * key 晚一拍落，同一步里后面那些按 key 定位的动作（补边、写字段）就会找不到刚建的这个节点。
   */
  function createPracticeNode(
    kind: CanvasNodeKind,
    key: string | undefined,
    spot: { x: number, y: number } | null,
    label?: string,
  ): CanvasFlowNode | undefined {
    const id = (spot ? opts.addNode(kind, spot.x, spot.y) : null) ?? opts.addNodeAtCenter(kind)
    if (!id)
      return undefined
    opts.updateNodeData(id, {
      ...(key ? { practiceKey: key } : {}),
      ...(label ? { label } : {}),
    })
    const node = opts.findNode(id)
    return isFlowContentNode(node) ? node : undefined
  }

  /** 按 key/kind 定位，找不到就建（同一拍写 practiceKey）；落点优先摆在 fromKey 那个节点的右侧 80px */
  function ensureScopeNode(
    kind: CanvasNodeKind,
    key?: string,
    fromKey?: string,
  ): CanvasFlowNode | undefined {
    const found = practiceScopeNode(kind, key)
    if (found)
      return found
    return createPracticeNode(kind, key, practiceNewNodeSpot(practiceScopeNodeByKey(fromKey)))
  }

  /** 补边（已连上就不重复连） */
  function linkScopeNodes(from: CanvasFlowNode, to: CanvasFlowNode) {
    if (view.value.edges.some(edge => edge.source === from.id && edge.target === to.id))
      return
    opts.linkNodes({ source: from.id, target: to.id, sourceHandle: 'out', targetHandle: 'in' })
  }

  function linkFromKey(fromKey: string, to: CanvasFlowNode) {
    const from = practiceScopeNodeByKey(fromKey)
    if (from)
      linkScopeNodes(from, to)
  }

  /**
   * 主体引用（API.md 10.2）：写 subjectIds + 锁定版本；主体库为空就写 session.notice 后照常继续。
   * await 之后会话可能已经退出，所以写完前必须再查一次 session.active。
   */
  async function applySubjectRef(patch: Record<string, unknown>, kind: 'character' | 'scene' | 'prop') {
    const subject = await opts.resolveSubject(kind)
    if (!session.value.active)
      return
    if (!subject) {
      writeNotice(opts.t('主体库还是空的：这一步按「不引用主体」演示'))
      return
    }
    patch.subjectIds = [subject.id]
    patch.subjectVersions = { [String(subject.id)]: subject.version }
  }

  /**
   * 执行一条 prepare（设计 §3.0 的六种）。每条都走同一套动作：
   * 「按 key/kind 定位 → 找不到就建（同一拍写 practiceKey）→ 补边 → 写字段」。
   *
   * 画布在跟练期间只读，不存在「用户已经写过的字」需要让位，所以字段一律写
   * （fillEmptyOnly 那套旗标随只读语义一起删了）。写入全部落进沙盒：退出 loadGraph 还原。
   */
  async function practicePrepareAction(prep: PracticePrepare, stepId: string) {
    if (!session.value.active)
      return
    switch (prep.kind) {
      case 'add-node': {
        // 已经有了就跳过：自动路径每次进步骤都会重算计划，不能每进一次就多建一个
        if (gateSatisfied({ kind: 'node', nodeKind: prep.nodeKind, atLeast: 1, key: prep.key }, view.value))
          return
        const node = createPracticeNode(prep.nodeKind as CanvasNodeKind, prep.key, practiceNewNodeSpot(), prep.label)
        if (!node) {
          noticePlaceNode(prep.nodeKind)
          return
        }
        focusPracticeNode(node)
        noteApplied(stepId, prep)
        revealPracticeAnchorSoon(node.id)
        return
      }
      case 'add-connect': {
        // 缺 toKind 就先替用户建一个，再连上——这一步永远不会把人卡住
        const from = practiceScopeNode(prep.fromKind, prep.fromKey)
        if (!from) {
          noticePlaceNode(prep.fromKind)
          return
        }
        if (gateSatisfied({ kind: 'edge', fromKind: prep.fromKind, toKind: prep.toKind, fromKey: prep.fromKey, toKey: prep.toKey }, view.value))
          return
        let to = practiceScopeNode(prep.toKind, prep.toKey)
        if (!to) {
          // 落点用「from 右侧 80px」（与 graphOriginPoint / 助手落图同口径），不要落在视口中心跟 from 叠一起
          to = createPracticeNode(prep.toKind as CanvasNodeKind, prep.key ?? prep.toKey, practiceNewNodeSpot(from))
        }
        if (!to) {
          noticePlaceNode(prep.toKind)
          return
        }
        linkScopeNodes(from, to)
        focusPracticeNode(to)
        noteApplied(stepId, prep)
        // 新节点落在 from 右侧，可能已经出屏：显式把它带回来（tools 锚点默认不追）
        revealPracticeAnchorSoon(to.id)
        return
      }
      case 'add-text': {
        let node = practiceScopeNode('text', prep.key)
        if (!node)
          node = createPracticeNode('text', prep.key, practiceNewNodeSpot())
        if (!node) {
          noticePlaceNode('text')
          return
        }
        // 文本节点是跟练自己的教具（角色设定 / 分镜脚本），正文一律写
        opts.updateNodeData(node.id, { content: prep.content })
        focusPracticeNode(node)
        noteApplied(stepId, prep)
        revealPracticeAnchorSoon(node.id)
        return
      }
      case 'image-setup': {
        const node = ensureScopeNode(prep.nodeKind as CanvasNodeKind, prep.key, prep.fromKey)
        if (!node) {
          noticePlaceNode(prep.nodeKind)
          return
        }
        const model = resolvePrepModel(prep.model, 'image')
        const patch: Record<string, unknown> = {
          model,
          params: { ...(prep.params || {}) },
        }
        if (prep.prompt)
          patch.prompt = prep.prompt
        if (prep.subjectKind)
          await applySubjectRef(patch, prep.subjectKind)
        if (!session.value.active)
          return
        opts.updateNodeData(node.id, patch)
        if (prep.fromKey)
          linkFromKey(prep.fromKey, node)
        focusPracticeNode(node)
        noteAppliedPrep(stepId, prep, model)
        revealPracticeAnchorSoon(node.id)
        return
      }
      case 'video-setup': {
        const node = ensureScopeNode('video', prep.key, prep.fromKey)
        if (!node) {
          noticePlaceNode('video')
          return
        }
        // 运镜课的脚本：文本上游缺就先建（带 key）并写正文，再连到视频节点上当输入
        if (prep.textUpstream) {
          let upstream = practiceScopeNode('text', prep.textUpstream.key)
          if (!upstream)
            upstream = createPracticeNode('text', prep.textUpstream.key, practiceNewNodeSpot())
          if (upstream) {
            opts.updateNodeData(upstream.id, { content: prep.textUpstream.content })
            linkScopeNodes(upstream, node)
          }
        }
        const params: Record<string, unknown> = { ...(prep.params || {}) }
        const patch: Record<string, unknown> = {}
        // model: 'auto' —— 口播那步由宿主现场解析「清单里带原生出声能力的视频模型」；
        // 解析不到就不写 model、也不写 videoMode='talking'（退回首帧驱动），data.talking 照样写进节点
        let fallbackToFirstFrame = false
        if (prep.model === 'auto') {
          const resolved = opts.resolveTalkingModel()
          if (resolved)
            patch.model = resolved
          else {
            fallbackToFirstFrame = true
            writeNotice(opts.t('清单里还没有带原生出声的模型：这一步按首帧驱动演示（口播配置照样写进节点）'))
          }
        }
        else {
          patch.model = resolvePrepModel(prep.model, 'video')
        }
        if (prep.prompt)
          patch.prompt = prep.prompt
        if (prep.talking) {
          const talking = normalizeTalkingData(prep.talking)
          patch.talking = talking
          patch.videoMode = fallbackToFirstFrame ? 'i2v' : 'talking'
          // 台词字数就是时长：没手填就用 talkingDuration 落档（这里没有模型清单，按 3~15 秒夹）
          if (!params.duration)
            params.duration = talkingDuration(talking.script, null)
        }
        else if (prep.videoMode) {
          patch.videoMode = prep.videoMode
        }
        if (prep.subjectKind)
          await applySubjectRef(patch, prep.subjectKind)
        if (!session.value.active)
          return
        if (prep.camera) {
          // 运镜是结构、prompt 只写动作：三处一起写（UI 的 chip 读 cameraMoves / fxPreset，提交侧读 params.fx）
          patch.cameraMoves = [...prep.camera.moves]
          if (prep.camera.fx) {
            patch.fxPreset = prep.camera.fx
            params.fx = prep.camera.fx
          }
          patch.camera = { ...DEFAULT_CAMERA_SETUP, on: true }
        }
        patch.params = params
        opts.updateNodeData(node.id, patch)
        if (prep.fromKey)
          linkFromKey(prep.fromKey, node)
        focusPracticeNode(node)
        noteAppliedPrep(stepId, prep, typeof patch.model === 'string' ? patch.model : undefined)
        revealPracticeAnchorSoon(node.id)
        return
      }
      case 'audio-setup': {
        // 不写 model：允许清单里没有 TTS 模型，写了会「模型未定价」（canvas-workflow-presets.ts:125）
        const node = ensureScopeNode('audio', prep.key)
        if (!node) {
          noticePlaceNode('audio')
          return
        }
        opts.updateNodeData(node.id, {
          ...(prep.label ? { label: prep.label } : {}),
          ...(prep.prompt ? { prompt: prep.prompt } : {}),
          params: { ...(prep.params || {}) },
        })
        focusPracticeNode(node)
        noteApplied(stepId, prep)
        revealPracticeAnchorSoon(node.id)
        return
      }
    }
  }

  /**
   * 进入一步时把这一步（以及到这一步为止还欠着的）都备好。
   *
   * 计划必须一个动作一拍地跑：prepare 里「刚建的节点同一 tick 里本地 nodes ref 还没回写
   * （Vue Flow 的 v-model 走 pre flush 微任务）」，而 practiceScopeNode 读的是 view（computed 自 nodes ref）。
   * 一步步等 nextTick，最多十来个微任务，用户看不到延迟。
   */
  async function runPracticeAutoPrepare() {
    const step = practice.currentStep()
    if (!step || !session.value.active)
      return
    const steps = practice.currentScript()?.steps ?? []
    const plan = practiceAutoPreparePlan(steps, session.value.stepIndex, view.value)
    for (const prep of plan) {
      await nextTick()
      if (!session.value.active)
        return
      // 计划是按剧本顺序推出来的：同一个 prep 对象在 steps 里唯一，用它反查这一步属于哪个 step
      const owner = steps.find(item => item.prepare === prep)?.id ?? step.id
      await practicePrepareAction(prep, owner)
    }
  }

  /**
   * 收尾步的成片卡：把回放那条产物留在画布视野中央。
   *
   * 优先复用跟练作用域内已有的同类节点（内容为空或已是同一 url），否则视口中心新建；
   * 居中走相机补间（滑过去的「到达感」），节点本身不做入场动画。
   */
  async function ensurePracticeShowcase(step: PracticeStep) {
    const show = step.showcase
    if (!show || !session.value.active)
      return
    await nextTick()
    if (!session.value.active)
      return
    const hit = practiceNodeOfKind(view.value, show.nodeKind)
    const picked = hit ? opts.findNode(hit.id) : undefined
    let node: (CanvasFlowNode & { data: CanvasNodeData }) | undefined = isFlowContentNode(picked) ? picked : undefined
    // 「节点在、且内容为空或已经是这条产物」才复用：线性走完时就是出片那步建的那张，不会多出第二张一样的卡
    const content = node ? String(node.data.content || '') : ''
    const reusable = Boolean(node) && (!content || content === show.url)
    if (!reusable) {
      const id = opts.addNodeAtCenter(show.nodeKind as CanvasNodeKind)
      const created = id ? opts.findNode(id) : undefined
      node = isFlowContentNode(created) ? created : undefined
    }
    if (!node)
      return
    opts.updateNodeData(node.id, {
      ...practiceReplayPatch(show.url, 'video', opts.t('生成失败')),
      model: resolvePrepModel(show.model, show.nodeKind === 'image' ? 'image' : 'video'),
      prompt: show.prompt,
      params: { ...(show.params || {}) },
      practiceShowcase: true,
    })
    for (const item of opts.nodes.value)
      item.selected = false
    node.selected = true
    // setCenter 的口径：视口 = 舞台中心 - 目标画布坐标 * zoom；这里是补间版，zoom 不变
    const pane = canvasFlowPaneRect()
    const zoom = opts.viewport.value.zoom
    const abs = absPosition(node, opts.nodes.value)
    const box = nodeSize(node)
    void camera.glideTo({
      x: (pane.width ?? 0) / 2 - (abs.x + box.w / 2) * zoom,
      y: (pane.height ?? 0) / 2 - (abs.y + box.h / 2) * zoom,
      zoom,
    }, { durationMs: CAMERA_GLIDE_MS })
    opts.notify(opts.t('成片卡已放到画布中央'))
  }

  /** 点清单里的一行：跳过去；点的就是当前这行时重跑一次（成片卡重新居中，且是幂等的） */
  function gotoStep(index: number) {
    const same = index === session.value.stepIndex
    practice.gotoStep(index)
    if (same)
      void enterPracticeStep()
  }

  /**
   * 进入某一步：先自动备好 → 再成片卡（收尾步）→ 再替用户选中锚点节点（面板保持紧凑态）→ 最后把锚点带进视野。
   *
   * inspector-* 锚点不再展开面板：跟练全程只读 + 紧凑态，展开的大面板会盖住画布；
   * 选中节点只是为了让紧凑态 Inspector 里那几个 data-guide 锚点（生成按钮 / 主体 chip / 口播框）挂出来。
   */
  async function enterPracticeStep() {
    const step = practice.currentStep()
    if (!step || !session.value.active)
      return
    // 上一步的如实说明不带进这一步：这一步要是也解析不到，备好时会自动再写一条
    if (session.value.notice)
      session.value = { ...session.value, notice: '' }
    await runPracticeAutoPrepare()
    if (!session.value.active)
      return
    await ensurePracticeShowcase(step)
    if (!session.value.active)
      return
    if (step.anchor?.startsWith('inspector')) {
      const kind = stepKindOf(step)
      const node = kind ? practiceScopeNode(kind, stepKeyOf(step) ?? undefined) : undefined
      if (node) {
        for (const item of opts.nodes.value)
          item.selected = false
        node.selected = true
        opts.inspectorOpen.value = false
      }
    }
    // 等一拍：Inspector 要等选中节点落定后才挂出来，新节点也要等 Vue Flow 渲染
    nextTick(() => revealPracticeAnchor())
    // demo 步是纯讲解：演示摆出来之后停一拍再算完成（主按钮与清单的勾都读 session.done）
    if (step.gate?.kind === 'demo')
      markDemoDone(step.id)
  }

  watch(() => session.value.stepIndex, () => {
    if (!session.value.active)
      return
    void enterPracticeStep()
  })

  /**
   * 把这一步的高亮目标带进可视区。
   *
   * 跟练是“浮层指路”范式：卡片和聚光灯贴在锚点当前的屏幕位置上，而右侧 Inspector 是
   * position:fixed 且上下左右都不夹界——节点靠近舞台下缘时，面板连同 inspector-run 那颗
   * 生成按钮整块掉到窗外，用户既看不到也点不到。这里替用户把画布平移回来。
   *
   * 视口平移与元素的 client 位移是 1:1（zoom 不变），一轮就该收敛；面板重排要等一帧，
   * 所以补间跑完再量一轮（最多两轮），吸收对话栏折叠那 240ms 宽度过渡造成的过期 pane。
   * 目标元素可能还没渲染出来（刚建的节点晚于 store 写入、Inspector 晚于选中），最多再等三帧——
   * 但补间在飞时不能量：锚点元素每帧都在动，这时算出来的 dx/dy 是错的。
   */
  async function revealPracticeAnchor(overrideNodeId?: string, wait = 0, measure = 0) {
    if (!import.meta.client || !session.value.active)
      return
    const el = practiceAnchorElement(overrideNodeId)
    if (!el) {
      if (wait < REVEAL_MAX_WAIT_FRAMES && !camera.tweening.value)
        requestAnimationFrame(() => void revealPracticeAnchor(overrideNodeId, wait + 1, measure))
      return
    }
    const pane = canvasFlowPaneRect()
    const paneW = pane.width ?? 0
    const paneH = pane.height ?? 0
    if (paneW <= 0 || paneH <= 0)
      return
    const r = el.getBoundingClientRect()
    const { dx, dy } = canvasRevealShift(
      { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height },
      { left: pane.left, top: pane.top, width: paneW, height: paneH },
    )
    if (!dx && !dy)
      return
    // 补间会覆盖旧目标（起点 = 旧补间的当前插值）：连续两次 reveal 不会打架，也不会瞬移
    await camera.panBy(dx, dy)
    if (!session.value.active)
      return
    if (measure < 2)
      nextTick(() => void revealPracticeAnchor(overrideNodeId, wait, measure + 1))
  }

  /** reveal 的目标元素：常显轨道（tools / starts）不追，其余按当前步骤的锚点找 */
  function practiceAnchorElement(overrideNodeId?: string) {
    if (overrideNodeId)
      return document.querySelector<HTMLElement>(`[data-id="${overrideNodeId}"]`)
    const anchor = practice.currentStep()?.anchor
    if (!anchor || anchor === 'tools' || anchor === 'starts')
      return null
    const selector = anchorSelector(anchor, view.value)
    return selector ? document.querySelector<HTMLElement>(selector) : null
  }

  function revealPracticeAnchorSoon(nodeId?: string) {
    nextTick(() => void revealPracticeAnchor(nodeId))
  }

  return {
    session,
    view,
    /**
     * 相机补间的 driver（Workspace 要给 @move-start / @node-click / @node-drag-start 绑 cancel）。
     * 注意宿主返回的是普通对象：模板里不能写 practice.camera.cancel()，要先落顶层别名。
     */
    camera,
    start,
    selectScript,
    exit,
    gotoStep,
    skipStep,
    replaySubmit: practice.replaySubmit,
    next: practice.next,
    minimize: practice.minimize,
    restore: practice.restore,
  }
}
