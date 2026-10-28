import { describe, expect, it, vi } from 'vitest'
import { previewOutputFromMode, renderPreviewPass } from './preview-pass'

function sceneWith(names: string[]) {
  const objects = names.map(name => ({ name, visible: true }))
  return {
    overrideMaterial: null as { type?: string } | null,
    background: 'sky',
    objects,
    traverse(fn: (obj: { name: string, visible: boolean }) => void) {
      for (const obj of objects)
        fn(obj)
    },
  }
}

describe('预演控制图', () => {
  it('时间轴三档，认不出的退回彩色', () => {
    expect(previewOutputFromMode('color')).toBe('color')
    expect(previewOutputFromMode('depth')).toBe('depth')
    expect(previewOutputFromMode('matte')).toBe('matte')
    expect(previewOutputFromMode('其他')).toBe('color')
  })

  it('深度会藏起地面，读完像素把彩色画面渲回去', () => {
    const scene = sceneWith(['角色', 'preview-omit'])
    const renders: string[] = []
    const url = renderPreviewPass({
      scene: scene as never,
      camera: {} as never,
      output: 'depth',
      renderer: {
        render: (current) => {
          const material = current.overrideMaterial
          renders.push(material && 'type' in material ? material.type : 'color')
        },
        domElement: { toDataURL: () => 'data:depth' },
      },
    })
    expect(url).toBe('data:depth')
    expect(renders[0]).toBe('MeshDepthMaterial')
    expect(renders[1]).toBe('color')
    expect(scene.overrideMaterial).toBeNull()
    expect(scene.background).toBe('sky')
    expect(scene.objects.map(item => item.visible)).toEqual([true, true])
  })

  it('白模用灰模材质，读像素失败也会还原', () => {
    const scene = sceneWith(['preview-omit'])
    const renderer = {
      render: vi.fn(),
      domElement: {
        toDataURL: () => {
          throw new Error('tainted')
        },
      },
    }
    expect(() => renderPreviewPass({
      scene: scene as never,
      camera: {} as never,
      output: 'matte',
      renderer: renderer as never,
    })).toThrow('tainted')
    expect(renderer.render).toHaveBeenCalledTimes(2)
    expect(scene.overrideMaterial).toBeNull()
    expect(scene.background).toBe('sky')
    expect(scene.objects[0]!.visible).toBe(true)
  })
})
