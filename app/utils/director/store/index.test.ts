import { describe, expect, it } from 'vitest'
import { createDirectorStore } from './index'
import type { PosePresetLookup } from './actions-pose'

const lookup: PosePresetLookup = id => (id === 'wave' ? { armR: 1.2 } : null)

function roleOf(store: ReturnType<typeof createDirectorStore>, id: string) {
  return store.state.value.project.objects.find(item => item.id === id)
}

describe('store 组装', () => {
  it('两个实例互不干扰', () => {
    // 上游是全局单例，我们的导演台是画布节点，同一张画布可能有好几个
    const a = createDirectorStore()
    const b = createDirectorStore()

    a.addPresetCharacter()
    expect(a.state.value.project.objects).toHaveLength(3)
    expect(b.state.value.project.objects).toHaveLength(2)
  })

  it('场景改动进撤销栈，选择不进', () => {
    const store = createDirectorStore()

    store.selectObject('char_default_a')
    expect(store.canUndo.value).toBe(false)

    store.addPresetCharacter()
    expect(store.canUndo.value).toBe(true)

    store.undo()
    expect(store.state.value.project.objects).toHaveLength(2)
    expect(store.canRedo.value).toBe(true)
    store.redo()
    expect(store.state.value.project.objects).toHaveLength(3)
  })

  it('掌镜同步不进撤销栈，记录节点才进', () => {
    // 掌镜时每帧都在同步，进栈的话撤销一次只退一帧
    const store = createDirectorStore()
    const pose = { position: [0, 1, 4] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], fov: 50 }

    store.syncCameraPose('cam_1', pose)
    expect(store.canUndo.value).toBe(false)

    store.recordCameraNode('cam_1', pose)
    expect(store.canUndo.value).toBe(true)
    expect(store.state.value.project.cameras[0]!.nodes).toHaveLength(1)
  })

  it('批量把连续拖拽合成一步撤销', () => {
    const store = createDirectorStore()

    store.beginBatch()
    for (let x = 1; x <= 3; x++)
      store.updateObjectTransform('char_default_a', { position: [x, 0, 0] })
    store.endBatch()

    expect(roleOf(store, 'char_default_a')!.transform.position).toEqual([3, 0, 0])
    store.undo()
    expect(roleOf(store, 'char_default_a')!.transform.position).toEqual([0, 0, 0])
  })

  it('姿势预设经由注入的查找函数生效', () => {
    const store = createDirectorStore()
    store.applyPosePreset('char_default_a', 'wave', lookup)

    expect(roleOf(store, 'char_default_a')!.characterRig!.controls).toEqual({ armR: 1.2 })
  })

  it('导入模型进撤销栈，撤销后对象和资产一起消失', () => {
    const store = createDirectorStore()
    const { objectId, assetId } = store.addImportedModel({
      url: 'blob:chair',
      fileName: 'chair.glb',
    })

    expect(store.state.value.project.objects.some(item => item.id === objectId)).toBe(true)
    expect(store.state.value.project.assets.some(item => item.id === assetId)).toBe(true)
    store.undo()
    expect(store.state.value.project.objects.some(item => item.id === objectId)).toBe(false)
    expect(store.state.value.project.assets.some(item => item.id === assetId)).toBe(false)
  })

  it('导入角色绑上骨骼后可以撤销，重复绑定不占撤销步', () => {
    const store = createDirectorStore()
    const { objectId } = store.addImportedModel({
      url: 'blob:hero',
      fileName: 'hero.glb',
      kind: 'character',
    })

    expect(roleOf(store, objectId)!.characterRig).toBeUndefined()
    store.bindImportedCharacterRig(objectId, 'mixamo')
    expect(roleOf(store, objectId)!.characterRig).toEqual({
      rigType: 'mixamo',
      posePresetId: 'stand',
      controls: {},
    })

    store.bindImportedCharacterRig(objectId, 'vrm')
    store.undo()
    expect(roleOf(store, objectId)!.characterRig).toBeUndefined()
  })

  it('群众阵列返回新建的 id', () => {
    const store = createDirectorStore()
    const ids = store.addCrowdCharacters({ rows: 2, columns: 2, spacing: 1 })

    expect(ids).toHaveLength(4)
    expect(store.state.value.selectedObjectIds).toEqual(ids)
  })
})

describe('复制粘贴', () => {
  it('粘贴的对象拿到新 id 并往右下偏移', () => {
    const store = createDirectorStore()
    store.selectObject('char_default_a')
    expect(store.copySelectedObjects()).toBe(1)

    store.pasteClipboardObjects()
    const pastedId = store.state.value.selectedObjectId!

    expect(pastedId).not.toBe('char_default_a')
    const pasted = roleOf(store, pastedId)!
    expect(pasted.transform.position[0]).toBeGreaterThan(0)
    expect(pasted.transform.position[2]).toBeGreaterThan(0)
  })

  it('连续粘贴越挪越远，不会叠在一起', () => {
    const store = createDirectorStore()
    store.selectObject('char_default_a')
    store.copySelectedObjects()

    store.pasteClipboardObjects()
    const first = roleOf(store, store.state.value.selectedObjectId!)!.transform.position[0]
    store.pasteClipboardObjects()
    const second = roleOf(store, store.state.value.selectedObjectId!)!.transform.position[0]

    expect(second).toBeGreaterThan(first)
  })

  it('复制机位会连机位本体一起复制，截图不跟着走', () => {
    const store = createDirectorStore()
    store.addCameraCaptures('cam_1', ['data:image/png;base64,a'])
    store.selectObject('cam_object_1')
    store.copySelectedObjects()
    store.pasteClipboardObjects()

    const cameras = store.state.value.project.cameras
    expect(cameras).toHaveLength(2)
    // 截图是原机位拍的，挂在复制件上会误导
    expect(cameras[1]!.captures).toEqual([])
    expect(cameras[0]!.captures).toHaveLength(1)

    // 粘出来的机位对象要绑到新机位，不能还连着原件
    const pastedObject = store.state.value.project.objects.find(item => item.id === store.state.value.selectedObjectId)!
    expect(pastedObject.linkedCameraId).toBe(cameras[1]!.id)
  })

  it('整组群众粘出来还是一组，但和原组分开', () => {
    const store = createDirectorStore()
    const ids = store.addCrowdCharacters({ rows: 1, columns: 3, spacing: 1 })
    const sourceCrowdId = roleOf(store, ids[0]!)!.crowdId

    store.selectCrowd(sourceCrowdId!)
    store.copySelectedObjects()
    store.pasteClipboardObjects()

    const pastedIds = store.state.value.selectedObjectIds
    const pastedCrowdIds = new Set(pastedIds.map(id => roleOf(store, id)!.crowdId))

    expect(pastedIds).toHaveLength(3)
    expect(pastedCrowdIds.size).toBe(1)
    expect([...pastedCrowdIds][0]).not.toBe(sourceCrowdId)
    expect(store.state.value.selectedCrowdId).toBe([...pastedCrowdIds][0])
  })

  it('剪贴板为空时粘贴不做事', () => {
    const store = createDirectorStore()
    expect(store.pasteClipboardObjects()).toBe(false)
  })

  it('粘贴出来的副本不带着锁', () => {
    const store = createDirectorStore()
    store.toggleObjectsLocked(['char_default_a'])
    store.selectObject('char_default_a')
    store.copySelectedObjects()
    store.pasteClipboardObjects()
    const pasted = roleOf(store, store.state.value.selectedObjectId!)!
    expect(pasted.locked).toBe(false)
    expect(roleOf(store, 'char_default_a')!.locked).toBe(true)
  })
})

describe('场景装载', () => {
  it('loadProject 换场景并清掉撤销栈', () => {
    // 不清的话能从新场景一路撤回到上一个场景
    const store = createDirectorStore()
    store.addPresetCharacter()
    expect(store.canUndo.value).toBe(true)

    const other = createDirectorStore()
    other.addGeometryPrimitive('box')
    store.loadProject(other.state.value.project)

    expect(store.canUndo.value).toBe(false)
    expect(store.state.value.project.objects.some(item => item.geometryType === 'box')).toBe(true)
  })

  it('replaceProject 保留撤销栈，可以退回原场景', () => {
    const store = createDirectorStore()
    const before = store.state.value.project.objects.length

    const other = createDirectorStore()
    other.addGeometryPrimitive('box')
    store.replaceProject(other.state.value.project)

    expect(store.state.value.project.objects.length).toBe(before + 1)
    store.undo()
    expect(store.state.value.project.objects.length).toBe(before)
  })

  it('装载后的场景与来源互不共享引用', () => {
    const store = createDirectorStore()
    const other = createDirectorStore()
    store.loadProject(other.state.value.project)

    other.updateObjectName('char_default_a', '被改了')
    expect(roleOf(store, 'char_default_a')!.name).not.toBe('被改了')
  })

  it('只读时场景改不动，选择还能切', () => {
    const store = createDirectorStore(undefined, { readonly: true })
    const before = store.state.value.project.objects.length
    store.addPresetCharacter()
    store.undo()
    expect(store.state.value.project.objects).toHaveLength(before)
    expect(store.canUndo.value).toBe(false)
    expect(store.readonly.value).toBe(true)
    store.selectObject('char_default_a')
    expect(store.state.value.selectedObjectId).toBe('char_default_a')
  })
})
