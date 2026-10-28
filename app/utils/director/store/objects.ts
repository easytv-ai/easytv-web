/**
 * 场景对象的查找与改写工具（复刻自 open-director 的 store/directorStore.ts，MIT）。
 *
 * 这层全是纯函数：进去一个对象数组，出来一个新数组，不碰任何状态。
 * store 的动作都靠它们拼出来，测试也能脱开 store 单独跑。
 */
import type { DirectorObject, DirectorTransform } from '../schema'

/** 角色默认配色，按顺序取，用完了再循环 */
export const CHARACTER_COLOR_PALETTE = [
  '#4F8EF7',
  '#E0524D',
  '#E91E63',
  '#F2A900',
  '#3FB950',
  '#9B5DE5',
  '#00BCD4',
  '#FF7043',
]

/** 坐标一律收敛到 6 位小数：拖拽会拖出一长串浮点尾巴，存进 JSON 又丑又大 */
export function roundTransformValue(value: number) {
  return Number(value.toFixed(6))
}

export function roundTransformTuple(values: [number, number, number]): [number, number, number] {
  return values.map(value => roundTransformValue(value)) as [number, number, number]
}

export function updateObjectById(
  objects: DirectorObject[],
  id: string,
  updater: (item: DirectorObject) => DirectorObject,
) {
  return objects.map(item => (item.id === id ? updater(item) : item))
}

export function getCrowdMemberObjects(objects: DirectorObject[], crowdId: string) {
  return objects.filter(item => item.crowdId === crowdId)
}

export function getCrowdMemberIds(objects: DirectorObject[], crowdId: string) {
  return getCrowdMemberObjects(objects, crowdId).map(item => item.id)
}

/**
 * 群众组的锚点：取全组位置的平均值，旋转和缩放取第一个成员的。
 * 面板上拖"整组"时就是拖这个锚点，各成员按相对偏移跟着动。
 */
export function getCrowdAnchorTransform(objects: DirectorObject[], crowdId: string): DirectorTransform | null {
  const members = getCrowdMemberObjects(objects, crowdId)
  if (!members.length)
    return null

  const sum = members.reduce<[number, number, number]>((acc, item) => {
    acc[0] += item.transform.position[0]
    acc[1] += item.transform.position[1]
    acc[2] += item.transform.position[2]
    return acc
  }, [0, 0, 0])

  const first = members[0]!
  return {
    position: roundTransformTuple([sum[0] / members.length, sum[1] / members.length, sum[2] / members.length]),
    rotation: [...first.transform.rotation],
    scale: [...first.transform.scale],
  }
}

/** 新角色挑一个还没被用过的颜色，全用过了就按数量循环 */
export function getNextCharacterColor(objects: DirectorObject[]) {
  const used = new Set(objects.filter(item => item.kind === 'character').map(item => item.color))
  const unused = CHARACTER_COLOR_PALETTE.find(color => !used.has(color))
  if (unused)
    return unused

  const characterCount = objects.filter(item => item.kind === 'character').length
  return CHARACTER_COLOR_PALETTE[characterCount % CHARACTER_COLOR_PALETTE.length]!
}

/**
 * 按前缀取下一个可用编号，比如 char_3、cam_object_2。
 * 删掉中间的对象再新建时不会撞号，因为只看现有 id 里的最大值。
 */
export function getNextSequentialId(existingIds: string[], prefix: string, minimumIndex = 1) {
  let maxIndex = minimumIndex - 1

  for (const id of existingIds) {
    if (!id.startsWith(prefix))
      continue
    const suffix = id.slice(prefix.length)
    const parsed = Number.parseInt(suffix, 10)
    if (Number.isFinite(parsed) && String(parsed) === suffix)
      maxIndex = Math.max(maxIndex, parsed)
  }

  return `${prefix}${maxIndex + 1}`
}

/** 场景里同类对象的下一个显示编号（角色01、机位02 那个数字） */
export function getNextSceneItemIndex(objects: DirectorObject[], kind: DirectorObject['kind']) {
  return objects.filter(item => item.kind === kind).length + 1
}
