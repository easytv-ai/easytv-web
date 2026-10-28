import { describe, expect, it } from 'vitest'
import { classifyPublicWorkResponse } from './watch-load'

describe('classifyPublicWorkResponse', () => {
  it('成功且有数据时留下作品', () => {
    expect(classifyPublicWorkResponse({ success: true, data: { id: 1 } })).toEqual({
      state: 'ok',
      work: { id: 1 },
      message: '',
    })
  })

  it('资源不存在或无效 ID 视为下架', () => {
    expect(classifyPublicWorkResponse({ success: false, message: '资源不存在' }).state).toBe('missing')
    expect(classifyPublicWorkResponse({ success: false, message: '无效的作品 ID' }).state).toBe('missing')
    expect(classifyPublicWorkResponse({ success: false, statusCode: 404, message: '请求的资源不存在' }).state).toBe('missing')
  })

  it('网络失败、超时和 5xx 留在本页', () => {
    expect(classifyPublicWorkResponse({ success: false, statusCode: 500, message: '服务器内部错误，请稍后重试' })).toMatchObject({
      state: 'error',
    })
    expect(classifyPublicWorkResponse({ success: false, statusCode: 408, message: '请求超时，请稍后重试' }).state).toBe('error')
    expect(classifyPublicWorkResponse({ success: false, message: '查询失败' }).state).toBe('error')
    expect(classifyPublicWorkResponse(null).state).toBe('error')
  })
})
