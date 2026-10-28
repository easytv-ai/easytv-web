import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { LOOK_PLATE_NAME, getLookProjectionLayout, lookSurfaceUv, setMannequinLookPlate } from './mannequin'

describe('setMannequinLookPlate', () => {
  it('把形象投到素体材质上，去掉时卸掉', () => {
    const scene = new Group()
    const material = new MeshStandardMaterial()
    const body = new Mesh(new BoxGeometry(0.5, 1.8, 0.3), material)
    body.position.set(0, 0.9, 0)
    scene.add(body)

    setMannequinLookPlate(scene, new Texture())
    expect(material.userData.directorLook).toBeTruthy()
    expect(material.customProgramCacheKey()).toBe('director-look-v2')

    setMannequinLookPlate(scene, null)
    expect(material.userData.directorLook).toBeFalsy()
    expect(material.customProgramCacheKey()).toBe('')
  })

  it('投影框盖住上半身', () => {
    const scene = new Group()
    const body = new Mesh(new BoxGeometry(0.5, 1.8, 0.3), new MeshStandardMaterial())
    body.position.set(0, 0.9, 0)
    scene.add(body)

    const layout = getLookProjectionLayout(scene)
    expect(layout.center[1]).toBeGreaterThan(1.1)
    expect(layout.size[0]).toBeGreaterThan(0.5)
    expect(layout.size[1]).toBeGreaterThan(0.6)
  })

  it('以前那张悬浮牌会卸掉', () => {
    const scene = new Group()
    const plate = new Mesh(new BoxGeometry(0.2, 0.2, 0.01))
    plate.name = LOOK_PLATE_NAME
    scene.add(plate)

    setMannequinLookPlate(scene, null)
    expect(scene.getObjectByName(LOOK_PLATE_NAME)).toBeUndefined()
  })

  it('正面贴在胸口，侧面错开，背面不出图', () => {
    const center = [0, 1.35, 0] as const
    const front = lookSurfaceUv([0, 1.4, 0.2], 1, center, 0.9)
    const left = lookSurfaceUv([-0.2, 1.4, 0.2], 0.7, center, 0.9)
    const right = lookSurfaceUv([0.2, 1.4, 0.2], 0.7, center, 0.9)
    const back = lookSurfaceUv([0, 1.4, -0.2], -1, center, 0.9)

    expect(front.u).toBeCloseTo(0.5, 2)
    expect(front.weight).toBeGreaterThan(0.9)
    expect(left.u).toBeLessThan(front.u)
    expect(right.u).toBeGreaterThan(front.u)
    expect(left.weight).toBeGreaterThan(0.5)
    expect(right.weight).toBeGreaterThan(0.5)
    expect(back.weight).toBe(0)
  })

  it('空场景也能卸，不会抛', () => {
    const scene = new Group()
    expect(() => setMannequinLookPlate(scene, null)).not.toThrow()
  })
})

describe('导入角色形象接线', () => {
  it('导入模型吃 lookUrl，角色面板不再把形象藏起来', () => {
    const imported = readFileSync(new URL('../../components/canvas/director/DirectorImportedModel.vue', import.meta.url), 'utf8')
    const objectNode = readFileSync(new URL('../../components/canvas/director/DirectorObjectNode.vue', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../../components/canvas/director/panels/DirectorCharacterPanel.vue', import.meta.url), 'utf8')
    expect(imported).toContain('lookUrl')
    expect(imported).toContain('setMannequinLookPlate')
    expect(objectNode).toContain(':look-url="isCharacter ? lookUrl : undefined"')
    expect(panel).toContain(':title="t(\'形象\')"')
    expect(panel).not.toContain('!selection.role.assetRefId')
  })
})
