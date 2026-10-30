/**
 * 宫格与故事板预设（L6）。
 * 每条预设 = 一段结构化提示词 + 推荐画幅比，不新增模型、不新增计费——
 * 选中后把提示词写进节点、比例写进 data.params，走的还是普通图片生成。
 *
 * 同一份定义也是对话式工作流生成（API.md 32）的底座：list_templates 会把这些当可抄的结构给模型。
 */

export type GridPreset = {
  id: string
  label: string
  /** 一句话说明，面板上显示在标题下面 */
  hint: string
  /** 结构化提示词正文 */
  prompt: string
  /** 推荐画幅比，写进 data.params.ratio */
  ratio: string
  /**
   * 是否必须有参考图：推演 / 矫正 / 设定图这类是在已有画面上做文章，
   * 没有上游图片时给出来只会让用户白跑一次生成。
   */
  needsRef: boolean
}

export const GRID_PRESETS: GridPreset[] = [
  {
    id: 'multi-cam-9',
    label: '多机位九宫格',
    hint: '同一场戏九个机位，一张图出齐',
    ratio: '1:1',
    needsRef: true,
    prompt: `把这张图的场景拍成九个机位，输出一张 3×3 九宫格图。
九格依次为：大远景、远景、全景、中景、中近景、近景、特写、大特写、过肩镜头。
要求：同一主体、同一服装、同一光线与色调，九格之间只有机位和景别变化；格与格之间留细白缝，不要写文字标注。`,
  },
  {
    id: 'story-4',
    label: '剧情推演四宫格',
    hint: '顺着这一幕往下推四步',
    ratio: '1:1',
    needsRef: true,
    prompt: `以这张图为第一格，推演接下来会发生什么，输出一张 2×2 四宫格图。
四格按时间先后排列：起因、发展、转折、结果。
要求：人物外形、服装与场景保持一致，只有动作、表情和机位随剧情推进变化；不要写文字标注。`,
  },
  {
    id: 'storyboard-25',
    label: '25 宫格连贯分镜',
    hint: '一整段戏拆成 25 格连续分镜',
    ratio: '1:1',
    needsRef: true,
    prompt: `以这张图为开场，把这段戏拆成 25 个连续镜头，输出一张 5×5 宫格图，按从左到右、从上到下的顺序阅读。
要求：镜头之间动作连贯，景别有远近变化，人物与场景始终一致；格与格之间留细白缝，不要写文字标注。`,
  },
  {
    id: 'cine-light',
    label: '电影级光影矫正',
    hint: '保持画面内容，只重打光',
    ratio: '16:9',
    needsRef: true,
    prompt: `保持这张图的构图、人物、服装和场景完全不变，只重新打光。
按电影摄影的布光重做：明确的主光方向、柔和的补光、能勾出轮廓的逆光，暗部保留细节不死黑，高光不过曝，整体色调统一。
不要改变人物五官、姿势和画面里的任何物件。`,
  },
  {
    id: 'before-5s',
    label: '画面推演·前 5 秒',
    hint: '这一刻之前发生了什么',
    ratio: '16:9',
    needsRef: true,
    prompt: `画出这张图发生之前 5 秒的那一刻。
同一场景、同一人物、同一光线，人物的位置、动作和表情要处在通往当前画面的前一步。
构图与镜头风格保持一致，只改变时间点。`,
  },
  {
    id: 'after-3s',
    label: '画面推演·后 3 秒',
    hint: '这一刻之后会怎样',
    ratio: '16:9',
    needsRef: true,
    prompt: `画出这张图发生之后 3 秒的那一刻。
同一场景、同一人物、同一光线，人物的动作和表情顺着当前画面自然往下走一步。
构图与镜头风格保持一致，只改变时间点。`,
  },
  {
    id: 'character-sheet',
    label: '角色设定图',
    hint: '一张图定死角色的外形与细节',
    ratio: '16:9',
    needsRef: true,
    prompt: `以这个角色为准做一张角色设定图，白底或浅灰底。
包含：正面全身、侧面全身、背面全身三视图，外加头部特写和两个表情小样。
要求：五官、发型、服装、配饰、配色在所有视图里完全一致，比例统一，人物之间留出间距；不要写文字标注。`,
  },
  {
    id: 'storyboard',
    label: '故事板',
    hint: '按镜头顺序排的手绘感故事板',
    ratio: '16:9',
    needsRef: false,
    prompt: `按这段内容画一张故事板，2 行 3 列共 6 格，从左到右、从上到下阅读。
画风统一为干净的黑白线稿加淡灰阴影，每格画出该镜头的构图、人物位置与主要动作，用箭头标出镜头或人物的运动方向。
格与格之间留白边，不要写文字。`,
  },
  {
    id: 'blocking-board',
    label: '调度故事板',
    hint: '俯视平面图，标机位与走位',
    ratio: '16:9',
    needsRef: false,
    prompt: `把这场戏画成一张俯视的调度平面图。
标出场景边界与主要陈设、人物起始位置与走位路线（用带箭头的虚线）、摄影机机位与朝向（用三角形），以及主光位置。
风格为干净的示意图，线条清晰，不要写文字标注。`,
  },
]

export function gridPresetById(id?: string) {
  return GRID_PRESETS.find(item => item.id === id) || null
}

/**
 * 当前能用的预设：没有参考图时，需要参考图的那几条不列出来——
 * 「在这张图上推演」没有图可推，出来的东西跟预设说的不是一回事。
 */
export function gridPresetsFor(hasRef: boolean) {
  return hasRef ? GRID_PRESETS : GRID_PRESETS.filter(item => !item.needsRef)
}

/**
 * 预设提示词与用户已写内容的合并：用户写过的留在前面当内容，预设正文接在后面当拍法。
 * 重复选同一条不会叠加第二遍。
 */
export function buildGridPrompt(preset: GridPreset, current = '') {
  const base = String(current || '').trim()
  if (!base)
    return preset.prompt
  if (base.includes(preset.prompt))
    return base
  return `${base}\n\n${preset.prompt}`
}

/** 选中预设后写回节点的补丁：提示词 + 比例（比例进 data.params，Inspector 优先读它） */
export function gridPresetPatch(preset: GridPreset, current = '', params?: Record<string, unknown> | null) {
  return {
    prompt: buildGridPrompt(preset, current),
    params: { ...(params || {}), ratio: preset.ratio },
  }
}
