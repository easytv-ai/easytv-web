/**
 * 从模型回复里抠出指令数组（复刻自 open-director 的 extractCommands，MIT）。
 *
 * 就算提示词里写死了「只输出 JSON」，模型还是经常包一层 ```json 代码块，
 * 或者在前后加一句「好的，我来帮你布置」。这里把这些都容忍掉。
 */
import type { DirectorCommand } from './commands'

export class CommandParseError extends Error {
  /** 解析失败时把原文带上，面板要把它显示给用户看 */
  readonly raw: string

  constructor(message: string, raw: string) {
    super(message)
    this.name = 'CommandParseError'
    this.raw = raw
  }
}

export function extractCommands(text: string): DirectorCommand[] {
  const trimmed = text.trim()

  // 有代码块就只看代码块里的内容，块外常常是「好的，我来帮你布置」这类话
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const source = fenced?.[1]?.trim() ?? trimmed

  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start)
    throw new CommandParseError('模型没有按指令格式回复', text)

  let parsed: unknown
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  }
  catch {
    throw new CommandParseError('模型返回的指令不是合法 JSON', text)
  }

  if (!Array.isArray(parsed))
    throw new CommandParseError('模型返回的不是指令数组', text)

  // 逐条挑出形状对的，坏掉的直接丢 —— 交给执行器的每一条都得有 action
  const commands = parsed.filter((item): item is DirectorCommand =>
    Boolean(item) && typeof item === 'object' && typeof (item as DirectorCommand).action === 'string',
  )

  if (!commands.length)
    throw new CommandParseError('模型返回的指令里没有一条能用', text)

  return commands
}
