/**
 * 新建导演台时的默认场景（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 单独拆出来是因为它不依赖 store 的任何状态，schema 的测试和以后的服务端
 * 序列化都要用；放在 store 里会绕出一圈循环依赖。
 */
import { DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT, getCameraRigPositionFromViewSnapshot } from './camera-geometry'
import type {
  CharacterBodyType,
  DirectorCameraShot,
  DirectorObject,
  DirectorProject,
  DirectorTransform,
  SceneSettings,
} from './schema'

export const DEFAULT_CHARACTER_BODY_TYPE: CharacterBodyType = 'mannequin'

/** 新场景的初始参数：天空 #000000 表示跟站点亮/暗主题走，半透明地面方便看站位 */
export const DEFAULT_SCENE: SceneSettings = {
  scale: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  backgroundColor: '#000000',
  panoramaYaw: 0,
  panoramaRadius: 60,
  showLabels: true,
  snapToGrid: false,
  showGround: true,
  groundOpacity: 0.4,
  groundHeight: 0,
}

export function createTransform(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): DirectorTransform {
  return { position, rotation, scale }
}

/** 场景里的对象统一叫「角色01」「机位02」这种两位数编号 */
export function formatSceneItemName(prefix: '角色' | '机位', index: number) {
  return `${prefix}${String(index).padStart(2, '0')}`
}

/**
 * 一个能直接用的空场景：一个角色站在原点，一台机位对着他。
 * 上游这里还会读 localStorage 里存过的本地模型，我们的场景要接后端，
 * 那部分留到阶段 6 再处理。
 */
export function createDefaultDirectorProject(): DirectorProject {
  const camera: DirectorCameraShot = {
    id: 'cam_1',
    name: formatSceneItemName('机位', 1),
    fov: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.fov,
    transform: createTransform(getCameraRigPositionFromViewSnapshot(DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT)),
    targetMode: 'manual',
    target: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.target,
    lastCaptureUrl: null,
    captures: [],
  }

  const role: DirectorObject = {
    id: 'char_default_a',
    name: formatSceneItemName('角色', 1),
    kind: 'character',
    visible: true,
    locked: false,
    bodyType: DEFAULT_CHARACTER_BODY_TYPE,
    color: '#4F8EF7',
    transform: createTransform([0, 0, 0]),
    characterRig: {
      rigType: 'ue4-mannequin',
      posePresetId: 'stand',
      controls: {},
    },
  }

  // 机位在场景树里还有个同名的可选中对象，拖它就等于拖机位
  const cameraObject: DirectorObject = {
    id: 'cam_object_1',
    name: camera.name,
    kind: 'camera',
    visible: true,
    locked: false,
    linkedCameraId: camera.id,
    transform: camera.transform,
  }

  return {
    version: 1,
    scene: DEFAULT_SCENE,
    assets: [],
    objects: [role, cameraObject],
    cameras: [camera],
    activeCameraId: camera.id,
    panoramaAssetId: null,
  }
}
