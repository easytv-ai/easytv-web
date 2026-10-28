/**
 * 口令红包预览回显纯函数。
 *
 * 三处场景共用：设置页内联表单、BonusCodeClaimModal 弹窗、LoginRegister 注册表单。
 * 把「红包积分 / 首充加赠 / 会员天数」拼成一句话，带渠道名前缀。
 *
 * 文案 key 走 `console.bonusCode.*` 命名空间（设置页和弹窗的主命名空间），
 * 注册页也复用这套 key，避免再维护一份同义不同名的文案。
 */
import type { BonusCodePreview } from '~/api/bonus-code'

/** 把预览结构拼成回显文案；preview 为空时返回空串 */
export function formatBonusPreviewText(preview: BonusCodePreview | null, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (!preview)
    return ''
  const parts: string[] = []
  if (preview.bonus_points > 0)
    parts.push(t('console.bonusCode.previewPoints', { points: preview.bonus_points }))
  if (preview.first_recharge_rate > 0)
    parts.push(t('console.bonusCode.previewRate', { percent: Math.round(preview.first_recharge_rate * 100) }))
  if (preview.member_days > 0)
    parts.push(t('console.bonusCode.previewMember', { days: preview.member_days }))
  const detail = parts.join(t('console.bonusCode.previewJoin'))
  return preview.partner_name
    ? t('console.bonusCode.previewValidFrom', { name: preview.partner_name, detail })
    : t('console.bonusCode.previewValidDetail', { detail })
}
