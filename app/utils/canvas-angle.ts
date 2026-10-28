export type AnglePreset = {
  id: string
  label: string
  cover: string
  /** 水平旋转，度。0 正面，90 右侧 */
  rotate: number
  /** 俯仰，度。正数俯视，负数仰视 */
  tilt: number
  note: string
}

// 封面放在 /images/canvas-angle：public 下不能有 canvas 目录，否则静态服务把 /canvas 301 到 /canvas/
export const ANGLE_PRESETS: AnglePreset[] = [
  { id: 'eye', label: '平视', cover: '/images/canvas-angle/angle-eye.webp', rotate: 0, tilt: 0, note: '平视机位，镜头与主体视线齐平，构图端正' },
  { id: 'high', label: '俯视', cover: '/images/canvas-angle/angle-high.webp', rotate: 12, tilt: 46, note: '俯视机位，从斜上方看向主体，略压低地平线' },
  { id: 'low', label: '仰视', cover: '/images/canvas-angle/angle-low.webp', rotate: -8, tilt: -68, note: '仰视机位，从下方仰拍主体，显得更高大' },
  { id: 'three-quarter', label: '3/4 视角', cover: '/images/canvas-angle/angle-three-quarter.webp', rotate: 58, tilt: -6, note: '三分之四侧面，同时看到正面和侧面轮廓' },
  { id: 'side', label: '侧面', cover: '/images/canvas-angle/angle-side.webp', rotate: 110, tilt: -10, note: '正侧面，轮廓清晰，身体朝向画面一侧' },
  { id: 'bird', label: '鸟瞰', cover: '/images/canvas-angle/angle-bird.webp', rotate: 14, tilt: 64, note: '高角度鸟瞰，从上往下看整个主体' },
  { id: 'fisheye', label: '鱼眼', cover: '/images/canvas-angle/angle-fisheye.webp', rotate: 0, tilt: 0, note: '鱼眼镜头，画面边缘明显弯曲，中央突出，超广视野' },
  { id: 'worm', label: '虫眼', cover: '/images/canvas-angle/angle-worm.webp', rotate: -10, tilt: -76, note: '虫视角，贴地仰拍，主体显得巨大，地面纹理清晰' },
  { id: 'wide', label: '广角', cover: '/images/canvas-angle/angle-wide.webp', rotate: 24, tilt: -14, note: '广角镜头，视野更宽，近大远小更强，空间纵深感明显' },
]

export const ANGLE_ROTATE_MIN = -180
export const ANGLE_ROTATE_MAX = 180
export const ANGLE_TILT_MIN = -80
export const ANGLE_TILT_MAX = 80
/** 立方体默认 3/4 朝向：0° 平视时也能看出立体，而不是正对一张图 */
export const ANGLE_CUBE_PITCH = -22
export const ANGLE_CUBE_YAW = -32
export const ANGLE_DRAG_SENS = 0.48

export function clampAngle(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return min
  return Math.min(max, Math.max(min, value))
}

/** 把角度收到 [-180, 180]，缩略图预览用短弧，避免 332° 拧过头 */
export function shortestDegrees(value: number) {
  if (!Number.isFinite(value))
    return 0
  const n = ((value % 360) + 360) % 360
  return n > 180 ? n - 360 : n
}

export function cubeTransform(rotate: number, tilt: number) {
  const pitch = ANGLE_CUBE_PITCH - clampAngle(tilt, ANGLE_TILT_MIN, ANGLE_TILT_MAX)
  const yaw = ANGLE_CUBE_YAW + shortestDegrees(rotate)
  return `rotateX(${pitch}deg) rotateY(${yaw}deg)`
}

export function dragCube(rotate: number, tilt: number, dx: number, dy: number) {
  return {
    rotate: clampAngle(rotate + dx * ANGLE_DRAG_SENS, ANGLE_ROTATE_MIN, ANGLE_ROTATE_MAX),
    tilt: clampAngle(tilt + dy * ANGLE_DRAG_SENS, ANGLE_TILT_MIN, ANGLE_TILT_MAX),
  }
}

export function buildAnglePrompt(opts: {
  preset?: AnglePreset | null
  rotate: number
  tilt: number
  note: string
}) {
  const parts = ['基于这张图生成同一个主体的新机位画面，保持外观、服装、风格和身份一致']
  const note = opts.note.trim() || opts.preset?.note || ''
  if (note)
    parts.push(note)
  const rotate = Math.round(clampAngle(opts.rotate, ANGLE_ROTATE_MIN, ANGLE_ROTATE_MAX))
  const tilt = Math.round(clampAngle(opts.tilt, ANGLE_TILT_MIN, ANGLE_TILT_MAX))
  parts.push(`镜头水平旋转 ${rotate}°，倾斜 ${tilt}°`)
  return `${parts.join('。')}。`
}
