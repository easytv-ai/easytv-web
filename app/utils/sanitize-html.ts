/**
 * 富文本净化：用于 v-html 前过滤用户或导入内容里的脚本与事件属性。
 * 画布文本节点、分享 / 导入的画布 JSON、站内公告正文都可能带 HTML，只保留展示用的标签与安全属性。
 */

const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'template', 'svg', 'math', 'noscript',
])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'srcdoc', 'srcset'])

function unsafeUrl(value: string) {
  const v = value.replace(/\s+/g, '').toLowerCase()
  if (v.startsWith('javascript:') || v.startsWith('vbscript:'))
    return true
  return v.startsWith('data:') && !v.startsWith('data:image/')
}

function sanitizeElement(el: Element) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    if (name.startsWith('on') || name === 'srcdoc') {
      el.removeAttribute(attr.name)
      continue
    }
    if (URL_ATTRS.has(name) && unsafeUrl(attr.value)) {
      el.removeAttribute(attr.name)
      continue
    }
    if (name === 'style' && /expression\s*\(|javascript:|behavior\s*:|@import/i.test(attr.value))
      el.removeAttribute(attr.name)
  }
}

/** 没有 DOM 时（SSR）的保守回退：只做正则剥离。 */
function sanitizeFallback(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta|base|form|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|link|meta|base|input|button|textarea|select|template|noscript)\b[^>]*\/?>/gi, '')
    .replace(/\s(on[a-z]+|srcdoc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src|action|formaction|poster|background)\s*=\s*(["']?)\s*(javascript|vbscript):[^"'\s>]*\2/gi, '')
    .replace(/\sstyle\s*=\s*("[^"]*(?:expression\s*\(|javascript:|behavior\s*:|@import)[^"]*"|'[^']*(?:expression\s*\(|javascript:|behavior\s*:|@import)[^']*')/gi, '')
}

export function sanitizeHtml(html: string): string {
  if (!html)
    return ''
  if (typeof DOMParser === 'undefined')
    return sanitizeFallback(html)
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (BLOCKED_TAGS.has(el.tagName.toLowerCase())) {
      el.remove()
      continue
    }
    sanitizeElement(el)
  }
  return doc.body.innerHTML
}
