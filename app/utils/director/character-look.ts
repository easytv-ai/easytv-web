/**
 * 把角色形象图绑到角色上（默认素体和导入 GLB 同一套）。
 *
 * 不改骨骼：图顺着正面曲面贴在上半身，姿势跟着皮肤走，背面不印。
 * 素材走 DirectorAssetRef（sourceType=image），存档规则和导入模型一样：
 * 本地 blob 会被摘掉，上传到资产库后刷新还在。
 * 画布拖进来的角色图仍优先落到素体；场上只有导入角色时才绑导入角色。
 */
import type { DirectorAssetRef, DirectorObject, DirectorProject } from './schema'

export const CHARACTER_LOOK_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'
export const CHARACTER_LOOK_MAX_BYTES = 12 * 1024 * 1024

export interface CharacterLookInput {
  url: string
  fileName: string
  assetSource?: 'local' | 'library'
}

export function isCharacterLookFileName(name: string) {
  return /\.(png|jpe?g|webp)$/i.test(name.trim())
}

export function characterLookFileError(file: { name?: string, size?: number } | null | undefined) {
  if (!file?.name)
    return '请选择形象图片'
  if (!isCharacterLookFileName(file.name))
    return '只支持 JPG / PNG / WebP'
  if (Number(file.size) > CHARACTER_LOOK_MAX_BYTES)
    return '形象图片太大'
  return ''
}

export function isImportedModelCharacter(object: DirectorObject, project: DirectorProject) {
  if (!object.assetRefId)
    return false
  return project.assets.some(item => item.id === object.assetRefId && item.sourceType === 'model')
}

/** 优先绑还没形象的素体；场上没有素体时才落到导入角色 */
export function pickLookTarget(project: DirectorProject): DirectorObject | null {
  const characters = project.objects.filter(item => item.kind === 'character')
  const mannequins = characters.filter(item => !isImportedModelCharacter(item, project))
  const pool = mannequins.length ? mannequins : characters
  return pool.find(item => !item.lookAssetId) ?? pool[0] ?? null
}

function unusedAfter(objects: DirectorObject[], previousIds: Iterable<string>) {
  const used = new Set(objects.map(item => item.lookAssetId).filter((id): id is string => Boolean(id)))
  return [...previousIds].filter(id => !used.has(id))
}

export function bindLookOnProject(
  project: DirectorProject,
  objectIds: string[],
  input: CharacterLookInput,
): DirectorProject {
  const ids = new Set(objectIds.filter(Boolean))
  const targets = project.objects.filter(item => ids.has(item.id) && item.kind === 'character')
  if (!targets.length)
    return project

  const previousIds = new Set(targets.map(item => item.lookAssetId).filter((id): id is string => Boolean(id)))
  // 同一毫秒内连绑两次会撞 id（旧图判「没人用」时就删不掉），加一段随机后缀
  const assetId = `look_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const asset: DirectorAssetRef = {
    id: assetId,
    kind: 'character',
    sourceType: 'image',
    fileName: input.fileName.trim() || 'look.jpg',
    url: input.url,
    assetSource: input.assetSource ?? 'library',
  }

  const objects = project.objects.map(item =>
    ids.has(item.id) && item.kind === 'character'
      ? { ...item, lookAssetId: assetId }
      : item,
  )
  const drop = new Set(unusedAfter(objects, previousIds))

  return {
    ...project,
    assets: [...project.assets.filter(item => !drop.has(item.id)), asset],
    objects,
  }
}

export function clearLookOnProject(project: DirectorProject, objectIds: string[]): DirectorProject {
  const ids = new Set(objectIds.filter(Boolean))
  const targets = project.objects.filter(item => ids.has(item.id) && item.kind === 'character')
  if (!targets.length)
    return project

  const previousIds = new Set(targets.map(item => item.lookAssetId).filter((id): id is string => Boolean(id)))
  const objects = project.objects.map(item =>
    ids.has(item.id) && item.lookAssetId
      ? { ...item, lookAssetId: undefined }
      : item,
  )
  const drop = new Set(unusedAfter(objects, previousIds))

  return {
    ...project,
    assets: project.assets.filter(item => !drop.has(item.id)),
    objects,
  }
}

/**
 * 画布送来的角色图：只填空位，不覆盖导演台里已经绑过的。
 * 和全景一样在装场景时并进去，不占撤销步。
 */
export function attachLookToDefaultCharacter(
  project: DirectorProject,
  input: CharacterLookInput,
): DirectorProject {
  const target = pickLookTarget(project)
  if (!target)
    return project
  if (target.lookAssetId) {
    const existing = project.assets.find(item => item.id === target.lookAssetId && item.url)
    if (existing)
      return project
  }
  return bindLookOnProject(project, [target.id], { ...input, assetSource: input.assetSource ?? 'library' })
}
