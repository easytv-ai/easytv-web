import type { GenerationModel } from '~/types/creative'

/** 从模型 id 抽出可读短名：provider/gpt-image-2.5 → Gpt Image 2.5 */
export function prettyModelSlug(id: string) {
  const slug = id.split(/[/:]/).pop() || id
  return slug.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, c => c.toUpperCase())
}

/**
 * 下拉里用的短名。运营配的 label 经常是一段英文能力介绍，
 * 超过 36 字就改用模型 id，避免选择框里全是 Flexible sizing…
 */
export function shortModelName(item: Pick<GenerationModel, 'model' | 'label'>) {
  const label = String(item.label || '').trim()
  if (label && label.length <= 36)
    return label
  return prettyModelSlug(item.model) || label.slice(0, 36)
}
