import { describe, expect, it } from 'vitest'
import {
  buildObjectTree,
  filterObjectTree,
  isTreeItemSelected,
  resolveSelectedIds,
} from './object-tree'
import type { DirectorAssetRef, DirectorObject } from './schema'

function makeObject(patch: Partial<DirectorObject> & Pick<DirectorObject, 'id' | 'name' | 'kind'>): DirectorObject {
  return {
    visible: true,
    locked: false,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...patch,
  }
}

function makeAsset(patch: Partial<DirectorAssetRef> & Pick<DirectorAssetRef, 'id' | 'sourceType'>): DirectorAssetRef {
  return {
    kind: 'prop',
    fileName: 'x',
    url: 'blob:x',
    ...patch,
  }
}

describe('buildObjectTree', () => {
  it('按类型分组，空组不出现', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'a', name: '主角', kind: 'character' }),
      makeObject({ id: 'c', name: '主机位', kind: 'camera' }),
    ], [])

    expect(groups.map(group => group.key)).toEqual(['characters', 'cameras'])
  })

  it('同一个 crowdId 的成员折成一行，成员进 children', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'm1', name: '群众 1', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' }),
      makeObject({ id: 'm2', name: '群众 2', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' }),
    ], [])

    const crowd = groups.find(group => group.key === 'crowd')
    expect(crowd?.items).toHaveLength(1)
    expect(crowd?.items[0]?.name).toBe('路人组')
    expect(crowd?.items[0]?.objectIds).toEqual(['m1', 'm2'])
    expect(crowd?.items[0]?.children?.map(child => child.id)).toEqual(['m1', 'm2'])
    // 折进群众组的成员不该再单独出现在角色组里
    expect(groups.find(group => group.key === 'characters')).toBeUndefined()
    expect(crowd?.items[0]?.visible).toBe(true)
    expect(crowd?.items[0]?.locked).toBe(false)
  })

  it('群众组的可见和锁定是全体成员的交集', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'm1', name: '群众 1', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组', visible: true, locked: true }),
      makeObject({ id: 'm2', name: '群众 2', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组', visible: false, locked: true }),
    ], [])

    const item = groups.find(group => group.key === 'crowd')?.items[0]
    expect(item?.visible).toBe(false)
    expect(item?.locked).toBe(true)
  })

  it('只有 crowdId 没有 crowdLabel 的当普通角色 —— 半截数据不该凭空造出一个无名组', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'm1', name: '群众 1', kind: 'character', crowdId: 'crowd-a' }),
    ], [])

    expect(groups.map(group => group.key)).toEqual(['characters'])
  })

  it('引用模型素材的进「我的模型」，引用图片的当几何体', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'p1', name: '模型道具', kind: 'prop', assetRefId: 'asset-model' }),
      makeObject({ id: 'p2', name: '图片道具', kind: 'prop', assetRefId: 'asset-image' }),
      makeObject({ id: 'p3', name: '立方体', kind: 'prop' }),
    ], [
      makeAsset({ id: 'asset-model', sourceType: 'model' }),
      makeAsset({ id: 'asset-image', sourceType: 'image' }),
    ])

    expect(groups.find(group => group.key === 'models')?.items.map(item => item.id)).toEqual(['p1'])
    expect(groups.find(group => group.key === 'geometry')?.items.map(item => item.id)).toEqual(['p2', 'p3'])
  })

  it('素材还没加载出来时先当模型，别让它在几何体组里闪一下', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'p1', name: '道具', kind: 'prop', assetRefId: 'missing' }),
    ], [])

    expect(groups.find(group => group.key === 'models')?.items.map(item => item.id)).toEqual(['p1'])
  })

  it('全景对象有自己的组，不会从树里消失', () => {
    const groups = buildObjectTree([
      makeObject({ id: 'sky', name: '天空', kind: 'panorama' }),
    ], [])

    expect(groups.map(group => group.key)).toEqual(['panorama'])
    expect(groups[0]?.items[0]?.icon).toBe('i-lucide-globe')
  })
})

describe('filterObjectTree', () => {
  const groups = buildObjectTree([
    makeObject({ id: 'a', name: '主角', kind: 'character' }),
    makeObject({ id: 'b', name: '配角', kind: 'character' }),
    makeObject({ id: 'm1', name: '群众 1', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' }),
    makeObject({ id: 'm2', name: '群众 2', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' }),
  ], [])

  it('空关键字原样返回', () => {
    expect(filterObjectTree(groups, '  ')).toBe(groups)
  })

  it('按名字过滤，全空的组去掉', () => {
    const filtered = filterObjectTree(groups, '主角')
    expect(filtered.map(group => group.key)).toEqual(['characters'])
    expect(filtered[0]?.items.map(item => item.id)).toEqual(['a'])
  })

  it('命中群众成员时保留整组，但只列命中的成员', () => {
    const filtered = filterObjectTree(groups, '群众 2')
    const crowd = filtered.find(group => group.key === 'crowd')
    expect(crowd?.items[0]?.children?.map(child => child.id)).toEqual(['m2'])
  })

  it('命中群众组名时成员全留着', () => {
    const filtered = filterObjectTree(groups, '路人组')
    const crowd = filtered.find(group => group.key === 'crowd')
    expect(crowd?.items[0]?.children).toHaveLength(2)
  })

  it('大小写不敏感', () => {
    const withLatin = buildObjectTree([makeObject({ id: 'a', name: 'Hero', kind: 'character' })], [])
    expect(filterObjectTree(withLatin, 'hero')[0]?.items).toHaveLength(1)
  })
})

describe('resolveSelectedIds', () => {
  it('多选优先于单选', () => {
    expect(resolveSelectedIds({ selectedObjectId: 'a', selectedObjectIds: ['b', 'c'] })).toEqual(['b', 'c'])
  })

  it('都没有时给空数组', () => {
    expect(resolveSelectedIds({ selectedObjectId: null, selectedObjectIds: [] })).toEqual([])
  })
})

describe('isTreeItemSelected', () => {
  const [crowdItem] = buildObjectTree([
    makeObject({ id: 'm1', name: '群众 1', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' }),
    makeObject({ id: 'm2', name: '群众 2', kind: 'character', crowdId: 'crowd-a', crowdLabel: '路人组' }),
  ], []).flatMap(group => group.items)

  const [single] = buildObjectTree([makeObject({ id: 'a', name: '主角', kind: 'character' })], [])
    .flatMap(group => group.items)

  it('整组被选中', () => {
    expect(isTreeItemSelected(crowdItem!, {
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedCrowdId: 'crowd-a',
    })).toBe(true)
  })

  it('成员被逐个选全了，也算整组选中', () => {
    expect(isTreeItemSelected(crowdItem!, {
      selectedObjectId: null,
      selectedObjectIds: ['m1', 'm2'],
      selectedCrowdId: null,
    })).toBe(true)
  })

  it('只选中一部分成员不算整组选中', () => {
    expect(isTreeItemSelected(crowdItem!, {
      selectedObjectId: null,
      selectedObjectIds: ['m1'],
      selectedCrowdId: null,
    })).toBe(false)
  })

  it('什么都没选时不算选中 —— 空选中集合别被 every 当成全中', () => {
    expect(isTreeItemSelected(single!, {
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedCrowdId: null,
    })).toBe(false)
  })

  it('单选命中', () => {
    expect(isTreeItemSelected(single!, {
      selectedObjectId: 'a',
      selectedObjectIds: [],
      selectedCrowdId: null,
    })).toBe(true)
  })
})
