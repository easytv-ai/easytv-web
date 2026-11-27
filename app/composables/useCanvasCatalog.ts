import taskApi from '~/api/task'
import type { GenerationModel } from '~/types/creative'
import { pickVisionTextModel } from '~/utils/image-input'

/**
 * 画布共用的模型清单和看图配置。
 * 进页时拉过的清单、后台看图模型会留在这次打开里。
 * 反推、标记、定风格、拉片、智能识别、对话带图都从这里读，避免有的按钮还拿着空配置。
 */
export function useCanvasCatalog() {
  const models = useState<GenerationModel[]>('generation-models', () => [])
  const loaded = useState('generation-models-loaded', () => false)
  const { growth, load: reloadGrowth } = useStudioAppConfig()

  async function ensureModels(force = false) {
    if (models.value.length && !force)
      return models.value
    const res = await taskApi.models()
    if (res?.success && Array.isArray(res.data)) {
      models.value = res.data
      loaded.value = true
    }
    return models.value
  }

  /** 先读最新的后台看图模型，清单里没有这条再补拉一次，然后按配置挑。 */
  async function resolveVisionTextModel() {
    await reloadGrowth(true)
    const want = String(growth.value?.vision_text_model || '').trim()
    const listed = Boolean(want && models.value.some(item => item.type === 'text' && item.model === want))
    if (!models.value.length || (want && !listed))
      await ensureModels(true)
    return pickVisionTextModel(models.value, want)
  }

  return { models, loaded, growth, ensureModels, resolveVisionTextModel }
}
