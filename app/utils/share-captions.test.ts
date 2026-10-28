import { describe, expect, it } from 'vitest'
import { TIKTOK_HASHTAGS, YOUTUBE_HASHTAGS, withHashtags } from './share-captions'

describe('withHashtags', () => {
  it('普通文案在末尾追加话题标签', () => {
    expect(withHashtags('来看看这部片子 https://e.tv/watch/1', TIKTOK_HASHTAGS))
      .toBe(`来看看这部片子 https://e.tv/watch/1 ${TIKTOK_HASHTAGS}`)
  })

  it('前后带空白的文案先收拢再追加', () => {
    expect(withHashtags('  hello  ', YOUTUBE_HASHTAGS)).toBe(`hello ${YOUTUBE_HASHTAGS}`)
  })

  it('空文案直接返回标签本身', () => {
    expect(withHashtags('', TIKTOK_HASHTAGS)).toBe(TIKTOK_HASHTAGS)
    expect(withHashtags('   ', YOUTUBE_HASHTAGS)).toBe(YOUTUBE_HASHTAGS)
  })
})
