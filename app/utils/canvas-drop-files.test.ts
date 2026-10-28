import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_DROP_MAX,
  canvasMediaFilesFromList,
  canvasMediaKindFromFile,
} from './canvas-drop-files'

function file(name: string, type: string) {
  return new File(['x'], name, { type })
}

describe('canvasMediaKindFromFile', () => {
  it('认 MIME，没有 MIME 时认扩展名', () => {
    expect(canvasMediaKindFromFile(file('a.png', 'image/png'))).toBe('image')
    expect(canvasMediaKindFromFile(file('b.mp4', 'video/mp4'))).toBe('video')
    expect(canvasMediaKindFromFile(file('c.mp3', 'audio/mpeg'))).toBe('audio')
    expect(canvasMediaKindFromFile(file('shot.jpg', ''))).toBe('image')
    expect(canvasMediaKindFromFile(file('notes.txt', 'text/plain'))).toBeNull()
  })
})

describe('canvasMediaFilesFromList', () => {
  it('丢掉不能上画布的类型，并截到上限', () => {
    const files = [
      file('a.txt', 'text/plain'),
      file('b.png', 'image/png'),
      file('c.mp4', 'video/mp4'),
      ...Array.from({ length: CANVAS_DROP_MAX }, (_, i) => file(`${i}.png`, 'image/png')),
    ]
    const picked = canvasMediaFilesFromList(files)
    expect(picked.every(item => canvasMediaKindFromFile(item))).toBe(true)
    expect(picked).toHaveLength(CANVAS_DROP_MAX)
    expect(picked[0]!.name).toBe('b.png')
  })
})

describe('画布接线', () => {
  it('粘贴没有信封时走文件，拖放落到 addAssetNodeAt', () => {
    const src = readFileSync('app/components/canvas/CanvasWorkspace.vue', 'utf8')
    expect(src).toContain('canvasMediaFilesFromDataTransfer')
    expect(src).toContain('placeDroppedFiles')
    expect(src).toContain('addAssetNodeAt')
    expect(src).toContain('@drop="onCanvasDrop"')
  })
})
