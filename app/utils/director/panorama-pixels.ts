/**
 * 全景图的像素修补（复刻自 open-director 的 loaders/panoramaImport.ts，MIT）。
 *
 * 等距柱状全景贴到球面上有两处天然的破绽：
 * - **接缝**：图片最左列和最右列在球面上是挨着的，两边对不上就会出现一条竖线
 * - **极点**：顶边和底边在球面上各收缩成一个点，那一整行的像素被挤在一起，
 *   颜色不一致就会在天顶和地面看到扭曲的漩涡
 *
 * 这里三个函数分别处理：融合接缝、柔化极点、把接缝挪到画面里最不显眼的位置。
 * 全是纯函数（进一个像素数组出一个新的），和导演台无关，
 * 画布上已有的全景节点也能直接用。
 */

/** 取某一行的平均颜色，作为极点的收敛色 */
function averageRowColor(pixels: Uint8ClampedArray, width: number, row: number) {
  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0

  for (let x = 0; x < width; x++) {
    const index = (row * width + x) * 4
    red += pixels[index] ?? 0
    green += pixels[index + 1] ?? 0
    blue += pixels[index + 2] ?? 0
    alpha += pixels[index + 3] ?? 0
  }

  return [
    Math.round(red / width),
    Math.round(green / width),
    Math.round(blue / width),
    Math.round(alpha / width),
  ] as const
}

/**
 * 融合左右接缝：把两侧各 seamWidth 列往中间值靠，越靠近边缘靠得越狠。
 * 最边上一列直接取两侧平均，往里逐渐还原成原色，所以不会糊掉一大片。
 */
export function blendPanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamWidth: number,
) {
  const next = new Uint8ClampedArray(pixels)
  const maxDistance = Math.max(1, seamWidth - 1)

  for (let y = 0; y < height; y++) {
    for (let distance = 0; distance < seamWidth; distance++) {
      const leftIndex = (y * width + distance) * 4
      const rightIndex = (y * width + (width - 1 - distance)) * 4
      const blend = distance / maxDistance

      for (let channel = 0; channel < 4; channel++) {
        const left = pixels[leftIndex + channel] ?? 0
        const right = pixels[rightIndex + channel] ?? 0
        const averaged = Math.round((left + right) / 2)
        next[leftIndex + channel] = Math.round(averaged + (left - averaged) * blend)
        next[rightIndex + channel] = Math.round(averaged + (right - averaged) * blend)
      }
    }
  }

  return next
}

/**
 * 柔化上下极点：顶边和底边各 poleBlendHeight 行往该处的平均色收敛。
 * 混合曲线用 1.35 次幂而不是线性 —— 极点附近收得更快，离开极点后迅速还原，
 * 线性的话会把天空糊掉一大片。
 */
export function softenPanoramaPolePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  poleBlendHeight: number,
) {
  const next = new Uint8ClampedArray(pixels)
  const topReferenceRow = Math.min(height - 1, poleBlendHeight)
  const bottomReferenceRow = Math.max(0, height - 1 - poleBlendHeight)
  const topPoleColor = averageRowColor(pixels, width, topReferenceRow)
  const bottomPoleColor = averageRowColor(pixels, width, bottomReferenceRow)
  const maxDistance = Math.max(1, poleBlendHeight - 1)

  for (let y = 0; y < poleBlendHeight; y++) {
    const blend = (y / maxDistance) ** 1.35

    for (let x = 0; x < width; x++) {
      const topIndex = (y * width + x) * 4
      const bottomIndex = ((height - 1 - y) * width + x) * 4

      for (let channel = 0; channel < 4; channel++) {
        const topOriginal = pixels[topIndex + channel] ?? 0
        const bottomOriginal = pixels[bottomIndex + channel] ?? 0
        const topPole = topPoleColor[channel]!
        const bottomPole = bottomPoleColor[channel]!
        next[topIndex + channel] = Math.round(topPole + (topOriginal - topPole) * blend)
        next[bottomIndex + channel] = Math.round(bottomPole + (bottomOriginal - bottomPole) * blend)
      }
    }
  }

  return next
}

/** 某一列和它左邻列的颜色差总和，越大说明这里的画面变化越剧烈 */
function getColumnTransitionScore(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamColumn: number,
) {
  // 上下各让开 8%：极点附近本来就扭曲，算进去会干扰判断
  const topGuard = Math.max(0, Math.min(height - 1, Math.round(height * 0.08)))
  const bottomGuard = Math.max(topGuard + 1, height - topGuard)
  let score = 0

  for (let y = topGuard; y < bottomGuard; y++) {
    const leftIndex = (y * width + (seamColumn - 1)) * 4
    const rightIndex = (y * width + seamColumn) * 4

    score += Math.abs((pixels[leftIndex] ?? 0) - (pixels[rightIndex] ?? 0))
    score += Math.abs((pixels[leftIndex + 1] ?? 0) - (pixels[rightIndex + 1] ?? 0))
    score += Math.abs((pixels[leftIndex + 2] ?? 0) - (pixels[rightIndex + 2] ?? 0))
    score += Math.abs((pixels[leftIndex + 3] ?? 255) - (pixels[rightIndex + 3] ?? 255))
  }

  return score
}

function normalizeSeamColumn(seamColumn: number, width: number) {
  if (width <= 0)
    return 0
  return ((Math.round(seamColumn) % width) + width) % width
}

/**
 * 找画面里最平坦的一列当接缝位置。
 * 接缝挪到一片纯色的天空或墙面上，比留在人脸或建筑边缘不显眼得多。
 */
export function findLowestEnergySeamColumn(pixels: Uint8ClampedArray, width: number, height: number) {
  if (width <= 1)
    return 0

  let bestColumn = 1
  let bestScore = Number.POSITIVE_INFINITY

  for (let seamColumn = 1; seamColumn < width; seamColumn++) {
    const score = getColumnTransitionScore(pixels, width, height, seamColumn)
    if (score < bestScore) {
      bestScore = score
      bestColumn = seamColumn
    }
  }

  return bestColumn
}

/** 把整张图横向循环平移，让指定列成为新的左边缘（也就是接缝所在处） */
export function relocatePanoramaSeamPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seamColumn = findLowestEnergySeamColumn(pixels, width, height),
) {
  const normalizedSeam = normalizeSeamColumn(seamColumn, width)
  if (normalizedSeam === 0)
    return new Uint8ClampedArray(pixels)

  const next = new Uint8ClampedArray(pixels.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = (x + normalizedSeam) % width
      const sourceIndex = (y * width + sourceX) * 4
      const targetIndex = (y * width + x) * 4

      next[targetIndex] = pixels[sourceIndex] ?? 0
      next[targetIndex + 1] = pixels[sourceIndex + 1] ?? 0
      next[targetIndex + 2] = pixels[sourceIndex + 2] ?? 0
      next[targetIndex + 3] = pixels[sourceIndex + 3] ?? 255
    }
  }

  return next
}
