import { describe, expect, it } from 'vitest'
import {
  cleanStyleExtract,
  parseStyleExtract,
  STYLE_DEFAULT_NAME,
  styleExtractInstruction,
  styleStatusLabel,
  suggestStyleName,
} from './canvas-style-extract'

describe('styleExtractInstruction', () => {
  it('只要风格、不要主体、限定字数', () => {
    const text = styleExtractInstruction()
    expect(text).toContain('媒介与技法')
    expect(text).toContain('色调与配色')
    expect(text).toContain('光线')
    expect(text).toContain('构图倾向')
    expect(text).toContain('质感与笔触')
    expect(text).toContain('时代感或流派气质')
    expect(text).toContain('不要描述画面里的主体')
    expect(text).toContain('80–200 字')
    expect(text).toMatch(/名称：<2–6 个字的风格名>/)
  })

  it('中文界面不加语言要求，繁体与其他语言按界面语言', () => {
    expect(styleExtractInstruction('zh')).not.toMatch(/Write the style/)
    expect(styleExtractInstruction('zh-TW')).toMatch(/繁体中文/)
    expect(styleExtractInstruction('en')).toMatch(/in English/)
    expect(styleExtractInstruction('en')).toMatch(/Name: <2–4 word style name>/)
    expect(styleExtractInstruction('ja-JP')).toMatch(/in Japanese/)
  })
})

describe('parseStyleExtract', () => {
  it('有名称行：名称去引号，描述取余下部分', () => {
    expect(parseStyleExtract('名称：「胶片暖调」\n\n胶片质感，暖调，柔和光线')).toEqual({ name: '胶片暖调', prompt: '胶片质感，暖调，柔和光线' })
    expect(parseStyleExtract('Name: Warm Film\n\nStyle: warm film grain, soft light')).toEqual({ name: 'Warm Film', prompt: 'warm film grain, soft light' })
    expect(parseStyleExtract('名字: 日系清新\n低饱和，通透').name).toBe('日系清新')
  })

  it('名称最多 20 字', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十廿一'
    expect(parseStyleExtract(`名称：${long}\n\n胶片质感`).name).toBe(long.slice(0, 20))
  })

  it('没有名称行：整段当描述并自动起名', () => {
    expect(parseStyleExtract('胶片暖调，柔和光线，颗粒质感')).toEqual({ name: '胶片暖调', prompt: '胶片暖调，柔和光线，颗粒质感' })
    expect(parseStyleExtract('')).toEqual({ name: STYLE_DEFAULT_NAME, prompt: '' })
  })

  it('包在代码块里也能拆', () => {
    expect(parseStyleExtract('```\n名称：复古港片\n\n霓虹夜景色调，高对比\n```')).toEqual({ name: '复古港片', prompt: '霓虹夜景色调，高对比' })
  })

  it('只有名称行没有描述', () => {
    expect(parseStyleExtract('名称：胶片暖调')).toEqual({ name: '胶片暖调', prompt: '' })
  })
})

describe('cleanStyleExtract', () => {
  it('剥掉代码块、前缀和成对引号', () => {
    expect(cleanStyleExtract('```\n胶片质感，暖调\n```')).toBe('胶片质感，暖调')
    expect(cleanStyleExtract('风格：胶片质感，暖调')).toBe('胶片质感，暖调')
    expect(cleanStyleExtract('风格描述: 胶片质感')).toBe('胶片质感')
    expect(cleanStyleExtract('Style: warm film grain')).toBe('warm film grain')
    expect(cleanStyleExtract('「胶片质感，暖调」')).toBe('胶片质感，暖调')
    expect(cleanStyleExtract('  ')).toBe('')
  })
})

describe('suggestStyleName', () => {
  it('中文取开头到第一个标点，最多 6 个字', () => {
    expect(suggestStyleName('胶片暖调，柔和光线，颗粒质感')).toBe('胶片暖调')
    expect(suggestStyleName('复古港片霓虹夜景色调，高对比')).toBe('复古港片霓虹')
    expect(suggestStyleName('  「日系清新」。低饱和')).toBe('日系清新')
  })

  it('单字开头跳到下一段', () => {
    expect(suggestStyleName('暖，胶片质感')).toBe('胶片质感')
  })

  it('拉丁文取前 2–3 个词', () => {
    expect(suggestStyleName('warm film grain, soft light')).toBe('warm film grain')
    expect(suggestStyleName('cinematic, moody')).toBe('cinematic')
  })

  it('取不出就用默认名', () => {
    expect(suggestStyleName('')).toBe(STYLE_DEFAULT_NAME)
    expect(suggestStyleName('，。')).toBe(STYLE_DEFAULT_NAME)
    expect(suggestStyleName('a')).toBe(STYLE_DEFAULT_NAME)
  })
})

describe('styleStatusLabel', () => {
  const t = (key: string) => `[${key}]`
  it('只有待审核和已收录有角标', () => {
    expect(styleStatusLabel(1, t)).toBe('')
    expect(styleStatusLabel(2, t)).toBe('')
    expect(styleStatusLabel(undefined, t)).toBe('')
    expect(styleStatusLabel(3, t)).toBe('[审核中]')
    expect(styleStatusLabel(4, t)).toBe('[已收录]')
  })
})
