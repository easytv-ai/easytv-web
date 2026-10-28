<script setup lang="ts">
import { imageOpCss, transformImage, type ImageTransformOp } from '~/utils/canvas-image-edit'

const { t } = useI18n()
const toast = useToast()

const props = withDefaults(defineProps<{
  open: boolean
  src: string
  box?: { left: number, top: number, width: number, height: number } | null
}>(), {
  box: null,
})

const emit = defineEmits<{
  close: []
  save: [blob: Blob]
}>()

const OPS: { id: ImageTransformOp, icon: string, label: string }[] = [
  { id: 'rotate-left', icon: 'i-lucide-rotate-ccw', label: '向左旋转' },
  { id: 'rotate-right', icon: 'i-lucide-rotate-cw', label: '向右旋转' },
  { id: 'flip-h', icon: 'i-lucide-flip-horizontal-2', label: '水平翻转' },
  { id: 'flip-v', icon: 'i-lucide-flip-vertical-2', label: '垂直翻转' },
]

const ops = ref<ImageTransformOp[]>([])
const busy = ref(false)

const layerStyle = computed(() => {
  const box = props.box
  if (!box)
    return null
  return {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  }
})

const picStyle = computed(() => ({
  transform: imageOpCss(ops.value) || 'none',
}))

function resetPreview() {
  ops.value = []
  busy.value = false
}

watch(() => props.open, () => {
  resetPreview()
})

function applyOp(op: ImageTransformOp) {
  if (!props.open || busy.value)
    return
  ops.value = [...ops.value, op]
}

async function save() {
  if (busy.value)
    return
  if (!ops.value.length) {
    emit('close')
    return
  }
  busy.value = true
  try {
    emit('save', await transformImage(props.src, ops.value))
  }
  catch {
    toast.add({
      title: t('处理失败，图片可能无法跨域读取'),
      color: 'error',
      close: false,
      progress: false,
      orientation: 'horizontal',
    })
  }
  finally {
    busy.value = false
  }
}

function onKey(event: KeyboardEvent) {
  if (!props.open)
    return
  if (event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    void save()
  }
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  resetPreview()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && layerStyle"
      class="canvas-flip-layer nodrag nopan"
      :style="layerStyle"
    >
      <div class="canvas-flip__stage">
        <img :src="src" alt="" draggable="false" :style="picStyle">
      </div>
      <div class="canvas-crop__tools nodrag nopan nowheel" @pointerdown.stop>
        <button type="button" class="canvas-crop__close" @click="emit('close')">
          <UIcon name="i-lucide-x" class="size-3.5" />
          <span>{{ t('旋转与镜像') }}</span>
        </button>
        <span class="canvas-smart__split" />
        <button
          v-for="item in OPS"
          :key="item.id"
          type="button"
          class="canvas-flip__icon"
          :disabled="busy"
          :aria-label="t(item.label)"
          @click="applyOp(item.id)"
        >
          <UIcon :name="item.icon" class="size-4" />
        </button>
        <button type="button" class="canvas-crop__ok" :disabled="busy" @click="save">
          {{ t('保存') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
