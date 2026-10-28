import { ref, watch, type Ref } from 'vue'

export type CanvasOverlayKey =
  | 'smartEdit'
  | 'depth'
  | 'light'
  | 'angle'
  | 'crop'
  | 'erase'
  | 'matting'
  | 'viral'
  | 'outpaint'
  | 'flip'
  | 'mark'
  | 'extendStrip'
  | 'clipStrip'
  | 'splitStrip'

/**
 * 工具面板开关。选中节点变了就关掉不属于该节点的面板。
 * closeOverlays 只关传入的那些，各 opener 的关闭集合保持原样。
 */
export function useCanvasToolOverlays(opts: {
  selectedId: Ref<string | undefined>
}) {
  const markOpen = ref(false)
  const markMode = ref<'mark' | 'erase'>('mark')
  const markSrc = ref('')
  const markExisting = ref('')
  const markNodeId = ref('')
  const inpaintBusy = ref(false)

  const smartEditOpen = ref(false)
  const smartEditSrc = ref('')
  const smartEditNodeId = ref('')
  const smartEditAssetId = ref(0)
  const smartEditRefs = ref<{ assetId: number, url: string }[]>([])
  const smartEditBusy = ref(false)
  const smartEditPick = ref(false)

  const depthOpen = ref(false)
  const depthNodeId = ref('')
  const depthBusy = ref(false)
  const depthResolution = ref<'480p' | '720p'>('480p')
  const depthModel = ref('')

  const lightOpen = ref(false)
  const lightNodeId = ref('')
  const lightBusy = ref(false)
  const lightSrc = ref('')

  const angleOpen = ref(false)
  const angleNodeId = ref('')
  const angleBusy = ref(false)
  const angleSrc = ref('')

  const cropOpen = ref(false)
  const cropNodeId = ref('')
  const cropVariant = ref<'image' | 'video'>('image')

  const eraseOpen = ref(false)
  const eraseNodeId = ref('')
  const eraseMode = ref<'smart' | 'box'>('smart')

  const mattingOpen = ref(false)
  const mattingNodeId = ref('')
  const mattingBusy = ref(false)

  const viralOpen = ref(false)
  const viralNodeId = ref('')
  const viralBusy = ref(false)
  const viralStep = ref<'' | 'analyze' | 'generate'>('')
  const viralModelId = ref('')

  const outpaintOpen = ref(false)
  const outpaintNodeId = ref('')
  const outpaintBusy = ref(false)

  const flipOpen = ref(false)
  const flipNodeId = useState('canvas-flip-node-id', () => '')

  const extendStripOpen = ref(false)
  const extendStripSrc = ref('')
  const extendStripNodeId = ref('')

  const clipStripOpen = ref(false)
  const clipStripSrc = ref('')
  const clipStripNodeId = ref('')

  const splitStripOpen = ref(false)
  const splitStripSrc = ref('')
  const splitStripNodeId = ref('')
  const splitBusy = ref(false)
  const stripAssetDuration = ref(0)

  const editSrc = ref('')

  const opens: Record<CanvasOverlayKey, { open: Ref<boolean>, nodeId?: Ref<string> }> = {
    smartEdit: { open: smartEditOpen, nodeId: smartEditNodeId },
    depth: { open: depthOpen, nodeId: depthNodeId },
    light: { open: lightOpen, nodeId: lightNodeId },
    angle: { open: angleOpen, nodeId: angleNodeId },
    crop: { open: cropOpen, nodeId: cropNodeId },
    erase: { open: eraseOpen, nodeId: eraseNodeId },
    matting: { open: mattingOpen, nodeId: mattingNodeId },
    viral: { open: viralOpen, nodeId: viralNodeId },
    outpaint: { open: outpaintOpen, nodeId: outpaintNodeId },
    flip: { open: flipOpen, nodeId: flipNodeId },
    mark: { open: markOpen, nodeId: markNodeId },
    extendStrip: { open: extendStripOpen, nodeId: extendStripNodeId },
    clipStrip: { open: clipStripOpen, nodeId: clipStripNodeId },
    splitStrip: { open: splitStripOpen, nodeId: splitStripNodeId },
  }

  function closeOverlays(keys: CanvasOverlayKey[]) {
    for (const key of keys)
      opens[key].open.value = false
  }

  /** 锁定节点（及子节点）后：关掉挂在这些 id 上的工具层，免得还能交作业 */
  function closeOverlaysForNodes(ids: Iterable<string>) {
    const set = new Set(ids)
    if (!set.size)
      return
    for (const item of Object.values(opens)) {
      if (item.open.value && item.nodeId && set.has(item.nodeId.value))
        item.open.value = false
    }
  }

  watch(flipOpen, (on) => {
    if (!on)
      flipNodeId.value = ''
  })

  watch(opts.selectedId, (id) => {
    if (smartEditOpen.value && id !== smartEditNodeId.value)
      smartEditOpen.value = false
    // 工具悬浮条（深度 / 复刻 / 打光 / 多视角 / 抠像 / 胶片条）：点画布空白取消选中不关，
    // 只有选中了别的节点才关；关掉靠条上的叉或再点一次它挂着的节点
    if (id && depthOpen.value && id !== depthNodeId.value)
      depthOpen.value = false
    if (id && lightOpen.value && id !== lightNodeId.value)
      lightOpen.value = false
    if (id && angleOpen.value && id !== angleNodeId.value)
      angleOpen.value = false
    if (cropOpen.value && id !== cropNodeId.value)
      cropOpen.value = false
    if (eraseOpen.value && id !== eraseNodeId.value)
      eraseOpen.value = false
    if (id && mattingOpen.value && id !== mattingNodeId.value)
      mattingOpen.value = false
    if (id && viralOpen.value && id !== viralNodeId.value)
      viralOpen.value = false
    if (outpaintOpen.value && id !== outpaintNodeId.value)
      outpaintOpen.value = false
    if (flipOpen.value && id !== flipNodeId.value)
      flipOpen.value = false
    if (markOpen.value && id !== markNodeId.value)
      markOpen.value = false
    if (id && extendStripOpen.value && id !== extendStripNodeId.value)
      extendStripOpen.value = false
    if (id && clipStripOpen.value && id !== clipStripNodeId.value)
      clipStripOpen.value = false
    if (id && splitStripOpen.value && id !== splitStripNodeId.value)
      splitStripOpen.value = false
  })

  return {
    markOpen,
    markMode,
    markSrc,
    markExisting,
    markNodeId,
    inpaintBusy,
    smartEditOpen,
    smartEditSrc,
    smartEditNodeId,
    smartEditAssetId,
    smartEditRefs,
    smartEditBusy,
    smartEditPick,
    depthOpen,
    depthNodeId,
    depthBusy,
    depthResolution,
    depthModel,
    lightOpen,
    lightNodeId,
    lightBusy,
    lightSrc,
    angleOpen,
    angleNodeId,
    angleBusy,
    angleSrc,
    cropOpen,
    cropNodeId,
    cropVariant,
    eraseOpen,
    eraseNodeId,
    eraseMode,
    mattingOpen,
    mattingNodeId,
    mattingBusy,
    viralOpen,
    viralNodeId,
    viralBusy,
    viralStep,
    viralModelId,
    outpaintOpen,
    outpaintNodeId,
    outpaintBusy,
    flipOpen,
    flipNodeId,
    extendStripOpen,
    extendStripSrc,
    extendStripNodeId,
    clipStripOpen,
    clipStripSrc,
    clipStripNodeId,
    splitStripOpen,
    splitStripSrc,
    splitStripNodeId,
    splitBusy,
    stripAssetDuration,
    editSrc,
    closeOverlays,
    closeOverlaysForNodes,
  }
}
