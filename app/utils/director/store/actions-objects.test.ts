import { describe, expect, it } from 'vitest'
import {
  addCrowdCharacters,
  addGeometryPrimitive,
  addImportedModel,
  addPresetCharacter,
  bindCharacterLook,
  bindImportedCharacterRig,
  clearCharacterLook,
  deleteObjectsByIds,
  deleteSelectedObject,
  getAddedModelColumnOffset,
  getCrowdCharacterPositions,
  updateImportedAsset,
} from './actions-objects'
import { updatePoseControl } from './actions-pose'
import { selectObject, toggleObjectSelection } from './actions-selection'
import { createInitialDirectorState } from './state'

describe('落点排布', () => {
  it('新对象左右交替岔开，不会叠在一起也不会一路跑远', () => {
    expect(getAddedModelColumnOffset(1)).toBeCloseTo(-1.25)
    expect(getAddedModelColumnOffset(2)).toBeCloseTo(1.25)
    expect(getAddedModelColumnOffset(3)).toBeCloseTo(-2.5)
    expect(getAddedModelColumnOffset(4)).toBeCloseTo(2.5)
  })

  it('群众阵列以整组中心为原点铺开', () => {
    const positions = getCrowdCharacterPositions(2, 3, 1)

    expect(positions).toHaveLength(6)
    // 3 列间距 1，中心对齐后 x 应该是 -1 / 0 / 1
    expect(positions[0]).toEqual([-1, 0, -0.5])
    expect(positions[2]).toEqual([1, 0, -0.5])
    expect(positions[5]).toEqual([1, 0, 0.5])
  })

  it('行列小于 1 或间距为 0 时兜底，不会算出空阵列', () => {
    expect(getCrowdCharacterPositions(0, 0, 0)).toHaveLength(1)
  })
})

describe('添加对象', () => {
  it('加角色后自动选中它', () => {
    const state = addPresetCharacter(createInitialDirectorState())
    const added = state.project.objects[state.project.objects.length - 1]!

    expect(added.kind).toBe('character')
    expect(state.selectedObjectId).toBe(added.id)
    expect(state.selectedObjectIds).toEqual([added.id])
    expect(state.directorInspectorMode).toBe('auto')
  })

  it('连加的角色颜色不重复', () => {
    let state = createInitialDirectorState()
    for (let i = 0; i < 4; i++)
      state = addPresetCharacter(state)

    const colors = state.project.objects.filter(item => item.kind === 'character').map(item => item.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('几何体同类第一个不带编号，第二个起才加', () => {
    let state = addGeometryPrimitive(createInitialDirectorState(), 'box')
    expect(state.project.objects[state.project.objects.length - 1]!.name).toBe('立方体')

    state = addGeometryPrimitive(state, 'box')
    expect(state.project.objects[state.project.objects.length - 1]!.name).toBe('立方体02')

    state = addGeometryPrimitive(state, 'sphere')
    expect(state.project.objects[state.project.objects.length - 1]!.name).toBe('球体')
  })

  it('群众整片共用一个 crowdId 并整组选中', () => {
    const { state, crowdId, createdIds } = addCrowdCharacters(createInitialDirectorState(), {
      rows: 2,
      columns: 3,
      spacing: 1,
    })

    expect(createdIds).toHaveLength(6)
    expect(state.selectedCrowdId).toBe(crowdId)
    expect(state.selectedObjectIds).toEqual(createdIds)

    const members = state.project.objects.filter(item => item.crowdId === crowdId)
    expect(members).toHaveLength(6)
    expect(new Set(members.map(item => item.id)).size).toBe(6)
  })

  it('群众整片排在已有角色的后方', () => {
    // 默认角色站在 z=0，整片不该压在它身上
    const { state } = addCrowdCharacters(createInitialDirectorState(), { rows: 1, columns: 2, spacing: 1 })
    const members = state.project.objects.filter(item => item.crowdId)

    for (const item of members)
      expect(item.transform.position[2]).toBeGreaterThan(0)
  })

  it('导入模型进「我的模型」，并自动选中', () => {
    const { state, assetId, objectId } = addImportedModel(createInitialDirectorState(), {
      url: 'blob:chair',
      fileName: 'red-chair.glb',
    })
    const object = state.project.objects.find(item => item.id === objectId)!
    const asset = state.project.assets.find(item => item.id === assetId)!

    expect(object.kind).toBe('prop')
    expect(object.name).toBe('red-chair')
    expect(object.assetRefId).toBe(assetId)
    expect(asset.sourceType).toBe('model')
    expect(asset.assetSource).toBe('local')
    expect(state.selectedObjectId).toBe(objectId)
  })

  it('导入角色模型不带素体骨骼，重名自动编号', () => {
    const first = addImportedModel(createInitialDirectorState(), {
      url: 'blob:a',
      fileName: 'hero.glb',
      kind: 'character',
    })
    const second = addImportedModel(first.state, {
      url: 'blob:b',
      fileName: 'hero.glb',
      kind: 'character',
    })
    const role = second.state.project.objects.find(item => item.id === second.objectId)!

    expect(role.kind).toBe('character')
    expect(role.characterRig).toBeUndefined()
    expect(role.name).toBe('hero02')
  })

  it('认出骨架后才给导入角色补姿势，已有姿势和道具都不动', () => {
    const imported = addImportedModel(createInitialDirectorState(), {
      url: 'blob:hero',
      fileName: 'hero.glb',
      kind: 'character',
    })
    const bound = bindImportedCharacterRig(imported.state, imported.objectId, 'mixamo')
    const role = bound.project.objects.find(item => item.id === imported.objectId)!

    expect(role.characterRig).toEqual({
      rigType: 'mixamo',
      posePresetId: 'stand',
      controls: {},
    })

    const posed = updatePoseControl(bound, imported.objectId, 'leftShoulder.pitch', 20)
    const again = bindImportedCharacterRig(posed, imported.objectId, 'vrm')
    expect(again).toBe(posed)
    expect(again.project.objects.find(item => item.id === imported.objectId)!.characterRig).toEqual({
      rigType: 'mixamo',
      posePresetId: 'stand',
      controls: { 'leftShoulder.pitch': 20 },
    })

    const prop = addImportedModel(createInitialDirectorState(), {
      url: 'blob:chair',
      fileName: 'chair.glb',
    })
    expect(bindImportedCharacterRig(prop.state, prop.objectId, 'mixamo')).toBe(prop.state)
  })

  it('上传成功后把本地 blob 换成资产库地址', () => {
    const { state, assetId } = addImportedModel(createInitialDirectorState(), {
      url: 'blob:chair',
      fileName: 'chair.glb',
    })
    const next = updateImportedAsset(state, assetId, {
      url: 'https://cdn.example/chair.glb',
      assetSource: 'library',
    })

    expect(next.project.assets[0]).toMatchObject({
      id: assetId,
      url: 'https://cdn.example/chair.glb',
      assetSource: 'library',
    })
  })

  it('第二组群众用新的 crowdId', () => {
    const first = addCrowdCharacters(createInitialDirectorState(), { rows: 1, columns: 2, spacing: 1 })
    const second = addCrowdCharacters(first.state, { rows: 1, columns: 2, spacing: 1 })

    expect(second.crowdId).not.toBe(first.crowdId)
  })
})

describe('删除对象', () => {
  it('删机位对象时配套的机位一起删，当前机位换到还在的那个', () => {
    let state = createInitialDirectorState()
    // 再加一个机位对象，保证删掉默认机位后还有得换
    state = {
      ...state,
      project: {
        ...state.project,
        cameras: [...state.project.cameras, { ...state.project.cameras[0]!, id: 'cam_2', name: '机位02' }],
        objects: [...state.project.objects, {
          id: 'cam_object_2',
          name: '机位02',
          kind: 'camera',
          visible: true,
          locked: false,
          linkedCameraId: 'cam_2',
          transform: state.project.cameras[0]!.transform,
        }],
      },
    }

    state = selectObject(state, 'cam_object_1')
    const next = deleteSelectedObject(state)

    expect(next.project.cameras.map(item => item.id)).toEqual(['cam_2'])
    expect(next.project.activeCameraId).toBe('cam_2')
  })

  it('有机位盯着被删对象时，注视目标退回手动', () => {
    // 不退回的话 targetObjectId 会指向一个不存在的 id
    let state = createInitialDirectorState()
    state = {
      ...state,
      project: {
        ...state.project,
        cameras: state.project.cameras.map(camera => ({
          ...camera,
          targetMode: 'object' as const,
          targetObjectId: 'char_default_a',
        })),
      },
    }

    state = selectObject(state, 'char_default_a')
    const next = deleteSelectedObject(state)

    expect(next.project.cameras[0]!.targetMode).toBe('manual')
    expect(next.project.cameras[0]!.targetObjectId).toBeNull()
  })

  it('本地导入的模型资产不跟着删', () => {
    // 本地文件只在这台机器上，删了找不回来
    let state = createInitialDirectorState()
    state = {
      ...state,
      project: {
        ...state.project,
        assets: [
          { id: 'asset_local', kind: 'prop', sourceType: 'model', fileName: 'a.fbx', url: 'blob:a', assetSource: 'local' },
          { id: 'asset_lib', kind: 'prop', sourceType: 'model', fileName: 'b.fbx', url: 'https://b', assetSource: 'library' },
        ],
        objects: [...state.project.objects,
          { id: 'prop_a', name: '本地', kind: 'prop', visible: true, locked: false, assetRefId: 'asset_local', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          { id: 'prop_b', name: '库里', kind: 'prop', visible: true, locked: false, assetRefId: 'asset_lib', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        ],
      },
    }

    state = toggleObjectSelection(toggleObjectSelection({ ...state, selectedObjectIds: [] }, 'prop_a'), 'prop_b')
    const next = deleteSelectedObject(state)

    expect(next.project.assets.map(item => item.id)).toEqual(['asset_local'])
  })

  it('资产还被别的对象引用时不删', () => {
    let state = createInitialDirectorState()
    const shared = { id: 'asset_lib', kind: 'prop' as const, sourceType: 'model' as const, fileName: 'b.fbx', url: 'https://b', assetSource: 'library' as const }
    const mk = (id: string) => ({ id, name: id, kind: 'prop' as const, visible: true, locked: false, assetRefId: 'asset_lib', transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } })
    state = {
      ...state,
      project: { ...state.project, assets: [shared], objects: [...state.project.objects, mk('prop_a'), mk('prop_b')] },
    }

    state = selectObject(state, 'prop_a')
    const next = deleteSelectedObject(state)

    expect(next.project.assets).toHaveLength(1)
  })

  it('没有选中时什么都不做', () => {
    const state = createInitialDirectorState()
    expect(deleteSelectedObject(state)).toBe(state)
  })

  it('按 id 删，不用先选中', () => {
    const { state, createdIds } = addCrowdCharacters(createInitialDirectorState(), {
      rows: 1,
      columns: 2,
      spacing: 1,
    })
    const next = deleteObjectsByIds(state, createdIds)
    expect(next.project.objects.some(item => createdIds.includes(item.id))).toBe(false)
    expect(next.selectedCrowdId).toBeNull()
  })

  it('锁定对象不删，没锁定的照删', () => {
    let state = createInitialDirectorState()
    const lockedId = state.project.objects.find(item => item.kind === 'character')!.id
    const withProp = addGeometryPrimitive(state, 'box')
    const objectId = withProp.selectedObjectId!
    state = {
      ...withProp,
      project: {
        ...withProp.project,
        objects: withProp.project.objects.map(item => item.id === lockedId ? { ...item, locked: true } : item),
      },
    }

    const lockedOnly = deleteObjectsByIds(state, [lockedId])
    expect(lockedOnly).toBe(state)
    expect(lockedOnly.project.objects.some(item => item.id === lockedId)).toBe(true)

    const mixed = deleteObjectsByIds(state, [lockedId, objectId])
    expect(mixed.project.objects.some(item => item.id === lockedId)).toBe(true)
    expect(mixed.project.objects.some(item => item.id === objectId)).toBe(false)
  })
})

describe('绑定形象', () => {
  it('给选中角色挂图', () => {
    const id = createInitialDirectorState().project.objects.find(item => item.kind === 'character')!.id
    const next = bindCharacterLook(createInitialDirectorState(), id, {
      url: 'https://cdn/face.jpg',
      fileName: 'face.jpg',
    })
    const role = next.project.objects.find(item => item.id === id)!
    expect(role.lookAssetId).toBeTruthy()
    expect(next.project.assets[0]!.url).toBe('https://cdn/face.jpg')
  })

  it('去掉形象', () => {
    const start = createInitialDirectorState()
    const id = start.project.objects.find(item => item.kind === 'character')!.id
    const bound = bindCharacterLook(start, id, { url: 'https://cdn/face.jpg', fileName: 'face.jpg' })
    const next = clearCharacterLook(bound, id)
    expect(next.project.objects.find(item => item.id === id)!.lookAssetId).toBeUndefined()
    expect(next.project.assets).toHaveLength(0)
  })
})
