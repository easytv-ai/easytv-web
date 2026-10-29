/**
 * 同一组顶部标签（项目 / 资产 / 主体 / 提示词，推荐 / 关注 / 榜单）之间切换时关掉页面过渡。
 * 这些页面各自渲染标签栏，整页淡入会让标签栏跟着闪；它们都 keepalive，直接切换即可。
 * app.vue 的 useRoute() 要等新页渲染完才更新，所以用 useState 把结果提前交给它。
 */
import { pathWithoutLocale } from '~/utils/app-path'

export default defineNuxtRouteMiddleware((to, from) => {
  const { homeTabs, libraryTabs } = useStudioNav()
  const toPath = pathWithoutLocale(to.path)
  const fromPath = pathWithoutLocale(from.path)
  const sameGroup = toPath !== fromPath && [homeTabs, libraryTabs].some((group) => {
    const paths = group.map(item => item.to as string)
    return paths.includes(toPath) && paths.includes(fromPath)
  })
  useState('studio-tab-switch', () => false).value = sameGroup
})
