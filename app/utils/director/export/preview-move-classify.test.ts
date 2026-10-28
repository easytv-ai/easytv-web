import { Euler, Quaternion } from 'three'
import { describe, expect, it } from 'vitest'
import type { CameraNode } from '../schema'
import { classifyPreviewMoves, classifyPreviewShotMove, previewShotPromptsFromPath } from './preview-move-classify'

function pose(
  id: string,
  position: [number, number, number],
  yaw = 0,
  extras?: { pitch?: number, fov?: number, roll?: number },
): CameraNode {
  const q = new Quaternion().setFromEuler(new Euler(extras?.pitch ?? 0, yaw, extras?.roll ?? 0, 'YXZ'))
  return {
    id,
    time: 0,
    position,
    rotation: [q.x, q.y, q.z, q.w],
    fov: extras?.fov ?? 50,
  }
}

describe('从运镜路径认出推、横移、升降、摇、停', () => {
  it('没有节点是空的；只有一个节点算固定镜头', () => {
    expect(classifyPreviewMoves({ nodes: [] })).toEqual([])
    expect(classifyPreviewMoves({ nodes: [pose('a', [0, 0, 0])] })).toEqual([{ moves: ['static'] }])
  })

  it('沿视线往前走是前推，往回走是后移', () => {
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0]), pose('b', [0, 0, -2]))).toEqual(['dolly-in'])
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0]), pose('b', [0, 0, 2]))).toEqual(['dolly-out'])
  })

  it('原地左转是左摇，右转是右摇', () => {
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0.4))).toEqual(['pan-left'])
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], -0.4))).toEqual(['pan-right'])
  })

  it('几乎不动算停', () => {
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0]), pose('b', [0.02, 0, 0], 0.01))).toEqual(['static'])
  })

  it('横着走是左移或右移，上下走是抬升或下降', () => {
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0]), pose('b', [2, 0, 0]))).toEqual(['truck-right'])
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0]), pose('b', [-2, 0, 0]))).toEqual(['truck-left'])
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0]), pose('b', [0, 2, 0]))).toEqual(['crane-up'])
    expect(classifyPreviewShotMove(pose('a', [0, 2, 0]), pose('b', [0, 0, 0]))).toEqual(['crane-down'])
    expect(classifyPreviewShotMove(pose('a', [0, 0, 0], Math.PI / 2), pose('b', [0, 0, -2], Math.PI / 2))).toEqual(['truck-right'])
  })

  it('又移又升时两句都留下，并写成提示词', () => {
    const camera = {
      nodes: [pose('a', [0, 0, 0]), pose('b', [2, 2, 0])],
    }
    expect(classifyPreviewMoves(camera)).toEqual([{ moves: ['truck-right', 'crane-up'] }])
    expect(previewShotPromptsFromPath(camera)).toEqual(['中景，24mm，镜头右移，镜头抬升'])
  })

  it('又推又转时两句都留下，并写成提示词', () => {
    const camera = {
      nodes: [pose('a', [0, 0, 0]), pose('b', [0, 0, -2], 0.4)],
    }
    expect(classifyPreviewMoves(camera)).toEqual([{ moves: ['dolly-in', 'pan-left'] }])
    expect(previewShotPromptsFromPath(camera)).toEqual(['中景，24mm，镜头前推，镜头左摇'])
  })

  it('抬头是上摇，低头是下摇', () => {
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0, { pitch: 0.4 }))).toEqual(['tilt-up'])
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0, { pitch: -0.4 }))).toEqual(['tilt-down'])
  })

  it('fov 变小是变焦推进，变大是拉远', () => {
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0, { fov: 30 }))).toEqual(['zoom-in'])
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0], 0, { fov: 30 }), pose('b', [0, 1, 0], 0, { fov: 70 }))).toEqual(['zoom-out'])
  })

  it('右移同时左摇写成环绕，不再拆成横移加摇', () => {
    const camera = {
      nodes: [pose('a', [0, 0, 5]), pose('b', [2, 0, 5], 0.4)],
    }
    expect(classifyPreviewMoves(camera)).toEqual([{ moves: ['orbit'] }])
    expect(previewShotPromptsFromPath(camera)).toEqual(['中景，24mm，环绕拍摄'])
  })

  it('前推同时拉远写成柯克变焦，后移同时推近也是', () => {
    const inOut = {
      nodes: [pose('a', [0, 0, 0], 0, { fov: 50 }), pose('b', [0, 0, -2], 0, { fov: 70 })],
    }
    const outIn = {
      nodes: [pose('a', [0, 0, 0], 0, { fov: 50 }), pose('b', [0, 0, 2], 0, { fov: 30 })],
    }
    expect(classifyPreviewMoves(inOut)).toEqual([{ moves: ['dolly-zoom'] }])
    expect(previewShotPromptsFromPath(inOut)).toEqual(['中景，24mm，柯克变焦，推进同时拉远焦距'])
    expect(classifyPreviewMoves(outIn)).toEqual([{ moves: ['dolly-zoom'] }])
    expect(previewShotPromptsFromPath(outIn)).toEqual(['中景，24mm，柯克变焦，推进同时拉远焦距'])
    expect(classifyPreviewShotMove(
      pose('a', [0, 0, 0], 0, { fov: 50 }),
      pose('b', [0, 0, -2], 0, { fov: 30 }),
    )).toEqual(['dolly-in', 'zoom-in'])
  })

  it('环绕同时升降写成盘旋，不再拆成环绕加升降', () => {
    const up = {
      nodes: [pose('a', [0, 0, 5]), pose('b', [2, 2, 5], 0.4)],
    }
    const down = {
      nodes: [pose('a', [0, 2, 5]), pose('b', [2, 0, 5], 0.4)],
    }
    expect(classifyPreviewMoves(up)).toEqual([{ moves: ['spiral-up'] }])
    expect(previewShotPromptsFromPath(up)).toEqual(['中景，24mm，盘旋抬升，镜头环绕上升'])
    expect(classifyPreviewMoves(down)).toEqual([{ moves: ['spiral-down'] }])
    expect(previewShotPromptsFromPath(down)).toEqual(['中景，24mm，盘旋下降，镜头环绕下落'])
  })

  it('原地绕视线转写成滚筒旋转，微转仍算停', () => {
    const camera = {
      nodes: [pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0, { roll: 0.4 })],
    }
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0, { roll: 0.4 }))).toEqual(['roll'])
    expect(classifyPreviewShotMove(pose('a', [0, 1, 0]), pose('b', [0, 1, 0], 0, { roll: 0.02 }))).toEqual(['static'])
    expect(previewShotPromptsFromPath(camera)).toEqual(['中景，24mm，滚筒旋转'])
  })

  it('前推同时滚转两句都留下', () => {
    expect(classifyPreviewShotMove(
      pose('a', [0, 0, 0]),
      pose('b', [0, 0, -2], 0, { roll: 0.4 }),
    )).toEqual(['dolly-in', 'roll'])
  })

  it('窄 fov 写成近景加 35mm，宽 fov 写成全景加 14mm', () => {
    expect(previewShotPromptsFromPath({
      nodes: [pose('a', [0, 0, 0], 0, { fov: 35 }), pose('b', [0, 0, -2], 0, { fov: 35 })],
    })).toEqual(['近景，35mm，镜头前推'])
    expect(previewShotPromptsFromPath({
      nodes: [pose('a', [0, 0, 0], 0, { fov: 70 }), pose('b', [0, 0, 0], 0, { fov: 70 })],
    })).toEqual(['全景，14mm，固定镜头，机位保持稳定'])
  })
})
