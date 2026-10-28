import { describe, expect, it } from 'vitest'
import {
  briefAskPicks,
  briefGenerateGroups,
  briefCharacters,
  briefFrameRatio,
  briefHistoryText,
  briefNodeTitle,
  briefPathOf,
  briefTitleHead,
  briefProps,
  briefSceneBody,
  briefScenes,
  briefShots,
  briefSpecChips,
  briefTitle,
  briefVoices,
  briefWantsBoard,
  briefWantsFilm,
  characterImagePrompt,
  parseBriefAsk,
  parseBriefDoc,
  plainChatPrompt,
  propImagePrompt,
  sceneImagePrompt,
  shotImagePrompt,
  shotVideoPrompt,
  briefNamesInText,
  briefPickShotRefs,
  SHOT_REF_HINT,
  shouldOpenBrief,
  looksLikeComposeReport,
  voiceAudioPrompt,
} from './canvas-chat-brief'

describe('shouldOpenBrief', () => {
  it('短句不开确认卡', () => {
    expect(shouldOpenBrief('1+1等于几')).toBe(false)
  })

  it('剧本或长材料才开', () => {
    expect(shouldOpenBrief('《仙帝在人间送外卖》故事脚本\n主角：林北玄，修真界一代仙帝。')).toBe(true)
    expect(shouldOpenBrief('甲'.repeat(180))).toBe(true)
  })
})

describe('briefTitle', () => {
  it('从书名号里取作品名', () => {
    expect(briefTitle('《仙帝在人间送外卖》故事脚本')).toBe('仙帝在人间送外卖')
    expect(briefTitle('没有书名')).toBe('未命名')
  })
})

describe('parseBriefAsk', () => {
  it('取出一问和四条选项', () => {
    const text = '好的：{"title":"仙帝","intro":"","ask":"接下来做什么？","options":["成片","预告","设定图","先写剧本"]}'
    expect(parseBriefAsk(text)).toEqual({
      title: '仙帝',
      intro: '',
      questions: [{
        ask: '接下来做什么？',
        options: ['成片', '预告', '设定图', '先写剧本'],
      }],
    })
  })

  it('两问时都留下', () => {
    const text = '{"title":"仙帝","questions":[{"ask":"做什么","options":["成片","设定图"]},{"ask":"剧情从哪来","options":["代写","再贴正文"]}]}'
    expect(parseBriefAsk(text)?.questions).toHaveLength(2)
  })

  it('没有问题就空', () => {
    expect(parseBriefAsk('不是确认卡')).toBeNull()
  })
})

describe('briefAskPicks', () => {
  it('选中的选项和自己填写都能拼出来', () => {
    expect(briefAskPicks({
      kind: 'ask',
      locked: false,
      title: '仙帝',
      script: '',
      questions: [
        { ask: '做什么', options: ['成片', '设定图'], chosen: 0 },
        { ask: '其他', options: ['代写'], chosen: 1, note: '只要林北玄' },
      ],
    })).toBe('成片；只要林北玄')
  })
})

describe('parseBriefDoc', () => {
  it('抽出思考、标题和正文', () => {
    const doc = parseBriefDoc('{"thinking":"需要代笔","label":"第一集","body":"场次一"}')
    expect(doc).toEqual({ thinking: '需要代笔', label: '第一集', body: '场次一' })
  })

  it('不是 JSON 时整段当正文', () => {
    expect(parseBriefDoc('场次一 · 站点')).toEqual({ thinking: '', label: '', body: '场次一 · 站点' })
  })
})

describe('briefCharacters', () => {
  it('优先用 JSON 里的角色', () => {
    const text = '{"characters":[{"name":"林北玄","look":"清瘦外卖青年"},{"name":"陈站长","look":"中年站长"}],"body":"场景\\n巷口，暴雨"}'
    expect(briefCharacters(text)).toEqual([
      { name: '林北玄', look: '清瘦外卖青年' },
      { name: '陈站长', look: '中年站长' },
    ])
    expect(briefSceneBody(text, briefCharacters(text))).toBe('场景\n巷口，暴雨')
  })

  it('没有数组时从角色一节拆开，场景留在正文', () => {
    const text = '角色\n林北玄，清瘦外卖青年\n陈站长，中年站长\n\n场景\n巷口，暴雨夜'
    expect(briefCharacters(text)).toEqual([
      { name: '林北玄', look: '清瘦外卖青年' },
      { name: '陈站长', look: '中年站长' },
    ])
    expect(briefSceneBody(text, briefCharacters(text))).toBe('场景\n巷口，暴雨夜')
  })

  it('提示词带上外貌，选了风格就接在后面', () => {
    const prompt = characterImagePrompt({ name: '林北玄', look: '清瘦外卖青年' }, '3D 国漫')
    expect(prompt).toContain('林北玄，清瘦外卖青年')
    expect(prompt).toContain('纯白背景')
    expect(prompt).toContain('3D 国漫')
  })
})

describe('briefScenes', () => {
  it('优先用 JSON 里的场景，正文只留道具', () => {
    const text = '{"characters":[{"name":"林北玄","look":"清瘦外卖青年"}],"scenes":[{"name":"巷口","look":"暴雨夜"}],"body":"道具\\n头盔，银色"}'
    expect(briefScenes(text)).toEqual([{ name: '巷口', look: '暴雨夜' }])
    expect(briefSceneBody(text, briefCharacters(text), briefScenes(text))).toBe('道具\n头盔，银色')
  })

  it('没有数组时从场景一节拆开', () => {
    const text = '角色\n林北玄，清瘦外卖青年\n\n场景\n巷口，暴雨夜\n\n道具\n头盔，银色'
    expect(briefScenes(text)).toEqual([{ name: '巷口', look: '暴雨夜' }])
    expect(briefSceneBody(text, briefCharacters(text), briefScenes(text))).toBe('道具\n头盔，银色')
  })

  it('场景提示词写环境，不要人物站姿', () => {
    const prompt = sceneImagePrompt({ name: '巷口', look: '暴雨夜，霓虹反光' }, '3D 国漫')
    expect(prompt).toContain('巷口，暴雨夜，霓虹反光')
    expect(prompt).toContain('无人物')
    expect(prompt).toContain('3D 国漫')
    expect(prompt).not.toContain('纯白背景')
  })
})

describe('briefVoices', () => {
  it('按对白角色收齐镜号', () => {
    expect(briefVoices([
      { no: '1', seconds: 4, picture: '抬头', line: '林北玄：单子来了' },
      { no: '2', seconds: 3, picture: '摔牌', line: '陈站长：你还想跑？' },
      { no: '3', seconds: 2, picture: '转身', line: '林北玄：跑什么' },
      { no: '4', seconds: 2, picture: '空镜', line: '' },
    ])).toEqual([
      { name: '林北玄', shots: ['1', '3'] },
      { name: '陈站长', shots: ['2'] },
    ])
  })

  it('音色提示词写共用哪几镜', () => {
    expect(voiceAudioPrompt({ name: '林北玄', shots: ['1', '3'] })).toContain('镜1、3')
    expect(briefHistoryText({
      kind: 'voice',
      locked: false,
      title: '仙帝',
      questions: [],
      voices: [],
      placed: false,
    })).toBe('音色锚点')
    expect(briefHistoryText({
      kind: 'generate',
      locked: false,
      title: '仙帝',
      questions: [],
      counts: { characters: 2, scenes: 1, props: 1, shots: 6, voices: 0 },
    })).toBe('等待确认是否生成')
    expect(briefHistoryText({
      kind: 'video',
      locked: false,
      title: '仙帝',
      questions: [],
      shots: 6,
    })).toBe('等待确认是否出视频')
    expect(briefHistoryText({
      kind: 'compose',
      locked: true,
      title: '仙帝',
      questions: [],
      shots: 6,
    })).toBe('已确认是否合成')
    expect(briefGenerateGroups(0)).toEqual(['character', 'scene', 'prop', 'shot', 'voice'])
    expect(briefGenerateGroups(2)).toEqual(['character', 'scene', 'prop'])
    expect(briefGenerateGroups(1)).toBeNull()
  })
})

describe('briefNodeTitle', () => {
  it('用名字加类型，不要图片编号', () => {
    expect(briefNodeTitle('王建国', 'character')).toBe('王建国 - 角色锚点')
    expect(briefNodeTitle('巷口', 'scene')).toBe('巷口 - 场景锚点')
    expect(briefNodeTitle('头盔', 'prop')).toBe('头盔 - 道具锚点')
    expect(briefNodeTitle('镜1', 'shot')).toBe('镜1 - 分镜')
    expect(briefNodeTitle('王建国', 'voice')).toBe('王建国 - 音色锚点')
    expect(briefTitleHead('镜1 - 分镜')).toBe('镜1')
    expect(briefNodeTitle('镜1 - 分镜', 'video')).toBe('镜1 - 分镜视频')
  })
})

describe('briefPath', () => {
  it('开场四条分别对应成片、预告、设定图、只写剧本', () => {
    expect(briefPathOf(0)).toBe('full')
    expect(briefPathOf(1)).toBe('teaser')
    expect(briefPathOf(2)).toBe('stills')
    expect(briefPathOf(3)).toBe('script')
    expect(briefWantsBoard('full')).toBe(true)
    expect(briefWantsBoard('stills')).toBe(false)
    expect(briefWantsFilm('teaser')).toBe(true)
    expect(briefWantsFilm('script')).toBe(false)
  })
})

describe('briefProps', () => {
  it('优先用 JSON 里的道具，正文不再重复', () => {
    const text = '{"characters":[{"name":"林北玄","look":"清瘦外卖青年"}],"scenes":[{"name":"巷口","look":"暴雨夜"}],"props":[{"name":"头盔","look":"银色外卖盔"}],"body":""}'
    expect(briefProps(text)).toEqual([{ name: '头盔', look: '银色外卖盔' }])
    expect(briefSceneBody(text, briefCharacters(text), briefScenes(text), briefProps(text))).toBe('')
  })

  it('道具提示词写外形，不要人物站姿', () => {
    const prompt = propImagePrompt({ name: '头盔', look: '银色外卖盔' }, '3D 国漫')
    expect(prompt).toContain('头盔，银色外卖盔')
    expect(prompt).toContain('纯白背景')
    expect(prompt).toContain('3D 国漫')
  })
})

describe('briefShots', () => {
  it('从 JSON 拆出每一镜', () => {
    const text = '{"shots":[{"no":"1","seconds":4,"picture":"暴雨巷口，林北玄抬头","line":"林北玄：单子来了"}]}'
    expect(briefShots(text)).toEqual([
      { no: '1', seconds: 4, picture: '暴雨巷口，林北玄抬头', line: '林北玄：单子来了' },
    ])
  })

  it('没有数组时按镜号行拆', () => {
    const text = '1｜4秒｜暴雨巷口，林北玄抬头｜林北玄：单子来了'
    expect(briefShots(text)[0]).toMatchObject({ no: '1', seconds: 4, picture: '暴雨巷口，林北玄抬头' })
  })

  it('画幅跟已确认的方向，提示词写这一镜的画面', () => {
    expect(briefFrameRatio('竖屏 9:16，约 60 秒')).toBe('9:16')
    expect(briefFrameRatio('没写画幅')).toBe('9:16')
    const prompt = shotImagePrompt({ no: '2', seconds: 3, picture: '陈站长摔牌', line: '' }, '3D 国漫')
    expect(prompt).toContain('镜2')
    expect(prompt).toContain('陈站长摔牌')
    expect(prompt).toContain('3D 国漫')
    expect(prompt).toContain(SHOT_REF_HINT)
    expect(prompt).not.toContain('纯白背景')
    expect(briefSpecChips('竖屏 9:16，约 60 秒')).toEqual(['9:16', '60秒'])
    expect(briefSpecChips('竖屏 9:16，约 60 秒', (key, params) => key === 'canvas.chat.brief.shotSeconds' ? `${params?.n}s` : key)).toEqual(['9:16', '60s'])
    expect(briefHistoryText({
      kind: 'ask',
      locked: true,
      title: '仙帝',
      script: '',
      questions: [],
    }, key => key)).toBe('canvas.chat.brief.history.askDone')
    const video = shotVideoPrompt({ no: '2', seconds: 3, picture: '陈站长摔牌', line: '' }, '3D 国漫')
    expect(video).toContain('做成视频')
    expect(video).toContain('镜2')
    expect(video).toContain('3D 国漫')
  })
})

describe('briefPickShotRefs', () => {
  it('按画面里的名字挑角色和道具，没写名字就带上全部角色', () => {
    expect(briefNamesInText('勇者抬眼盯着史莱姆，生锈铁剑尖抵地', ['生锈铁剑', '剑', '勇者', '史莱姆'])).toEqual([
      '生锈铁剑',
      '史莱姆',
      '勇者',
    ])
    expect(briefPickShotRefs('近景，勇者抬眼', {
      characters: ['勇者', '史莱姆'],
      scenes: ['地下城入口'],
      props: ['生锈铁剑', '火把'],
    })).toEqual({
      characters: ['勇者'],
      scenes: ['地下城入口'],
      props: [],
    })
    expect(briefPickShotRefs('黑屏字幕', {
      characters: ['勇者'],
      scenes: ['黑屏字幕'],
      props: ['火把'],
    }).scenes).toEqual(['黑屏字幕'])
  })
})

describe('plainChatPrompt', () => {
  it('没有上文时只回当前句', () => {
    expect(plainChatPrompt({ current: '1+1', turns: [] })).toBe('1+1')
  })
})

describe('looksLikeComposeReport', () => {
  it('成片交付状态加文件名是模型写的假报告', () => {
    expect(looksLikeComposeReport('三、成片交付状态\n导出文件：final_cut_16x9_15s_per_shot_768p.mp4\n交付可用：成片可直接导出')).toBe(true)
    expect(looksLikeComposeReport('合成结果：全17条素材已完成音画绑定')).toBe(true)
    expect(looksLikeComposeReport('接下来确认要不要出逐镜视频。')).toBe(false)
  })
})
