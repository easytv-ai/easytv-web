import { describe, expect, it } from 'vitest'
import {
  ANGLE_PRESETS,
  buildAnglePrompt,
  clampAngle,
  cubeTransform,
  dragCube,
  shortestDegrees,
} from './canvas-angle'

describe('clampAngle', () => {
  it('夹在上下限内', () => {
    expect(clampAngle(-10, 0, 360)).toBe(0)
    expect(clampAngle(400, 0, 360)).toBe(360)
    expect(clampAngle(40, 0, 360)).toBe(40)
  })
})

describe('shortestDegrees', () => {
  it('收到短弧', () => {
    expect(shortestDegrees(332)).toBe(-28)
    expect(shortestDegrees(-28)).toBe(-28)
    expect(shortestDegrees(180)).toBe(180)
    expect(shortestDegrees(0)).toBe(0)
  })
})

describe('cubeTransform', () => {
  it('平视时也带默认立体朝向', () => {
    expect(cubeTransform(0, 0)).toBe('rotateX(-22deg) rotateY(-32deg)')
  })

  it('俯视朝向顶面，仰视朝向底面', () => {
    const high = cubeTransform(12, 46)
    const low = cubeTransform(-8, -68)
    expect(high).toBe('rotateX(-68deg) rotateY(-20deg)')
    expect(low).toBe('rotateX(46deg) rotateY(-40deg)')
  })

  it('3/4 与侧面转到左面', () => {
    expect(cubeTransform(58, -6)).toBe('rotateX(-16deg) rotateY(26deg)')
    expect(cubeTransform(110, -10)).toBe('rotateX(-12deg) rotateY(78deg)')
  })
})

describe('dragCube', () => {
  it('横向拖动改旋转，纵向拖动改倾斜', () => {
    const next = dragCube(0, 0, 20, 10)
    expect(next.rotate).toBeGreaterThan(0)
    expect(next.tilt).toBeGreaterThan(0)
  })
})

describe('buildAnglePrompt', () => {
  it('带上机位说明和角度', () => {
    const preset = ANGLE_PRESETS.find(item => item.id === 'three-quarter')
    const text = buildAnglePrompt({
      preset,
      rotate: 58,
      tilt: -6,
      note: '三分之四侧面',
    })
    expect(text).toContain('新机位')
    expect(text).toContain('三分之四侧面')
    expect(text).toContain('58°')
    expect(text).toContain('-6°')
  })

  it('虫眼负数倾斜不会被夹成 0', () => {
    const preset = ANGLE_PRESETS.find(item => item.id === 'worm')
    const text = buildAnglePrompt({
      preset,
      rotate: preset!.rotate,
      tilt: preset!.tilt,
      note: '',
    })
    expect(text).toContain('-76°')
  })

  it('没有手写说明时用预设 note', () => {
    const preset = ANGLE_PRESETS[0]
    const text = buildAnglePrompt({
      preset,
      rotate: 0,
      tilt: 0,
      note: '',
    })
    expect(text).toContain(preset!.note)
  })

  it('机位封面是公用静态图', () => {
    const ids = ANGLE_PRESETS.map(item => item.id)
    expect(ids).toEqual(['eye', 'high', 'low', 'three-quarter', 'side', 'bird', 'fisheye', 'worm', 'wide'])
    for (const item of ANGLE_PRESETS) {
      expect(item.cover).toMatch(/^\/images\/canvas-angle\/.+\.webp$/)
    }
  })
})
