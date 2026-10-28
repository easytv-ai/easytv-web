import contentApi from '~/api/content'
import { WORK_CATEGORIES } from '~/utils/work-categories'

/** 接口不可用时的内置标签（与 seed 数据一致） */
const FALLBACK: Record<'work' | 'skill', readonly string[]> = {
  work: WORK_CATEGORIES,
  skill: ['专业影视', '商业广告', '短剧漫剧', '动漫游戏', '音乐MV', '自媒体创作', '通用技能', '发现'],
}

/**
 * 前台分类标签（GET /category?scope=），运营在后台「内容分类」维护。
 * 返回原文名称数组，渲染时用 t(name) 翻译；接口失败回退内置标签。
 */
export function useContentCategories(scope: 'work' | 'skill') {
  const names = useState<string[]>(`content-categories-${scope}`, () => [...FALLBACK[scope]])
  const loaded = useState<boolean>(`content-categories-${scope}-loaded`, () => false)

  async function load() {
    if (loaded.value)
      return
    try {
      const res = await contentApi.categories(scope)
      if (!res?.success)
        return
      if (Array.isArray(res.data) && res.data.length)
        names.value = res.data.map(item => item.name)
      loaded.value = true
    }
    catch {
      // 保留内置标签
    }
  }

  return { names, load }
}
