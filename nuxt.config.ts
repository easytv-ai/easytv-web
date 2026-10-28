import { defineNuxtConfig } from 'nuxt/config'

const defaultLocale = 'zh'

export default defineNuxtConfig({
  ignore: ['**/pages/**/components/**'],
  app: {
    head: {
      script: [
        {
          innerHTML: `(function(){try{var k='easytv-theme',s=localStorage.getItem(k),d=s==='light'?false:true;var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          type: 'text/javascript',
          tagPosition: 'head',
        },
      ],
    },
  },
  ssr: true,
  experimental: {
    renderJsonPayloads: true,
    payloadExtraction: false,
    appManifest: true,
  },
  nitro: {
    prerender: {
      autoSubfolderIndex: true,
      routes: ['/robots.txt', '/sitemap.xml'],
      crawlLinks: false,
    },

    routeRules: {
      '/oauth/**': { prerender: false, ssr: false },
      // 哈希文件名可变，长期缓存；HTML 不缓存，避免发版后还指向已删除的 /_nuxt/*.js
      '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
      '/**': { headers: { 'cache-control': 'no-cache, must-revalidate' } },
    },

    preset: "cloudflare_module",

    cloudflare: {
      deployConfig: true,
      nodeCompat: true
    }
  },
  /**
   * Tres 网格、几何体是自定义标签，只在导演台模板里出现。
   * 不把 @tresjs/nuxt 放进全局 modules，落地页和设置页就不会带上 three。
   * 白名单和 @tresjs/core 的 templateCompilerOptions 一致：TresCanvas 仍是普通组件。
   */
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) =>
        ((/^Tres[A-Z]/.test(tag) || tag.startsWith('tres-'))
          && tag !== 'TresCanvas'
          && tag !== 'TresCanvasContext'
          && tag !== 'TresLeches'
          && tag !== 'TresScene')
        || tag === 'primitive',
    },
  },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', 'nitro-cloudflare-dev'],
  ui: {
    colorMode: false,
    fonts: false,
  },
  appConfig: {
    ui: {
      colors: {
        primary: 'primary',
        neutral: 'neutral',
      },
    },
  },
  i18n: {
    defaultLocale,
    strategy: 'prefix_except_default',
    baseUrl: 'https://www.easytv.ai',
    lazy: true,
    langDir: 'locales',
    locales: [
      { code: 'zh', language: 'zh-CN', name: '简体中文', file: 'zh.json' },
      { code: 'zh-tw', language: 'zh-TW', name: '繁體中文', file: 'zh-TW.json' },
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'fr', language: 'fr', name: 'Français', file: 'fr.json' },
      { code: 'ja', language: 'ja', name: '日本語', file: 'ja.json' },
      { code: 'ru', language: 'ru', name: 'Русский', file: 'ru.json' },
      { code: 'vi', language: 'vi', name: 'Tiếng Việt', file: 'vi.json' },
    ],
    detectBrowserLanguage: false,
    vueI18n: './i18n.config.ts',
  } as any,
  css: [
    '~/assets/css/main.css',
    '~/assets/css/studio-base.css',
  ],
  build: {
    transpile: ['@kangc/v-md-editor', '@tresjs/core', '@tresjs/cientos'],
  },
  vite: {
    resolve: {
      dedupe: ['three'],
    },
    optimizeDeps: {
      include: [
        '@vue-flow/core',
        '@vue-flow/background',
        '@kangc/v-md-editor/lib/preview',
        '@kangc/v-md-editor/lib/theme/github.js',
        'highlight.js',
        /**
         * cientos 入口会 `import Stats from 'stats.js'`。stats.js 是 UMD，没有 ESM default。
         * 不预打包的话 Vite 会直接吐 /_nuxt/@fs/.../stats.min.js，导演台控制台报
         * "does not provide an export named 'default'"。
         */
        'stats.js',
        '@tresjs/cientos',
        '@tresjs/core',
      ],
      needsInterop: ['stats.js'],
    },
  },
  components: true,
  router: {
    options: {
      hashMode: false,
    },
  },
  runtimeConfig: {
    public: {
      defaultLocale,
      siteName: (globalThis as any).process?.env?.NUXT_PUBLIC_SITE_NAME || 'EasyTV',
      /** 站点公开地址：canonical、sitemap、OG 图片绝对地址都从这里拼 */
      siteUrl: (globalThis as any).process?.env?.NUXT_PUBLIC_SITE_URL || 'https://www.easytv.ai',
      apiBaseUrl: (globalThis as any).process?.env?.NUXT_PUBLIC_API_BASE_URL || 'https://tv-api.easyapi.com',
    },
  },
  future: {
    compatibilityVersion: 5,
  },
  compatibilityDate: '2024-11-14',
  hooks: {
    'pages:extend'(pages) {
      for (let i = pages.length - 1; i >= 0; i--) {
        const path = pages[i]?.path ?? ''
        if (path.includes('/components/'))
          pages.splice(i, 1)
        // 导演台调试页只留在本地；生产构建直接拿掉路由
        else if (process.env.NODE_ENV === 'production' && (path === '/director-dev' || path.startsWith('/director-dev/')))
          pages.splice(i, 1)
      }
    },
  },
  devServer: {
    port: 3005,
  },
})