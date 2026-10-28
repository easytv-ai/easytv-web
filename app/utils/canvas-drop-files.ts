/** 一次拖入 / 粘贴最多这么多文件，避免把资产库刷爆 */
export const CANVAS_DROP_MAX = 12

export function canvasMediaKindFromFile(file: File): 'image' | 'video' | 'audio' | null {
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('image/'))
    return 'image'
  if (mime.startsWith('video/'))
    return 'video'
  if (mime.startsWith('audio/'))
    return 'audio'
  const name = String(file.name || '').toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|avif|svg)$/.test(name))
    return 'image'
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(name))
    return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name))
    return 'audio'
  return null
}

export function canvasMediaFilesFromList(list: ArrayLike<File> | File[]): File[] {
  const picked: File[] = []
  for (const file of Array.from(list)) {
    if (!canvasMediaKindFromFile(file))
      continue
    picked.push(file)
    if (picked.length >= CANVAS_DROP_MAX)
      break
  }
  return picked
}

/** 粘贴或拖放：优先 FileList，没有再从 items 里掏 file */
export function canvasMediaFilesFromDataTransfer(data: DataTransfer | null | undefined): File[] {
  if (!data)
    return []
  if (data.files?.length)
    return canvasMediaFilesFromList(data.files)
  const fromItems: File[] = []
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file')
      continue
    const file = item.getAsFile()
    if (file)
      fromItems.push(file)
  }
  return canvasMediaFilesFromList(fromItems)
}
