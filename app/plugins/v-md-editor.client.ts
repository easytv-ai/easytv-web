import PreviewMod from '@kangc/v-md-editor/lib/preview'
import ThemeMod from '@kangc/v-md-editor/lib/theme/github.js'
import hljs from 'highlight.js'
import { setMarkdownParser } from '~/utils/markdown'
import '@kangc/v-md-editor/lib/style/preview.css'
import '@kangc/v-md-editor/lib/theme/style/github.css'

function unwrap<T>(mod: T | { default: T }): T {
  if (mod && typeof mod === 'object' && 'default' in (mod as object))
    return (mod as { default: T }).default
  return mod as T
}

const VMdPreview = unwrap(PreviewMod)
const githubTheme = unwrap(ThemeMod)

VMdPreview.use(githubTheme, { Hljs: hljs })
VMdPreview.xss.extend({
  whiteList: {
    font: ['color', 'size', 'face'],
  },
})
setMarkdownParser(text => VMdPreview.vMdParser.parse(text || ''))

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VMdPreview)
})
