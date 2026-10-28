/**
 * 角色体型与标签高度（复刻自 open-director 的 runtime/，MIT）。
 *
 * 上游的 bodyTypes.ts 有 287 行，绝大部分是程序化人体的完整比例表
 * （骨盆半径、上臂长度、鼻子缩放……四十多个字段乘八种体型）。那张表只在
 * 渲染 ProceduralMannequin 时用得上，属于阶段 2 的活，现在搬过来既用不上
 * 也没法验证，所以这里只取两样现在真正需要的：体型清单、以及每种体型的
 * 标签高度 —— 后者是对焦点计算的输入（见 object-focus.ts）。
 *
 * 两套骨架的高度不一样：程序化素体比 UE4 那具模型高出一截，
 * 因为两者的单位尺度本来就不同，不能混用。
 */
import type { CharacterBodyType } from './schema'
import type { LabelYLookup } from './object-focus'

export interface BodyTypeOption {
  bodyType: CharacterBodyType
  label: string
  /** 程序化素体的头顶标签高度 */
  proceduralLabelY: number
  /** UE4 骨架模型的头顶标签高度 */
  ue4LabelY: number
}

export const BODY_TYPE_OPTIONS: BodyTypeOption[] = [
  { bodyType: 'mannequin', label: '男性素体', proceduralLabelY: 2.62, ue4LabelY: 2.04 },
  { bodyType: 'female', label: '女性素体', proceduralLabelY: 2.52, ue4LabelY: 1.98 },
  { bodyType: 'broad', label: '宽厚素体', proceduralLabelY: 2.76, ue4LabelY: 2.08 },
  { bodyType: 'muscular', label: '健壮素体', proceduralLabelY: 2.7, ue4LabelY: 2.08 },
  { bodyType: 'slim', label: '纤细素体', proceduralLabelY: 2.58, ue4LabelY: 1.98 },
  { bodyType: 'teen', label: '少年素体', proceduralLabelY: 2.28, ue4LabelY: 1.78 },
  { bodyType: 'child', label: '儿童素体', proceduralLabelY: 1.82, ue4LabelY: 1.46 },
  { bodyType: 'chibi', label: '二头身', proceduralLabelY: 1.38, ue4LabelY: 1.18 },
]

export function isCharacterBodyType(value: unknown): value is CharacterBodyType {
  return BODY_TYPE_OPTIONS.some(item => item.bodyType === value)
}

/** 体型不认识时退回第一个（男性素体），和上游一致 */
export function getBodyTypeOption(bodyType?: string | null) {
  return BODY_TYPE_OPTIONS.find(item => item.bodyType === bodyType) ?? BODY_TYPE_OPTIONS[0]!
}

export function getBodyTypeLabel(bodyType?: string | null) {
  return getBodyTypeOption(bodyType).label
}

/**
 * 接 object-focus 的注入口：按骨架类型取对应的标签高度。
 * 默认角色用的是 ue4-mannequin，只有显式选了程序化素体才走另一套数值。
 */
export const labelYOf: LabelYLookup = (bodyType, rigType) => {
  const option = getBodyTypeOption(bodyType)
  return rigType === 'ue4-mannequin' ? option.ue4LabelY : option.proceduralLabelY
}
