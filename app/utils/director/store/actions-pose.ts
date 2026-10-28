/**
 * 姿势相关动作（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 姿势有两层：选一个预置姿势会整套替换骨骼控制量；再单独微调某根骨头时
 * 只改那一项，预置 id 保留不动 —— 面板上仍然显示"从哪个姿势改过来的"。
 */
import type { PosePresetId } from '../schema'
import type { DirectorState } from './state'
import { updateObjectById } from './objects'

/** 姿势预设表由 presets 层提供，这里只接一个查找函数，避免把几百行预设数据拖进来 */
export type PosePresetLookup = (presetId: PosePresetId) => Record<string, number> | null

function applyRig(
  state: DirectorState,
  matches: (objectId: string, crowdId?: string) => boolean,
  updateRig: (controls: Record<string, number>) => Partial<{ posePresetId: string | null, controls: Record<string, number> }>,
): DirectorState {
  return {
    ...state,
    project: {
      ...state.project,
      objects: state.project.objects.map((item) => {
        if (!item.characterRig || !matches(item.id, item.crowdId))
          return item
        return { ...item, characterRig: { ...item.characterRig, ...updateRig(item.characterRig.controls) } }
      }),
    },
  }
}

export function applyPosePreset(
  state: DirectorState,
  id: string,
  presetId: PosePresetId,
  lookup: PosePresetLookup,
): DirectorState {
  const controls = lookup(presetId)
  return {
    ...state,
    project: {
      ...state.project,
      objects: updateObjectById(state.project.objects, id, item => (
        item.characterRig
          ? {
              ...item,
              characterRig: {
                ...item.characterRig,
                posePresetId: presetId,
                // 查不到预设时保留原有控制量，别把角色摆成一堆零
                controls: controls ? { ...controls } : item.characterRig.controls,
              },
            }
          : item
      )),
    },
  }
}

export function applyCrowdPosePreset(
  state: DirectorState,
  crowdId: string,
  presetId: PosePresetId,
  lookup: PosePresetLookup,
): DirectorState {
  const controls = lookup(presetId)
  return applyRig(
    state,
    (_, itemCrowdId) => itemCrowdId === crowdId,
    current => ({ posePresetId: presetId, controls: controls ? { ...controls } : current }),
  )
}

/** 微调单根骨头：只覆盖这一项，预置 id 留着 */
export function updatePoseControl(state: DirectorState, id: string, key: string, value: number): DirectorState {
  return applyRig(state, objectId => objectId === id, current => ({ controls: { ...current, [key]: value } }))
}

export function updateCrowdPoseControl(
  state: DirectorState,
  crowdId: string,
  key: string,
  value: number,
): DirectorState {
  return applyRig(
    state,
    (_, itemCrowdId) => itemCrowdId === crowdId,
    current => ({ controls: { ...current, [key]: value } }),
  )
}
