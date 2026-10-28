/**
 * 摄影提示词库：机身 / 镜头 / 焦段 / 光圈四段各自贡献一句英文片段，按顺序拼到
 * 生成提示词末尾。片段都写成可逗号连接的短句，最后补一条 guardrail，免得模型
 * 把相机、三脚架本身画进画面。
 *
 * 常量表里存中文原文，渲染时再过 t()，和 canvas-node-kinds.ts 的做法一致。
 */

/** 节点上保存的摄影配置，随节点复制、随画布 graph 一起存 */
export type CameraSetup = {
  /** 关掉时不参与提示词拼接，配置仍留在节点上 */
  on: boolean
  body: string
  lens: string
  focal: number
  aperture: number
}

export type CameraOption = {
  id: string
  /** 机型 / 镜头型号保持英文原名 */
  name: string
  /** 中文名 */
  label: string
  desc: string
  useCase: string
  /** 拼进提示词的英文片段 */
  prompt: string
}

export const CAMERA_BODIES: CameraOption[] = [
  {
    id: 'alexa-35',
    name: 'ARRI ALEXA 35',
    label: '阿莱 ALEXA 35',
    desc: '影视工业标杆，宽容度高，肤色还原准',
    useCase: '剧情片、高端广告',
    prompt: 'shot on ARRI ALEXA 35, ARRI REVEAL color science, 17 stops of dynamic range, natural highlight rolloff, true-to-life skin tones, refined filmic grain',
  },
  {
    id: 'venice-2',
    name: 'Sony VENICE 2',
    label: '索尼 VENICE 2',
    desc: '8K 全画幅，双原生 ISO，暗部干净',
    useCase: '夜戏、科幻、大制作',
    prompt: 'shot on Sony VENICE 2, 8.6K full-frame sensor, dual base ISO with clean shadows, deep saturated color, crisp modern digital cinema look',
  },
  {
    id: 'komodo-x',
    name: 'RED KOMODO-X',
    label: '红龙 KOMODO-X',
    desc: '全局快门，高微对比，动态画面不果冻',
    useCase: '动作、运动、车拍',
    prompt: 'shot on RED KOMODO-X, global shutter, high micro-contrast, punchy REDWideGamutRGB color, sharp action-ready rendering',
  },
  {
    id: 'ursa-12k',
    name: 'Blackmagic URSA Cine 12K',
    label: '黑魔法 URSA Cine 12K',
    desc: '12K 高解析，对比清淡好调色',
    useCase: '独立电影、纪录片',
    prompt: 'shot on Blackmagic URSA Cine 12K, Generation 5 color science, gentle contrast, flexible neutral base image, abundant fine detail',
  },
  {
    id: 'vision3-500t',
    name: 'Kodak Vision3 500T',
    label: '柯达 Vision3 500T 胶片',
    desc: '35mm 胶片颗粒，暖调高光，光源带光晕',
    useCase: '文艺片、MV、怀旧质感',
    prompt: 'shot on 35mm Kodak Vision3 500T motion picture film, organic silver-halide grain, warm tungsten-balanced highlights, soft halation around light sources, analog color response',
  },
  {
    id: 'portra-400',
    name: 'Kodak Portra 400',
    label: '柯达 Portra 400',
    desc: '人像负片，肤色柔和偏暖，对比低',
    useCase: '人像、生活、婚礼',
    prompt: 'shot on Kodak Portra 400 medium-format film, creamy pastel skin tones, low contrast, fine grain, gentle warm cast',
  },
  {
    id: 'x2d-100c',
    name: 'Hasselblad X2D 100C',
    label: '哈苏 X2D 100C',
    desc: '中画幅一亿像素，层次细腻',
    useCase: '产品、时尚静帧、封面',
    prompt: 'shot on Hasselblad X2D 100C, 100MP medium-format sensor, Hasselblad Natural Colour Solution, extreme tonal gradation, immaculate detail',
  },
  {
    id: 'smartphone',
    name: 'Smartphone',
    label: '手机直出',
    desc: '广角高锐度，HDR 重，日常真实感',
    useCase: '社媒、vlog、伪纪实',
    prompt: 'shot on a modern smartphone camera, wide-angle HDR look, heavy computational sharpening, everyday candid realism',
  },
]

export const CAMERA_LENSES: CameraOption[] = [
  {
    id: 'cooke-s7',
    name: 'Cooke S7/i',
    label: '库克 S7/i',
    desc: '经典 Cooke Look，虚实过渡柔，肤色讨喜',
    useCase: '人像、剧情对白',
    prompt: 'Cooke S7/i full-frame prime, signature Cooke Look, gentle roll-off into focus, warm flattering skin rendition, round creamy bokeh',
  },
  {
    id: 'supreme-prime',
    name: 'Zeiss Supreme Prime',
    label: '蔡司 Supreme 定焦',
    desc: '中性锐利，畸变低，耀斑克制',
    useCase: '广告、产品、科幻',
    prompt: 'Zeiss Supreme Prime, neutral high-resolution rendering, low distortion, even field illumination, clean well-controlled flare',
  },
  {
    id: 'anamorphic',
    name: 'Anamorphic',
    label: '变形宽银幕镜头',
    desc: '椭圆焦外，蓝色横向耀斑，宽银幕味',
    useCase: '大片、预告片',
    prompt: 'anamorphic cine lens with 2x squeeze, oval bokeh, horizontal blue streak flares, slight barrel distortion, cinemascope character',
  },
  {
    id: 'helios-44',
    name: 'Helios 44-2',
    label: '老镜旋焦',
    desc: '旋转焦外，低对比，暖偏色，开放光圈发光',
    useCase: '文艺、梦境、MV',
    prompt: 'vintage Helios 44-2 lens, swirly rotating bokeh, low contrast, warm color cast, soft uncoated glow wide open',
  },
  {
    id: 'macro',
    name: 'Macro',
    label: '微距镜头',
    desc: '极浅景深，表面纹理毕现',
    useCase: '产品细节、食物、昆虫',
    prompt: 'dedicated macro lens at 1:1 magnification, razor-thin plane of focus, extreme surface texture detail, smooth defocused background',
  },
  {
    id: 'tilt-shift',
    name: 'Tilt-Shift',
    label: '移轴镜头',
    desc: '焦平面可倾斜，出微缩感，垂直线不变形',
    useCase: '建筑、城市、微缩',
    prompt: 'tilt-shift lens, tilted plane of focus, a selective sliver of sharpness, miniature-model effect, corrected vertical lines',
  },
]

export type CameraScaleOption = {
  value: number
  /** 中文档位名，单独拿出来是为了能当 i18n key（label 含 . 和 / 不能做 key） */
  tier: string
  desc: string
  useCase: string
  prompt: string
}

export const CAMERA_FOCALS: CameraScaleOption[] = [
  {
    value: 14,
    tier: '超广角',
    desc: '透视极度夸张，边缘明显拉伸',
    useCase: '场景交代、建筑、张力',
    prompt: '14mm ultra-wide-angle, exaggerated perspective, sweeping environmental context, strong wide-angle stretch toward the edges',
  },
  {
    value: 24,
    tier: '广角',
    desc: '环境交代充分，轻微透视拉伸',
    useCase: '环境人像、街拍',
    prompt: '24mm wide-angle, expansive framing with the subject set inside its environment, mild perspective stretch',
  },
  {
    value: 35,
    tier: '人文',
    desc: '主体与环境平衡，纪实感',
    useCase: '纪实、对话戏',
    prompt: '35mm semi-wide, natural reportage framing, subject and surroundings held in balance',
  },
  {
    value: 50,
    tier: '标准',
    desc: '接近人眼视角，比例不变形',
    useCase: '日常、通用',
    prompt: '50mm standard lens, perspective close to human vision, neutral undistorted proportions',
  },
  {
    value: 85,
    tier: '人像',
    desc: '五官比例讨喜，背景压缩分离',
    useCase: '人像特写',
    prompt: '85mm short telephoto, flattering facial proportions, compressed background with pleasing separation',
  },
  {
    value: 135,
    tier: '长焦',
    desc: '背景压缩强，主体被剥离出来',
    useCase: '特写、远距跟拍',
    prompt: '135mm telephoto, strong background compression, isolated subject, intimate observation from a distance',
  },
  {
    value: 200,
    tier: '超长焦',
    desc: '空间层次被压平，偷窥视角',
    useCase: '体育、野生动物',
    prompt: '200mm super-telephoto, extreme compression flattening the depth layers, subject tightly isolated against a wash of background',
  },
]

export const CAMERA_APERTURES: CameraScaleOption[] = [
  {
    value: 1.2,
    tier: '大光圈',
    desc: '景深薄如纸，只有眼睛是实的',
    useCase: '梦幻人像、极暗光',
    prompt: 'shot wide open at f/1.2, paper-thin depth of field, only the eyes critically sharp, background dissolved into light',
  },
  {
    value: 1.4,
    tier: '大光圈',
    desc: '强烈虚化，高光成圆形光斑',
    useCase: '夜景人像、弱光',
    prompt: 'at f/1.4, very shallow depth of field, dreamy heavily blurred background, glowing highlight bokeh',
  },
  {
    value: 1.8,
    tier: '大光圈',
    desc: '明显背景虚化，主体分离清楚',
    useCase: '半身人像、街头弱光',
    prompt: 'at f/1.8, shallow depth of field with clear subject separation, softly blurred background',
  },
  {
    value: 2,
    tier: '大光圈',
    desc: '柔和虚化，主体锐度够',
    useCase: '人像、文艺日常',
    prompt: 'at f/2, soft background blur retained with enough sharpness across the subject',
  },
  {
    value: 2.8,
    tier: '中大光圈',
    desc: '景深适中，背景可辨但已散',
    useCase: '群像、叙事',
    prompt: 'at f/2.8, moderate depth of field, background still readable but clearly defocused',
  },
  {
    value: 4,
    tier: '中光圈',
    desc: '主体全实，背景轻微虚化',
    useCase: '群像、婚礼、剧集',
    prompt: 'at f/4, subject rendered fully sharp with gentle background separation',
  },
  {
    value: 5.6,
    tier: '中光圈',
    desc: '景深均衡，环境信息保留',
    useCase: '纪实、日常',
    prompt: 'at f/5.6, balanced depth of field, the environment stays legible behind the subject',
  },
  {
    value: 8,
    tier: '小光圈',
    desc: '画质最佳区，前后都清晰',
    useCase: '风光、建筑、产品',
    prompt: 'at f/8, optimal optical sharpness, both foreground and background in focus',
  },
  {
    value: 11,
    tier: '小光圈',
    desc: '超大景深，几乎全画面清晰',
    useCase: '大场景、摆拍',
    prompt: 'at f/11, deep focus, nearly everything from near to far rendered sharp',
  },
  {
    value: 16,
    tier: '小光圈',
    desc: '景深最大，点光源出星芒',
    useCase: '日光风光、星芒特效',
    prompt: 'at f/16, maximum depth of field, point light sources rendered as crisp starbursts',
  },
]

/** 提示词片段前缀与收尾的 guardrail */
const CAMERA_PROMPT_LEAD = 'Camera and lens setup:'
const CAMERA_PROMPT_GUARD = 'do not show the camera, lens, tripod or any filming equipment in the frame'

export const DEFAULT_CAMERA_SETUP: CameraSetup = {
  on: true,
  body: 'alexa-35',
  lens: 'cooke-s7',
  focal: 50,
  aperture: 2.8,
}

export function findBody(id: string) {
  return CAMERA_BODIES.find(item => item.id === id) ?? null
}

export function findLens(id: string) {
  return CAMERA_LENSES.find(item => item.id === id) ?? null
}

export function findFocal(value: number) {
  return CAMERA_FOCALS.find(item => item.value === value) ?? null
}

export function findAperture(value: number) {
  return CAMERA_APERTURES.find(item => item.value === value) ?? null
}

/** 补齐缺失字段，老画布里存的半截配置也能用 */
export function normalizeCameraSetup(raw?: Partial<CameraSetup> | null): CameraSetup {
  return {
    on: raw?.on ?? false,
    body: findBody(String(raw?.body || '')) ? String(raw!.body) : DEFAULT_CAMERA_SETUP.body,
    lens: findLens(String(raw?.lens || '')) ? String(raw!.lens) : DEFAULT_CAMERA_SETUP.lens,
    focal: findFocal(Number(raw?.focal)) ? Number(raw!.focal) : DEFAULT_CAMERA_SETUP.focal,
    aperture: findAperture(Number(raw?.aperture)) ? Number(raw!.aperture) : DEFAULT_CAMERA_SETUP.aperture,
  }
}

/**
 * 拼出要追加到用户提示词后面的英文片段；未开启返回空串。
 * 顺序固定：机身 → 镜头 → 焦段 → 光圈 → guardrail。
 */
export function buildCameraPrompt(raw?: Partial<CameraSetup> | null) {
  if (!raw?.on)
    return ''
  const setup = normalizeCameraSetup(raw)
  const parts = [
    findBody(setup.body)?.prompt,
    findLens(setup.lens)?.prompt,
    findFocal(setup.focal)?.prompt,
    findAperture(setup.aperture)?.prompt,
  ].filter(Boolean) as string[]
  if (!parts.length)
    return ''
  return `${CAMERA_PROMPT_LEAD} ${parts.join(', ')}, ${CAMERA_PROMPT_GUARD}.`
}

/** chip 上的短摘要，如「ALEXA 35 · 50mm · f/2.8」 */
export function cameraSummary(raw?: Partial<CameraSetup> | null) {
  if (!raw?.on)
    return ''
  const setup = normalizeCameraSetup(raw)
  const body = findBody(setup.body)
  return [body?.name, `${setup.focal}mm`, `f/${setup.aperture}`].filter(Boolean).join(' · ')
}
