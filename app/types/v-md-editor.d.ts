declare module '@kangc/v-md-editor/lib/preview' {
  import type { Plugin } from 'vue'

  const VMdPreview: Plugin & {
    use: (theme: unknown, options?: unknown) => void
    vMdParser: { parse: (text: string) => string }
    xss: { extend: (options: unknown) => void }
  }

  export default VMdPreview
}

declare module '@kangc/v-md-editor/lib/theme/github.js' {
  const githubTheme: unknown
  export default githubTheme
}
