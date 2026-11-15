// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

/**
 * 只把关「正确性」，不管格式和写法偏好（不引入 stylistic / prettier）。
 * 四个前端仓库（web / manage / partner / website）用同一套分级思路：
 *   - error：现有代码零违反（或已手工修完）的正确性规则，新代码不许再犯；
 *   - warn ：存量太多、一时改不完的规则，只提示不拦 CI（lint 脚本不加 --max-warnings）；
 *   - off  ：纯风格 / 偏好类规则。
 * 请不要对全仓库跑 `eslint --fix`：大面积改动会和别人的提交冲突。
 */
export default withNuxt(
  {
    ignores: ['.nuxt/**', '.output/**', '.data/**', '.wrangler/**', 'dist/**', 'node_modules/**', 'public/**', '**/*.d.ts'],
  },
  {
    rules: {
      // ---- error：正确性 ----
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 空 catch 是「失败就算了」的惯用写法，放行；其它空代码块仍报错
      'no-empty': ['error', { allowEmptyCatch: true }],

      // ---- warn：存量太多，暂为 warn ----
      '@typescript-eslint/no-explicit-any': 'warn',
      'vue/no-mutating-props': 'warn',
      'vue/no-v-html': 'warn',
      // 命中的多是 try/catch 前的防御性初始值，不是 bug；先提示，不拦
      'no-useless-assignment': 'warn',

      // ---- off：风格 / 偏好类，不在本仓库的 lint 范围 ----
      'vue/attributes-order': 'off',
      'vue/html-self-closing': 'off',
      'vue/require-default-prop': 'off',
      'prefer-const': 'off',
      'import/first': 'off',
      'import/no-duplicates': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
    },
  },
  {
    // 模板里的全角空格是有意的排版；.vue 改用能识别模板文本的同名规则
    files: ['**/*.vue'],
    rules: {
      'no-irregular-whitespace': 'off',
      'vue/no-irregular-whitespace': ['error', { skipHTMLTextContents: true }],
    },
  },
)
