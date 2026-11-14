import { resolveNoModelsHint } from '~/utils/canvas-no-models'

/** 当前登录用户在模型清单为空时该看到的提示（运营后台地址取运行时配置 manageUrl） */
export function useNoModelsHint() {
  const { user } = useAuth()
  return computed(() => resolveNoModelsHint(user.value, useRuntimeConfig().public.manageUrl))
}
