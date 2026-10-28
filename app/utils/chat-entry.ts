/** Agent 页把一次对话交给画布侧边栏：先记下草稿，进画布后再按画布自己的发送走一遍 */
export const CHAT_ENTRY_KEY = 'easytv-chat-entry'

export type ChatEntryAttachment = {
  key: string
  kind: 'image' | 'video' | 'audio'
  name: string
  assetId?: number
  url?: string
}

export type ChatEntrySkill = {
  id: number
  title: string
  slug: string
  cover: string
  description: string
  hasGuide: boolean
  prompt?: string
}

export type ChatEntryDraft = {
  prompt: string
  skill: ChatEntrySkill | null
  agentAuto: boolean
  model: string
  styleName: string
  stylePrompt: string
  styleCover?: string
  attachments: ChatEntryAttachment[]
}

export function writeChatEntry(draft: ChatEntryDraft) {
  try {
    sessionStorage.setItem(CHAT_ENTRY_KEY, JSON.stringify(draft))
  }
  catch {
    // 私密模式写不进去时，画布侧读不到就只打开空白对话
  }
}

export function takeChatEntry(): ChatEntryDraft | null {
  try {
    const raw = sessionStorage.getItem(CHAT_ENTRY_KEY)
    sessionStorage.removeItem(CHAT_ENTRY_KEY)
    if (!raw)
      return null
    const data = JSON.parse(raw) as ChatEntryDraft
    if (!data || typeof data.prompt !== 'string')
      return null
    return data
  }
  catch {
    return null
  }
}
