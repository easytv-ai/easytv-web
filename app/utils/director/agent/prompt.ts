/**
 * 拼给模型的提示词。
 *
 * 上游把指令说明放在 Anthropic Messages API 的 system 字段里。我们走的是
 * 自己的 POST /user/task（type=text），请求体只有 prompt，没有 system，
 * 所以指令说明、场景摘要、对话历史、用户这句话按固定顺序拼成一段。
 *
 * 没有做成 skill 的执行契约（POST /user/task 的 skill_id 会让服务端注入
 * 【执行规则】【输出格式】）—— 那套是给运营在管理端维护文案用的，而这里的
 * 指令表必须和执行器的代码同步；放进数据库就会出现代码加了指令、DB 里的
 * 说明没加，模型永远不知道有这条。
 */
import { COMMAND_DOCS, buildSceneSummary } from './commands'
import type { DirectorStore } from '../store'

export interface AgentTurn {
  role: 'user' | 'assistant'
  content: string
}

/** 带多少轮历史。再多一方面是浪费 token，一方面老指令会干扰当前这句 */
export const HISTORY_TURNS = 8

export function buildAgentPrompt(options: {
  store: DirectorStore
  history: AgentTurn[]
  question: string
}): string {
  const { store, history, question } = options

  const parts = [
    COMMAND_DOCS,
    buildSceneSummary(store),
  ]

  // 调用方常常是「把用户这句 push 进消息列表之后」才来拼提示词，
  // 那样末尾那条就是当前这句，会在「之前的对话」和「这次的要求」里各出现一遍
  const earlier = history[history.length - 1]?.role === 'user'
    && history[history.length - 1]?.content === question
    ? history.slice(0, -1)
    : history

  const recent = earlier.slice(-HISTORY_TURNS)
  if (recent.length) {
    parts.push([
      '之前的对话：',
      ...recent.map(turn => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`),
    ].join('\n'))
  }

  parts.push(`用户这次的要求：${question}`)
  // 说明放最前、要求放最后，中间隔开；模型对开头和结尾的注意力最好
  parts.push('现在只输出 JSON 指令数组。')

  return parts.join('\n\n')
}
