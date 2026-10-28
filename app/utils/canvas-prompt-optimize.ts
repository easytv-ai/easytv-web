/**
 * 提示词优化（L15）：把用户随手写的一句话改写成结构化提示词，展示对照后由用户决定填回还是追加。
 * 指令模板与结果清洗都是纯函数；模型走文本任务，选型与反推提示词同一套（growth.vision_text_model）。
 */

export type OptimizeKind = 'image' | 'video'

/** 最短得有这么多字才值得改写，不然模型只能瞎编 */
export const OPTIMIZE_MIN_CHARS = 2
export const OPTIMIZE_MAX_CHARS = 2000

const OUTPUT_LANG: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  fr: 'French',
  ru: 'Russian',
  vi: 'Vietnamese',
}

const IMAGE_SECTIONS = ['主体与外观细节', '动作与姿态', '场景与环境', '构图、景别与机位', '光线', '色调与画面风格']
const VIDEO_SECTIONS = ['主体与外观细节', '动作与情绪', '场景与环境', '镜头运动与机位', '景别变化', '光线与色调', '节奏与时长感']

/** 改写指令：保留用户原意，按固定顺序补全维度；中文界面出中文，其他语言按界面语言 */
export function promptOptimizeInstruction(kind: OptimizeKind, prompt: string, locale?: string) {
  const sections = kind === 'video' ? VIDEO_SECTIONS : IMAGE_SECTIONS
  const target = kind === 'video' ? 'AI 视频生成' : 'AI 图片生成'
  const lines = [
    `下面是用户写的一段${target}提示词，请把它改写成更完整、更可控的结构化提示词。`,
    '要求：',
    '1. 保留用户已经写明的主体、动作、场景和风格，不要改成别的东西；用户没写的维度按常见做法补全，但不要凭空加入新的人物或物件。',
    `2. 按这个顺序组织内容：${sections.join('、')}。用一段或几段自然语言写，不要写成标题加冒号的表格。`,
    '3. 具体、可视化：写得出画面的词优先，避免「好看」「高级」这类空词。',
    '4. 只输出改写后的提示词本身，不要标题、解释、编号、引号或代码块。',
    '',
    '用户的提示词：',
    prompt.trim(),
  ]
  const code = (locale || '').toLowerCase()
  if (code === 'zh-tw')
    lines.push('', '用繁体中文输出。')
  else if (OUTPUT_LANG[code.split('-')[0] || ''])
    lines.push('', `Write the rewritten prompt in ${OUTPUT_LANG[code.split('-')[0]!]}.`)
  return lines.join('\n')
}

/** 模型偶尔还是会包一层代码块、引号或「优化后：」这种前缀，都剥掉 */
export function cleanOptimizedPrompt(raw: string) {
  let text = String(raw || '').trim()
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim()
  text = text.replace(/^(优化后的提示词|优化后|改写后的提示词|改写后|提示词|Prompt)\s*[:：]\s*/i, '')
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('「') && text.endsWith('」')) || (text.startsWith('“') && text.endsWith('”')))
    text = text.slice(1, -1).trim()
  return text
}

/** 能不能优化：太短没内容，太长模型接不住 */
export function canOptimizePrompt(prompt: string) {
  const n = String(prompt || '').trim().length
  return n >= OPTIMIZE_MIN_CHARS && n <= OPTIMIZE_MAX_CHARS
}

export type OptimizeApplyMode = 'replace' | 'append'

/** 填回：替换整段，或接在原文后面 */
export function applyOptimizedPrompt(mode: OptimizeApplyMode, current: string, optimized: string) {
  const next = cleanOptimizedPrompt(optimized)
  if (!next)
    return String(current || '')
  if (mode === 'append') {
    const base = String(current || '').trimEnd()
    return base ? `${base}\n\n${next}` : next
  }
  return next
}
