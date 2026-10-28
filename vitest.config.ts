import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 导演台数据层的单元测试（复刻计划阶段 1）。
 *
 * 这层是纯逻辑，不需要 Nuxt 运行时，所以用裸 vitest 跑，不引 @nuxt/test-utils ——
 * 启动快，也不会把 Nuxt 的环境问题混进来。只配一个 ~ 别名对齐项目写法。
 */
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts'],
  },
})
