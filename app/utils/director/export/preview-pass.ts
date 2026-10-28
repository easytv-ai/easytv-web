/**
 * 深度 / 白模这一帧。换掉场景材质再渲一帧，读完像素立刻还原彩色画面。
 * 不上传、不落节点、不提交生成。
 *
 * 名叫 preview-omit 的物体（地面、网格、全景球）在这一帧里藏起来，
 * 不然整张图会被地板或天空填满。
 */
import { Color, MeshDepthMaterial, MeshStandardMaterial, type Camera, type Scene } from 'three'

export type PreviewOutput = 'color' | 'depth' | 'matte'
export type PreviewControlOutput = 'depth' | 'matte'

/** 时间轴三档：彩色走原来的截图，深度和白模走这里 */
export function previewOutputFromMode(mode: string): PreviewOutput {
  if (mode === 'depth' || mode === 'matte')
    return mode
  return 'color'
}

export const PREVIEW_OMIT_NAME = 'preview-omit'

export function renderPreviewPass(input: {
  renderer: {
    render: (scene: Scene, camera: Camera) => void
    domElement: { toDataURL: (type: string) => string }
  }
  scene: Scene
  camera: Camera
  output: PreviewControlOutput
}): string {
  const previousMaterial = input.scene.overrideMaterial
  const previousBackground = input.scene.background
  const hidden: { visible: boolean, object: { visible: boolean } }[] = []
  const material = input.output === 'depth'
    ? new MeshDepthMaterial()
    : new MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.95, metalness: 0 })

  try {
    input.scene.traverse((obj) => {
      if (obj.name !== PREVIEW_OMIT_NAME || !obj.visible)
        return
      hidden.push({ object: obj, visible: true })
      obj.visible = false
    })
    input.scene.overrideMaterial = material
    input.scene.background = new Color(input.output === 'depth' ? 0x000000 : 0x111111)
    input.renderer.render(input.scene, input.camera)
    return input.renderer.domElement.toDataURL('image/png')
  }
  finally {
    input.scene.overrideMaterial = previousMaterial
    input.scene.background = previousBackground
    for (const item of hidden)
      item.object.visible = true
    material.dispose()
    input.renderer.render(input.scene, input.camera)
  }
}
