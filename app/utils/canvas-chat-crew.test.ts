import { describe, expect, it } from 'vitest'
import {
  buildCrewChatPrompt,
  cardToHistoryText,
  clipCrewTurn,
  crewElapsed,
  crewFromMessages,
  crewAudioModel,
  crewGridPrompt,
  crewImageModel,
  crewPortraitPrompt,
  crewShotPrompt,
  crewShotsSettled,
  crewPortraitsSettled,
  crewScenePrompt,
  crewScenesRetryable,
  crewScenesSettled,
  crewStateLine,
  defaultCrewSettings,
  defaultCrewState,
  lockSettingsCard,
  lockStylesCard,
  parseCrewCharacters,
  shouldStartCrew,
  type CrewSettingsCard,
  type CrewStylesCard,
} from './canvas-chat-crew'

describe('shouldStartCrew', () => {
  it('没选技能不开卡', () => {
    expect(shouldStartCrew({ step: 'idle' })).toBe(false)
  })

  it('空闲或做完后再发，选了技能就开新卡', () => {
    expect(shouldStartCrew({ skillId: 3, step: 'idle' })).toBe(true)
    expect(shouldStartCrew({ skillId: 3, step: 'done' })).toBe(true)
  })

  it('卡在确认、选风格或出主图时不再开新卡', () => {
    expect(shouldStartCrew({ skillId: 3, step: 'settings' })).toBe(false)
    expect(shouldStartCrew({ skillId: 3, step: 'styles' })).toBe(false)
    expect(shouldStartCrew({ skillId: 3, step: 'portraits' })).toBe(false)
  })
})

describe('crewFromMessages', () => {
  it('没卡片就是空闲', () => {
    expect(crewFromMessages([])).toEqual(defaultCrewState())
  })

  it('未锁定的设置卡停在 settings', () => {
    const state = crewFromMessages([{
      card: {
        kind: 'settings',
        role: 'director',
        locked: false,
        startedAt: 1,
        ...defaultCrewSettings(),
        script: '剧本.docx',
      },
    }])
    expect(state.step).toBe('settings')
    expect(state.script).toBe('剧本.docx')
    expect(state.ratio).toBe('16:9')
  })

  it('设置已确认、风格未选 → styles；风格锁定 → done', () => {
    const settings: CrewSettingsCard = {
      kind: 'settings',
      role: 'director',
      locked: true,
      startedAt: 1,
      ratio: '9:16',
      language: 'ja',
    }
    const styles: CrewStylesCard = {
      kind: 'styles',
      role: 'character',
      locked: false,
      startedAt: 2,
      styles: [],
    }
    expect(crewFromMessages([{ card: settings }, { card: styles }]).step).toBe('styles')
    expect(crewFromMessages([
      { card: settings },
      { card: { ...styles, locked: true, picked: '3D玄幻' } },
    ])).toMatchObject({ step: 'portraits', styleName: '3D玄幻', ratio: '9:16', language: 'ja' })
    expect(crewFromMessages([
      { card: settings },
      { card: { ...styles, locked: true, picked: '3D玄幻' } },
      { card: { kind: 'portraits', role: 'character', locked: false, startedAt: 3, portraits: [] } },
    ]).step).toBe('portraits')
    expect(crewFromMessages([
      { card: settings },
      { card: { ...styles, locked: true, picked: '3D玄幻' } },
      { card: { kind: 'portraits', role: 'character', locked: true, startedAt: 3, portraits: [] } },
    ]).step).toBe('scenes')
  })
})

describe('parseCrewCharacters', () => {
  it('从夹杂文字的 JSON 里抽出角色，最多 6 个且去重', () => {
    const text = '如下：[{"name":"林北玄","look":"蓝衣"},{"name":"林北玄","look":"重复"},{"name":"苏小鱼","look":"辫子"}] 完'
    expect(parseCrewCharacters(text)).toEqual([
      { name: '林北玄', look: '蓝衣' },
      { name: '苏小鱼', look: '辫子' },
    ])
  })

  it('不是数组就空', () => {
    expect(parseCrewCharacters('没有角色')).toEqual([])
  })
})

describe('crew portraits helpers', () => {
  it('全部成功或失败才算结束', () => {
    expect(crewPortraitsSettled({
      kind: 'portraits',
      role: 'character',
      locked: false,
      startedAt: 1,
      portraits: [
        { name: 'A', look: 'a', status: 'ok' },
        { name: 'B', look: 'b', status: 'fail' },
      ],
    })).toBe(true)
    expect(crewPortraitsSettled({
      kind: 'portraits',
      role: 'character',
      locked: false,
      startedAt: 1,
      portraits: [{ name: 'A', look: 'a', status: 'run' }],
    })).toBe(false)
  })

  it('出图提示词带上外貌、名字和风格', () => {
    expect(crewPortraitPrompt({ name: '林北玄', look: '蓝衣', style: '赛博朋克' })).toContain('赛博朋克')
  })

  it('场景图全部结束才算可确认，失败或等待可以重试', () => {
    const base = {
      kind: 'scenes' as const,
      role: 'scene' as const,
      locked: false,
      startedAt: 1,
    }
    expect(crewScenesSettled({
      ...base,
      scenes: [
        { name: '雨巷', look: '夜雨', status: 'ok' },
        { name: '屋顶', look: '黄昏', status: 'fail' },
      ],
    })).toBe(true)
    expect(crewScenesSettled({
      ...base,
      scenes: [{ name: '雨巷', look: '夜雨', status: 'run' }],
    })).toBe(false)
    expect(crewScenesRetryable({
      ...base,
      scenes: [{ name: '雨巷', look: '夜雨', status: 'fail' }],
    })).toBe(true)
  })

  it('场景提示词是环境全景，不带人物设定', () => {
    const prompt = crewScenePrompt({ name: '雨巷', look: '夜雨霓虹', style: '赛博朋克' })
    expect(prompt).toContain('场景设定图')
    expect(prompt).toContain('赛博朋克')
    expect(prompt).not.toContain('角色设定图')
  })

  it('分镜视频结束才算完成，提示词带场景和角色', () => {
    expect(crewShotsSettled({
      kind: 'storyboard',
      role: 'storyboard',
      locked: true,
      startedAt: 1,
      model: 'v',
      scheme: 'multi',
      shots: [{ name: '雨巷', status: 'ok' }],
    })).toBe(true)
    expect(crewShotsSettled({
      kind: 'storyboard',
      role: 'storyboard',
      locked: true,
      startedAt: 1,
      model: 'v',
      scheme: 'multi',
      loading: true,
      shots: [{ name: '雨巷', status: 'run' }],
    })).toBe(false)
    expect(crewShotPrompt({ name: '雨巷', look: '夜雨', cast: '林北玄', style: '赛博朋克' })).toContain('林北玄')
    expect(crewGridPrompt({ scenes: '雨巷', cast: '林北玄', style: '赛博朋克' })).toContain('四格分镜')
  })

  it('音频模型优先已定价的', () => {
    expect(crewAudioModel([
      { type: 'video', model: 'vid', priced: true },
      { type: 'audio', model: 'free-audio' },
      { type: 'audio', model: 'paid-audio', priced: true },
    ])).toBe('paid-audio')
  })

  it('图片模型优先已定价的', () => {
    expect(crewImageModel([
      { type: 'text', model: 'chat', priced: true },
      { type: 'image', model: 'free-img' },
      { type: 'image', model: 'paid-img', priced: true },
    ])).toBe('paid-img')
  })
})

describe('lock cards', () => {
  it('锁定设置卡时记下用时', () => {
    const locked = lockSettingsCard({
      kind: 'settings',
      role: 'director',
      locked: false,
      startedAt: 1000,
      ...defaultCrewSettings(),
    }, 4000)
    expect(locked.locked).toBe(true)
    expect(locked.elapsed).toBe(3)
  })

  it('锁定风格卡时记下选中项', () => {
    const locked = lockStylesCard({
      kind: 'styles',
      role: 'character',
      locked: false,
      startedAt: 1000,
      styles: [],
      loading: true,
    }, '日系治愈', 2000)
    expect(locked.picked).toBe('日系治愈')
    expect(locked.loading).toBe(false)
    expect(locked.elapsed).toBe(1)
  })
})

describe('buildCrewChatPrompt', () => {
  it('没有上文和进度时只回当前句', () => {
    expect(buildCrewChatPrompt({
      current: '1+1等于几',
      state: defaultCrewState(),
      turns: [],
    })).toBe('1+1等于几')
  })

  it('带上制作进度和最近对话', () => {
    const prompt = buildCrewChatPrompt({
      current: '1+1等于几',
      state: {
        step: 'styles',
        script: '一页剧本',
        ratio: '16:9',
        language: 'zh',
      },
      turns: [
        { role: 'user', text: '这是剧本' },
        { role: 'assistant', text: cardToHistoryText({
          kind: 'settings',
          role: 'director',
          locked: true,
          startedAt: 1,
          ratio: '16:9',
          language: 'zh',
        }) },
      ],
    })
    expect(prompt).toContain('当前制作进度：比例 16:9，语言 zh，等待选择风格')
    expect(prompt).toContain('用户：这是剧本')
    expect(prompt).toContain('助手：影片设置 16:9 zh 已确认')
    expect(prompt.endsWith('1+1等于几')).toBe(true)
  })

  it('过长的一轮会截断', () => {
    expect(clipCrewTurn('啊'.repeat(500)).endsWith('…')).toBe(true)
  })
})

describe('crewStateLine / cardToHistoryText', () => {
  it('空闲没有进度行', () => {
    expect(crewStateLine(defaultCrewState())).toBe('')
  })

  it('邀请卡有固定摘要', () => {
    expect(cardToHistoryText({
      kind: 'invite',
      role: 'director',
      locked: true,
      startedAt: 1,
      guest: 'character',
    })).toBe('已邀请character')
  })
})

describe('crewElapsed', () => {
  it('不足一秒也记 1', () => {
    expect(crewElapsed(1000, 1000)).toBe(1)
  })
})
