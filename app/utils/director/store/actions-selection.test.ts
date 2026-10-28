import { describe, expect, it } from 'vitest'
import {
  attachPanoramaToProject,
  getOrderedSelectedObjectIds,
  openSceneInspector,
  removePanoramaAsset,
  selectCrowd,
  selectObject,
  toggleObjectSelection,
  updateScene,
} from './actions-selection'
import { createInitialDirectorState, type DirectorState } from './state'
import type { DirectorObject } from '../schema'

function withCrowd(state: DirectorState): DirectorState {
  const members: DirectorObject[] = ['a', 'b', 'c'].map((suffix, index) => ({
    id: `crowd_${suffix}`,
    name: `群众${suffix}`,
    kind: 'character',
    visible: true,
    locked: false,
    crowdId: 'crowd_1',
    crowdLabel: '群众01',
    transform: { position: [index, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }))
  return { ...state, project: { ...state.project, objects: [...state.project.objects, ...members] } }
}

describe('选择', () => {
  it('选中对象时清掉群众选中并切回自动面板', () => {
    const state = openSceneInspector(createInitialDirectorState())
    expect(state.directorInspectorMode).toBe('scene')

    const next = selectObject(state, 'char_default_a')
    expect(next.selectedObjectId).toBe('char_default_a')
    expect(next.selectedObjectIds).toEqual(['char_default_a'])
    expect(next.selectedCrowdId).toBeNull()
    expect(next.directorInspectorMode).toBe('auto')
  })

  it('选中机位对象会顺带把它设为当前机位', () => {
    // 点一下机位就能从它的视角看出去，不用再去机位列表切一次
    const state = createInitialDirectorState()
    const changed = { ...state, project: { ...state.project, activeCameraId: null } }

    const next = selectObject(changed, 'cam_object_1')
    expect(next.project.activeCameraId).toBe('cam_1')
  })

  it('选中普通对象不会动当前机位', () => {
    const state = createInitialDirectorState()
    const next = selectObject(state, 'char_default_a')
    expect(next.project.activeCameraId).toBe('cam_1')
  })

  it('传 null 相当于取消选中', () => {
    const state = selectObject(createInitialDirectorState(), 'char_default_a')
    const next = selectObject(state, null)
    expect(next.selectedObjectId).toBeNull()
    expect(next.selectedObjectIds).toEqual([])
  })
})

describe('群众组选择', () => {
  it('选中整组时成员全进选中列表，当前对象取最后一个', () => {
    const state = withCrowd(createInitialDirectorState())
    const next = selectCrowd(state, 'crowd_1')

    expect(next.selectedCrowdId).toBe('crowd_1')
    expect(next.selectedObjectIds).toEqual(['crowd_a', 'crowd_b', 'crowd_c'])
    expect(next.selectedObjectId).toBe('crowd_c')
  })

  it('组不存在时保持原状，不会把选中清空', () => {
    const state = selectObject(withCrowd(createInitialDirectorState()), 'char_default_a')
    const next = selectCrowd(state, 'crowd_missing')
    expect(next).toBe(state)
  })

  it('传 null 清掉整组选中', () => {
    const state = selectCrowd(withCrowd(createInitialDirectorState()), 'crowd_1')
    const next = selectCrowd(state, null)
    expect(next.selectedCrowdId).toBeNull()
    expect(next.selectedObjectIds).toEqual([])
  })
})

describe('多选切换', () => {
  it('未选中则追加，当前对象是最后点的那个', () => {
    const state = withCrowd(createInitialDirectorState())
    const first = toggleObjectSelection(state, 'crowd_a')
    const second = toggleObjectSelection(first, 'crowd_b')

    expect(second.selectedObjectIds).toEqual(['crowd_a', 'crowd_b'])
    expect(second.selectedObjectId).toBe('crowd_b')
  })

  it('已选中则移出，当前对象回退到剩下的最后一个', () => {
    const state = withCrowd(createInitialDirectorState())
    const picked = toggleObjectSelection(toggleObjectSelection(state, 'crowd_a'), 'crowd_b')
    const next = toggleObjectSelection(picked, 'crowd_b')

    expect(next.selectedObjectIds).toEqual(['crowd_a'])
    expect(next.selectedObjectId).toBe('crowd_a')
  })

  it('全部移出后当前对象为空', () => {
    const state = withCrowd(createInitialDirectorState())
    const picked = toggleObjectSelection(state, 'crowd_a')
    const next = toggleObjectSelection(picked, 'crowd_a')

    expect(next.selectedObjectIds).toEqual([])
    expect(next.selectedObjectId).toBeNull()
  })

  it('对象不存在时原样返回', () => {
    const state = createInitialDirectorState()
    expect(toggleObjectSelection(state, 'nope')).toBe(state)
  })

  it('只有单个 selectedObjectId 的老状态也能正确接上', () => {
    const state = { ...createInitialDirectorState(), selectedObjectId: 'char_default_a', selectedObjectIds: [] }
    expect(getOrderedSelectedObjectIds(state)).toEqual(['char_default_a'])

    const next = toggleObjectSelection(state, 'cam_object_1')
    expect(next.selectedObjectIds).toEqual(['char_default_a', 'cam_object_1'])
  })
})

describe('场景设置', () => {
  it('只改传进来的字段，其余保持不变', () => {
    const state = createInitialDirectorState()
    const next = updateScene(state, { groundOpacity: 0.8 })

    expect(next.project.scene.groundOpacity).toBe(0.8)
    expect(next.project.scene.backgroundColor).toBe(state.project.scene.backgroundColor)
    expect(next.project.scene.showGround).toBe(state.project.scene.showGround)
  })
})

describe('removePanoramaAsset', () => {
  function stateWithPanorama(): DirectorState {
    const base = createInitialDirectorState()
    return {
      ...base,
      project: {
        ...base.project,
        panoramaAssetId: 'pano-1',
        assets: [
          { id: 'pano-1', kind: 'panorama', sourceType: 'image', fileName: 'sky.jpg', url: 'blob:sky' },
          { id: 'other', kind: 'prop', sourceType: 'model', fileName: 'box.glb', url: 'blob:box' },
        ],
      },
    }
  }

  it('摘掉引用，顺带把那张图从素材里删掉', () => {
    const next = removePanoramaAsset(stateWithPanorama())
    expect(next.project.panoramaAssetId).toBeNull()
    expect(next.project.assets.map(item => item.id)).toEqual(['other'])
  })

  it('本来就没有全景时原样返回，不产生多余的撤销步', () => {
    const state = createInitialDirectorState()
    expect(removePanoramaAsset(state)).toBe(state)
  })
})

describe('attachPanoramaToProject', () => {
  it('挂上之后 panoramaAssetId 指向新加的素材', () => {
    const project = createInitialDirectorState().project
    const next = attachPanoramaToProject(project, { url: 'https://x/a.jpg', fileName: 'a.jpg' })
    const asset = next.assets.find(item => item.id === next.panoramaAssetId)

    expect(asset?.url).toBe('https://x/a.jpg')
    expect(asset?.kind).toBe('panorama')
  })

  it('换图时把上一张删掉，不在存档里越堆越多', () => {
    const project = createInitialDirectorState().project
    const first = attachPanoramaToProject(project, { url: 'https://x/a.jpg', fileName: 'a.jpg' })
    const second = attachPanoramaToProject(first, { url: 'https://x/b.jpg', fileName: 'b.jpg' })

    expect(second.assets.filter(item => item.kind === 'panorama')).toHaveLength(1)
    expect(second.assets.find(item => item.id === second.panoramaAssetId)?.url).toBe('https://x/b.jpg')
  })

  it('标成 library：它是服务器地址，不该被当成本地 blob 在存档时摘掉', () => {
    const project = createInitialDirectorState().project
    const next = attachPanoramaToProject(project, { url: 'https://x/a.jpg', fileName: 'a.jpg' })
    expect(next.assets.find(item => item.id === next.panoramaAssetId)?.assetSource).toBe('library')
  })

  it('默认按 equirectangular 投影', () => {
    const project = createInitialDirectorState().project
    const next = attachPanoramaToProject(project, { url: 'https://x/a.jpg', fileName: 'a.jpg' })
    expect(next.assets.find(item => item.id === next.panoramaAssetId)?.projectionMode).toBe('equirectangular')
  })
})
