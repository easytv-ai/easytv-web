/**
 * 姿势面板的滑块表（复刻自 open-director 的 CharacterPanel.tsx，MIT）。
 *
 * 键要和 mannequin-rig.ts 里读的控制量名对得上，写错了滑块会静默失效 ——
 * 拖了没反应，也不报错。旁边的 pose-controls.test.ts 就是拿这张表逐条
 * 验有没有真的传到骨骼上。
 */

export interface PoseControl {
  key: string
  /** i18n key 即中文原文 */
  label: string
}

export interface PoseControlGroup {
  title: string
  controls: PoseControl[]
}

/** 角度上限，和 mannequin-rig 的 getPoseLimit 对齐（体型更小的会再收紧） */
export const POSE_CONTROL_RANGE = { min: -90, max: 90, step: 1 } as const

/**
 * 骨盆上下，单位米。不放进上面的角度表：那些滑块都是 -90° 到 90°，
 * 这一项是 -1 到 1，混进去拖了会对不上骨骼。
 * 负值往下蹲（跪下、投掷预设用的就是这个），正值把人抬起来。
 */
export const BODY_OFFSET_Y_CONTROL = { key: 'body.offsetY', label: '蹲下高度' } as const
export const BODY_OFFSET_Y_RANGE = { min: -1, max: 1, step: 0.01 } as const

export const POSE_CONTROL_GROUPS: PoseControlGroup[] = [
  {
    title: '身体',
    controls: [
      { key: 'body.pitch', label: '前倾' },
      { key: 'body.yaw', label: '转身' },
      { key: 'body.roll', label: '侧倾' },
    ],
  },
  {
    title: '躯干',
    controls: [
      { key: 'torso.pitch', label: '前倾' },
      { key: 'torso.yaw', label: '扭转' },
      { key: 'torso.roll', label: '侧倾' },
    ],
  },
  {
    title: '头部',
    controls: [
      { key: 'head.pitch', label: '点头' },
      { key: 'head.yaw', label: '转头' },
      { key: 'head.roll', label: '歪头' },
    ],
  },
  {
    title: '左肩',
    controls: [
      { key: 'leftShoulder.pitch', label: '前举' },
      { key: 'leftShoulder.spread', label: '外展' },
      { key: 'leftShoulder.twist', label: '扭转' },
    ],
  },
  {
    title: '右肩',
    controls: [
      { key: 'rightShoulder.pitch', label: '前举' },
      { key: 'rightShoulder.spread', label: '外展' },
      { key: 'rightShoulder.twist', label: '扭转' },
    ],
  },
  { title: '左肘', controls: [{ key: 'leftElbow.bend', label: '弯曲' }] },
  { title: '右肘', controls: [{ key: 'rightElbow.bend', label: '弯曲' }] },
  {
    title: '左髋',
    controls: [
      { key: 'leftHip.pitch', label: '前抬' },
      { key: 'leftHip.spread', label: '外展' },
      { key: 'leftHip.twist', label: '扭转' },
    ],
  },
  {
    title: '右髋',
    controls: [
      { key: 'rightHip.pitch', label: '前抬' },
      { key: 'rightHip.spread', label: '外展' },
      { key: 'rightHip.twist', label: '扭转' },
    ],
  },
  { title: '左膝', controls: [{ key: 'leftKnee.bend', label: '弯曲' }] },
  { title: '右膝', controls: [{ key: 'rightKnee.bend', label: '弯曲' }] },
  {
    title: '左手',
    controls: [
      { key: 'leftHand.pitch', label: '点头' },
      { key: 'leftHand.roll', label: '翻滚' },
      { key: 'leftHand.twist', label: '扭转' },
    ],
  },
  {
    title: '右手',
    controls: [
      { key: 'rightHand.pitch', label: '点头' },
      { key: 'rightHand.roll', label: '翻滚' },
      { key: 'rightHand.twist', label: '扭转' },
    ],
  },
  {
    title: '左脚',
    controls: [
      { key: 'leftFoot.pitch', label: '点头' },
      { key: 'leftFoot.roll', label: '翻滚' },
      { key: 'leftFoot.twist', label: '扭转' },
    ],
  },
  {
    title: '右脚',
    controls: [
      { key: 'rightFoot.pitch', label: '点头' },
      { key: 'rightFoot.roll', label: '翻滚' },
      { key: 'rightFoot.twist', label: '扭转' },
    ],
  },
]
