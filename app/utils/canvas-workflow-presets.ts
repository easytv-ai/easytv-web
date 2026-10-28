/**
 * 行业配方库（L3 的"从零起步"入口）：把当期常用、也确实跑得通的节点链固化成配方，
 * 用户点一下就能整块落到画布上照着改。按行业场景分组（顺序见 WORKFLOW_PRESET_GROUPS）：
 * 通用 → 电商商品 → 本地生活 → 课程知识。
 *
 * 约定（与后台 /generation/models 对齐，改模型 id 前先确认线上有定价，否则提交会拿「模型未定价」）：
 * - 图片：qwen-image-2.0（unit=image、11 点/张，image_input=url，能直接吃上游参考图）
 * - 换装定妆：qwen-image-edit（16 点/张，三张参考图按 image 角色一起提交）
 * - 视频：Kling-2.5（unit=second、16 点/秒，durations 3–15，resolutions 720P/1080P，口播需运营开 native_audio）
 * - node.data 里只写 Inspector 认的字段：model / params(ratio|clarity|quality|duration|resolution) /
 *   videoMode(reference|fl2v|i2v|talking) / prompt / content / label
 *
 * 这些是"配方不是成品"：只带提示词与参数，产物留空，落图后由用户自己点生成（也就自己付费）。
 *
 * 配方字段（可选，老预设不带也能渲染）：
 * - scenario：场景分组 id（面板按 WORKFLOW_PRESET_GROUPS 的顺序分组）
 * - platform：这条配方的平台规格（比例 / 时长 / 分辨率），卡片上显示
 * - estimatedPoints：把这条配方的场景跑一次的点数估算（图片按张、视频按秒：qwen-image-2.0 11 点/张、
 *   qwen-image-edit 16 点/张、Kling-2.5 16 点/秒）。单镜单支线就等于落图 graph 重跑一次；多镜配方
 *   （多镜头分镜 2 镜、一图三规格 3 支线、同城双镜 2 段、微课 36 镜）按文案里的镜数铺满算——
 *   落图 graph 是能复制的片段（微课只落 3 镜试片 ≈273 点，铺满 ≈3276 点）。
 * - copyTemplate：给用户照着改的文案模板（含「{商品名}」这类填空占位）。**刻意不进 i18n**：该字段
 *   原样渲染。vue-i18n 的 message compiler 编译中文花括号占位会抛
 *   `SyntaxError: Message compilation error: Invalid token in placeholder`（scripts/i18n-merge.py 的
 *   \{(\\w+)\} 在 Python 里能匹配中文，会把 zh 写成 k:k），所以只有 name / hint 这类不带花括号的文案才走 t()。
 * - teachingPoint：这条配方要讲清的一句话教学重点（口播能力位、合成上限这类前提写在这里）。
 */

import type { CanvasWorkflowGraph } from '~/utils/canvas-workflow'

/** 场景分组 id：顺序即面板分组顺序（通用放最前，保持原「官方预设」的第一眼位置） */
export type WorkflowPresetScenario = 'generic' | 'ecom-product' | 'local-life' | 'course-knowledge'

export type WorkflowPresetPlatform = {
  /** 出图/出片比例（取自 Inspector 的 RATIO_ITEMS，非法值会被回落） */
  ratio: string
  /** 单条视频的时长（秒）；多镜配方这里写"每镜"的时长，整片时长看 copyTemplate */
  durationSeconds: number
  resolution: string
  /** 卡片上代替单一比例的说明。两镜比例不同时用，渲染时过 t() */
  shotLine?: string
}

export type WorkflowPreset = {
  id: string
  /** 中文原文即 key，渲染时过 t() */
  name: string
  hint: string
  graph: CanvasWorkflowGraph
  /** 场景分组 id */
  scenario?: WorkflowPresetScenario
  /** 平台规格：比例 / 时长 / 分辨率 */
  platform?: WorkflowPresetPlatform
  /** 跑完整场景一次的点数估算（口径见文件头） */
  estimatedPoints?: number
  /** 文案模板：原样渲染，不要进 i18n（含中文花括号占位） */
  copyTemplate?: string
  /** 一句话教学重点 */
  teachingPoint?: string
}

/** 分组元数据：只有顺序与说明，组内配方由 groupedWorkflowPresets 现场挑 */
export type WorkflowPresetGroupMeta = {
  scenario: WorkflowPresetScenario
  /** 中文原文即 key，渲染时过 t() */
  label: string
  note: string
}

/** 面板分组视图：元数据 + 组内配方 */
export type WorkflowPresetGroup = WorkflowPresetGroupMeta & {
  items: WorkflowPreset[]
}

const IMAGE_MODEL = 'qwen-image-2.0'
const IMAGE_EDIT_MODEL = 'qwen-image-edit'
const VIDEO_MODEL = 'Kling-2.5'
const PRESET_VERSION = 1

/** 图片节点默认参数：16:9 出图，2K 清晰度（与 Inspector 的默认档一致，但显式写出来便于以后改） */
const IMAGE_PARAMS = { ratio: '16:9', clarity: '2K', quality: 'std' }

/** 视频节点默认参数：5 秒、1080P，首帧驱动（上游图当第一帧） */
const VIDEO_PARAMS = { duration: 5, resolution: '1080P', ratio: '16:9' }

/** 节点参数覆盖：ratio/duration 这类要按配方各写各的，但别改上面的共享默认值（会串到别的配方） */
type ImagePatch = {
  /** 省略 = 默认图片模型；null = 上传位（不写模型，等用户上传素材） */
  model?: string | null
  params?: Record<string, unknown>
}

/** 一行提示词：文本节点用 content（下游读的是 content），图片/视频节点用 prompt */
function textNode(id: string, x: number, y: number, label: string, content: string) {
  return { id, kind: 'text', x, y, width: 320, height: 220, data: { label, content, prompt: content } }
}

function imageNode(id: string, x: number, y: number, label: string, prompt = '', patch: ImagePatch = {}) {
  const data: Record<string, unknown> = { label, prompt, params: { ...IMAGE_PARAMS, ...patch.params } }
  const model = patch.model === undefined ? IMAGE_MODEL : patch.model
  if (model)
    data.model = model
  return { id, kind: 'image', x, y, width: 320, height: 240, data }
}

function videoNode(
  id: string,
  x: number,
  y: number,
  label: string,
  prompt = '',
  videoMode: 'i2v' | 'fl2v' | 'reference' | 'talking' = 'i2v',
  patch: { params?: Record<string, unknown> } = {},
) {
  return {
    id,
    kind: 'video',
    x,
    y,
    width: 360,
    height: 260,
    data: { label, prompt, model: VIDEO_MODEL, videoMode, params: { ...VIDEO_PARAMS, ...patch.params } },
  }
}

/**
 * 音频节点不写 model：允许清单里没有 TTS 模型（写了会「模型未定价」），它只承载上传的自备配音。
 * 连线方向必须是 video → audio（后端按这个方向把配音挂到镜头上，compose.go 的 voiceAssetsByVideo）。
 */
function audioNode(id: string, x: number, y: number, label: string) {
  return { id, kind: 'audio', x, y, width: 280, height: 118, data: { label, prompt: '' } }
}

function edge(source: string, target: string) {
  return { source, target, sourceHandle: 'out', targetHandle: 'in' }
}

/**
 * 视频高清节点：不写生成模型（后端按 upscale 能力位挑），也不写时长。
 * 连线必须是成片 → 高清。点这个节点的生成才走媒体作业，点数不进配方卡片。
 * 补帧 / 慢放保持关闭：提交时只带 resolution。
 */
function hdNode(id: string, x: number, y: number, resolution: '1080P' | '2K' | '4K' = '2K') {
  return {
    id,
    kind: 'video',
    x,
    y,
    width: 360,
    height: 260,
    data: {
      label: '成片高清',
      tag: '高清',
      prompt: '',
      hdParams: { model: '', resolution, interp: 'none', slowmo: '1x' },
    },
  }
}

/** 分组顺序：通用 → 电商商品 → 本地生活 → 课程知识（通用放最前，保持原「官方预设」的位置） */
export const WORKFLOW_PRESET_GROUPS: WorkflowPresetGroupMeta[] = [
  {
    scenario: 'generic',
    label: '通用',
    note: '结构底座：一句话成片和多镜头分镜，再加上首尾帧、同一主体出片、一景两镜、出片后再高清。图生视频·首帧驱动已下线，参考图定妆出片已并入电商的「商品换装换景·三路参考出片」。',
  },
  {
    scenario: 'ecom-product',
    label: '电商商品',
    note: '商品图起步：一图三规格派生、换模特换场景与卖点字幕，按各平台比例/时长一次落图。',
  },
  {
    scenario: 'local-life',
    label: '本地生活',
    note: '门店实拍起步：口播时长由台词自动算，30 秒同城版用两段 ≤15s 接。',
  },
  {
    scenario: 'course-knowledge',
    label: '课程知识',
    note: '讲稿起步：知识点口播、微课多镜与 SRT/交付包，字幕做成可复用资产。',
  },
]

const FALLBACK_SCENARIO: WorkflowPresetScenario = 'generic'

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  // ---- 通用 ----
  {
    id: 'prompt-to-video',
    name: '一句话成片',
    hint: '文本 → 出图 → 首帧出视频',
    scenario: 'generic',
    platform: { ratio: '16:9', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 91,
    copyTemplate: '【故事脚本 text.content】一句话说清「谁·在哪·做什么·什么风格」，例：一只橘猫在雨夜的东京街头寻找回家的路：霓虹倒影、湿漉漉的柏油路、电影感浅景深、镜头缓慢前推。【首帧图 prompt】把脚本收成一张剧照：主体＋环境＋光线＋镜头质感（35mm 质感、浅景深）。【视频 prompt】只写动作与运镜：镜头缓慢前推，雨滴落在猫毛上，霓虹光斑在积水中晃动。注意：上游文本只是给人看的脚本底稿，真正提交的是图片/视频节点自己的提示词（节点提示词为空时才回落到上游文本）。',
    teachingPoint: 'canvas.workflowTeach.promptToVideo',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 120, '故事脚本', '一只橘猫在雨夜的东京街头寻找回家的路：霓虹倒影、湿漉漉的柏油路、电影感浅景深，镜头缓慢前推。'),
        imageNode('i1', 400, 120, '首帧图', '电影感剧照：橘猫侧身站在雨夜街口，霓虹把湿地面照成彩色反光，浅景深，35mm 质感。'),
        videoNode('v1', 800, 120, '成片', '镜头缓慢前推，雨滴落在猫毛上，霓虹光斑在积水中晃动。'),
      ],
      edges: [edge('t1', 'i1'), edge('i1', 'v1')],
    },
  },
  {
    id: 'multi-shot',
    name: '多镜头分镜',
    hint: '一个脚本拆两个镜头，各自出图出片',
    scenario: 'generic',
    platform: { ratio: '16:9', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 182,
    copyTemplate: '【脚本】一个两镜小片段：主角在便利店买咖啡，走出门，抬头看见雨停了。【镜头一/二首帧 prompt】各写各的景别、主体位置与光线（便利店内部冷白日光灯／雨后街道霓虹倒影），两条链互不串提示词。【视频 prompt】每镜只写动作与运镜。想加镜就整列复制 image→video 再改提示词。',
    teachingPoint: 'canvas.workflowTeach.multiShot',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 220, '故事脚本', '一个三镜头的小片段：主角在便利店买咖啡，走出门，抬头看见雨停了。'),
        imageNode('i1', 400, 0, '镜头一·首帧', '便利店内部，主角在收银台前接过咖啡，冷白日光灯，玻璃门上有水珠。'),
        imageNode('i2', 400, 420, '镜头二·首帧', '雨后的街道，主角站在店门口抬头看天，霓虹倒影在水洼里。'),
        videoNode('v1', 820, 0, '镜头一成片', '镜头轻微手持晃动，蒸汽从咖啡杯上升起。'),
        videoNode('v2', 820, 420, '镜头二成片', '镜头缓慢上摇，雨滴从屋檐滴落，主角露出放松的表情。'),
      ],
      edges: [edge('t1', 'i1'), edge('t1', 'i2'), edge('i1', 'v1'), edge('i2', 'v2')],
    },
  },
  {
    id: 'fl2v-first-last',
    name: '两张图·首帧到尾帧',
    hint: '两张图分别作首帧和尾帧，再出一段过渡',
    scenario: 'generic',
    platform: { ratio: '16:9', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 80,
    copyTemplate: '【首帧图】上传这段镜头开始时的画面。【尾帧图】上传结束时的画面，必须和首帧不是同一张素材。【视频 prompt】只写两帧之间的动作与运镜，不要重写主体外形。连线顺序：先连首帧图，再连尾帧图。',
    teachingPoint: 'canvas.workflowTeach.firstLast',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        imageNode('i1', 0, 0, '首帧图（上传）', '', { model: null }),
        imageNode('i2', 0, 320, '尾帧图（上传）', '', { model: null }),
        videoNode('v1', 480, 140, '首尾帧成片', '镜头从第一张缓缓过渡到第二张，主体外形与画面文字保持不变。', 'fl2v'),
      ],
      edges: [edge('i1', 'v1'), edge('i2', 'v1')],
    },
  },
  {
    id: 'character-consistency',
    name: '角色一致性·同一主体出片',
    hint: '角色设定写成文本，定妆和出镜引用同一个主体',
    scenario: 'generic',
    platform: { ratio: '9:16', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 91,
    copyTemplate: '【角色设定 text.content】写清外貌、发型、服装、气质，例：短黑发、左眉一颗小痣、米白衬衫、冷静克制。【定妆图 prompt】半身正面，五官、发型和服装按角色设定锁死，浅灰背景，柔光，9:16。【出镜 prompt】只写动作与运镜：她转身看向镜头，头发轻轻晃动，脸和衣服保持不变。【主体】定妆图和出镜视频都在检查器点「主体」，选主体库里的同一个角色。配方不写死主体编号：编号是账号自己的，换账号就对不上。',
    teachingPoint: 'canvas.workflowTeach.character',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 80, '角色设定', '短黑发、左眉一颗小痣、米白衬衫、冷静克制。外貌、发型和服装在每条片子里都保持不变。'),
        imageNode('i1', 400, 80, '定妆图（引用主体）', '半身正面，五官、发型和服装按角色设定锁死，浅灰背景，柔光。', { params: { ratio: '9:16' } }),
        videoNode('v1', 800, 80, '角色出镜（同一主体）', '她转身看向镜头，头发轻轻晃动，脸和衣服保持不变。', 'i2v', { params: { ratio: '9:16' } }),
      ],
      edges: [edge('t1', 'i1'), edge('i1', 'v1')],
    },
  },
  {
    id: 'scene-continuity',
    name: '场景延续·一景两镜',
    hint: '一张场景首帧扇出近景和全景，两镜引用同一个场景主体',
    scenario: 'generic',
    platform: { ratio: '16:9', durationSeconds: 5, resolution: '1080P', shotLine: '近景 9:16 / 全景 16:9' },
    estimatedPoints: 171,
    copyTemplate: '【场景设定 text.content】写清地点、时间、光线、固定景物，例：老城面馆门头、暖光、雨后街道、霓虹倒影。【场景首帧 prompt】宽画幅 16:9，招牌文字清晰，玻璃门上有水珠。【近景 prompt】只写前推：从门头推到招牌牛肉面，热气升起，场景不变。比例 9:16。【全景 prompt】只写右摇：从门头摇到整条街道，场景不变。比例 16:9。【主体】首帧、近景、全景都在检查器点「主体」，选主体库里的同一个场景。配方不写死主体编号。',
    teachingPoint: 'canvas.workflowTeach.scene',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 200, '场景设定', '老城面馆门头，招牌文字清晰，店内暖光，玻璃门上有水珠，雨后街道的霓虹倒影。景物在两条片子里都保持不变。'),
        imageNode('i1', 400, 200, '场景首帧（引用主体）', '场景首帧：老城面馆门头，招牌文字清晰、店内暖光，玻璃门上有水珠，雨后街道的霓虹倒影，宽画幅 16:9。'),
        videoNode('v1', 820, 0, '近景（同一场景）', '镜头缓慢前推，从门头推到桌上的招牌牛肉面，热气升起，场景不变。', 'i2v', { params: { ratio: '9:16' } }),
        videoNode('v2', 820, 420, '全景（同一场景）', '镜头缓慢右摇，从门头摇到整条街道，霓虹倒影与行人剪影入画，场景不变。', 'i2v', { params: { ratio: '16:9' } }),
      ],
      edges: [edge('t1', 'i1'), edge('i1', 'v1'), edge('i1', 'v2')],
    },
  },
  {
    id: 'clip-then-hd',
    name: '出片后再高清',
    hint: '先出一段 1080P 成片，再接到高清节点升到 2K',
    scenario: 'generic',
    platform: { ratio: '16:9', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 91,
    copyTemplate: '【首帧 prompt】一张能当第一帧的画面：主体、环境、光线写清。【成片 prompt】只写动作与运镜。【高清】成片生成成功、进了资产库之后，再点右侧「成片高清」节点的生成。分辨率是 2K。卡片上的点数只含出片这一段。',
    teachingPoint: 'canvas.workflowTeach.hd',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 80, '画面脚本', '雨夜街口，橘猫侧身站着，霓虹把湿地面照成彩色反光。'),
        imageNode('i1', 400, 80, '首帧图', '电影感剧照：橘猫侧身站在雨夜街口，霓虹把湿地面照成彩色反光，浅景深。'),
        videoNode('v1', 800, 80, '成片', '镜头缓慢前推，雨滴落在猫毛上，霓虹光斑在积水中晃动。'),
        hdNode('h1', 1240, 80, '2K'),
      ],
      edges: [edge('t1', 'i1'), edge('i1', 'v1'), edge('v1', 'h1')],
    },
  },

  // ---- 电商商品 ----
  {
    id: 'ecom-three-specs',
    name: '商品主图·一图三规格派生（3:4 主图 / 1:1 详情页 / 9:16 信息流）',
    hint: '同一张商品图扇出三条支线，各带自己的比例与时长',
    scenario: 'ecom-product',
    platform: { ratio: '3:4', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 273,
    copyTemplate: '【卖点脚本 text.content】商品：{商品名}｜人群：{目标人群}｜痛点：{使用场景里的具体麻烦}｜卖点（可验证）：1){卖点+证据} 2){卖点+证据} 3){卖点+证据}｜价格锚点：¥{价格}（{活动}）。出三版台词：主图 8 秒 3 句、详情页 15 秒 6 句（要 30 秒就照本地生活那样两段 ≤15s 接）、信息流 15 秒 4 句，每句 ≤14 字。【三张首帧 prompt】3:4 主图：干净浅灰背景、商品正面 45°、占画面 70%，右下留价格贴纸位，画面下方一行大字「{核心卖点}」中文清晰；1:1 详情页：加{使用场景小道具}、展示{材质/尺寸细节}；9:16 信息流：上方 1/3 留钩子大字位、商品居中偏下。【视频 prompt】镜头缓慢环绕/前推，商品匀速微转，柔光棚拍，不改变商品外形与包装文字；9:16 版前 3 秒先给{痛点钩子画面}。【时长档】主图 5–8s、信息流 8–15s；详情页从 15s 起，超过 15s 按「两段 ≤15s」再接一条 video 节点（Kling-2.5 单段 3–15s）。【出图口径】平台出图只有 16:9 系 / 9:16 系 / 1:1 三个桶：3:4 与 9:16 会落成同一张竖图（qwen-image-2.0 走 imageSizeFor 归 portrait），要严格 3:4 得后期裁切，或先让运营确认网关是否透传 aspect_ratio。【交付两坑】3:4 不在合成字幕画幅内（只支持 16:9/9:16/1:1，非法值回落 16:9）——主图卖点必须烧进首帧图文字；三条片在同一画布时合成会按 y 再 x 的顺序取全部已成功视频节点，成套前分开画布或走成片时间线只选对应镜头。',
    teachingPoint: 'canvas.workflowTeach.threeSpecs',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 260, '卖点脚本', '商品：{商品名}｜人群：{目标人群}｜痛点：{使用场景里的具体麻烦}｜卖点（可验证）：1){卖点一+证据} 2){卖点二+证据} 3){卖点三+证据}｜价格锚点：¥{价格}（{活动}）。台词三版：主图 8 秒 3 句、详情页 15 秒 6 句、信息流 15 秒 4 句，每句 ≤14 字。'),
        imageNode('i0', 380, 260, '商品图（上传）', '', { model: null }),
        imageNode('i1', 760, 0, '3:4 主图首帧', '商品主图：干净浅灰背景，商品正面 45°、占画面 70%，柔光影棚光，右下留价格贴纸位，画面下方一行大字「{核心卖点}」中文清晰（卖点必须烧进图里：合成字幕画幅只有 16:9/9:16/1:1）。', { params: { ratio: '3:4' } }),
        imageNode('i2', 760, 260, '1:1 详情页首帧', '详情页方图：加{使用场景小道具}、展示{材质/尺寸细节}，主体与包装文字清晰，浅色背景留出文字位。', { params: { ratio: '1:1' } }),
        imageNode('i3', 760, 520, '9:16 信息流首帧', '信息流竖版首帧：上方 1/3 留钩子大字位，商品居中偏下，前 3 秒先给{痛点钩子画面}，暖光、手机实拍质感。', { params: { ratio: '9:16' } }),
        videoNode('v1', 1160, 0, '主图成片', '镜头缓慢环绕，商品匀速微转，柔光棚拍，不改变商品外形与包装文字。', 'i2v', { params: { ratio: '3:4' } }),
        videoNode('v2', 1160, 260, '详情页成片', '镜头缓慢前推，商品匀速微转，柔光棚拍，不改变商品外形与包装文字。', 'i2v', { params: { ratio: '1:1' } }),
        videoNode('v3', 1160, 520, '信息流成片', '镜头轻微手持跟拍，商品匀速微转，前 3 秒给痛点钩子画面，不改变商品外形与包装文字。', 'i2v', { params: { ratio: '9:16' } }),
      ],
      edges: [
        edge('t1', 'i0'),
        edge('i0', 'i1'), edge('i0', 'i2'), edge('i0', 'i3'),
        edge('i1', 'v1'), edge('i2', 'v2'), edge('i3', 'v3'),
      ],
    },
  },
  {
    id: 'ecom-cast-swap',
    name: '商品换装换景·三路参考出片（商品不变，只换人与景）',
    hint: '三路参考（商品＋模特＋场景）先定妆再出片',
    scenario: 'ecom-product',
    platform: { ratio: '9:16', durationSeconds: 5, resolution: '1080P' },
    estimatedPoints: 96,
    copyTemplate: '【换装定妆图 prompt】三张参考：图1 是商品（{商品名}），图2 是模特，图3 是场景。硬要求：商品本体的颜色、材质、logo、包装文字、纹理与图1 完全一致，不得改写、不得重绘文字；模特换成图2 人物的脸型、发型、体型、肤色与气质；背景换成图3 的{场景描述}；柔光/侧逆光，半身构图，商品占画面 40% 以上、对焦清晰。【视频 prompt】模特转身展示/抬手抚过面料/走近镜头，镜头环绕或前推，衣料褶皱与光影自然，logo 与包装文字始终清晰。【尺寸分配】3:4 走淘宝/天猫主图与详情页，9:16 走抖音信息流与小红书；同一张定妆图可再扇出第二条视频换时长档（5s/15s）。【模型选择】换装默认 qwen-image-edit（16 点/张，单条 96 点），纯立拍可换 qwen-image-2.0（11 点/张，单条 91 点）；要模特开口说话：videoMode 改「口播」，并换 Kling-2.6（原生出声默认名单含 2.6/3.0；Kling-2.5 需运营显式勾 native_audio 能力位，勾不上就整组换 2.6）。三张上游图都按 image 角色一次提交（最多 10 张），素材由用户上传。',
    teachingPoint: 'canvas.workflowTeach.castSwap',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        imageNode('i1', 0, 0, '商品图（上传）', '', { model: null }),
        imageNode('i2', 0, 300, '模特参考（上传）', '', { model: null }),
        imageNode('i3', 0, 600, '场景参考（上传）', '', { model: null }),
        imageNode('i4', 400, 300, '换装定妆图', '三张参考：图1 是商品（{商品名}），图2 是模特，图3 是场景。硬要求：商品本体的颜色、材质、logo、包装文字、纹理与图1 完全一致，不得改写、不得重绘文字；模特换成图2 人物的脸型、发型、体型、肤色与气质；背景换成图3 的{场景描述}；柔光/侧逆光，半身构图，商品占画面 40% 以上、对焦清晰。', { model: IMAGE_EDIT_MODEL, params: { ratio: '9:16' } }),
        videoNode('v1', 820, 300, '成片', '模特转身展示/抬手抚过面料/走近镜头，镜头环绕或前推，衣料褶皱与光影自然，logo 与包装文字始终清晰。', 'i2v', { params: { ratio: '9:16' } }),
      ],
      edges: [edge('i1', 'i4'), edge('i2', 'i4'), edge('i3', 'i4'), edge('i4', 'v1')],
    },
  },

  // ---- 本地生活 ----
  {
    id: 'local-talking-first-frame',
    name: '探店口播·实拍首帧（15s 单镜）',
    hint: '实拍首帧 + 15 秒口播台词，时长按台词自动算',
    scenario: 'local-life',
    platform: { ratio: '9:16', durationSeconds: 15, resolution: '1080P' },
    estimatedPoints: 240,
    copyTemplate: '【台词 ≤49 字 ≈15 秒（中文 3.5 字/秒＋1 秒收尾）】「{城市}这家{品类}，{价格锚点}就能吃到{招牌菜}。{卖点一：现做/分量/招牌做法}，{卖点二：环境/排队/服务}。左下角定位有团购，{营业时间}来之前先囤券。」【操作三步】① 台词粘进 Inspector 的「口播」框——为空会被直接拦下，时长按台词自动落档（节点上写的 15s 只是占位）；② 首帧必须连上传的实拍图，连了才按 first_frame 提交，否则回落「全能参考」；③ 节点提示词只写画面补充（门头招牌清晰、店内暖光、镜头缓慢推近），别把台词写在这里。【无实拍图】把实拍节点换成 qwen-image-2.0 生成首帧（竖版 9:16 美食特写、热气清晰、手机实拍质感），再进口播。【口播前提】口播下拉只列带 native_audio 的模型，Kling-2.5 需运营显式勾能力位（后台默认只推断 2.6/3.0）；勾不上就整组换 Kling-2.6（同为 16 点/秒，估价不变）。',
    teachingPoint: 'canvas.workflowTeach.talkingFirst',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 0, '台词卡', '「{城市}这家{品类}，{价格锚点}就能吃到{招牌菜}。{卖点一：现做/分量/招牌做法}，{卖点二：环境/排队/服务}。左下角定位有团购，{营业时间}来之前先囤券。」' + '\n（≤49 字 ≈15 秒；粘进视频节点的「口播」框，别写进节点提示词）'),
        imageNode('i1', 380, 0, '门头/菜品实拍（上传）', '', { model: null }),
        videoNode('v1', 780, 0, '口播成片', '门头招牌清晰，店内暖光，镜头缓慢推近。', 'talking', { params: { duration: 15, ratio: '9:16' } }),
      ],
      edges: [edge('t1', 'i1'), edge('i1', 'v1')],
    },
  },
  {
    id: 'local-two-shot-talking',
    name: '双镜口播·30 秒同城版（两段各 ≤15s）',
    hint: '两段 ≤15s 口播：钩子＋价格锚点，卖点＋CTA',
    scenario: 'local-life',
    platform: { ratio: '9:16', durationSeconds: 30, resolution: '1080P' },
    estimatedPoints: 480,
    copyTemplate: '【镜头一台词·钩子＋价格锚点（≤49 字）】「{城市}{商圈}这家{品类}路过三次都没进，今天{价格锚点}进来试了——{招牌菜}是{做法亮点}。」【镜头二台词·卖点＋CTA（≤49 字）】「{卖点一}，{卖点二}，人均{客单}。团购在左下角定位，{营业时间}，到店报{暗号/活动}就行。」【操作】两个首帧分别连到对应口播节点（各自走 first_frame），两段台词分别粘进两个节点「口播」框。【分段】Kling-2.5 单段只有 3–15 秒，30 秒同城版就是两段接：第一段钩子＋价格锚点、第二段卖点＋CTA。【派生 16:9】复制视频节点（副本保留参数与参考、清任务状态）→ params.ratio 改 16:9 → 同一台词与首帧重跑，投 B 站/店铺大屏。【收尾】成片后用「语音转字幕」拿逐句时间轴做字幕；改词只「片段重拍」那 5 秒，不整条重跑。【口播前提】Kling-2.5 需运营勾 native_audio 能力位（后台默认只推断 2.6/3.0）；勾不上就整组换 Kling-2.6（同为 16 点/秒，估价不变）。',
    teachingPoint: 'canvas.workflowTeach.twoShot',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 0, '镜头一台词', '「{城市}{商圈}这家{品类}路过三次都没进，今天{价格锚点}进来试了——{招牌菜}是{做法亮点}。」（≤49 字）'),
        textNode('t2', 0, 520, '镜头二台词', '「{卖点一}，{卖点二}，人均{客单}。团购在左下角定位，{营业时间}，到店报{暗号/活动}就行。」（≤49 字）'),
        imageNode('i1', 380, 0, '镜头一实拍（上传）', '', { model: null }),
        imageNode('i2', 380, 520, '镜头二实拍（上传）', '', { model: null }),
        videoNode('v1', 780, 0, '镜头一·口播', '门头招牌清晰，店内暖光，镜头缓慢推近。', 'talking', { params: { duration: 15, ratio: '9:16' } }),
        videoNode('v2', 780, 520, '镜头二·口播', '菜品特写，热气清晰，镜头轻微手持，收尾定格在招牌菜。', 'talking', { params: { duration: 15, ratio: '9:16' } }),
      ],
      edges: [edge('t1', 'i1'), edge('t2', 'i2'), edge('i1', 'v1'), edge('i2', 'v2')],
    },
  },

  // ---- 课程知识 ----
  {
    id: 'course-talking-shorts',
    name: '知识点口播·竖版（讲稿 → 口播 → 字幕源）',
    hint: '讲稿 → 定妆 → 竖版口播，另配独立 SRT 字幕源',
    scenario: 'course-knowledge',
    platform: { ratio: '9:16', durationSeconds: 10, resolution: '1080P' },
    estimatedPoints: 171,
    copyTemplate: '【五句式讲稿（前 3 秒钩子）】提问或反常识：「90% 的人都用错了 VLOOKUP」→ 定义一句 → 例子一句 → 常见误区一句 → 行动一句（关注/领资料），每句 ≤14 字，一屏一行。【定妆 prompt】保持讲师参考图的五官与气质，竖版半身、干净背景、正面看镜头、服装质感清晰；同一门课每期沿用同一张参考图，避免形象漂移。【台词与时长】讲稿粘进「口播」框；10 秒 ≈31 字（3.5 字/秒＋1 秒收尾），超 15 秒拆第二个口播节点。【字幕源】独立文本节点正文必须是带「-->」时间轴的 SRT 骨架（1 / 00:00:00,000 --> 00:00:03,000 / 一句钩子 …）；成片时间线「字幕来源」选它整份烧录，或用工具条「语音转字幕」自动填它。转写模型由后台下发、按媒体动作另计，不在本清单内。【口播前提】口播下拉只列带 native_audio 的模型，Kling-2.5 需运营勾能力位；勾不上就整组换 Kling-2.6（同为 16 点/秒，估价不变）。',
    teachingPoint: 'canvas.workflowTeach.courseShorts',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 0, '讲稿/钩子', '90% 的人都用错了 VLOOKUP\n定义：它只能从左往右查\n例子：换 XLOOKUP 一行就够\n误区：把查找列放在数据后面\n行动：关注我，领函数速查表\n（五句式、前 3 秒钩子；每句 ≤14 字，粘进视频节点「口播」框）'),
        imageNode('i1', 380, 0, '讲师参考（上传）', '', { model: null }),
        imageNode('i2', 760, 0, '定妆 9:16', '保持讲师参考图的五官与气质，竖版半身、干净背景、正面看镜头、服装质感清晰。', { params: { ratio: '9:16' } }),
        videoNode('v1', 1140, 0, '口播成片', '竖版半身，正面看镜头，干净背景，讲稿按语气自然说出。', 'talking', { params: { duration: 10, ratio: '9:16' } }),
        textNode('t2', 380, 420, '字幕源 SRT', '1\n00:00:00,000 --> 00:00:03,000\n90% 的人都用错了 VLOOKUP\n2\n00:00:03,000 --> 00:00:06,000\n它只能从左往右查\n3\n00:00:06,000 --> 00:00:08,000\n换 XLOOKUP 一行就够\n4\n00:00:08,000 --> 00:00:10,000\n关注领函数速查表'),
      ],
      edges: [edge('t1', 'i1'), edge('i1', 'i2'), edge('i2', 'v1')],
    },
  },
  {
    id: 'course-micro-lesson',
    name: '企业微课·讲稿到母版（16:9 多镜＋交付包）',
    hint: '讲稿＋分镜表 → 多镜母版，带配音轨与 SRT（先落 3 镜试片）',
    scenario: 'course-knowledge',
    platform: { ratio: '16:9', durationSeconds: 180, resolution: '1080P' },
    estimatedPoints: 3276,
    copyTemplate: '【讲稿】一句一镜；每镜写一句要点＋一个可见动作（圈重点/画线/前后对比），术语保留英文原文便于检索。【分镜表】用「场次/镜头/景别/运镜/画面/对白」列；讲稿与分镜表都做成独立源文本节点——带上游的节点不能带正文，会被当成待清产物。落图只带 3 镜试片（约 273 点）验证管线，铺满 36 镜再整列复制。【示意底图 prompt】只做示意画面，生图别写长句；字幕每行 ≤16 字、最多两行，片尾留合规声明与联系人。【配音】成片配音默认走成片时间线按策划案音色逐镜生成；自备配音改成「上传到音频节点」——音频节点不写 model（允许清单里没有 TTS 模型，写了会「模型未定价」），连线方向必须 video → audio（每镜一条），素材靠用户上传（assetId）。【成本】3 分钟成片约 36 镜 ≈3276 点（视频 2880＋图 396，转写/配音另计）；先按 3 镜试片（约 273 点）验证管线再铺满。【合成上限】单次合成最多 24 镜，超了要分段合成（片段各合成一次再拼）；36 镜满铺 = 2＋36＋36＋1＋1 = 76 节点，超过单个工作流 60 节点的上限，铺满时按 24 镜一批分画布或删掉已用不上的节点。【交付包】合成时勾「同时导出交付包」拿无字幕母版＋SRT＋对白轨＋素材清单；交付包母版是无字幕的，改一版台词只重出字幕，要换母版仍得再跑一次合成。',
    teachingPoint: 'canvas.workflowTeach.microLesson',
    graph: {
      version: PRESET_VERSION,
      nodes: [
        textNode('t1', 0, 0, '讲稿（源）', '一句一镜：① 开场提问「为什么…」② 术语定义（保留英文原文）③ 示意/对比 ④ 常见误区 ⑤ 行动项。每镜写一句要点＋一个可见动作（圈重点/画线/前后对比）。'),
        textNode('t2', 0, 420, '分镜表（源）', '场次 | 镜头 | 景别 | 运镜 | 画面 | 对白\n1-1 | 开场 | 中景 | 固定 | 讲师出镜＋标题版 | …\n1-2 | 示意 | 近景 | 前推 | 示意图 A（圈重点） | …\n1-3 | 对比 | 中景 | 左右摇 | 前后对比表 | …'),
        imageNode('i1', 400, 0, '镜一底图', '示意图：标题版＋一个关键图示，简洁扁平，留字幕位。'),
        imageNode('i2', 400, 260, '镜二底图', '示意图：单张流程/结构图，圈出重点，留字幕位。'),
        imageNode('i3', 400, 520, '镜三底图', '示意图：前后对比两栏，简洁扁平，留字幕位。'),
        videoNode('v1', 820, 0, '镜一成片', '镜头缓慢前推，重点处圈出示意。'),
        videoNode('v2', 820, 260, '镜二成片', '镜头轻微左摇，圈出重点。'),
        videoNode('v3', 820, 520, '镜三成片', '镜头左右摇做前后对比。'),
        audioNode('a1', 1240, 260, '配音轨（上传自备配音）'),
        textNode('t3', 400, 820, '字幕源 SRT', '1\n00:00:00,000 --> 00:00:05,000\n镜一要点\n2\n00:00:05,000 --> 00:00:10,000\n镜二要点\n3\n00:00:10,000 --> 00:00:15,000\n镜三要点'),
      ],
      edges: [
        // 讲稿与分镜表都是源节点（无上游），当三个镜头的底稿；连了线也不当提交内容
        edge('t1', 'i1'), edge('t1', 'i2'), edge('t1', 'i3'),
        edge('t2', 'i1'), edge('t2', 'i2'), edge('t2', 'i3'),
        edge('i1', 'v1'), edge('i2', 'v2'), edge('i3', 'v3'),
        // 配音轨：方向必须 video → audio，后端按这个方向把配音挂到镜头上
        edge('v1', 'a1'),
      ],
    },
  },
]

export function findWorkflowPreset(id: string) {
  return WORKFLOW_PRESETS.find(item => item.id === id) ?? null
}

/**
 * 面板分组视图：按 WORKFLOW_PRESET_GROUPS 的顺序排；没标 scenario（或标了未知值）的并入通用组，
 * 空组不渲染——这样以后加场景只要往两组常量里各加一条。
 */
export function groupedWorkflowPresets(presets: WorkflowPreset[] = WORKFLOW_PRESETS): WorkflowPresetGroup[] {
  const known = new Set(WORKFLOW_PRESET_GROUPS.map(group => group.scenario))
  const scenarioOf = (preset: WorkflowPreset) =>
    preset.scenario && known.has(preset.scenario) ? preset.scenario : FALLBACK_SCENARIO
  return WORKFLOW_PRESET_GROUPS
    .map(group => ({ ...group, items: presets.filter(preset => scenarioOf(preset) === group.scenario) }))
    .filter(group => group.items.length > 0)
}
