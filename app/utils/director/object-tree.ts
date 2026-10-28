/**
 * 对象树的分组与搜索（复刻自 open-director 的 ObjectTreePanel.tsx，MIT）。
 *
 * 面板只负责画，分到哪一组、搜不搜得到、算不算选中，全在这里 ——
 * 这几条规则有不少边角（群众要折成一行、模型和几何体靠 asset 区分），
 * 放在组件里没法单独测。
 */
import type { DirectorAssetRef, DirectorObject } from './schema'

/** UIcon 的图标名，和画布里别处的写法一致（i-lucide-*） */
export type ObjectTreeIcon =
  | 'i-lucide-user'
  | 'i-lucide-users'
  | 'i-lucide-box'
  | 'i-lucide-boxes'
  | 'i-lucide-camera'
  | 'i-lucide-globe'

export interface ObjectTreeChild {
  id: string
  name: string
  icon: ObjectTreeIcon
  visible: boolean
  locked: boolean
}

export interface ObjectTreeItem {
  /** 普通对象是对象 id，群众组是 crowdId */
  id: string
  name: string
  icon: ObjectTreeIcon
  /** 普通对象有；群众组没有单个对象，可见 / 锁定看下面两个聚合字段 */
  object?: DirectorObject
  visible: boolean
  locked: boolean
  /** 这一行代表的所有对象，群众组是全体成员 */
  objectIds: string[]
  crowdId?: string
  children?: ObjectTreeChild[]
}

export interface ObjectTreeGroup {
  key: string
  /** 组标题，i18n key 即中文原文 */
  title: string
  items: ObjectTreeItem[]
}

/** 组的顺序就是面板里从上到下的顺序 */
const GROUP_ORDER = [
  { key: 'characters', title: '角色' },
  { key: 'crowd', title: '群众' },
  { key: 'geometry', title: '几何体' },
  { key: 'models', title: '我的模型' },
  { key: 'panorama', title: '全景' },
  { key: 'cameras', title: '摄像机' },
] as const

/**
 * 对象是不是由导入的模型驱动的。
 *
 * assetRefId 指向的素材找不到时也算模型：素材表还没加载完的那一瞬间，
 * 宁可先归到「我的模型」，也别让它在几何体组里闪一下再跳走。
 */
function isModelBacked(object: DirectorObject | undefined, assets: Map<string, DirectorAssetRef>) {
  if (!object?.assetRefId)
    return false
  const asset = assets.get(object.assetRefId)
  return !asset || asset.sourceType === 'model'
}

function iconOf(object: DirectorObject, assets: Map<string, DirectorAssetRef>): ObjectTreeIcon {
  if (object.kind === 'camera')
    return 'i-lucide-camera'
  if (object.kind === 'character')
    return 'i-lucide-user'
  if (object.kind === 'panorama')
    return 'i-lucide-globe'
  // 导入的模型和内置几何体用不同的图标，一眼能看出哪些是外部素材
  return isModelBacked(object, assets) ? 'i-lucide-boxes' : 'i-lucide-box'
}

/** 把对象列表整理成面板要画的分组结构；空组会被去掉 */
export function buildObjectTree(objects: DirectorObject[], assetList: DirectorAssetRef[]): ObjectTreeGroup[] {
  const assets = new Map(assetList.map(asset => [asset.id, asset]))
  const crowds = new Map<string, ObjectTreeItem>()
  const singles: ObjectTreeItem[] = []

  for (const object of objects) {
    // 群众成员折成一行：一组几十个人各占一行的话，树就没法看了
    if (object.kind === 'character' && object.crowdId && object.crowdLabel) {
      const existing = crowds.get(object.crowdId)
      const child: ObjectTreeChild = {
        id: object.id,
        name: object.name,
        icon: 'i-lucide-user',
        visible: object.visible,
        locked: object.locked,
      }

      if (existing) {
        existing.objectIds.push(object.id)
        existing.children!.push(child)
        existing.visible = existing.visible && object.visible
        existing.locked = existing.locked && object.locked
        continue
      }

      crowds.set(object.crowdId, {
        id: object.crowdId,
        name: object.crowdLabel,
        icon: 'i-lucide-users',
        crowdId: object.crowdId,
        visible: object.visible,
        locked: object.locked,
        objectIds: [object.id],
        children: [child],
      })
      continue
    }

    singles.push({
      id: object.id,
      name: object.name,
      icon: iconOf(object, assets),
      object,
      visible: object.visible,
      locked: object.locked,
      objectIds: [object.id],
    })
  }

  const byKey: Record<string, ObjectTreeItem[]> = {
    characters: singles.filter(item => item.object?.kind === 'character'),
    crowd: [...crowds.values()],
    geometry: singles.filter(item => item.icon === 'i-lucide-box'),
    models: singles.filter(item => item.icon === 'i-lucide-boxes'),
    panorama: singles.filter(item => item.object?.kind === 'panorama'),
    cameras: singles.filter(item => item.object?.kind === 'camera'),
  }

  return GROUP_ORDER
    .map(group => ({ key: group.key, title: group.title, items: byKey[group.key] ?? [] }))
    .filter(group => group.items.length > 0)
}

/**
 * 按关键字过滤。
 *
 * 群众组的成员名命中时，整组保留但只列命中的成员 —— 搜「群众 3」要能直接
 * 看到那一个人，而不是把整组三十个人都摊开。
 */
export function filterObjectTree(groups: ObjectTreeGroup[], query: string): ObjectTreeGroup[] {
  const keyword = query.trim()
  if (!keyword)
    return groups

  const hit = (text: string) => text.toLowerCase().includes(keyword.toLowerCase())

  return groups
    .map((group) => {
      const items = group.items.flatMap((item) => {
        const matchedChildren = item.children?.filter(child => hit(child.name)) ?? []
        if (hit(item.name))
          return [item]
        if (matchedChildren.length)
          return [{ ...item, children: matchedChildren }]
        return []
      })
      return { ...group, items }
    })
    .filter(group => group.items.length > 0)
}

/** 当前选中的对象 id：多选优先，没有多选就看单选 */
export function resolveSelectedIds(state: {
  selectedObjectId: string | null
  selectedObjectIds: string[]
}): string[] {
  if (state.selectedObjectIds.length)
    return state.selectedObjectIds
  return state.selectedObjectId ? [state.selectedObjectId] : []
}

/**
 * 这一行算不算选中。
 *
 * 群众组有两种算法：整组被选（selectedCrowdId），或者成员被逐个选全了 ——
 * 后者是用户按住 Shift 一个个点出来的，视觉上也该显示成整组选中。
 */
export function isTreeItemSelected(
  item: ObjectTreeItem,
  state: { selectedObjectId: string | null, selectedObjectIds: string[], selectedCrowdId: string | null },
): boolean {
  if (item.crowdId && state.selectedCrowdId === item.crowdId)
    return true

  const selectedIds = resolveSelectedIds(state)
  if (!selectedIds.length)
    return false

  return item.objectIds.every(id => selectedIds.includes(id))
}
