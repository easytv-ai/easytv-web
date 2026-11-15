import { describe, expect, it, vi } from 'vitest'
import { downloadProxyUrl, fetchDownloadBlob, type DownloadFetch } from './canvas-download'

const PAGE = 'https://studio.example.com'
const OSS = 'https://bucket.oss-cn-hangzhou.aliyuncs.com/a/b.mp4?sig=1&x=2'
const blob = new Blob(['x'], { type: 'video/mp4' })

describe('节点下载取字节', () => {
  it('直连拿得到就不走代理', async () => {
    const fetcher = vi.fn<DownloadFetch>(async () => ({ ok: true, blob: async () => blob }))
    expect(await fetchDownloadBlob(OSS, PAGE, fetcher)).toEqual({ via: 'direct', blob })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('对象存储没有 CORS（直连抛错）：回退走同源代理，原地址整体编码进 url 参数', async () => {
    const fetcher = vi.fn<DownloadFetch>(async (url) => {
      if (url === OSS)
        throw new TypeError('Failed to fetch')
      return { ok: true, blob: async () => blob }
    })
    expect(await fetchDownloadBlob(OSS, PAGE, fetcher)).toEqual({ via: 'proxy', blob })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([OSS, `/api/canvas-media?url=${encodeURIComponent(OSS)}`])
  })

  it('直连回非 2xx 也回退代理', async () => {
    const fetcher = vi.fn<DownloadFetch>(async url => ({ ok: url !== OSS, blob: async () => blob }))
    expect((await fetchDownloadBlob(OSS, PAGE, fetcher)).via).toBe('proxy')
  })

  it('代理也拿不到（域名不在白名单 / 文件过大）：交给调用方新窗口打开', async () => {
    const fetcher = vi.fn<DownloadFetch>(async (url) => {
      if (url === OSS)
        throw new TypeError('Failed to fetch')
      return { ok: false, blob: async () => blob }
    })
    expect(await fetchDownloadBlob(OSS, PAGE, fetcher)).toEqual({ via: 'open' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('同源 / blob / data 地址没有代理可走：直连失败直接回退打开', async () => {
    expect(downloadProxyUrl(`${PAGE}/upload/a.png`, PAGE)).toBeNull()
    expect(downloadProxyUrl('/upload/a.png', PAGE)).toBeNull()
    expect(downloadProxyUrl('blob:https://studio.example.com/1', PAGE)).toBeNull()
    expect(downloadProxyUrl('data:image/png;base64,AA', PAGE)).toBeNull()
    const fetcher = vi.fn<DownloadFetch>(async () => {
      throw new Error('gone')
    })
    expect(await fetchDownloadBlob('/upload/a.png', PAGE, fetcher)).toEqual({ via: 'open' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
