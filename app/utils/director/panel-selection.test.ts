import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHARACTER_COLOR,
  resolveCharacterSelection,
  resolvePropSelection,
  selectRightPanelKind,
} from './panel-selection'
import { createInitialDirectorState, type DirectorState } from './store/state'
import type { DirectorAssetRef, DirectorObject } from './schema'

function makeObject(patch: Partial<DirectorObject> & Pick<DirectorObject, 'id' | 'name' | 'kind'>): DirectorObject {
  return {
    visible: true,
    locked: false,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...patch,
  }
}

function makeState(patch: {
  objects?: DirectorObject[]
  assets?: DirectorAssetRef[]
  selectedObjectId?: string | null
  selectedCrowdId?: string | null
  viewMode?: 'director' | 'camera'
  directorInspectorMode?: 'auto' | 'scene'
} = {}): DirectorState {
  const base = createInitialDirectorState()
  return {
    ...base,
    viewMode: patch.viewMode ?? base.viewMode,
    directorInspectorMode: patch.directorInspectorMode ?? base.directorInspectorMode,
    selectedObjectId: patch.selectedObjectId ?? null,
    selectedCrowdId: patch.selectedCrowdId ?? null,
    selectedObjectIds: [],
    project: {
      ...base.project,
      objects: patch.objects ?? [],
      assets: patch.assets ?? [],
    },
  }
}

describe('selectRightPanelKind', () => {
  it('什么都没选时是场景', () => {
    expect(selectRightPanelKind(makeState())).toBe('scene')
  })

  it('点了空白看场景设置，优先于选中了什么', () => {
    const state = makeState({
      objects: [makeObject({ id: 'a', name: '主角', kind: 'character' })],
      selectedObjectId: 'a',
      directorInspectorMode: 'scene',
    })
    expect(selectRightPanelKind(state)).toBe('scene')
  })

  it('选中群众组是角色面板', () => {
    const state = makeState({
      objects: [makeObject({ id: 'm1', name: '角色02', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' })],
      selectedCrowdId: 'crowd-a',
    })
    expect(selectRightPanelKind(state)).toBe('character')
  })

  it('选中角色是角色面板', () => {
    const state = makeState({
      objects: [makeObject({ id: 'a', name: '主角', kind: 'character' })],
      selectedObjectId: 'a',
    })
    expect(selectRightPanelKind(state)).toBe('character')
  })

  it('引用模型素材的对象走道具面板，哪怕 kind 是 scene', () => {
    const state = makeState({
      objects: [makeObject({ id: 's', name: '布景', kind: 'scene', assetRefId: 'asset-1' })],
      assets: [{ id: 'asset-1', kind: 'scene', sourceType: 'model', fileName: 'x.glb', url: 'blob:x' }],
      selectedObjectId: 's',
    })
    expect(selectRightPanelKind(state)).toBe('prop')
  })

  it('引用图片素材的不算模型', () => {
    const state = makeState({
      objects: [makeObject({ id: 's', name: '布景', kind: 'scene', assetRefId: 'asset-1' })],
      assets: [{ id: 'asset-1', kind: 'scene', sourceType: 'image', fileName: 'x.png', url: 'blob:x' }],
      selectedObjectId: 's',
    })
    expect(selectRightPanelKind(state)).toBe('scene')
  })

  it('机位视角下没选中东西时看的就是这个机位', () => {
    expect(selectRightPanelKind(makeState({ viewMode: 'camera' }))).toBe('camera')
  })

  it('机位视角下的 scene 模式不生效 —— 那个开关只属于导演视角', () => {
    const state = makeState({ viewMode: 'camera', directorInspectorMode: 'scene' })
    expect(selectRightPanelKind(state)).toBe('camera')
  })
})

describe('resolveCharacterSelection', () => {
  const crowd = [
    makeObject({ id: 'm1', name: '角色02', kind: 'character', crowdId: 'c', crowdLabel: '路人组', color: '#112233' }),
    makeObject({ id: 'm2', name: '角色03', kind: 'character', crowdId: 'c', crowdLabel: '路人组', color: '#112233' }),
  ]

  it('单选角色', () => {
    const state = makeState({
      objects: [makeObject({ id: 'a', name: '主角', kind: 'character' })],
      selectedObjectId: 'a',
    })
    const selection = resolveCharacterSelection(state)
    expect(selection?.mode).toBe('single')
    expect(selection?.name).toBe('主角')
    expect(selection?.color).toBe(DEFAULT_CHARACTER_COLOR)
  })

  it('群众组用组名和锚点变换，姿势落在最后一个成员上', () => {
    const state = makeState({ objects: crowd, selectedCrowdId: 'c' })
    const selection = resolveCharacterSelection(state)
    expect(selection?.mode).toBe('crowd')
    expect(selection?.name).toBe('路人组')
    expect(selection?.color).toBe('#112233')
    expect(selection?.role.id).toBe('m2')
  })

  it('群众组成员已被删光时退回单选，别把面板卡在不存在的组上', () => {
    const state = makeState({
      objects: [makeObject({ id: 'a', name: '主角', kind: 'character' })],
      selectedCrowdId: 'c',
      selectedObjectId: 'a',
    })
    expect(resolveCharacterSelection(state)?.mode).toBe('single')
  })

  it('选中的不是角色时给 null', () => {
    const state = makeState({
      objects: [makeObject({ id: 'p', name: '道具', kind: 'prop' })],
      selectedObjectId: 'p',
    })
    expect(resolveCharacterSelection(state)).toBeNull()
  })
})

describe('resolvePropSelection', () => {
  it('道具直接命中', () => {
    const state = makeState({
      objects: [makeObject({ id: 'p', name: '箱子', kind: 'prop' })],
      selectedObjectId: 'p',
    })
    expect(resolvePropSelection(state)?.id).toBe('p')
  })

  it('模型驱动的布景也走道具面板', () => {
    const state = makeState({
      objects: [makeObject({ id: 's', name: '布景', kind: 'scene', assetRefId: 'asset-1' })],
      assets: [{ id: 'asset-1', kind: 'scene', sourceType: 'model', fileName: 'x.glb', url: 'blob:x' }],
      selectedObjectId: 's',
    })
    expect(resolvePropSelection(state)?.id).toBe('s')
  })

  it('角色不是道具', () => {
    const state = makeState({
      objects: [makeObject({ id: 'a', name: '主角', kind: 'character' })],
      selectedObjectId: 'a',
    })
    expect(resolvePropSelection(state)).toBeNull()
  })
})

describe('selectRightPanelKind 与面板数据必须一致', () => {
  it('群众组被删空时不再返回 character —— 否则角色面板取不到数据，右侧是一块空白', () => {
    const state = makeState({ selectedCrowdId: 'crowd-gone' })
    expect(selectRightPanelKind(state)).toBe('scene')
    expect(resolveCharacterSelection(state)).toBeNull()
  })

  it('返回 character 时一定取得到角色数据', () => {
    const state = makeState({
      objects: [makeObject({ id: 'm1', name: '角色02', kind: 'character', crowdId: 'c', crowdLabel: '路人组' })],
      selectedCrowdId: 'c',
    })
    expect(selectRightPanelKind(state)).toBe('character')
    expect(resolveCharacterSelection(state)).not.toBeNull()
  })
})
