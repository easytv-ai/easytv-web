import { pathWithoutLocale } from '~/utils/app-path'
import { parseProductTab, type ProductTab } from '~/utils/pricing-plans'

const PRICING_TAB_KEY = 'easytv-pricing-tab'

export function usePricingModal() {
  const pricingOpen = useState('pricing-modal-open', () => false)
  const pricingTab = useState<ProductTab>('pricing-modal-tab', () => 'membership')

  function rememberPricingTab(tab: ProductTab) {
    if (import.meta.client)
      sessionStorage.setItem(PRICING_TAB_KEY, parseProductTab(tab))
  }

  function openPricing(tab: ProductTab = 'membership') {
    pricingTab.value = parseProductTab(tab)
    pricingOpen.value = true
  }

  function closePricing() {
    pricingOpen.value = false
  }

  function gotoPricing(tab: ProductTab) {
    const route = useRoute()
    const router = useRouter()
    if (pathWithoutLocale(route.path) === '/pricing') {
      const query = { ...route.query }
      if (tab === 'membership')
        delete query.tab
      else
        query.tab = tab
      void router.replace({ path: route.path, query })
      closePricing()
      return
    }
    if (pricingOpen.value && pricingTab.value === tab) {
      closePricing()
      return
    }
    openPricing(tab)
  }

  function restorePricingAfterLogin() {
    if (!import.meta.client)
      return
    const saved = sessionStorage.getItem(PRICING_TAB_KEY)
    if (!saved)
      return
    sessionStorage.removeItem(PRICING_TAB_KEY)
    openPricing(parseProductTab(saved))
  }

  return {
    pricingOpen,
    pricingTab,
    openPricing,
    closePricing,
    gotoPricing,
    rememberPricingTab,
    restorePricingAfterLogin,
  }
}
