import { describe, expect, it } from 'vitest'
import { createDefaultDirectorProject } from './default-project'
import {
  attachLookToDefaultCharacter,
  bindLookOnProject,
  characterLookFileError,
  clearLookOnProject,
  pickLookTarget,
} from './character-look'

describe('characterLookFileError', () => {
  it('没文件', () => {
    expect(characterLookFileError(null)).toBe('请选择形象图片')
  })

  it('只认常见图片', () => {
    expect(characterLookFileError({ name: 'a.glb', size: 10 })).toBe('只支持 JPG / PNG / WebP')
    expect(characterLookFileError({ name: 'face.png', size: 10 })).toBe('')
  })

  it('太大挡住', () => {
    expect(characterLookFileError({ name: 'face.jpg', size: 20 * 1024 * 1024 })).toBe('形象图片太大')
  })
})

describe('bindLookOnProject', () => {
  it('给素体挂一张图，旧图没人用就丢掉', () => {
    let project = createDefaultDirectorProject()
    const id = project.objects[0]!.id
    project = bindLookOnProject(project, [id], { url: 'https://cdn/a.jpg', fileName: 'a.jpg' })
    const first = project.objects[0]!.lookAssetId
    expect(first).toBeTruthy()
    expect(project.assets).toHaveLength(1)

    project = bindLookOnProject(project, [id], { url: 'https://cdn/b.jpg', fileName: 'b.jpg' })
    expect(project.assets).toHaveLength(1)
    expect(project.assets[0]!.url).toBe('https://cdn/b.jpg')
    expect(project.objects[0]!.lookAssetId).not.toBe(first)
  })

  it('去掉形象时素材也清掉', () => {
    let project = createDefaultDirectorProject()
    const id = project.objects[0]!.id
    project = bindLookOnProject(project, [id], { url: 'https://cdn/a.jpg', fileName: 'a.jpg' })
    project = clearLookOnProject(project, [id])
    expect(project.objects[0]!.lookAssetId).toBeUndefined()
    expect(project.assets).toHaveLength(0)
  })

  it('不是角色的对象不动', () => {
    const project = createDefaultDirectorProject()
    const cameraId = project.objects.find(item => item.kind === 'camera')!.id
    const next = bindLookOnProject(project, [cameraId], { url: 'https://cdn/a.jpg', fileName: 'a.jpg' })
    expect(next).toBe(project)
  })
})

describe('attachLookToDefaultCharacter', () => {
  it('空场景绑到默认角色', () => {
    const project = attachLookToDefaultCharacter(createDefaultDirectorProject(), {
      url: 'https://cdn/cast.jpg',
      fileName: 'cast.jpg',
    })
    expect(pickLookTarget(project)?.lookAssetId).toBeTruthy()
    expect(project.assets[0]!.url).toBe('https://cdn/cast.jpg')
  })

  it('场上只有导入角色时绑到导入角色', () => {
    const mannequinId = createDefaultDirectorProject().objects.find(item => item.kind === 'character')!.id
    const project = attachLookToDefaultCharacter({
      ...createDefaultDirectorProject(),
      assets: [{ id: 'm1', kind: 'character', sourceType: 'model', fileName: 'a.glb', url: 'https://cdn/a.glb' }],
      objects: createDefaultDirectorProject().objects.map(item =>
        item.id === mannequinId ? { ...item, assetRefId: 'm1' } : item),
    }, { url: 'https://cdn/face.jpg', fileName: 'face.jpg' })
    expect(pickLookTarget(project)?.id).toBe(mannequinId)
    expect(project.objects.find(item => item.id === mannequinId)?.lookAssetId).toBeTruthy()
  })

  it('有素体时不绑导入角色', () => {
    const base = createDefaultDirectorProject()
    const mannequin = base.objects.find(item => item.kind === 'character')!
    const project = {
      ...base,
      assets: [...base.assets, { id: 'm1', kind: 'character' as const, sourceType: 'model' as const, fileName: 'a.glb', url: 'https://cdn/a.glb' }],
      objects: [
        ...base.objects,
        { ...mannequin, id: 'char_imported', name: '角色02', assetRefId: 'm1' },
      ],
    }
    expect(pickLookTarget(project)?.id).toBe(mannequin.id)
  })

  it('已经有形象就不再覆盖', () => {
    const first = attachLookToDefaultCharacter(createDefaultDirectorProject(), {
      url: 'https://cdn/old.jpg',
      fileName: 'old.jpg',
    })
    const second = attachLookToDefaultCharacter(first, {
      url: 'https://cdn/new.jpg',
      fileName: 'new.jpg',
    })
    expect(second.assets[0]!.url).toBe('https://cdn/old.jpg')
  })
})
