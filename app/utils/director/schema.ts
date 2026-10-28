/**
 * 导演台的数据模型（复刻自 open-director 的 schema/，MIT）。
 *
 * 这一层是纯类型和常量，不碰 three、不碰 Vue，方便在 store、组件和以后的
 * 服务端序列化之间共用。整份 DirectorProject 就是一个导演台节点的全部内容，
 * 能直接 JSON 化存起来。
 */

export type ViewMode = 'director' | 'camera'
export type RightPanelKind = 'scene' | 'character' | 'prop' | 'camera'
export type DirectorObjectKind = 'character' | 'scene' | 'prop' | 'camera' | 'panorama'

/** 可直接丢进场景的基础几何体 */
export const GEOMETRY_PRIMITIVE_OPTIONS = [
  { type: 'box', label: '立方体' },
  { type: 'sphere', label: '球体' },
  { type: 'cylinder', label: '圆柱体' },
  { type: 'torus', label: '环状体' },
  { type: 'cone', label: '圆锥' },
  { type: 'pyramid', label: '棱锥' },
] as const

export type GeometryPrimitiveType = (typeof GEOMETRY_PRIMITIVE_OPTIONS)[number]['type']

export type CharacterRigType = 'mannequin' | 'ue4-mannequin' | 'mixamo' | 'vrm' | 'custom-humanoid'

export type CharacterBodyType =
  | 'mannequin'
  | 'female'
  | 'broad'
  | 'muscular'
  | 'slim'
  | 'teen'
  | 'child'
  | 'chibi'

export type DirectorAssetKind = 'character' | 'scene' | 'prop' | 'panorama'
export type DirectorAssetSource = 'local' | 'library'
/** equirectangular 贴成球形环境，backdrop 只当远景背景板 */
export type PanoramaProjectionMode = 'equirectangular' | 'backdrop'

export interface DirectorTransform {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export interface SceneSettings {
  scale: number
  position: [number, number, number]
  rotation: [number, number, number]
  backgroundColor: string
  panoramaYaw: number
  panoramaRadius: number
  showLabels: boolean
  snapToGrid: boolean
  showGround: boolean
  groundOpacity: number
  groundHeight: number
}

export interface CharacterRigState {
  rigType: CharacterRigType
  posePresetId: string | null
  /** 骨骼控制量，键是控制器名，值是归一化后的角度 */
  controls: Record<string, number>
}

/** 导入的模型 / 图片，按 id 被场景对象引用 */
export interface DirectorAssetRef {
  id: string
  kind: DirectorAssetKind
  sourceType: 'model' | 'image'
  fileName: string
  name?: string
  url: string
  assetSource?: DirectorAssetSource
  projectionMode?: PanoramaProjectionMode
}

export interface DirectorObject {
  id: string
  name: string
  kind: DirectorObjectKind
  visible: boolean
  locked: boolean
  transform: DirectorTransform
  bodyType?: CharacterBodyType
  color?: string
  assetRefId?: string
  /** 投到角色正面上半身的形象图（素体和导入 GLB 同一套），指向 assets 里 sourceType=image 的那条 */
  lookAssetId?: string
  geometryType?: GeometryPrimitiveType
  /** 群众阵列：同一个 crowdId 的对象整体当一组操作 */
  crowdId?: string
  crowdLabel?: string
  linkedCameraId?: string | null
  characterRig?: CharacterRigState
}

export interface DirectorCameraCapture {
  id: string
  index: number
  name: string
  dataUrl: string
}

/**
 * 运镜节点：掌镜时按 K 记录下的一个相机姿态。
 * rotation 存四元数 [x, y, z, w]，欧拉角插值会有歧义。
 */
export interface CameraNode {
  id: string
  position: [number, number, number]
  rotation: [number, number, number, number]
  fov: number
  /** 时间轴位置（秒），也就是这个节点出段的起始时间，由时间轴拖拽维护 */
  time: number
}

export type CameraSegmentCurveMode = 'linear' | 'bezier'
export type CameraSegmentEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

/**
 * 相邻两个运镜节点之间的一段运动。
 * duration 是运动时长，holdAfter 是到终点后停住的时长，两者之和决定下一个节点的时间：
 * node[i+1].time = node[i].time + duration + holdAfter
 */
export interface CameraSegment {
  id: string
  fromNodeId: string
  toNodeId: string
  curveMode: CameraSegmentCurveMode
  duration: number
  holdAfter: number
  easing: CameraSegmentEasing
  handleOut?: [number, number, number]
  handleIn?: [number, number, number]
}

export interface DirectorCameraShot {
  id: string
  name: string
  fov: number
  transform: DirectorTransform
  targetMode: 'manual' | 'object'
  targetObjectId?: string | null
  target: [number, number, number]
  lastCaptureUrl?: string | null
  captures?: DirectorCameraCapture[]
  /** 运镜路径节点，空表示这个机位还没记过运镜 */
  nodes?: CameraNode[]
  /** 节点之间的运动段，和 nodes 同步；缺失时按节点时间现推 */
  segments?: CameraSegment[]
}

/** 一个导演台节点的完整场景，可直接 JSON 序列化 */
export interface DirectorProject {
  version: 1
  scene: SceneSettings
  assets: DirectorAssetRef[]
  objects: DirectorObject[]
  cameras: DirectorCameraShot[]
  activeCameraId: string | null
  panoramaAssetId: string | null
}

/** 内置姿势，和 runtime 里的骨骼预设一一对应 */
export const POSE_PRESET_IDS = [
  'stand',
  't-pose',
  'walk',
  'run',
  'sit',
  'crouch',
  'kneel-one',
  'kneel-two',
  'hands-on-hips',
  'lean',
  'bow',
  'think',
  'fight',
  'kick',
  'throw',
  'push',
  'wave',
  'reach',
  'cross-arms',
  'phone',
] as const

export type PosePresetId = (typeof POSE_PRESET_IDS)[number]

/** 取景框比例；auto 表示跟着视口自身大小走 */
export const VIEWPORT_ASPECT_RATIO_OPTIONS = [
  { id: 'auto', label: '自动', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '2:1', label: '2:1', value: 2 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '4:3', label: '4:3', value: 4 / 3 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '21:9', label: '21:9', value: 21 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
] as const

export type ViewportAspectRatio = (typeof VIEWPORT_ASPECT_RATIO_OPTIONS)[number]['id']

export function getViewportAspectRatioValue(ratio: ViewportAspectRatio) {
  return VIEWPORT_ASPECT_RATIO_OPTIONS.find(option => option.id === ratio)?.value ?? null
}

/** 对象名字标签浮在模型顶端上方多少米 */
export const VIEWPORT_OBJECT_LABEL_VERTICAL_GAP = 0.18
