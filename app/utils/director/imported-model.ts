/**
 * 导入 GLB / GLTF 的校验和落点尺寸。
 *
 * 用户文件单位可能是厘米或毫米，原尺寸丢进场景会撑爆视口。
 * 这里只算缩放系数，真正改 three 对象在渲染组件里做。
 */

export const IMPORTED_MODEL_ACCEPT = '.glb,.gltf'
export const IMPORTED_MODEL_MAX_BYTES = 80 * 1024 * 1024
/** 导入后最长边压到这个长度（米），已经更小的不放大 */
export const IMPORTED_MODEL_MAX_EXTENT = 2

export function isImportedModelFileName(name: string) {
  return /\.(glb|gltf)$/i.test(name.trim())
}

/** 去掉路径和扩展名，给对象当显示名 */
export function importedModelDisplayName(fileName: string) {
  const base = fileName.replace(/\\/g, '/').split('/').pop()?.trim() || fileName.trim()
  return base.replace(/\.(glb|gltf)$/i, '') || base
}

export function importedModelFileError(file: { name?: string, size?: number } | null | undefined) {
  if (!file?.name)
    return '请选择模型文件'
  if (!isImportedModelFileName(file.name))
    return '只支持 GLB / GLTF'
  if (Number(file.size) > IMPORTED_MODEL_MAX_BYTES)
    return '模型文件太大'
  return ''
}

export function fitImportedModelScale(maxDimension: number, limit = IMPORTED_MODEL_MAX_EXTENT) {
  if (!Number.isFinite(maxDimension) || maxDimension <= 0)
    return 1
  if (maxDimension <= limit)
    return 1
  return limit / maxDimension
}
