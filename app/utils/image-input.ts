import type { GenerationModel } from '~/types/creative'

/** 图片模型能不能带参考图 / 原图（后端 model_price.image_input，API.md 11.4） */
export function supportsImageRefs(model?: Pick<GenerationModel, 'image_input'> | null) {
  return model?.image_input === 'edits' || model?.image_input === 'url'
}

/**
 * 给图片编辑挑模型：优先用当前默认模型；它不支持就按清单顺序找第一个支持的已定价模型。
 * 带蒙版的局部修改只有 edits 方式（OpenAI 图像模型）支持。找不到返回空串。
 */
export function isImageEditModel(model: GenerationModel, needMask: boolean) {
  return model.type === 'image' && model.priced
    && (needMask ? model.image_input === 'edits' : supportsImageRefs(model))
}

export function listImageEditModels(list: GenerationModel[], needMask: boolean) {
  return list.filter(item => isImageEditModel(item, needMask))
}

export function pickImageEditModel(list: GenerationModel[], preferred: string, needMask: boolean) {
  const current = list.find(m => m.model === preferred)
  if (current && isImageEditModel(current, needMask))
    return current.model
  return listImageEditModels(list, needMask)[0]?.model ?? ''
}

/** 画布默认图模：已定价的图片模型优先，没有再取清单里第一条图片模型 */
export function preferredImageModel(list: GenerationModel[]) {
  return list.find(item => item.type === 'image' && item.priced)?.model
    || list.find(item => item.type === 'image')?.model
    || ''
}

/** 打光 / 多角度 / 工具条报价：和提交同一条图片编辑模型 */
export function pickCanvasImageEditModel(list: GenerationModel[]) {
  return pickImageEditModel(list, preferredImageModel(list), false)
}

/** gpt-image 系 edits 最大边 1536，出不了 2K / 4K。 */
export function isGptImageModel(model: string) {
  const name = model.split('/').pop()?.toLowerCase() ?? ''
  return name.startsWith('gpt-image') || name.startsWith('chatgpt-image')
}

/** 当前网关令牌调不通 qwen-image-edit，图片高清不要选它。 */
function isBlockedUpscaleModel(model: string) {
  const name = model.split('/').pop()?.toLowerCase() ?? ''
  return name.includes('qwen-image-edit')
}

function isSeedreamModel(model: string) {
  return (model.split('/').pop()?.toLowerCase() ?? '').includes('seedream')
}

/**
 * 图片高清要出 2K / 4K，并带上原图。
 * 不用 gpt-image（封顶 1536），也不用 qwen-image-edit（网关鉴权失败）。
 * 有 Seedream 就用它，否则用当前默认模型，再否则用清单里第一个能带原图的。
 */
export function pickImageUpscaleModel(list: GenerationModel[], preferred: string) {
  const capable = listImageEditModels(list, false).filter(item => !isGptImageModel(item.model) && !isBlockedUpscaleModel(item.model))
  const seedream = capable.find(item => isSeedreamModel(item.model))
  if (seedream)
    return seedream.model
  if (preferred && capable.some(item => item.model === preferred))
    return preferred
  return capable[0]?.model || pickImageEditModel(list, preferred, false)
}

/** 能看图的文本模型（按名称识别：OpenAI 4o/4.1/5 系、Gemini、Claude、通义 VL、GLM-4V、豆包 vision 等） */
const VISION_TEXT_MODEL = /gpt-4o|gpt-4\.1|gpt-5|^o[34]|gemini|claude|qwen.*vl|qvq|glm-4.*v|vision|llava|pixtral/i

export function isVisionTextModel(model: Pick<GenerationModel, 'type' | 'model'>) {
  return model.type === 'text' && VISION_TEXT_MODEL.test(model.model) && !/tts|audio|transcribe|realtime|embedding/i.test(model.model)
}

/** 看图效果的偏好顺序：靠前的先用。运营在后台开通了更强的模型，前端不用改代码就会切过去 */
const VISION_PREFERENCE = [/gemini/i, /claude/i, /gpt-5|gpt-4\.1/i, /qwen.*vl|qvq|glm-4.*v/i]

function visionRank(model: string) {
  const index = VISION_PREFERENCE.findIndex(re => re.test(model))
  return index < 0 ? VISION_PREFERENCE.length : index
}

/**
 * 反推提示词 / 智能识别用的看图模型：运营在后台配了（GET /app/config growth.vision_text_model）且在清单里就用它；
 * 否则已定价的优先，同档按偏好顺序；找不到返回空串。
 */
export function pickVisionTextModel(list: GenerationModel[], preferred?: string | null) {
  const want = String(preferred || '').trim()
  if (want && list.some(m => m.type === 'text' && m.model === want))
    return want
  const vision = list.filter(isVisionTextModel)
  const priced = vision.filter(m => m.priced)
  const pool = priced.length ? priced : vision
  return [...pool].sort((a, b) => visionRank(a.model) - visionRank(b.model))[0]?.model ?? ''
}
