/** 由 `@kangc/v-md-editor` 客户端插件注入，画布文本预览与放大编辑共用同一套解析。 */
let parseMarkdown = (text: string) => text

export function setMarkdownParser(fn: (text: string) => string) {
  parseMarkdown = fn
}

export function renderMarkdown(raw: string) {
  const source = (raw || '').trim()
  if (!source)
    return ''
  return parseMarkdown(source)
}
