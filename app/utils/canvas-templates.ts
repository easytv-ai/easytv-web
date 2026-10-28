/**
 * 画布提示词结构模板：分镜脚本 / 角色小传等骨架。
 * CanvasTextPickModal（节点提示词）与 CanvasChat（对话输入）共用。
 * 正文逐行翻译再拼：词条 key 不能带换行（见 scripts/i18n-keys.txt 一行一个 key）。
 */
export type PromptTemplate = { id: string, icon: string, title: string, text: string }

const PROMPT_TEMPLATE_DEFS = [
  { id: 'shot', icon: 'i-lucide-clapperboard', title: '分镜脚本', lines: ['场次：', '镜头：', '景别：', '运镜：', '画面：', '对白：'] },
  { id: 'role', icon: 'i-lucide-user-round', title: '角色小传', lines: ['姓名：', '年龄：', '外形：', '性格：', '目标：', '冲突：'] },
  { id: 'scene', icon: 'i-lucide-map-pin', title: '场景描述', lines: ['地点：', '时间：', '光线：', '氛围：', '道具：', '可拍细节：'] },
  { id: 'dialog', icon: 'i-lucide-messages-square', title: '对白', lines: ['角色A：', '角色B：'] },
  { id: 'list', icon: 'i-lucide-list-ordered', title: '镜头列表', lines: ['1. 远景建立', '2. 中景对话', '3. 近景情绪', '4. 特写物件'] },
] as const

export function promptTemplates(t: (key: string) => string): PromptTemplate[] {
  return PROMPT_TEMPLATE_DEFS.map(def => ({
    id: def.id,
    icon: def.icon,
    title: t(def.title),
    text: `${def.lines.map(line => t(line)).join('\n')}\n`,
  }))
}
