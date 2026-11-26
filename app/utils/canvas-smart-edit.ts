/** 智能编辑交给模型的说明。框的坐标跟 Seedream / LibTV 交互编辑一致：0–999，左上为 0,0。 */

export type SmartEditBox = { x: number, y: number, w: number, h: number }

function norm(value: number, span: number) {
  const n = Math.round(value / Math.max(span, 1) * 1000)
  return Math.max(0, Math.min(999, n))
}

/** `<bbox>x1 y1 x2 y2</bbox>`，x2/y2 至少比起点大 1，避免零面积框。 */
export function smartEditBBox(box: SmartEditBox, width: number, height: number) {
  const x1 = norm(box.x, width)
  const y1 = norm(box.y, height)
  let x2 = norm(box.x + box.w, width)
  let y2 = norm(box.y + box.h, height)
  if (x2 <= x1)
    x2 = Math.min(999, x1 + 1)
  if (y2 <= y1)
    y2 = Math.min(999, y1 + 1)
  return `<bbox>${x1} ${y1} ${x2} ${y2}</bbox>`
}

/**
 * edits（gpt-image）单处修改：选区走蒙版，说明只留用户写的那句。
 * 其余情况（Seedream / Qwen 等 url，或多处不同说明）：每处写成
 * `把图1<bbox>…</bbox>区域` + 用户原文。不写百分比。
 */
export function buildSmartEditPrompt(
  notes: { box: SmartEditBox, text: string }[],
  size: { w: number, h: number },
  imageInput: string,
) {
  const items = notes
    .map(item => ({ box: item.box, text: item.text.trim() }))
    .filter(item => item.text)
  if (!items.length)
    return ''
  if (imageInput === 'edits' && items.length === 1)
    return items[0]!.text
  return items
    .map(item => `把图1${smartEditBBox(item.box, size.w, size.h)}区域${item.text}`)
    .join('。')
}
