export type SharePreviewKind = 'image' | 'video' | 'audio'

export type ShareMediaPreview = {
  open: boolean
  src: string
  kind: SharePreviewKind
  caption: string
}

export function useShareMediaPreview() {
  const preview = useState<ShareMediaPreview>('share-media-preview', () => ({
    open: false,
    src: '',
    kind: 'image',
    caption: '',
  }))

  function open(kind: SharePreviewKind, src: string, caption = '') {
    const url = String(src || '').trim()
    if (!url)
      return
    preview.value = { open: true, src: url, kind, caption }
  }

  function close() {
    preview.value.open = false
  }

  return { preview, open, close }
}
