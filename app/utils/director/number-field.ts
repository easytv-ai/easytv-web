/**
 * 面板数字输入的取值规则（复刻自 open-director 的 InspectorControls.tsx，MIT）。
 *
 * 显示精度、夹取、拖动增量这几件事，数字框、轴输入、滑块三处都要用同一套，
 * 各写一份迟早对不齐（同一个值在两个框里显示成 1.2 和 1.20），所以抽在这里。
 */

/** 一个像素一步太灵敏，十个像素一步手感接近 Blender */
export const AXIS_DRAG_PIXELS_PER_STEP = 10

/** step 是 0.1 就留一位小数，0.01 留两位；整数 step 不留 */
export function precisionOfStep(step: number): number {
  const decimal = String(step).match(/\.(\d+)/)
  return decimal ? decimal[1]!.length : 0
}

/** 小数位再多显示也没意义，浮点误差反而会漏出来（0.1+0.2 那种） */
export function formatFieldValue(value: number, precision: number): string {
  if (!Number.isFinite(value))
    return ''
  // toFixed 之后再过一次 Number：去掉 1.20 这种没意义的尾零
  return String(Number(value.toFixed(Math.min(Math.max(precision, 0), 6))))
}

export function clampFieldValue(value: number, min?: number, max?: number): number {
  const lower = min === undefined ? value : Math.max(min, value)
  return max === undefined ? lower : Math.min(max, lower)
}

/**
 * 拖动位移换算成新值。
 *
 * 按「起点 + 总位移」算而不是每次事件累加：累加的话每帧的取整误差会攒起来，
 * 拖出去再拖回来回不到原值。
 */
export function valueAfterDrag(options: {
  startValue: number
  deltaPixels: number
  step: number
  min?: number
  max?: number
}): number {
  const { startValue, deltaPixels, step, min, max } = options
  const steps = Math.round(deltaPixels / AXIS_DRAG_PIXELS_PER_STEP)
  const raw = startValue + steps * (step > 0 ? step : 1)
  // 乘完再按精度收一次：0.1 步长连加会出 0.30000000000000004
  const precision = precisionOfStep(step)
  const rounded = Number(raw.toFixed(Math.min(precision + 2, 10)))
  return clampFieldValue(rounded, min, max)
}

/**
 * 面板里的角度一律显示成度，存的是弧度。
 *
 * 上游的旋转输入框直接显示弧度，用户看到的是 0.785 这种数 —— 想转 45°
 * 得自己心算。转换只发生在显示层，store 里存的还是三的弧度。
 */
export function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI
}

export function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}
