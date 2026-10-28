import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 跟练升级的契约测试（W7）：vitest 是 node 环境、不挂组件，照仓库既有做法读源码做字符串 / 正则断言。
 *
 * 口径以 docs/跟练课程与交互升级.md 为准，逐条对应 §八「契约测试要点」1–7：
 * 导出名与接口 / 事件名 / 类名与结构 / 动效机制的存在性 / 只读闸 / 删除清单的反向断言 / 接口交接点。
 * 纯函数的值断言不在这里（§八.8 放在 canvas-practice.test.ts 与 canvas-viewport-tween.test.ts）。
 *
 * 这里锁的是「改交互时最容易静默失效的接线」：漏一根不会报错，只会按钮点了没反应。
 */
function source(path: string) {
  return readFileSync(resolve(path), 'utf8')
}

/** 取一个函数的函数体（到下一个顶层 function 声明为止）：断言「闸落在哪条入口里」，比全文件命中硬 */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0)
    return ''
  const rest = src.slice(start)
  const next = rest.slice(1).search(/\n(?:async )?function /)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/** 去掉块注释：反向断言「代码里不许出现什么」时，注释里解释「为什么不用它」不算违规 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 取一条 CSS 规则的声明块（花括号配对）：反向断言只在块内做，避免误伤别的规则 */
function cssBlock(css: string, selector: string): string {
  let from = 0
  while (from < css.length) {
    const at = css.indexOf(selector, from)
    if (at < 0)
      return ''
    // 必须是「选择器整体」（逗号列表也认）：后面紧跟 { 或 ,
    if (/^\s*[{,]/.test(css.slice(at + selector.length))) {
      const open = css.indexOf('{', at + selector.length)
      let depth = 0
      for (let i = open; i < css.length; i++) {
        if (css[i] === '{')
          depth += 1
        else if (css[i] === '}') {
          depth -= 1
          if (depth === 0)
            return css.slice(open + 1, i)
        }
      }
      return ''
    }
    from = at + 1
  }
  return ''
}

const PRACTICE = 'app/utils/canvas-practice.ts'
const TWEEN = 'app/utils/canvas-viewport-tween.ts'
const GUIDE_ANIM = 'app/utils/guide-anim.ts'
const OVERLAY = 'app/composables/useGuideOverlay.ts'
const CAMERA = 'app/composables/useCanvasCameraGlide.ts'
const PRACTICE_SESSION = 'app/composables/useCanvasPractice.ts'
const HOST = 'app/composables/useCanvasPracticeHost.ts'
const TOUR = 'app/components/canvas/CanvasPracticeTour.vue'
const LIST = 'app/components/canvas/CanvasPracticeList.vue'
const WORKSPACE = 'app/components/canvas/CanvasWorkspace.vue'
const INDEX_PAGE = 'app/pages/canvas/index.vue'
const SHORTCUTS = 'app/utils/canvas-shortcuts.ts'
const INSPECTOR = 'app/components/canvas/CanvasInspector.vue'
const PROMPT_INPUT = 'app/components/canvas/CanvasPromptInput.vue'
const SMART_EDIT = 'app/components/canvas/CanvasSmartEdit.vue'
const HELP_MODAL = 'app/components/canvas/CanvasHelpModal.vue'
const MEDIA_JOBS = 'app/composables/useCanvasMediaJobs.ts'
const IMAGE_EDITS = 'app/composables/useCanvasImageEdits.ts'
const CSS = 'app/assets/css/studio-parts/canvas.css'
const TOKENS = 'app/assets/css/studio-parts/tokens-motion.css'
const STUDIO_CSS = 'app/assets/css/studio.css'

describe('导出名与接口（§八.1、§五「保留的符号」）', () => {
  it('canvas-practice.ts：判据 / 回放 / 锚点的函数与保留符号都在', () => {
    const src = source(PRACTICE)
    for (const name of [
      'practiceStepSatisfied',
      'practiceReplayFor',
      'practiceAnchorKey',
      'stepKeyOf',
      'PRACTICE_REPLAY_KINDS',
      // 设计 §五「保留的符号」：签名可变、但不许删
      'practiceReplayPatch',
      'practiceReplayFailPatch',
      'PRACTICE_REPLAY_FAIL_LABEL',
      'PRACTICE_REPLAY_FAIL_NOTICE',
      'practiceSpotForNewNode',
      'practiceScopedGraphView',
      'practiceProgress',
      'practiceReadyItems',
      'anchorSelector',
      'practiceKindLabel',
      'PRACTICE_LIST_WIDTH',
      // 八条剧本与宿主 / 界面交接的必需导出（等级分组、按 key 定位、applied 的结构类型）
      'PRACTICE_LEVELS',
      'practiceScopedNodeOf',
      'PracticeAppliedPrepare',
    ])
      expect(src, name).toMatch(new RegExp(`export (?:const|function|type|interface) ${name}\\b`))
  })

  it('canvas-viewport-tween.ts（不叫 canvas-camera.ts：那个路径已被摄影提示词库占用）：导出与常量逐个对齐 §6.1', () => {
    const src = source(TWEEN)
    for (const name of [
      'canvasEaseOutCubic',
      'canvasViewportAt',
      'canvasTweenDuration',
      'canvasViewportSettled',
      'canvasRevealShift',
      'canvasApproachFactor',
      'prefersReducedMotion',
    ])
      expect(src, name).toMatch(new RegExp(`export function ${name}\\(`))
    expect(src).toMatch(/CAMERA_GLIDE_MIN_MS = 200/)
    expect(src).toMatch(/CAMERA_GLIDE_MAX_MS = 420/)
    expect(src).toMatch(/CAMERA_GLIDE_MS_PER_PX = 0\.25/)
    // 默认整段时长与 CSS 令牌 --st-motion-camera 同值
    expect(src).toMatch(/CAMERA_GLIDE_MS = 260/)
  })

  it('guide-anim.ts：半衰期 90 / 110、is-gliding、聚光外扩与整视口兜底、transform 定位', () => {
    const src = source(GUIDE_ANIM)
    expect(src).toMatch(/GUIDE_SPOT_HALF_LIFE_MS = 90/)
    expect(src).toMatch(/GUIDE_CARD_HALF_LIFE_MS = 110/)
    expect(src).toMatch(/GUIDE_CARD_GLIDE_CLASS = 'is-gliding'/)
    for (const name of ['guideApproach', 'guideSpotRect', 'guideSpotFullscreen', 'guideCardTransform', 'guideReducedMotion'])
      expect(src, name).toMatch(new RegExp(`export function ${name}\\(`))
  })

  it('useGuideOverlay.ts：常驻 rAF + 分级节流 8 帧 + 帧率无关平滑 + reduced-motion 直落', () => {
    const src = source(OVERLAY)
    expect(src).toContain('export function useGuideOverlay(')
    expect(src).toContain('requestAnimationFrame(')
    expect(src).toContain('cancelAnimationFrame(')
    // 分级节流：禁区与清单几何每 8 帧一收（§6.2）
    expect(src).toMatch(/ZONE_EVERY_FRAMES = 8/)
    expect(src).toContain('guideApproach(')
    expect(src).toContain('GUIDE_SPOT_HALF_LIFE_MS')
    expect(src).toContain('GUIDE_CARD_HALF_LIFE_MS')
    expect(src).toContain('guideReducedMotion()')
    expect(src).toContain('guideSpotFullscreen(')
    // 数值没变就不写（稳态零响应式写入）
    expect(src).toMatch(/sameRect\(|samePoint\(/)
    for (const member of ['spot', 'card', 'gliding', 'listRect', 'listCollapsed', 'measureNow'])
      expect(src, member).toContain(member)
  })

  it('useCanvasCameraGlide.ts：单一补间槽、reduced-motion 直落、一帧一次 setViewport（不碰 setCenter / fitView）', () => {
    const src = stripComments(source(CAMERA))
    expect(src).toContain('prefersReducedMotion()')
    expect(src).toMatch(/duration <= 0 \|\| reduced/)
    expect(src).toContain('opts.setViewport(')
    expect(src).toContain('canvasViewportAt(')
    expect(src).toContain('canvasViewportSettled(')
    expect(src).toContain('cancelAnimationFrame(')
    // 循环里禁止再调 setCenter / fitView（一帧两次全量派生刷新）
    expect(src).not.toContain('setCenter(')
    expect(src).not.toContain('fitView(')
  })

  it('useCanvasPractice.ts：exit() 不带 keep，会话字段对齐（done / applied / notice + replayBusy 交接）', () => {
    const src = source(PRACTICE_SESSION)
    expect(src).toMatch(/function exit\(\)\s*\{/)
    expect(src).not.toMatch(/function exit\(\s*(?:options|keep)/)
    expect(src).toContain('export type PracticeApplied')
    expect(src).toMatch(/\bdone: string\[\]/)
    expect(src).toMatch(/\bapplied: PracticeApplied\[\]/)
    expect(src).toMatch(/\bnotice: string/)
    // 回放在飞：Tour 的「跳过这一步」据此禁用（W2/W3 的接口交接，§3.0 底栏三态③）
    expect(src).toMatch(/\breplayBusy: boolean/)
    // 领回放的口径是「节点 kind + practiceKey」：多镜 / 多规格剧本按 byKey 各演各的
    expect(src).toContain('practiceReplayFor(')
    expect(src).toContain('practiceKey')
  })
})

describe('CanvasPracticeTour（props / emit / 结构）（§八.2、§八.3、§八.4）', () => {
  const src = source(TOUR)

  it('emits 只有设计点名的七个，旧的三动作与人工介入一律不在', () => {
    for (const name of ['exit', 'next', 'goto', 'minimize', 'restore', 'pickScript', 'skip'])
      expect(src, name).toMatch(new RegExp(`\\b${name}: \\[`))
    for (const call of ["emit('exit')", "emit('next')", "emit('goto'", "emit('minimize')", "emit('restore')", "emit('pickScript'", "emit('skip')"])
      expect(src, call).toContain(call)
    // 反向断言（§八.2）：真跑 / 存模板 / 留在画布 / 帮我改 的接线不许回归
    expect(src).not.toMatch(/emit\('(?:runReal|saveWorkflow|keep)'\)/)
    expect(src).not.toMatch(/emit\('(?:prepare|modify)'/)
  })

  it('props：session（done / applied / replayBusy）、view、notice、cameraTweening；satisfied 走 done 通道', () => {
    expect(src).toMatch(/\bdone: string\[\]/)
    expect(src).toMatch(/applied\?: PracticeAppliedPrepare\[\]/)
    expect(src).toMatch(/replayBusy\?: boolean/)
    expect(src).toMatch(/cameraTweening\?: boolean/)
    expect(src).toContain('practiceStepSatisfied(step.value, props.view, doneIds.value)')
    expect(src).toContain('practiceProgress(steps.value, props.view, props.session.stepIndex, doneIds.value)')
    // ready 行只报宿主真写进去的 prepare（session.applied 反推，不由剧本静态推导）
    expect(src).toContain('practiceReadyItems(step.value, props.session.applied)')
  })

  it('三套 Transition + 聚光恒在 + 位置走 transform（卡片保留 inline width 给 readCardSize）', () => {
    expect(src).toMatch(/session\.minimized \? 'practice-pill' : 'practice-pop'/)
    expect(src).toMatch(/<Transition :name="transitionName" mode="out-in">/)
    expect(src).toContain('<Transition name="practice-step">')
    expect(src).toContain('class="canvas-guide__spot"')
    expect(src).toContain('GUIDE_CARD_GLIDE_CLASS')
    expect(src).toContain('directFall: () => Boolean(props.cameraTweening)')
    expect(src.match(/transform: guideCardTransform\(/g) ?? []).toHaveLength(2)
    // readCardSize 的准入条件是 inline width 非空（§6.2 坑②：迁 transform 后必须继续写 width）
    expect(src).toContain('!el.style.width')
    expect(src).toContain('ResizeObserver')
  })

  it('动效机制：聚光 / 卡片由常驻 rAF + 平滑趋近驱动（§6.2），旧的轮询测量不再出现', () => {
    // 旧实现是 400ms 的 setInterval 轮询：只要还有轮询测量就没落到 rAF 上
    expect(src).not.toContain('setInterval(')
    expect(src).toContain('useGuideOverlay(')
    expect(src).toContain('requestAnimationFrame(')
    expect(src).toContain('measureNow()')
    // 平滑所需的回调都从 Tour 接进 overlay：锚点身份（换步直落）、慢活刷新、相机在飞直落
    expect(src).toContain('practiceAnchorKey(')
    expect(src).toContain('anchor: () =>')
    expect(src).toContain('refreshZones: () =>')
    expect(src).toContain('directFall: () => Boolean(props.cameraTweening)')
  })

  it('底栏三态：产物步没做完主按钮禁用 + 「跳过这一步」（回放飞行中禁用）；收尾步只退出还原', () => {
    expect(src).toMatch(/:disabled="resultStep && !satisfied"/)
    expect(src).toMatch(/:disabled="Boolean\(session\.replayBusy\)"/)
    expect(src).toContain("t('跳过这一步')")
    expect(src).toContain("t('继续')")
    expect(src).toContain("t('完成，退出并还原画布')")
    // 结束卡的三按钮（canvas-guide__finish）整块已删
    expect(src).not.toContain('canvas-guide__finish')
  })

  it('卡片文案按 §九：新键在用、被删的旧键一个不留', () => {
    expect(src).toContain("t('跟练已替你布好这一步')")
    expect(src).toContain("t('等你动手：{hint}'")
    expect(src).toContain("t('由跟练演示：看完点继续')")
    // demo 步的说明行（§九）：剧本 gateHint 渲染成「这一步的做法：{what}」
    expect(src).toContain("current.gate.kind === 'demo' && current.gateHint")
    expect(src).toContain("t('这一步的做法：{what}'")
    expect(src).toContain("t('跟练走完了：退出会把画布还原成进来那一刻')")
    for (const key of [
      '已引用主体：{name}',
      '已写好台词：{text}',
      '自动 {n} 秒',
      '已写好脚本：{text}',
      '已写好正文：{text}',
      '已放好音频轨（{n} 秒）',
      '已配好运镜：{moves}',
      '模型已选好：{value}',
      '已放好一个{kind}节点',
      '已放好{from} → {to} 的连线',
    ])
      expect(src, key).toContain(`t('${key}'`)
    for (const gone of [
      '已为你准备好，请确认',
      '确认并继续',
      '我要改',
      '帮我做',
      '按上面说的做',
      '真跑一次',
      '存成我的工作流模板',
      '留在画布上继续做',
      '带走这条链',
      '每条都是八步',
    ])
      expect(src, gone).not.toContain(gone)
  })

  it('场景选择卡按 level 分组（入门 / 进阶 / 高阶），副标题按 §九 改文案', () => {
    expect(src).toContain('PRACTICE_SCRIPTS')
    expect(src).toContain('PRACTICE_LEVELS')
    expect(src).toContain('scriptGroups')
    expect(src).toMatch(/emit\('pickScript', item\.id\)/)
    expect(src).toContain('canvas-guide__scenes')
    expect(src).toContain('t(group.label)')
    expect(src).toContain("t('跟练场景：{name}'")
    expect(src).toContain("t('每条都是从易到难的一条链：跟练替你布好、你点生成看回放。全程不调模型、不花点数；中途随时可以退出，退出会把画布还原成现在的样子。')")
  })

  it('清单挂载与避让：session.done 传下去、清单进 HARD 禁区、折叠判定只跟 Inspector 求交', () => {
    expect(src).toContain('<CanvasPracticeList')
    expect(src).toContain(':done-ids="session.done"')
    expect(src).toContain(':collapsed="listFolded"')
    expect(src).toContain(':style="listStyle"')
    expect(src).toMatch(/HARD_ZONE_SELECTORS = \[[^\]]*'\.canvas-practice-list'/)
    expect(src).toContain('guideRectOverlap')
    expect(src).toContain("queryRects('[data-guide=\"inspector\"]')")
    expect(src).toContain('listHeight')
    expect(src).toMatch(/if \(!listFolded\.value\)/)
    expect(src).toContain("listManual.value = 'auto'")
    expect(src).toContain("listManual.value = listFolded.value ? 'open' : 'closed'")
    expect(src).not.toContain('canvas-guide__dots')
  })
})

describe('CanvasPracticeList（清单 / 折叠 / 图标）', () => {
  const src = source(LIST)

  it('doneIds 进 practiceProgress：演示 / 跳过都在清单上打勾', () => {
    expect(src).toMatch(/doneIds: string\[\]/)
    expect(src).toContain('practiceProgress(props.steps, props.view, props.stepIndex, new Set(props.doneIds))')
  })

  it('结构不许动（测试锁着）：<ol> 行、点行 emit goto、进度条、三个图标、scrollTop 且没有 scrollIntoView', () => {
    expect(src).toMatch(/<ol[^>]*class="canvas-practice-list__rows"/)
    expect(src).toMatch(/@click="emit\('goto', item\.index\)"/)
    expect(src).toContain("t('已完成 {n}/{total} 步'")
    expect(src).toContain('canvas-practice-list__bar')
    expect(src).toContain('i-lucide-check')
    expect(src).toContain('i-lucide-circle-dashed')
    expect(src).toContain('i-lucide-play')
    expect(src).toContain('scrollTop')
    expect(src).not.toContain('scrollIntoView(')
    expect(src).toContain(":aria-current=\"item.state === 'current' ? 'step' : undefined\"")
    expect(src).toContain("t('第 {n} 步：{title}'")
  })

  it('折叠：is-collapsed 挂在 section 上、行区包进 __body；图标三态用 Transition 交叉', () => {
    expect(src).toContain("'is-collapsed': collapsed")
    expect(src).toContain('canvas-practice-list__body')
    expect(src).toMatch(/<Transition name="practice-icon" mode="out-in">/)
  })
})

describe('useCanvasPracticeHost（自动备好 / 相机 / demo / 退出）', () => {
  const host = source(HOST)

  it('相机：实例从返回值暴露（Workspace 要绑 cancel），reveal / 成片居中 / 退出各走 panBy / glideTo / cancel', () => {
    expect(host).toContain('useCanvasCameraGlide({')
    expect(host).toContain('camera.panBy(')
    expect(host).toContain('camera.glideTo(')
    expect(host).toContain('camera.cancel()')
    expect(host).toContain('camera,')
  })

  it('demo 步：PRACTICE_DEMO_BEAT_MS 停一拍后写 session.done；「跳过这一步」走同一条 done 通道', () => {
    expect(host).toContain('PRACTICE_DEMO_BEAT_MS')
    expect(host).toContain('markDemoDone')
    expect(host).toContain('markStepDone')
    expect(host).toMatch(/function skipStep\(\)[\s\S]{0,200}markStepDone/)
    expect(host).toContain('skipStep,')
  })

  it('Inspector 全程紧凑态：宿主只关不展开（删掉强制展开那条接线）', () => {
    expect(host).toContain('opts.inspectorOpen.value = false')
    expect(host).not.toContain('inspectorOpen.value = true')
  })

  it('六种 prepare 都在，且「定位 → 缺则建（同拍写 practiceKey）→ 补边 → 写字段」', () => {
    const body = functionBody(host, 'practicePrepareAction')
    for (const kind of ['add-node', 'add-connect', 'add-text', 'image-setup', 'video-setup', 'audio-setup'])
      expect(body, kind).toContain(`case '${kind}':`)
    expect(host).toContain('function practiceScopeNode(')
    expect(host).toContain('practiceScopedNodeOf(')
    expect(host).toContain('practiceKey: key')
    expect(host).toContain('linkScopeNodes(')
    expect(host).toContain('practiceSpotForNewNode(')
    // video-setup 的文本上游、口播的 auto 解析与运镜写入
    expect(host).toContain('textUpstream')
    expect(host).toContain('normalizeTalkingData(')
    expect(host).toContain('talkingDuration(')
    expect(host).toContain("prep.model === 'auto'")
    expect(host).toContain('opts.resolveTalkingModel()')
    expect(host).toContain('opts.resolveSubject(')
    expect(host).toContain('cameraMoves')
    expect(host).toContain('fxPreset')
    // 主体库为空 / 清单里没有原生出声模型：如实写 session.notice，不静默失败
    expect(host).toContain('writeNotice(')
  })

  it('进入一步的四段顺序不变：备好 → 成片卡 → inspector 锚点（紧凑态）→ reveal', () => {
    const body = functionBody(host, 'enterPracticeStep')
    const order = [
      'await runPracticeAutoPrepare()',
      'await ensurePracticeShowcase(step)',
      "step.anchor?.startsWith('inspector')",
      'nextTick(() => revealPracticeAnchor())',
    ]
    let cursor = -1
    for (const token of order) {
      const at = body.indexOf(token)
      expect(at, token).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(body).toContain('opts.inspectorOpen.value = false')
  })

  it('基线过滤与 ref 陷阱：view 走跟练作用域、viewport / inspectorOpen 收 ref、退出 keepHistory', () => {
    expect(host).toMatch(/const practiceBaselineIds = ref<Set<string>>/)
    expect(host).toMatch(/const view = computed\(\(\) => practiceScopedGraphView\(/)
    expect(host).toMatch(/viewport: Ref</)
    expect(host).toMatch(/inspectorOpen: Ref<boolean>/)
    expect(host).toMatch(/opts\.loadGraph\(graphSnapshot, \{ keepHistory: true \}\)/)
    expect(host).toMatch(/function exit\(\)[\s\S]*?camera\.cancel\(\)/)
    expect(host).toMatch(/function exit\(\)[\s\S]*?opts\.historySuspended\.value = false/)
    expect(host).toContain('onScopeDispose(')
  })

  it('opts 注入与 ===生成 前置检查：resolveSubject / resolveTalkingModel 由页面注入，start 仍看 canEditCanvas', () => {
    expect(host).toMatch(/resolveSubject: \(kind: 'character' \| 'scene' \| 'prop'\) => Promise/)
    expect(host).toMatch(/resolveTalkingModel: \(\) => string \| null/)
    expect(host).toMatch(/canEditCanvas: \(action: '生成'\) => boolean/)
    expect(host).toMatch(/function start\([\s\S]{0,200}opts\.canEditCanvas\('生成'\)/)
  })

  it('开会话：关新手引导、显式进第 0 步、退出只有一个动作（没有 keep / 留在画布）', () => {
    expect(host).toContain("useState('canvas-guide-open', () => false)")
    expect(host).toMatch(/function start\([\s\S]*?canvasGuideOpen\.value = false/)
    expect(host).toContain('void nextTick(() => enterPracticeStep())')
    expect(host).not.toMatch(/practiceManualIds|\brealRunPlan\b|practiceDropReplayProducts|practiceScopeNodes|\bmanual\b|\bmodify\b/)
  })

  it('备好会把剧本上的模型写进节点；退出按进跟练时的快照还原', () => {
    expect(host).toContain('graphSnapshot = opts.getGraph()')
    expect(host).toContain('opts.loadGraph(graphSnapshot, { keepHistory: true })')
    expect(host).toContain('resolvePrepModel(prep.model')
    expect(host).toContain('function resolvePrepModel(')
    expect(host).toContain('patch.videoMode = prep.videoMode')
  })
})

describe('CanvasWorkspace（只读闸与接口交接）（§八.4、§八.5、§八.7）', () => {
  const ws = source(WORKSPACE)

  it('顶层别名 + 模板绑定：camera 的 tweening 必须落别名（链式取值会传 Ref 对象，聚光永远直落）', () => {
    expect(ws).toContain('const practiceCamera = practice.camera')
    expect(ws).toContain('const practiceCameraTweening = practice.camera.tweening')
    expect(ws).toContain(':camera-tweening="practiceCameraTweening"')
    expect(ws).toContain(':notice="practiceSession.notice"')
    // Tour 的七个事件逐条接上（跳步 / 最小化 / 退出 / 选场景都从模板进宿主）
    for (const binding of [
      '@exit="exitPractice"',
      '@next="practice.next()"',
      '@goto="practice.gotoStep($event)"',
      '@minimize="practice.minimize()"',
      '@restore="practice.restore()"',
      '@pick-script="selectPracticeScript($event)"',
      '@skip="practice.skipStep()"',
    ])
      expect(ws, binding).toContain(binding)
    expect(ws).not.toContain(':manual="practice.manual"')
  })

  it('只读总开关与统一提示：practiceLocked 不并入 canvasLocked（平移缩放是保留的读操作）', () => {
    expect(ws).toMatch(/const practiceLocked = computed\(\(\) => practiceSession\.value\.active\)/)
    expect(ws).toContain("t('跟练中画布是只读的：先退出跟练再编辑')")
    expect(ws).toMatch(/function practiceBlocked\(\)[\s\S]{0,200}return true/)
  })

  it('拖 / 连 / 选三处都带 !canvasLocked && !practiceLocked', () => {
    expect(ws).toContain(':nodes-draggable="!canvasLocked && !practiceLocked && !isPanning && !canvasMarkPick.open"')
    expect(ws).toContain(':nodes-connectable="!canvasLocked && !practiceLocked && !canvasMarkPick.open"')
    expect(ws).toContain(':selection-key-code="(!canvasLocked && !practiceLocked) ? selectionKeyCode : null"')
    expect(ws.match(/!canvasLocked && !practiceLocked/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('用户可点的写入口逐个上闸：每个函数体里都有一条 practiceBlocked()（§四 #5/#6/#8/#9/#14/#25；空画布起步卡是复核补的 #23）', () => {
    for (const name of ['openMenuAtAdd', 'openAssetPicker', 'onBlankContext', 'onStageDblClick', 'onNodeDblClick', 'onWindowPaste', 'runStyleExtract', 'organizeCanvas', 'onEmptyStart', 'onEmptyStartSkill'])
      expect(functionBody(ws, name), name).toContain('practiceBlocked()')
    expect(ws).toContain('@start="onEmptyStart"')
  })

  it('快捷键与相机接管：practiceReadonly 传给 dispatchCanvasShortcut；@move-start / 节点点击 / 拖起 / Ctrl+滚轮都 cancel', () => {
    expect(ws).toContain('practiceReadonly: practiceLocked.value || props.readonly')
    expect(ws).toContain('@move-start="practiceCamera.cancel()"')
    expect(functionBody(ws, 'onNodeClick')).toContain('practiceCamera.cancel()')
    expect(functionBody(ws, 'onNodeDragStart')).toContain('practiceCamera.cancel()')
    // Ctrl/⌘+滚轮被 Workspace 捕获阶段截走，Vue Flow 的 move-start 收不到，得自己取消补间
    expect(functionBody(ws, 'onWindowWheel')).toContain('practiceCamera.cancel()')
    expect(ws).toContain('@move-start')
  })

  it('选中浮动条跟练期间不渲染（派生任务的主入口，§四 #24）', () => {
    expect(ws).toMatch(/<CanvasSelBar\s+v-if="[^"]*!practiceLocked/)
  })

  it('readonly 透传：Inspector / SmartEdit 跟练期间只读；loadGraph 保留 keepHistory', () => {
    expect(ws).toContain(':readonly="practiceLocked"')
    expect(ws).toMatch(/function loadGraph\(graph: CanvasGraph \| null \| undefined, opts: \{ keepHistory\?: boolean \} = \{\}\)/)
    expect(ws).toMatch(/if \(!opts\.keepHistory\)\s*\n\s*resetHistory\(\)/)
  })

  it('成片角标（§6.3）：CanvasNode 带 practiceShowcase 分支', () => {
    const node = source('app/components/canvas/CanvasNode.vue')
    expect(node).toMatch(/v-if="data\.practiceShowcase"[\s\S]{0,120}cnode__tag-practice/)
    expect(node).toContain("t('跟练成片')")
  })
})

describe('只读闸的跨文件对端（§八.3、§八.5、§四 #10/#12/#13）', () => {
  it('canvas-shortcuts.ts 认 practiceReadonly 位：命中即 return，原生粘贴另走 onWindowPaste 的闸', () => {
    const src = source(SHORTCUTS)
    expect(src).toMatch(/practiceReadonly\??: boolean/)
    expect(src.match(/practiceReadonly/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('CanvasPromptInput.vue 是 contenteditable：readonly 必须与它写在同一行（单单 Inspector 加 readonly 挡不住键入）', () => {
    const src = source(PROMPT_INPUT)
    expect(src).toMatch(/:contenteditable="!readonly"/)
    expect(src).toMatch(/contenteditable[^\n]*readonly/)
  })

  it('CanvasInspector.vue：readonly prop + 四个新锚点（主体 / 口播 / 运镜 / 音频）', () => {
    const src = source(INSPECTOR)
    expect(src).toMatch(/readonly\??: boolean/)
    for (const anchor of ['inspector-subject', 'inspector-talking', 'inspector-cam', 'inspector-audio'])
      expect(src, anchor).toContain(`data-guide="${anchor}"`)
  })

  it('CanvasSmartEdit.vue 的识别调用认 readonly（§四 #13）：真正的闸在 recognizeRegion 的第一行早退', () => {
    const src = source(SMART_EDIT)
    expect(src).toMatch(/readonly\??: boolean/)
    // 锁函数体里的那行闸：prop 声明本身不算实现（识别要真提交 taskApi.create）
    expect(functionBody(src, 'recognizeRegion')).toContain('if (props.readonly || isRecognizing(item.id))')
  })

  it('CanvasNode.vue 双击进编辑态认跟练会话（§四 #26：它 stopPropagation，Workspace 的闸收不到）', () => {
    const node = source('app/components/canvas/CanvasNode.vue')
    expect(node).toContain("useState<PracticeSession>('canvas-practice'")
    expect(functionBody(node, 'onStageDblClick')).toContain('practiceSession.value.active')
  })

  it('跟练中替换 / 上传按钮直接禁用，查看大图仍可点', () => {
    const node = source('app/components/canvas/CanvasNode.vue')
    expect(node).toContain('const practiceLocked = computed(() => practiceSession.value.active)')
    expect(node).toContain('const writeFrozen = computed(() => practiceLocked.value || nodeLocked.value)')
    expect(functionBody(node, 'onUploadClick')).toContain('writeFrozen.value')
    expect(node).toContain(':disabled="writeFrozen"')
    expect(node).toContain(':disabled="nodeUploading || writeFrozen"')
    const previewAt = node.indexOf("t('查看大图')")
    const preview = node.slice(previewAt - 180, previewAt + 220)
    expect(preview).toContain('imagePreviewOpen = true')
    expect(preview).not.toContain('practiceLocked')
  })

  it('跟练中文本节点不露出缩放手柄', () => {
    const node = source('app/components/canvas/CanvasNode.vue')
    expect(node).toContain('v-if="isText && !writeFrozen"')
    expect(functionBody(node, 'onResizeStart')).toContain('writeFrozen.value')
  })

  it('跟练卡片的主体名和运镜名逐段过 t()，外语界面不再夹中文键', () => {
    const tour = source('app/components/canvas/CanvasPracticeTour.vue')
    expect(tour).toContain('name: t(item.name)')
    expect(tour).toContain('translateParts(item.moves)')
    expect(functionBody(tour, 'translateParts')).toContain("split(' · ')")
  })

  it('两个真提交点都有 blocked 早退：submitMediaJob 与 submitDerivedTask（缺一个就会真扣点）', () => {
    const src = source(MEDIA_JOBS)
    expect(src).toMatch(/blocked\?: \(\) => boolean/)
    expect(functionBody(src, 'submitMediaJob')).toContain('opts.blocked')
    expect(functionBody(src, 'submitDerivedTask')).toContain('opts.blocked')
  })

  it('useCanvasImageEdits 自己的两处 taskApi.create 前也早退（§四 #13）：闸必须在 create 之前', () => {
    const src = source(IMAGE_EDITS)
    expect(src).toMatch(/blocked\?: \(\) => boolean/)
    for (const name of ['runPromptOptimize', 'runImageEdit']) {
      const body = functionBody(src, name)
      expect(body, `${name} 里没有 opts.blocked 闸`).toContain('opts.blocked')
      const gate = body.indexOf('opts.blocked')
      const create = body.indexOf('taskApi.create(')
      expect(create, `${name} 里没有 taskApi.create`).toBeGreaterThan(-1)
      // 闸落在 create 之前：只数出现次数会被「先提交再检查」蒙混过去
      expect(gate, `${name} 的 blocked 闸不在 taskApi.create 之前`).toBeLessThan(create)
    }
  })
})

describe('canvas 页面（沙盒与对话栏）（§四 #15/#21、§八.5）', () => {
  const page = source(INDEX_PAGE)

  it('对话栏跟练期间不渲染（CanvasChat 零跟练感知，唯一能拦住它真提交的位置）', () => {
    expect(page).toContain('chatOpen && !practiceSession.active')
  })

  it('导入画布文件被跟练闸拦下（整张替换画布会毁掉沙盒语义）', () => {
    expect(functionBody(page, 'onImportFile')).toContain('blockedByPractice()')
  })

  it('退出只有还原一条路：没有 kept 分支（不再 markDirty / 排自动保存）', () => {
    expect(page).not.toContain('session.kept')
    expect(page).not.toContain('kept:')
  })
})

describe('删除清单的反向断言（§八.6）：六个文件对旧真跑 / keep 接线零命中', () => {
  const files = [PRACTICE, HOST, PRACTICE_SESSION, WORKSPACE, TOUR, INDEX_PAGE]
  const DELETED = /practiceRealRunPlan|practiceRealRunPoints|practiceRealRunPayload|practiceIsTalkingRun|PracticeRealRunCandidate|PracticeRealRunIssue|PracticeRealRunPlan|PracticeRealRunBlocker|PracticeRealRunInfo|practiceKeepPatch|practiceHasReplayProduct|practiceDropReplayProducts|practiceScopeNodes|realRunPlan|savePracticeWorkflow|keepPractice|runPracticeReal|practiceWaitTask|PRACTICE_REAL_TASK_TIMEOUT|prepareLabel/

  it('旧符号一个都不留', () => {
    for (const file of files)
      expect(source(file), file).not.toMatch(DELETED)
  })

  it('kept 只按 session.kept / kept: 形态断言（避免误伤 keepHistory 这类普通英文词）', () => {
    for (const file of files)
      expect(source(file), file).not.toMatch(/session\.kept|kept:/)
  })

  it('Workspace 不再绑旧事件 / 旧属性（run-real / save-workflow / keep / real-run / manual）', () => {
    const ws = source(WORKSPACE)
    expect(ws).not.toMatch(/@run-real|@save-workflow|@keep=|:real-run=|practice\.manual|practice\.modify/)
  })
})

describe('动效样式（§八.3、§6.2 / §6.3）', () => {
  const css = source(CSS)
  const tokens = source(TOKENS)

  it('令牌 120 / 160 / 220 / 260ms；reduced-motion 一次归零且角标动画关掉', () => {
    expect(tokens).toMatch(/--st-motion-fast:\s*120ms/)
    expect(tokens).toMatch(/--st-motion-base:\s*160ms/)
    expect(tokens).toMatch(/--st-motion-slow:\s*220ms/)
    expect(tokens).toMatch(/--st-motion-camera:\s*260ms/)
    const media = cssBlock(tokens, '@media (prefers-reduced-motion: reduce)')
    expect(media).toContain('--st-motion-camera: 1ms')
    expect(media).toMatch(/\.cnode__tag-practice\s*\{\s*animation:\s*none/)
  })

  it('studio.css 第一行 @import 令牌文件（@import 必须在其它规则之前）', () => {
    expect(source(STUDIO_CSS).split('\n')[0]).toContain("@import './studio-parts/tokens-motion.css'")
  })

  it('清单折叠：__body 1fr ↔ 0fr（min-height:0 + overflow:hidden），行区不再有 max-height', () => {
    const body = cssBlock(css, '.canvas-practice-list__body')
    expect(body).toMatch(/grid-template-rows:\s*1fr/)
    expect(body).toContain('min-height: 0')
    expect(body).toContain('overflow: hidden')
    expect(cssBlock(css, '.canvas-practice-list.is-collapsed .canvas-practice-list__body')).toMatch(/grid-template-rows:\s*0fr/)
    expect(cssBlock(css, '.canvas-practice-list__rows')).not.toContain('max-height')
  })

  it('聚光恒在：位置走 transform、left/top 归零、绝不写 CSS transition（与 rAF 抢同一属性）', () => {
    const spot = cssBlock(css, '.canvas-guide__spot')
    expect(spot).toMatch(/top:\s*0/)
    expect(spot).toMatch(/left:\s*0/)
    expect(spot).not.toContain('transition')
    expect(cssBlock(css, '.canvas-guide__card--practice:not(.canvas-guide__card--pick)')).toMatch(/top:\s*0/)
  })

  it('卡片滑行不吃点击 + 药丸出入场写全居中位移 + 三套过渡名 + 跟练层 z-index', () => {
    expect(cssBlock(css, '.canvas-guide__card.is-gliding')).toContain('pointer-events: none')
    expect(cssBlock(css, '.practice-pill-enter-from')).toContain('translateX(-50%)')
    expect(css).toContain('.practice-step-enter-from')
    expect(css).toContain('.practice-icon-enter-from')
    expect(css).toMatch(/\.canvas-guide--practice\s*\{[^}]*z-index:\s*72/)
  })

  it('进度条选择器不许动（测试锁着）、宽度过渡走令牌；成片角标一次性 keyframes', () => {
    expect(cssBlock(css, '.canvas-practice-list__bar i')).toContain('transition: width var(--st-motion-slow)')
    expect(css).toContain('.cnode__tag-practice')
    expect(cssBlock(css, '.cnode__tag-practice')).toContain('animation: practice-tag-in')
    expect(css).toMatch(/@keyframes practice-tag-in/)
    expect(css).not.toContain('.canvas-guide__dots')
  })
})

describe('i18n 文案面（§九 / §五）', () => {
  it('帮助弹窗改成「跟练期间画布只读…」：不再提真跑与留在画布', () => {
    const src = source(HELP_MODAL)
    expect(src).not.toContain("t('也可以选真跑一次，点数写在按钮上；收尾可以把成片留在画布上。')")
    expect(src).toContain("t('跟练期间画布只读：跟练替你布好每一步，你点生成看回放；退出会把画布还原。')")
    expect(src).toContain("t('canvas.director.preview.help')")
    expect(src).toContain("t('canvas.director.export.help')")
    expect(src).toContain("t('canvas.help.compose')")
    expect(src).toContain("t('canvas.help.shortcuts')")
    expect(src).toContain("t('视频工具条只显示当前账号已开通的能力，没开通的不会出现。')")
  })
})
