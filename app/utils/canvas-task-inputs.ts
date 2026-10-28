import type { TaskInput } from '~/types/creative'
import type { CanvasNodeData } from '~/utils/canvas-node-kinds'

export type CanvasRefImage = { assetId?: number, url: string }

/** 参考图去重：先按资产 id，再按地址 */
export function pushCanvasRefImage(
  items: CanvasRefImage[],
  seenId: Set<number>,
  seenUrl: Set<string>,
  assetId?: number,
  url = '',
) {
  const href = String(url || '').trim()
  if (assetId && seenId.has(assetId))
    return
  if (href && seenUrl.has(href))
    return
  if (!assetId && !href)
    return
  if (assetId)
    seenId.add(assetId)
  if (href)
    seenUrl.add(href)
  items.push({ assetId, url: href })
}

/**
 * 任务 inputs：首尾帧走 first_frame / last_frame，首帧只走 first_frame，视频全能参考走 reference，图片节点走 image；
 * 风格 / 蒙版 / 音色 / 角色 / 场景各自带角色（后端映射见 API.md 11.1）。
 * 导演台控制图没有独立 depth / matte 通道：预演视频（previewSubmit）把首尾帧之外的连线参考图按 reference 带上。
 */
export function buildCanvasTaskInputs(
  node: { data: CanvasNodeData },
  mode: string,
  images: CanvasRefImage[],
  extraRefs: Array<{ assetId?: number, url: string, kind: 'image' | 'video' | 'audio' }>,
): TaskInput[] {
  const inputs: TaskInput[] = []
  const seen = new Set<number>()
  function pushAsset(assetId?: number, role = 'image') {
    if (!assetId || seen.has(assetId))
      return
    seen.add(assetId)
    inputs.push({ asset_id: assetId, role })
  }
  const isVideoLike = node.data.kind === 'video' || node.data.kind === 'director'
  if (isVideoLike && (mode === 'fl2v' || mode === 'i2v')) {
    const first = images[0]
    pushAsset(first?.assetId, 'first_frame')
    if (mode === 'fl2v') {
      const last = node.data.lastAssetId
        ? { assetId: node.data.lastAssetId, url: String(node.data.lastUrl || '') }
        : images.length > 1
          ? (node.data.previewSubmit === 'first-last-prompt' ? images[1] : images[images.length - 1])
          : null
      if (last?.assetId && last.assetId !== first?.assetId)
        pushAsset(last.assetId, 'last_frame')
    }
    // 预演视频：同一镜上多连的控制图没有独立通道，按参考图带上
    if (node.data.previewSubmit === 'first-last-prompt') {
      for (const item of images)
        pushAsset(item.assetId, 'reference')
    }
  }
  else {
    // 视频「全能参考」：每张都是参考图，不能都按首帧提交（新版视频接口一个任务只收一张首帧）；
    // 旧版只收首帧的模型由后端取第一张参考图兜底。图片节点仍按原图 / 参考图（image）提交
    const role = node.data.kind === 'video' || node.data.kind === 'director' ? 'reference' : 'image'
    if (role === 'image') {
      pushAsset(node.data.castAssetId, 'character')
      pushAsset(node.data.setAssetId, 'scene')
    }
    for (const item of images)
      pushAsset(item.assetId, role)
    // 视频全能参考里的视频 / 音频素材走 reference_video / reference_audio（网关按类型收）；
    // 图片节点只能用图片参考，后端遇到非图片会整单失败
    if (role === 'reference') {
      for (const item of extraRefs) {
        if (item.kind === 'video')
          pushAsset(item.assetId, 'reference_video')
        else if (item.kind === 'audio')
          pushAsset(item.assetId, 'reference_audio')
      }
    }
  }
  if (node.data.styleAssetId)
    inputs.push({ asset_id: node.data.styleAssetId, role: 'style' })
  if (node.data.markAssetId)
    inputs.push({ asset_id: node.data.markAssetId, role: 'mask' })
  if (node.data.voiceAssetId)
    inputs.push({ asset_id: node.data.voiceAssetId, role: 'voice' })
  if (node.data.kind !== 'image') {
    pushAsset(node.data.castAssetId, 'character')
    pushAsset(node.data.setAssetId, 'scene')
  }
  return inputs
}

/**
 * 只有地址、没有资产 ID 的参考素材数。分享 / 做同款复制时后端会清掉原作者的资产 ID（API.md 11.3），
 * 画面上还看得到参考图，但提交任务只认资产 ID，得提醒用户重新选入，别让人以为参考生效了。
 */
export function countUnlinkedCanvasRefs(
  node: { data: CanvasNodeData },
  images: CanvasRefImage[],
) {
  let n = images.filter(item => !item.assetId && item.url).length
  const pairs: Array<[number | undefined, string | undefined]> = [
    [node.data.lastAssetId, node.data.lastUrl],
    [node.data.styleAssetId, node.data.styleUrl],
    [node.data.voiceAssetId, node.data.voiceUrl],
    [node.data.castAssetId, node.data.castUrl],
    [node.data.setAssetId, node.data.setUrl],
  ]
  for (const [id, url] of pairs) {
    if (!id && String(url || '').trim())
      n += 1
  }
  return n
}
