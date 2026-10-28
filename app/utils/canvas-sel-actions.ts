import { isImageEditAction, parseUpscaleAction, type ImageEditAction, type UpscaleScale } from '~/utils/canvas-image-edit'

export type CanvasSelActionApi = {
  group: () => void
  ungroup: () => void
  collapse: () => void
  duplicate: () => void
  shrink: () => void
  grow: () => void
  download: () => void
  expand: () => void
  regen: () => void
  brush: () => void
  inpaint: () => void
  smartEdit: () => void
  depth: () => void
  light: () => void
  multiview: () => void
  promptReverse: () => void
  crop: () => void
  frameCrop: () => void
  removeSubtitles: () => void
  boxSubtitles: () => void
  separate: () => void
  extractVoice: () => void
  extractBgm: () => void
  transcribe: () => void
  removeSilence: () => void
  outpaint: () => void
  flip: () => void
  runUpscale: (scale: UpscaleScale) => void
  runRemoveBg: (name: 'bg-object' | 'bg-person') => void
  runThreeView: (name: 'view-char' | 'view-face' | 'view-prop') => void
  hd: () => void
  viral: () => void
  videoSplit: () => void
  retake: () => void
  smartExtend: () => void
  clipCut: () => void
  frameByFrame: () => void
  depthMotion: () => void
  smartMatting: () => void
  captureFrame: () => void
  captureFirst: () => void
  captureLast: () => void
  runSubject: (name: 'remove-subject' | 'edit-subject' | 'replace-subject') => void
  runImageEdit: (name: ImageEditAction) => void
  /** 把选中那串节点存成工作流模板（L3，API.md 31.1） */
  saveWorkflow: () => void
  fallback: () => void
}

const SIMPLE: Record<string, keyof CanvasSelActionApi> = {
  group: 'group',
  ungroup: 'ungroup',
  'save-workflow': 'saveWorkflow',
  collapse: 'collapse',
  duplicate: 'duplicate',
  shrink: 'shrink',
  grow: 'grow',
  download: 'download',
  expand: 'expand',
  regen: 'regen',
  brush: 'brush',
  inpaint: 'inpaint',
  'smart-edit': 'smartEdit',
  depth: 'depth',
  light: 'light',
  multiview: 'multiview',
  'prompt-reverse': 'promptReverse',
  crop: 'crop',
  'frame-crop': 'frameCrop',
  'remove-subtitles': 'removeSubtitles',
  'box-subtitles': 'boxSubtitles',
  separate: 'separate',
  'extract-voice': 'extractVoice',
  'extract-bgm': 'extractBgm',
  'transcribe': 'transcribe',
  'remove-silence': 'removeSilence',
  outpaint: 'outpaint',
  flip: 'flip',
  hd: 'hd',
  'viral-remake': 'viral',
  'video-split': 'videoSplit',
  retake: 'retake',
  'smart-extend': 'smartExtend',
  'clip-cut': 'clipCut',
  'frame-by-frame': 'frameByFrame',
  'depth-motion': 'depthMotion',
  'smart-matting': 'smartMatting',
  'capture-frame': 'captureFrame',
  'capture-first': 'captureFirst',
  'capture-last': 'captureLast',
}

/** 选中工具条动作分发。只做路由，不改各动作自己的实现。 */
export function dispatchCanvasSelAction(name: string, api: CanvasSelActionApi) {
  const simple = SIMPLE[name]
  if (simple) {
    const fn = api[simple]
    if (typeof fn === 'function')
      (fn as () => void)()
    return
  }
  const upscaleScale = parseUpscaleAction(name)
  if (upscaleScale) {
    api.runUpscale(upscaleScale)
    return
  }
  if (name === 'upscale')
    return
  if (name === 'bg-object' || name === 'bg-person') {
    api.runRemoveBg(name)
    return
  }
  if (name === 'view-char' || name === 'view-face' || name === 'view-prop') {
    api.runThreeView(name)
    return
  }
  if (name === 'remove-subject' || name === 'edit-subject' || name === 'replace-subject') {
    api.runSubject(name)
    return
  }
  if (isImageEditAction(name)) {
    api.runImageEdit(name)
    return
  }
  api.fallback()
}
