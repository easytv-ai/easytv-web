/**
 * 我的风格（L18，API.md 34.5）：「从当前图定风格」让看图文本模型只输出一段风格描述，
 * 回填到保存表单当提示词片段。指令模板、结果清洗与默认名都是纯函数；
 * 模型选型与反推提示词 / 提示词优化同一套（growth.vision_text_model）。
 */

import { cleanOptimizedPrompt } from '~/utils/canvas-prompt-optimize'

const OUTPUT_LANG: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  fr: 'French',
  ru: 'Russian',
  vi: 'Vietnamese',
}

/** 风格提取指令：只写画风，不写主体；中文界面出中文，其他语言按界面语言 */
export function styleExtractInstruction(locale?: string) {
  const lines = [
    '请只看这张图的整体风格，用一段话概括它的画风，这段话会作为风格片段追加到 AI 图片 / 视频生成的提示词末尾。',
    '要求：',
    '1. 只写风格本身：媒介与技法、色调与配色、光线、构图倾向、质感与笔触、时代感或流派气质。',
    '2. 不要描述画面里的主体、人物、物件、动作或场景内容，也不要出现「这张图」「画面中」这类指代。',
    '3. 80–200 字，一段自然语言，能直接接在别的提示词后面用。',
    '4. 输出格式：第一行写「名称：<2–6 个字的风格名>」，空一行，再写风格描述；除此之外不要标题、解释、编号、引号或代码块。',
  ]
  const code = (locale || '').toLowerCase()
  const lang = OUTPUT_LANG[code.split('-')[0] || '']
  if (code === 'zh-tw')
    lines.push('', '用繁体中文输出。')
  else if (lang)
    lines.push('', `Write in ${lang}: first line "Name: <2–4 word style name>", then a blank line, then the style description in 40–120 words.`)
  return lines.join('\n')
}

const NAME_LINE = /^(名称|名字|Name)\s*[:：]\s*(.+)$/i
const STYLE_NAME_MAX = 20

function stripQuotes(text: string) {
  let out = text.trim()
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith('「') && out.endsWith('」')) || (out.startsWith('“') && out.endsWith('”')) || (out.startsWith('『') && out.endsWith('』')))
    out = out.slice(1, -1).trim()
  return out
}

/**
 * 拆「名称：xx」首行与风格描述：有名称行就用它（去引号、最多 20 字），
 * 余下部分走 cleanStyleExtract；没有名称行就整段清洗后用 suggestStyleName 起名
 */
export function parseStyleExtract(raw: string): { name: string, prompt: string } {
  const body = cleanOptimizedPrompt(raw)
  const lines = body.split(/\r?\n/)
  let name = ''
  let rest = body
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line)
      continue
    const m = line.match(NAME_LINE)
    if (m) {
      name = Array.from(stripQuotes(m[2]!)).slice(0, STYLE_NAME_MAX).join('').trim()
      rest = lines.slice(i + 1).join('\n')
    }
    break
  }
  const prompt = cleanStyleExtract(rest)
  return { name: name || suggestStyleName(prompt), prompt }
}

/** 模型偶尔会包代码块、引号或「风格：」前缀，都剥掉 */
export function cleanStyleExtract(raw: string) {
  let text = cleanOptimizedPrompt(raw)
  text = text.replace(/^(风格描述|画风描述|整体风格|风格|画风|Style description|Style)\s*[:：]\s*/i, '').trim()
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('「') && text.endsWith('」')) || (text.startsWith('“') && text.endsWith('”')))
    text = text.slice(1, -1).trim()
  return text
}

export const STYLE_DEFAULT_NAME = '我的风格'

const SPLIT = /[，,。．.；;：:、！!？?\n\r\t（）()[\]{}「」『』“”"'‘’《》<>—…\-|/\\]+/
const CJK = /[㐀-鿿぀-ヿ가-힯]/

/**
 * 从提示词片段里取一个短名字当默认风格名：中文取开头 2–6 个字（到第一个标点为止），
 * 拉丁文取前 2–3 个词；实在取不出就用「我的风格」
 */
export function suggestStyleName(prompt: string) {
  const segments = String(prompt || '').split(SPLIT).map(item => item.trim()).filter(Boolean)
  for (const segment of segments) {
    if (CJK.test(segment)) {
      const chars = Array.from(segment.replace(/\s+/g, ''))
      if (chars.length >= 2)
        return chars.slice(0, 6).join('')
      continue
    }
    const words = segment.split(/\s+/).filter(Boolean)
    if (words.length >= 2 || (words[0] && words[0].length >= 4)) {
      let out = ''
      for (const word of words.slice(0, 3)) {
        const next = out ? `${out} ${word}` : word
        if (next.length > 24)
          break
        out = next
      }
      if (out.length >= 2)
        return out
    }
  }
  return STYLE_DEFAULT_NAME
}

/** 我的风格角标：1 私有可用不标，3 审核中，4 已收录（2 下架用户侧不会出现） */
export function styleStatusLabel(status: number | undefined, t: (key: string) => string) {
  if (status === 3)
    return t('审核中')
  if (status === 4)
    return t('已收录')
  return ''
}
