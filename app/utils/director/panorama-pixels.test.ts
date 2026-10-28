import { describe, expect, it } from 'vitest'
import {
  blendPanoramaSeamPixels,
  findLowestEnergySeamColumn,
  relocatePanoramaSeamPixels,
  softenPanoramaPolePixels,
} from './panorama-pixels'

/** 造一张纯色图，再按需要改某些列/行 */
function makeImage(width: number, height: number, fill: [number, number, number, number] = [0, 0, 0, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = fill[0]
    pixels[i * 4 + 1] = fill[1]
    pixels[i * 4 + 2] = fill[2]
    pixels[i * 4 + 3] = fill[3]
  }
  return pixels
}

function setColumn(pixels: Uint8ClampedArray, width: number, height: number, x: number, color: [number, number, number, number]) {
  for (let y = 0; y < height; y++) {
    const index = (y * width + x) * 4
    pixels[index] = color[0]
    pixels[index + 1] = color[1]
    pixels[index + 2] = color[2]
    pixels[index + 3] = color[3]
  }
}

function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number) {
  const index = (y * width + x) * 4
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]]
}

describe('接缝融合', () => {
  it('最边上一列取两侧平均，左右因此对齐', () => {
    // 左边全黑右边全白，贴到球面上就是一条硬边
    const width = 8
    const height = 4
    const pixels = makeImage(width, height, [0, 0, 0, 255])
    setColumn(pixels, width, height, width - 1, [255, 255, 255, 255])

    const next = blendPanoramaSeamPixels(pixels, width, height, 3)

    expect(pixelAt(next, width, 0, 0)[0]).toBe(128)
    expect(pixelAt(next, width, width - 1, 0)[0]).toBe(128)
  })

  it('往里逐渐还原原色，不会糊掉一大片', () => {
    const width = 8
    const height = 2
    const pixels = makeImage(width, height, [0, 0, 0, 255])
    setColumn(pixels, width, height, width - 1, [255, 255, 255, 255])

    const next = blendPanoramaSeamPixels(pixels, width, height, 3)

    // 第 3 列（距离边缘 2，也就是 seamWidth-1）应该完全是原色
    expect(pixelAt(next, width, 2, 0)[0]).toBe(0)
  })

  it('不改动原数组', () => {
    const width = 4
    const pixels = makeImage(width, 2, [10, 20, 30, 255])
    const copy = new Uint8ClampedArray(pixels)
    blendPanoramaSeamPixels(pixels, width, 2, 2)

    expect(pixels).toEqual(copy)
  })
})

describe('极点柔化', () => {
  it('顶行收敛到该处平均色', () => {
    // 顶部一行左黑右白，球面上会挤成一个漩涡
    const width = 4
    const height = 6
    const pixels = makeImage(width, height, [100, 100, 100, 255])
    for (let x = 0; x < width; x++) {
      const index = x * 4
      pixels[index] = x < 2 ? 0 : 200
    }

    const next = softenPanoramaPolePixels(pixels, width, height, 3)
    const topRow = [0, 1, 2, 3].map(x => pixelAt(next, width, x, 0)[0]!)

    // 整行被拉到同一个值，漩涡消失
    expect(new Set(topRow).size).toBe(1)
  })

  it('中间行完全不受影响', () => {
    const width = 4
    const height = 10
    const pixels = makeImage(width, height, [100, 100, 100, 255])
    setColumn(pixels, width, height, 1, [7, 7, 7, 255])

    const next = softenPanoramaPolePixels(pixels, width, height, 3)

    expect(pixelAt(next, width, 1, 5)[0]).toBe(7)
  })
})

describe('接缝选位', () => {
  it('挑变化最小的一列', () => {
    const width = 6
    const height = 4
    const pixels = makeImage(width, height, [50, 50, 50, 255])
    // 在第 2 列制造一道剧烈跳变，接缝应该躲开它
    setColumn(pixels, width, height, 2, [250, 250, 250, 255])

    const seam = findLowestEnergySeamColumn(pixels, width, height)

    expect(seam).not.toBe(2)
    expect(seam).not.toBe(3)
  })

  it('宽度不足时返回 0', () => {
    expect(findLowestEnergySeamColumn(makeImage(1, 4), 1, 4)).toBe(0)
  })
})

describe('接缝平移', () => {
  it('指定列成为新的左边缘', () => {
    const width = 4
    const height = 1
    const pixels = makeImage(width, height)
    for (let x = 0; x < width; x++)
      setColumn(pixels, width, height, x, [x * 10, 0, 0, 255])

    const next = relocatePanoramaSeamPixels(pixels, width, height, 2)

    expect(pixelAt(next, width, 0, 0)[0]).toBe(20)
    expect(pixelAt(next, width, 1, 0)[0]).toBe(30)
    // 循环回绕
    expect(pixelAt(next, width, 2, 0)[0]).toBe(0)
    expect(pixelAt(next, width, 3, 0)[0]).toBe(10)
  })

  it('负数或超出宽度的列号会归一化', () => {
    const width = 4
    const pixels = makeImage(width, 1)
    for (let x = 0; x < width; x++)
      setColumn(pixels, width, 1, x, [x * 10, 0, 0, 255])

    expect(pixelAt(relocatePanoramaSeamPixels(pixels, width, 1, -2), width, 0, 0)[0]).toBe(20)
    expect(pixelAt(relocatePanoramaSeamPixels(pixels, width, 1, 6), width, 0, 0)[0]).toBe(20)
  })

  it('列号为 0 时原样返回一份副本', () => {
    const width = 4
    const pixels = makeImage(width, 1, [9, 9, 9, 255])
    const next = relocatePanoramaSeamPixels(pixels, width, 1, 0)

    expect(next).toEqual(pixels)
    expect(next).not.toBe(pixels)
  })
})
