/** 统一去掉末尾斜杠，避免 /demo/chat/ 与 /demo/chat 布局不一致 */
export default defineNuxtRouteMiddleware((to) => {
  const { path, query, hash } = to
  if (path.length > 1 && path.endsWith('/')) {
    return navigateTo(
      {
        path: path.replace(/\/+$/, '') || '/',
        query,
        hash,
      },
      { redirectCode: 301 },
    )
  }
})
