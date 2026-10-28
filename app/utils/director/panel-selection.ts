/**
 * 右侧面板显示哪一个、面板拿哪一份数据（复刻自 open-director 的
 * directorSelectors.ts / CharacterPanel.tsx / PropPanel.tsx，MIT）。
 *
 * 「当前选中的是角色还是道具」这件事判定条件不少（群众组、模型素材、
 * 机位视角），三个面板各判一遍迟早对不齐 —— 出现的现象是面板标题写着
 * 「角色」，里面的字段却是道具的。所以统一在这里判。
 */
import type { DirectorObject, DirectorTransform, RightPanelKind } from './schema'
import { getCrowdAnchorTransform } from './store/objects'
import type { DirectorState } from './store/state'

/** 角色和道具没设颜色时的默认值，和上游一致 */
export const DEFAULT_CHARACTER_COLOR = '#4f8ef7'
export const DEFAULT_PROP_COLOR = '#d7e7ff'

function findSelected(state: DirectorState) {
  return state.project.objects.find(item => item.id === state.selectedObjectId)
}

/** 对象是不是导入的模型驱动的 —— 模型道具和几何体走同一个面板 */
function isModelBacked(state: DirectorState, object: DirectorObject | undefined) {
  if (!object?.assetRefId)
    return false
  const asset = state.project.assets.find(item => item.id === object.assetRefId)
  return asset?.sourceType === 'model'
}

function hasCrowdMembers(state: DirectorState) {
  return state.project.objects.some(
    item => item.kind === 'character' && item.crowdId === state.selectedCrowdId,
  )
}

export function selectRightPanelKind(state: DirectorState): RightPanelKind {
  // 用户主动点了空白处看场景设置，这个意图优先于选中了什么
  if (state.viewMode === 'director' && state.directorInspectorMode === 'scene')
    return 'scene'

  // 群众组要确认还有成员：组被删空而选中标记还在时返回 character，
  // 角色面板会因为取不到数据渲染成空白，右侧就是一块什么都没有的地方
  if (state.selectedCrowdId && hasCrowdMembers(state))
    return 'character'

  const selected = findSelected(state)
  if (selected?.kind === 'character')
    return 'character'
  if (selected?.kind === 'prop' || isModelBacked(state, selected))
    return 'prop'
  if (selected?.kind === 'camera')
    return 'camera'

  // 机位视角下没选中任何东西时，看的就是这个机位
  if (state.viewMode === 'camera')
    return 'camera'

  return 'scene'
}

export interface CharacterSelection {
  /** crowd 时所有字段作用于整组，single 时作用于单个角色 */
  mode: 'crowd' | 'single'
  crowdId: string | null
  /** 姿势读写的落点：群众组读最后一个成员（新加的那个，姿势最新） */
  role: DirectorObject
  name: string
  color: string
  /** 群众组是锚点变换，单个角色就是它自己的变换 */
  transform: DirectorTransform
}

export function resolveCharacterSelection(state: DirectorState): CharacterSelection | null {
  if (state.selectedCrowdId) {
    const members = state.project.objects.filter(
      item => item.kind === 'character' && item.crowdId === state.selectedCrowdId,
    )
    const anchor = getCrowdAnchorTransform(state.project.objects, state.selectedCrowdId)

    if (members.length && anchor) {
      return {
        mode: 'crowd',
        crowdId: state.selectedCrowdId,
        role: members[members.length - 1]!,
        name: members[0]!.crowdLabel ?? '群众',
        color: members[0]!.color ?? DEFAULT_CHARACTER_COLOR,
        transform: anchor,
      }
    }
    // 组空了或锚点算不出来时往下走，别把面板卡在一个不存在的组上
  }

  const role = state.project.objects.find(
    item => item.id === state.selectedObjectId && item.kind === 'character',
  )
  if (!role)
    return null

  return {
    mode: 'single',
    crowdId: null,
    role,
    name: role.name,
    color: role.color ?? DEFAULT_CHARACTER_COLOR,
    transform: role.transform,
  }
}

/** 道具面板的数据：道具，或者由导入模型驱动的任意对象 */
export function resolvePropSelection(state: DirectorState): DirectorObject | null {
  const selected = findSelected(state)
  if (!selected)
    return null
  if (selected.kind === 'prop' || isModelBacked(state, selected))
    return selected
  return null
}
