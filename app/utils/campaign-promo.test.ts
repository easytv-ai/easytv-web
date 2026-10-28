import { describe, expect, it } from 'vitest'
import { campaignPromoItems, parseCampaignModelPromo } from './campaign-promo'

describe('parseCampaignModelPromo', () => {
  it('读对象、models 数组和数组写法', () => {
    expect(parseCampaignModelPromo('{"model":"Veo-3","rate":0.5}')).toEqual([
      { model: 'veo-3', rate: 0.5, points: undefined, label: '' },
    ])
    expect(parseCampaignModelPromo('{"models":["a","b"],"points":8,"label":"特价"}').map(item => item.model)).toEqual(['a', 'b'])
    expect(parseCampaignModelPromo('[{"model":"x","rate":0.4}]')[0]?.rate).toBe(0.4)
  })

  it('缺折扣或坏 JSON 丢掉', () => {
    expect(parseCampaignModelPromo('{"model":"x"}')).toEqual([])
    expect(parseCampaignModelPromo('nope')).toEqual([])
  })
})

describe('campaignPromoItems', () => {
  it('优先用接口解析好的 items', () => {
    expect(campaignPromoItems({
      id: 1,
      title: 'a',
      slug: 'a',
      banner_url: '',
      rules: '',
      tag: '',
      starts_at: 0,
      ends_at: 0,
      status: 1,
      prizes: [],
      entries_count: 0,
      model_promo: '{"model":"old","rate":0.5}',
      model_promo_items: [{ model: 'veo-3', rate: 0.5, label: '活动 5 折' }],
    }).map(item => item.model)).toEqual(['veo-3'])
  })
})
