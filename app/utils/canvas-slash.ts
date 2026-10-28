/**
 * Slash 快捷入口（L2）：在提示词输入框打 "/" 就地列出当前节点能用的能力，
 * 挑中的 key 走的还是生成器下方那排 chip 的同一条通道（CanvasInspector 的 chip 事件）。
 */

export type SlashItem = {
  /** 与 chip 的 key 一致，工作区按它分发 */
  key: string
  label: string
  hint: string
  icon: string
  /** 适用的节点类型，空数组表示都适用 */
  kinds: string[]
  /** 搜索时额外可命中的词 */
  alias?: string[]
}

export const SLASH_ITEMS: SlashItem[] = [
  { key: 'ref', label: '参考素材', hint: '从资产库选参考图 / 视频 / 音频', icon: 'i-lucide-images', kinds: ['image', 'video', 'audio', 'panorama', 'director'], alias: ['cankao', 'reference'] },
  { key: 'ref-local', label: '上传参考', hint: '从本地上传一份参考素材', icon: 'i-lucide-upload', kinds: ['image', 'video', 'audio', 'panorama', 'director'], alias: ['upload', 'shangchuan'] },
  { key: 'ref-canvas', label: '从画布选参考', hint: '直接点画布上已有的节点', icon: 'i-lucide-mouse-pointer-click', kinds: ['image', 'video', 'audio', 'panorama', 'director'] },
  { key: 'mark', label: '标记元素', hint: '在参考图上圈出要用的局部', icon: 'i-lucide-scan-search', kinds: ['image', 'video', 'panorama'], alias: ['biaoji', 'mark'] },
  { key: 'style', label: '风格参考', hint: '选一张图定整体风格', icon: 'i-lucide-box', kinds: ['image', 'panorama'], alias: ['fengge', 'style'] },
  { key: 'stylelib', label: '风格库', hint: '套用运营配好的整体风格', icon: 'i-lucide-palette', kinds: ['image', 'video', 'panorama', 'director'], alias: ['fenggeku', 'stylelib'] },
  { key: 'lens', label: '摄像机控制', hint: '相机、镜头、焦距、光圈', icon: 'i-lucide-aperture', kinds: ['image', 'video', 'panorama', 'director'], alias: ['xiangji', 'camera', 'lens'] },
  { key: 'grid', label: '宫格与故事板', hint: '九宫格、剧情推演、故事板、角色设定图', icon: 'i-lucide-layout-grid', kinds: ['image', 'panorama'], alias: ['gongge', 'grid', 'storyboard', 'fenjing'] },
  { key: 'optimize', label: '提示词优化', hint: '一键改写成结构化提示词，对照后填回', icon: 'i-lucide-sparkles', kinds: ['image', 'video', 'panorama', 'director'], alias: ['youhua', 'optimize', 'rewrite'] },
  { key: 'cam', label: '运镜预设', hint: '推拉摇移环绕等运镜', icon: 'i-lucide-video', kinds: ['video', 'director'], alias: ['yunjing', 'camera-move'] },
  { key: 'first', label: '首帧', hint: '指定视频第一帧', icon: 'i-lucide-image-play', kinds: ['video'], alias: ['shouzhen'] },
  { key: 'last', label: '尾帧', hint: '指定视频最后一帧', icon: 'i-lucide-image-down', kinds: ['video'], alias: ['weizhen'] },
  { key: 'cast', label: '角色素材', hint: '从资产库选角色形象或声音', icon: 'i-lucide-user-round', kinds: ['video', 'director'], alias: ['juese', 'cast', '角色库'] },
  { key: 'set', label: '场景', hint: '引用已有场景图', icon: 'i-lucide-mountain-snow', kinds: ['video', 'director'], alias: ['changjing', 'scene'] },
  { key: 'voice', label: '音色', hint: '选一段音频定音色', icon: 'i-lucide-audio-lines', kinds: ['audio', 'video'], alias: ['yinse', 'voice'] },
  { key: 'skill', label: '技能模板', hint: '套用运营配好的技能', icon: 'i-lucide-wand-sparkles', kinds: [], alias: ['jineng', 'skill'] },
  { key: 'prompt', label: '提示词库', hint: '从提示词库挑一段', icon: 'i-lucide-text-quote', kinds: [], alias: ['tishici', 'prompt'] },
  { key: 'template', label: '模板', hint: '套用现成的提示词模板', icon: 'i-lucide-layout-template', kinds: [], alias: ['muban', 'template'] },
]

/** Slash 面板最多列这么多条：视频节点能用的能力已经十来条，8 会把首尾帧挤出去 */
export const SLASH_MAX = 10

/** "/" 前面必须是行首或空白，句子里的斜杠（如 16/9）不触发 */
function slashStart(src: string, caret: number) {
  for (let i = caret; i > 0; i--) {
    const ch = src[i - 1] || ''
    if (ch === '/') {
      const prev = src[i - 2]
      return prev == null || /\s/.test(prev) ? i - 1 : -1
    }
    if (/\s/.test(ch) || caret - i >= 12)
      return -1
  }
  return -1
}

/** 光标处的 slash 查询；不在 slash 状态返回 null */
export function slashQueryAt(prompt: string, caret: number): { query: string, start: number } | null {
  const src = String(prompt || '')
  const at = Math.max(0, Math.min(caret, src.length))
  const start = slashStart(src, at)
  if (start < 0)
    return null
  return { query: src.slice(start + 1, at), start }
}

function matches(item: SlashItem, query: string) {
  if (!query)
    return true
  const key = query.toLowerCase()
  return item.label.toLowerCase().includes(key)
    || item.key.toLowerCase().includes(key)
    || item.hint.toLowerCase().includes(key)
    || (item.alias || []).some(word => word.toLowerCase().includes(key))
}

export function filterSlashItems(kind: string, query = '', items: SlashItem[] = SLASH_ITEMS) {
  const node = String(kind || '')
  return items
    .filter(item => !item.kinds.length || item.kinds.includes(node))
    .filter(item => matches(item, query))
    .slice(0, SLASH_MAX)
}

/** 选中后把 "/查询词" 从提示词里删掉 */
export function clearSlashQuery(prompt: string, start: number, caret: number) {
  const src = String(prompt || '')
  const from = Math.max(0, Math.min(start, src.length))
  const to = Math.max(from, Math.min(caret, src.length))
  return { prompt: src.slice(0, from) + src.slice(to), caret: from }
}

/** 面板里上下移动，到头回绕 */
export function moveSlashIndex(index: number, delta: number, total: number) {
  if (total <= 0)
    return 0
  return ((index + delta) % total + total) % total
}
