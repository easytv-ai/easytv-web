import { describe, expect, it } from 'vitest'
import { clearSlashQuery, filterSlashItems, moveSlashIndex, SLASH_MAX, slashQueryAt } from './canvas-slash'

describe('slashQueryAt', () => {
  it('行首的斜杠触发', () => {
    expect(slashQueryAt('/', 1)).toEqual({ query: '', start: 0 })
    expect(slashQueryAt('/参考', 3)).toEqual({ query: '参考', start: 0 })
  })

  it('空白后的斜杠触发', () => {
    expect(slashQueryAt('黄昏 /运镜', 6)).toEqual({ query: '运镜', start: 3 })
  })

  it('句子里的斜杠不触发', () => {
    expect(slashQueryAt('比例 16/9', 8)).toBeNull()
  })

  it('查询词中间有空格就退出 slash 状态', () => {
    expect(slashQueryAt('/参考 图', 5)).toBeNull()
  })

  it('查询词过长不再当 slash', () => {
    expect(slashQueryAt(`/${'参'.repeat(20)}`, 21)).toBeNull()
  })
})

describe('filterSlashItems', () => {
  it('只列当前节点能用的能力', () => {
    const keys = filterSlashItems('audio').map(item => item.key)
    expect(keys).toContain('voice')
    expect(keys).not.toContain('cam')
  })

  it('视频节点能看到运镜和首尾帧', () => {
    const keys = filterSlashItems('video').map(item => item.key)
    expect(keys).toEqual(expect.arrayContaining(['cam', 'first', 'last']))
  })

  it('按中文、key、拼音都能搜到', () => {
    expect(filterSlashItems('video', '运镜').map(item => item.key)).toEqual(['cam'])
    expect(filterSlashItems('video', 'cast').map(item => item.key)).toEqual(['cast'])
    expect(filterSlashItems('video', '角色库').map(item => item.key)).toEqual(['cast'])
    expect(filterSlashItems('video', '角色素材').map(item => item.key)).toEqual(['cast'])
    // 「fengge」同时命中风格参考与风格库（fenggeku 前缀），风格库只按 fenggeku 精确命中
    expect(filterSlashItems('image', 'fengge').map(item => item.key)).toEqual(['style', 'stylelib'])
    expect(filterSlashItems('video', 'fenggeku').map(item => item.key)).toEqual(['stylelib'])
  })

  it('最多列 SLASH_MAX 条', () => {
    expect(filterSlashItems('video').length).toBeLessThanOrEqual(SLASH_MAX)
  })

  it('搜不到时给空列表', () => {
    expect(filterSlashItems('image', 'zzz')).toEqual([])
  })
})

describe('clearSlashQuery 与 moveSlashIndex', () => {
  it('挑中后把 /查询词 删掉', () => {
    expect(clearSlashQuery('黄昏 /运镜', 3, 6)).toEqual({ prompt: '黄昏 ', caret: 3 })
  })

  it('上下移动到头回绕', () => {
    expect(moveSlashIndex(0, -1, 3)).toBe(2)
    expect(moveSlashIndex(2, 1, 3)).toBe(0)
    expect(moveSlashIndex(0, 1, 0)).toBe(0)
  })
})
