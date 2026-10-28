import { describe, expect, it } from 'vitest'
import {
  fitImportedModelScale,
  importedModelDisplayName,
  importedModelFileError,
  IMPORTED_MODEL_MAX_BYTES,
  isImportedModelFileName,
} from './imported-model'

describe('导入模型文件', () => {
  it('只认 glb / gltf 扩展名', () => {
    expect(isImportedModelFileName('chair.glb')).toBe(true)
    expect(isImportedModelFileName('Chair.GLTF')).toBe(true)
    expect(isImportedModelFileName('chair.fbx')).toBe(false)
    expect(isImportedModelFileName('chair.png')).toBe(false)
  })

  it('显示名去掉路径和扩展名', () => {
    expect(importedModelDisplayName('C:\\\\models\\\\red-chair.glb')).toBe('red-chair')
    expect(importedModelDisplayName('角色.gltf')).toBe('角色')
  })

  it('空文件、错误扩展名、超大文件分别报错', () => {
    expect(importedModelFileError(null)).toBe('请选择模型文件')
    expect(importedModelFileError({ name: 'a.fbx', size: 10 })).toBe('只支持 GLB / GLTF')
    expect(importedModelFileError({ name: 'a.glb', size: IMPORTED_MODEL_MAX_BYTES + 1 })).toBe('模型文件太大')
    expect(importedModelFileError({ name: 'a.glb', size: 128 })).toBe('')
  })
})

describe('导入模型缩放', () => {
  it('已经小于上限的不放大', () => {
    expect(fitImportedModelScale(1.2)).toBe(1)
  })

  it('超大模型按最长边压进上限', () => {
    expect(fitImportedModelScale(20)).toBeCloseTo(0.1)
  })

  it('无效尺寸当 1，避免除零', () => {
    expect(fitImportedModelScale(0)).toBe(1)
    expect(fitImportedModelScale(Number.NaN)).toBe(1)
  })
})
