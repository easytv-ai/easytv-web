/**
 * AI 导演助手的指令层（复刻自 open-director 的 agent/directorCommands.ts，MIT）。
 *
 * 模型只输出一个 JSON 指令数组，真正动场景的是这里。让模型直接写代码或直接改
 * 状态都不可控，指令表把它能做的事限定成一张白名单。
 *
 * 和上游两处结构性差异：
 * - 上游的执行器直接抓全局单例 store。我们的 store 是工厂（一张画布可以有多个
 *   导演台），所以 store 是参数传进来的。
 * - 给模型看的指令说明由同一份常量生成，不是另写一段文字。分开写的话，
 *   代码里加了姿势而说明里没加，模型永远不会用到它，且没有任何报错。
 */
import { POSE_PRESET_IDS, GEOMETRY_PRIMITIVE_OPTIONS } from '../schema'
import type { CharacterBodyType, GeometryPrimitiveType, PosePresetId, ViewMode } from '../schema'
import { BODY_TYPE_OPTIONS } from '../body-types'
import { getLookAtQuaternion } from '../camera-path'
import { createDefaultDirectorProject } from '../default-project'
import { degreesToRadians } from '../number-field'
import type { DirectorStore } from '../store'
import type { CameraPlaybackStore } from '../playback/store'

export interface DirectorCommand {
  action: string
  args?: Record<string, unknown>
}

export interface CommandContext {
  store: DirectorStore
  playback: CameraPlaybackStore
}

export const AVAILABLE_BODY_TYPES = BODY_TYPE_OPTIONS.map(item => item.bodyType)
export const AVAILABLE_GEOMETRY_TYPES = GEOMETRY_PRIMITIVE_OPTIONS.map(item => item.type)

/** 指令说明里列举取值时用，避免手写一遍列表 */
function quoteList(values: readonly string[]) {
  return values.map(value => `"${value}"`).join('|')
}

/**
 * 给模型看的指令说明。
 *
 * 取值列表全部从常量生成 —— 手抄一份的话，代码里加了姿势而说明里漏了，
 * 模型永远不会用到它，而且不会有任何报错。旁边的测试逐条核对说明里
 * 列出的 action 和执行器认识的 action 是同一批。
 */
export const COMMAND_DOCS = `
可用指令（每次输出一个 JSON 数组，元素为 {"action": "...", "args": {...}}）：
1. add_character：args {"body_type": ${quoteList(AVAILABLE_BODY_TYPES)}, "name": "自定义名"}
2. add_geometry：args {"geometry_type": ${quoteList(AVAILABLE_GEOMETRY_TYPES)}, "name": "自定义名"}
3. add_camera：args {"name": "自定义名", "position": [x,y,z], "target": [x,y,z], "fov": 45}
4. move_object：args {"name": "对象名", "position": [x,y,z]}
5. rotate_object：args {"name": "对象名", "rotation_degrees": [x,y,z]}
6. scale_object：args {"name": "对象名", "scale": 1.5}
7. set_pose：args {"name": "角色名", "pose": ${quoteList(POSE_PRESET_IDS)}}
8. set_active_camera：args {"name": "机位名"}
9. switch_view：args {"view": "director"|"camera"}
10. look_at：args {"name": "机位名", "position": [x,y,z], "target": [x,y,z], "fov": 45}（让机位从 position 看向 target）
11. record_shot：args {"name": "机位名", "position": [x,y,z], "target": [x,y,z], "fov": 45}（给机位记一个运镜节点）
12. play / pause / stop：args 为空
13. set_playhead：args {"time": 3.5}
14. delete_object：args {"name": "对象名"}
15. rename_object：args {"name": "对象名", "new_name": "新名字"}
16. set_color：args {"name": "对象名", "color": "#ff0000"}
17. clear_scene：args 为空（清空所有角色和机位）
18. undo：args 为空
19. explain：args {"message": "说明文字"}（请求超出能力时用，不做任何操作）

规则：
- 对象名一律用中文（如「女主角」「机位A」）
- "对象名"必须是场景摘要里列出的准确名称，否则找不到
- 坐标 [x,y,z]，y 是垂直方向，地面 y=0；角色身高约 1.8，机位高度建议 1.5~1.8
- 一次可以输出多条指令，按顺序执行
- 录运镜（record_shot）至少输出 2 条且 position 必须不同，才能形成路径
- 请求超出能力范围（生成完整影片、复杂动画、需要外部素材）时，只输出一条 explain 说明原因，不要用别的指令硬凑
- 只输出 JSON 数组本身，不要加任何解释性文字
`.trim()

/** 场景摘要：告诉模型现在场上有什么，它才知道该用哪个名字 */
export function buildSceneSummary(store: DirectorStore): string {
  const project = store.project.value
  const lines: string[] = ['当前场景：']

  for (const object of project.objects) {
    // 机位对象在下面单独列，这里跳过，免得同一台机位出现两遍
    if (object.kind === 'camera')
      continue
    const position = object.transform.position.map(value => Math.round(value * 100) / 100)
    const body = object.bodyType ? ` ${object.bodyType}` : ''
    lines.push(`- ${object.name}（${object.kind}${body}）位置 ${JSON.stringify(position)}`)
  }

  for (const camera of project.cameras) {
    const position = camera.transform.position.map(value => Math.round(value * 100) / 100)
    const target = camera.target.map(value => Math.round(value * 100) / 100)
    const active = camera.id === project.activeCameraId ? '，当前机位' : ''
    lines.push(`- ${camera.name}（机位）位置 ${JSON.stringify(position)} 看向 ${JSON.stringify(target)}${active}`)
  }

  if (project.objects.length === 0 && project.cameras.length === 0)
    lines.push('（空场景）')

  return lines.join('\n')
}

function findObject(store: DirectorStore, name: string) {
  const objects = store.project.value.objects
  // 先精确匹配再模糊：模型常把「角色01」写成「角色」，但精确名字必须优先
  return objects.find(item => item.name === name) ?? objects.find(item => item.name.includes(name))
}

function findCamera(store: DirectorStore, name: string) {
  const cameras = store.project.value.cameras
  return cameras.find(item => item.name === name) ?? cameras.find(item => item.name.includes(name))
}

function asVec3(value: unknown): [number, number, number] {
  if (Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item)))
    return [value[0], value[1], value[2]]
  throw new Error('position / target 必须是三个数字组成的数组')
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** 刚加进场景的那个对象 —— 加对象的动作不返回 id，只能对比前后差集 */
function findAddedObjectId(store: DirectorStore, idsBefore: string[]) {
  const before = new Set(idsBefore)
  return store.project.value.objects.find(item => !before.has(item.id))?.id ?? ''
}

/** 只读导演台还能看、播，不能改场景 */
const READONLY_OK = new Set(['explain', 'play', 'pause', 'stop', 'set_playhead', 'set_active_camera', 'switch_view'])

function requireWritable(store: DirectorStore) {
  if (store.readonly.value)
    throw new Error('只读画布不能修改')
}

function requireAdded(id: string) {
  if (!id)
    throw new Error('只读画布不能修改')
}

function requireUnlocked(object: { locked?: boolean } | undefined) {
  if (object?.locked)
    throw new Error('锁定')
}

function cameraObject(store: DirectorStore, cameraId: string) {
  return store.project.value.objects.find(item => item.linkedCameraId === cameraId)
}

/** 执行一条指令，返回给用户看的一行结果 */
export function execCommand(context: CommandContext, command: DirectorCommand): string {
  const { store, playback } = context
  if (!READONLY_OK.has(command.action))
    requireWritable(store)

  switch (command.action) {
    case 'add_character': {
      const bodyType = asString(command.args?.body_type, 'mannequin') as CharacterBodyType
      if (!AVAILABLE_BODY_TYPES.includes(bodyType))
        throw new Error(`不认识的体型：${bodyType}`)

      const before = store.project.value.objects.map(item => item.id)
      store.addPresetCharacter(bodyType)
      const id = findAddedObjectId(store, before)
      requireAdded(id)
      const name = asString(command.args?.name)
      if (name) {
        store.updateObjectName(id, name)
        return `已添加角色「${name}」`
      }
      return '已添加角色'
    }

    case 'add_geometry': {
      const geometryType = asString(command.args?.geometry_type) as GeometryPrimitiveType
      if (!AVAILABLE_GEOMETRY_TYPES.includes(geometryType))
        throw new Error(`不认识的几何体：${geometryType}`)

      const before = store.project.value.objects.map(item => item.id)
      store.addGeometryPrimitive(geometryType)
      const id = findAddedObjectId(store, before)
      requireAdded(id)
      const name = asString(command.args?.name)
      if (name) {
        store.updateObjectName(id, name)
        return `已添加几何体「${name}」`
      }
      return '已添加几何体'
    }

    case 'add_camera': {
      const name = asString(command.args?.name)
      store.addCameraShot({
        position: asVec3(command.args?.position ?? [3, 1.7, 5]),
        target: asVec3(command.args?.target ?? [0, 1, 0]),
        fov: asNumber(command.args?.fov, 45),
        name: name || undefined,
      })
      return name ? `已添加机位「${name}」` : '已添加机位'
    }

    case 'move_object': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到对象「${name}」`)
      requireUnlocked(object)
      const position = asVec3(command.args?.position)
      store.updateObjectTransform(object.id, { position })
      return `已把「${object.name}」移到 ${JSON.stringify(position)}`
    }

    case 'rotate_object': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到对象「${name}」`)
      requireUnlocked(object)
      const degrees = asVec3(command.args?.rotation_degrees ?? [0, 0, 0])
      store.updateObjectTransform(object.id, {
        rotation: [
          degreesToRadians(degrees[0]),
          degreesToRadians(degrees[1]),
          degreesToRadians(degrees[2]),
        ],
      })
      return `已旋转「${object.name}」`
    }

    case 'scale_object': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到对象「${name}」`)
      requireUnlocked(object)
      const scale = asNumber(command.args?.scale, 1)
      store.updateUniformScale(object.id, scale)
      return `已把「${object.name}」缩放到 ${scale} 倍`
    }

    case 'set_pose': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到角色「${name}」`)
      requireUnlocked(object)
      const pose = asString(command.args?.pose)
      if (!POSE_PRESET_IDS.includes(pose as PosePresetId))
        throw new Error(`不认识的姿势：${pose}`)
      store.applyPosePreset(object.id, pose as PosePresetId)
      return `「${object.name}」已摆成 ${pose}`
    }

    case 'set_active_camera': {
      const name = asString(command.args?.name)
      const camera = findCamera(store, name)
      if (!camera)
        throw new Error(`找不到机位「${name}」`)
      store.setActiveCamera(camera.id)
      return `已切到机位「${camera.name}」`
    }

    case 'switch_view': {
      const view = asString(command.args?.view) as ViewMode
      if (view !== 'director' && view !== 'camera')
        throw new Error(`不认识的视角：${view}`)
      store.setViewMode(view)
      return view === 'camera' ? '已切到机位视角' : '已切到导演视角'
    }

    case 'look_at':
    case 'record_shot': {
      const name = asString(command.args?.name)
      const camera = findCamera(store, name)
      if (!camera)
        throw new Error(`找不到机位「${name}」`)
      requireUnlocked(cameraObject(store, camera.id))

      const position = asVec3(command.args?.position ?? camera.transform.position)
      const target = asVec3(command.args?.target ?? camera.target)
      const fov = asNumber(command.args?.fov, camera.fov)

      if (command.action === 'look_at') {
        store.updateCamera(camera.id, {
          transform: { ...camera.transform, position },
          target,
          fov,
        })
        return `机位「${camera.name}」已对准目标`
      }

      const quaternion = getLookAtQuaternion(position, target)
      store.recordCameraNode(camera.id, {
        position,
        rotation: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
        fov,
      })
      return `机位「${camera.name}」已记一个运镜节点`
    }

    case 'play':
      playback.play()
      return '开始播放运镜'

    case 'pause':
      playback.pause()
      return '已暂停'

    case 'stop':
      playback.stop()
      return '已停止'

    case 'set_playhead': {
      const time = asNumber(command.args?.time, 0)
      playback.setPlayheadTime(time)
      return `播放头移到 ${time} 秒`
    }

    case 'delete_object': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到对象「${name}」`)
      requireUnlocked(object)
      store.selectObject(object.id)
      store.deleteSelectedObject()
      return `已删除「${object.name}」`
    }

    case 'rename_object': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到对象「${name}」`)
      requireUnlocked(object)
      const newName = asString(command.args?.new_name)
      if (!newName)
        throw new Error('缺少 new_name')
      store.updateObjectName(object.id, newName)
      return `已把「${object.name}」改名为「${newName}」`
    }

    case 'set_color': {
      const name = asString(command.args?.name)
      const object = findObject(store, name)
      if (!object)
        throw new Error(`找不到对象「${name}」`)
      requireUnlocked(object)
      const color = asString(command.args?.color, '#ffffff')
      store.updateObjectColor(object.id, color)
      return `「${object.name}」颜色已改成 ${color}`
    }

    case 'clear_scene':
      store.replaceProject(createDefaultDirectorProject())
      return '场景已清空'

    case 'undo':
      store.undo()
      return '已撤销上一步'

    case 'explain':
      return asString(command.args?.message, '（没有说明）')

    default:
      throw new Error(`不认识的指令：${command.action}`)
  }
}

export interface ExecResult {
  /** 每条指令一行结果，失败的那条前面带感叹号 */
  lines: string[]
  succeeded: number
  failed: number
}

/**
 * 整批执行，算一步撤销。
 *
 * 单条失败不中断后面的 —— 模型输出五条错一条，另外四条照样有价值，
 * 让用户看到哪条错了比整批回滚更有用。
 *
 * 批次一定要关掉：上游只在「至少成功过一条」时才 endUndoBatch，全部失败时
 * 批次就一直开着，用户之后的所有改动都会被吞进这个没关上的批次里。
 */
export function execCommands(context: CommandContext, commands: DirectorCommand[]): ExecResult {
  const lines: string[] = []
  let succeeded = 0
  let failed = 0

  context.store.beginBatch()
  try {
    for (const command of commands) {
      try {
        lines.push(execCommand(context, command))
        succeeded += 1
      }
      catch (error) {
        lines.push(`⚠️ ${error instanceof Error ? error.message : String(error)}`)
        failed += 1
      }
    }
  }
  finally {
    context.store.endBatch()
  }

  return { lines, succeeded, failed }
}
