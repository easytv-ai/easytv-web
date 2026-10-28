import { describe, expect, it } from 'vitest'
import {
  AVAILABLE_BODY_TYPES,
  AVAILABLE_GEOMETRY_TYPES,
  buildSceneSummary,
  COMMAND_DOCS,
  execCommand,
  execCommands,
  type CommandContext,
} from './commands'
import { createDirectorStore } from '../store'
import { createCameraPlaybackStore } from '../playback/store'
import { POSE_PRESET_IDS } from '../schema'

function makeContext(): CommandContext {
  return { store: createDirectorStore(), playback: createCameraPlaybackStore() }
}

/** 指令说明里编号列出的 action 名 */
function documentedActions(): string[] {
  return [...COMMAND_DOCS.matchAll(/^\d+\.\s*([a-z_ /]+)：/gm)]
    .flatMap(match => match[1]!.split('/').map(item => item.trim()))
    .filter(Boolean)
}

describe('COMMAND_DOCS 与执行器保持一致', () => {
  it('说明里写的每条指令执行器都认识 —— 否则模型会用一条永远失败的指令', () => {
    const context = makeContext()
    for (const action of documentedActions()) {
      // 认识的指令不会报「不认识的指令」，参数不对报别的错没关系
      let message = ''
      try {
        execCommand(context, { action })
      }
      catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message, action).not.toContain('不认识的指令')
    }
  })

  it('体型和几何体的取值直接从常量生成，不会和代码里的对不上', () => {
    for (const bodyType of AVAILABLE_BODY_TYPES)
      expect(COMMAND_DOCS).toContain(`"${bodyType}"`)
    for (const geometry of AVAILABLE_GEOMETRY_TYPES)
      expect(COMMAND_DOCS).toContain(`"${geometry}"`)
  })

  it('姿势列表覆盖全部内置姿势', () => {
    for (const pose of POSE_PRESET_IDS)
      expect(COMMAND_DOCS).toContain(`"${pose}"`)
  })
})

describe('buildSceneSummary', () => {
  it('列出角色和机位，机位只出现一次', () => {
    const context = makeContext()
    const summary = buildSceneSummary(context.store)

    expect(summary).toContain('角色01')
    // 机位在 objects 和 cameras 里各有一份，摘要里不该重复
    expect(summary.match(/机位01/g)).toHaveLength(1)
    expect(summary).toContain('当前机位')
  })

  it('新加的对象会出现在摘要里', () => {
    const context = makeContext()
    execCommand(context, { action: 'add_geometry', args: { geometry_type: 'box', name: '箱子' } })
    expect(buildSceneSummary(context.store)).toContain('箱子')
  })
})

describe('execCommand', () => {
  it('加角色并改名', () => {
    const context = makeContext()
    const result = execCommand(context, { action: 'add_character', args: { body_type: 'female', name: '女主角' } })

    expect(result).toContain('女主角')
    expect(context.store.project.value.objects.some(item => item.name === '女主角')).toBe(true)
  })

  it('体型不认识时报错，不会悄悄用默认值建一个', () => {
    const context = makeContext()
    const before = context.store.project.value.objects.length
    expect(() => execCommand(context, { action: 'add_character', args: { body_type: 'dragon' } })).toThrow('不认识的体型')
    expect(context.store.project.value.objects).toHaveLength(before)
  })

  it('加机位', () => {
    const context = makeContext()
    execCommand(context, {
      action: 'add_camera',
      args: { name: '侧机位', position: [4, 1.7, 0], target: [0, 1, 0], fov: 35 },
    })
    expect(context.store.project.value.cameras.some(item => item.name === '侧机位')).toBe(true)
  })

  it('移动对象', () => {
    const context = makeContext()
    execCommand(context, { action: 'move_object', args: { name: '角色01', position: [2, 0, -1] } })
    const object = context.store.project.value.objects.find(item => item.name === '角色01')!
    expect(object.transform.position).toEqual([2, 0, -1])
  })

  it('对象名模糊匹配，但精确名字优先', () => {
    const context = makeContext()
    execCommand(context, { action: 'add_character', args: { name: '角色' } })

    // 场上同时有「角色01」和「角色」，传「角色」要命中那个精确的
    execCommand(context, { action: 'move_object', args: { name: '角色', position: [9, 0, 0] } })
    const exact = context.store.project.value.objects.find(item => item.name === '角色')!
    const other = context.store.project.value.objects.find(item => item.name === '角色01')!
    expect(exact.transform.position).toEqual([9, 0, 0])
    expect(other.transform.position).not.toEqual([9, 0, 0])
  })

  it('旋转的参数是度，存进去是弧度', () => {
    const context = makeContext()
    execCommand(context, { action: 'rotate_object', args: { name: '角色01', rotation_degrees: [0, 90, 0] } })
    const object = context.store.project.value.objects.find(item => item.name === '角色01')!
    expect(object.transform.rotation[1]).toBeCloseTo(Math.PI / 2, 10)
  })

  it('摆姿势', () => {
    const context = makeContext()
    execCommand(context, { action: 'set_pose', args: { name: '角色01', pose: 'sit' } })
    const object = context.store.project.value.objects.find(item => item.name === '角色01')!
    expect(object.characterRig?.posePresetId).toBe('sit')
  })

  it('姿势不认识时报错', () => {
    const context = makeContext()
    expect(() => execCommand(context, { action: 'set_pose', args: { name: '角色01', pose: 'moonwalk' } }))
      .toThrow('不认识的姿势')
  })

  it('找不到对象时报错，报错里带上模型给的名字', () => {
    const context = makeContext()
    expect(() => execCommand(context, { action: 'move_object', args: { name: '不存在的人', position: [0, 0, 0] } }))
      .toThrow('不存在的人')
  })

  it('坐标不是三个数字时报错', () => {
    const context = makeContext()
    expect(() => execCommand(context, { action: 'move_object', args: { name: '角色01', position: [1, 2] } }))
      .toThrow('三个数字')
    expect(() => execCommand(context, { action: 'move_object', args: { name: '角色01', position: ['a', 'b', 'c'] } }))
      .toThrow('三个数字')
  })

  it('record_shot 记运镜节点', () => {
    const context = makeContext()
    execCommand(context, { action: 'record_shot', args: { name: '机位01', position: [3, 1.7, 5], target: [0, 1, 0] } })
    execCommand(context, { action: 'record_shot', args: { name: '机位01', position: [-3, 1.7, 5], target: [0, 1, 0] } })

    const camera = context.store.project.value.cameras[0]!
    expect(camera.nodes).toHaveLength(2)
  })

  it('播放控制走 playback store', () => {
    const context = makeContext()
    execCommand(context, { action: 'play' })
    expect(context.playback.isPlaying.value).toBe(true)
    execCommand(context, { action: 'set_playhead', args: { time: 2 } })
    expect(context.playback.playheadTime.value).toBe(2)
    execCommand(context, { action: 'stop' })
    expect(context.playback.isPlaying.value).toBe(false)
    expect(context.playback.playheadTime.value).toBe(0)
  })

  it('删除对象', () => {
    const context = makeContext()
    execCommand(context, { action: 'delete_object', args: { name: '角色01' } })
    expect(context.store.project.value.objects.some(item => item.name === '角色01')).toBe(false)
  })

  it('清空场景回到默认', () => {
    const context = makeContext()
    execCommand(context, { action: 'add_character', args: { name: '路人' } })
    execCommand(context, { action: 'clear_scene' })
    expect(context.store.project.value.objects.some(item => item.name === '路人')).toBe(false)
  })

  it('explain 不动场景，只把话带回来', () => {
    const context = makeContext()
    const before = JSON.stringify(context.store.project.value)
    const message = execCommand(context, { action: 'explain', args: { message: '做不到，因为需要外部素材' } })

    expect(message).toBe('做不到，因为需要外部素材')
    expect(JSON.stringify(context.store.project.value)).toBe(before)
  })

  it('不认识的指令报错', () => {
    expect(() => execCommand(makeContext(), { action: 'launch_rocket' })).toThrow('不认识的指令')
  })

  it('锁定对象不能移动 / 删除 / 改名', () => {
    const context = makeContext()
    const object = context.store.project.value.objects.find(item => item.name === '角色01')!
    context.store.toggleObjectsLocked([object.id])
    const before = [...object.transform.position]

    expect(() => execCommand(context, { action: 'move_object', args: { name: '角色01', position: [2, 0, -1] } }))
      .toThrow('锁定')
    expect(context.store.project.value.objects.find(item => item.id === object.id)!.transform.position).toEqual(before)
    expect(() => execCommand(context, { action: 'delete_object', args: { name: '角色01' } }))
      .toThrow('锁定')
    expect(context.store.project.value.objects.some(item => item.id === object.id)).toBe(true)
  })

  it('只读导演台不能改场景，播放和 explain 还能用', () => {
    const store = createDirectorStore(undefined, { readonly: true })
    const context = { store, playback: createCameraPlaybackStore() }
    const before = store.project.value.objects.length

    expect(() => execCommand(context, { action: 'add_character', args: { body_type: 'female', name: '女主角' } }))
      .toThrow('只读画布不能修改')
    expect(store.project.value.objects).toHaveLength(before)
    expect(execCommand(context, { action: 'explain', args: { message: '看就好' } })).toBe('看就好')
    expect(execCommand(context, { action: 'play' })).toContain('播放')
  })
})

describe('execCommands', () => {
  it('整批算一步撤销', () => {
    const context = makeContext()
    const before = context.store.project.value.objects.length

    execCommands(context, [
      { action: 'add_character', args: { name: 'A' } },
      { action: 'add_character', args: { name: 'B' } },
      { action: 'add_geometry', args: { geometry_type: 'box' } },
    ])
    expect(context.store.project.value.objects).toHaveLength(before + 3)

    context.store.undo()
    expect(context.store.project.value.objects).toHaveLength(before)
  })

  it('单条失败不中断后面的', () => {
    const context = makeContext()
    const result = execCommands(context, [
      { action: 'add_character', args: { name: 'A' } },
      { action: 'move_object', args: { name: '查无此人', position: [0, 0, 0] } },
      { action: 'add_character', args: { name: 'B' } },
    ])

    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.lines[1]).toContain('⚠️')
    expect(context.store.project.value.objects.some(item => item.name === 'B')).toBe(true)
  })

  it('全部失败时批次也要关掉 —— 不然之后所有改动都被吞进这个没关上的批次', () => {
    const context = makeContext()
    execCommands(context, [
      { action: 'launch_rocket' },
      { action: 'move_object', args: { name: '查无此人', position: [0, 0, 0] } },
    ])

    // 批次没关上的话，下面这两步会被合进去，撤销一次就全没了
    execCommands(context, [{ action: 'add_character', args: { name: 'A' } }])
    execCommands(context, [{ action: 'add_character', args: { name: 'B' } }])

    context.store.undo()
    expect(context.store.project.value.objects.some(item => item.name === 'B')).toBe(false)
    expect(context.store.project.value.objects.some(item => item.name === 'A')).toBe(true)
  })
})
