import { describe, expect, it } from 'vitest'
import { createDefaultDirectorProject, createTransform } from './default-project'
import { getSceneOverviewPose, getVisibleOverviewObjects } from './scene-overview'
import type { DirectorObject } from './schema'

function character(id: string, x: number, z: number): DirectorObject {
  return {
    id,
    name: id,
    kind: 'character',
    visible: true,
    locked: false,
    transform: createTransform([x, 0, z]),
  }
}

describe('getSceneOverviewPose', () => {
  it('空场退回默认机位', () => {
    const pose = getSceneOverviewPose([])
    expect(pose.position[0]).toBeGreaterThan(0)
    expect(pose.target[2]).toBe(3)
  })

  it('人散开时相机会拉远，目标落在人群中间', () => {
    const tight = getSceneOverviewPose(createDefaultDirectorProject().objects)
    const wide = getSceneOverviewPose([
      character('a', -6, 0),
      character('b', 6, 0),
      character('c', 0, 8),
    ])
    const tightDist = Math.hypot(
      tight.position[0] - tight.target[0],
      tight.position[1] - tight.target[1],
      tight.position[2] - tight.target[2],
    )
    const wideDist = Math.hypot(
      wide.position[0] - wide.target[0],
      wide.position[1] - wide.target[1],
      wide.position[2] - wide.target[2],
    )
    expect(wideDist).toBeGreaterThan(tightDist)
    expect(wide.target[0]).toBeCloseTo(0, 5)
  })

  it('看不见的和全景不参与取景', () => {
    expect(getVisibleOverviewObjects([
      { ...character('a', 0, 0), visible: false },
      { ...character('b', 1, 0), kind: 'panorama' },
      character('c', 2, 0),
    ]).map(item => item.id)).toEqual(['c'])
  })
})
