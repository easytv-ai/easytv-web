<script setup lang="ts">
/**
 * 全景查看器：把 2:1 等距柱状图贴到球内侧看。
 *
 * 用裸 WebGL 手写（约一屏 shader），不引 three —— 只是为了看一张图，
 * 没必要为此背上几百 KB 的三维库。拖拽转视角，滚轮调 FOV。
 */
const props = defineProps<{
  open: boolean
  src: string
  title?: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(false)
const failed = ref(false)
/** 'gl' 初始化失败 / 'image' 图片加载失败，两种提示文案不同 */
const failReason = ref<'gl' | 'image'>('image')

// 视角：偏航 / 俯仰（弧度），FOV（角度）
let yaw = 0
let pitch = 0
let fov = 75
let raf = 0
let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let texture: WebGLTexture | null = null
let buffer: WebGLBuffer | null = null
let disposed = false

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

/*
 * 逐像素反推：先由屏幕坐标和 FOV 得到相机空间的方向向量，
 * 再按 yaw / pitch 旋转，最后把方向转成等距柱状图的 uv。
 */
const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_fov;
const float PI = 3.14159265359;

void main() {
  float aspect = u_res.x / u_res.y;
  float halfFov = tan(u_fov * 0.5);
  vec3 dir = normalize(vec3(v_uv.x * halfFov * aspect, v_uv.y * halfFov, -1.0));

  float cp = cos(u_pitch), sp = sin(u_pitch);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);

  float cy = cos(u_yaw), sy = sin(u_yaw);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);

  float u = atan(dir.x, -dir.z) / (2.0 * PI) + 0.5;
  // acos 给的 v：朝上 = 0、朝下 = 1，正好对上等距柱状图「天在顶、地在底」的排布，
  // 纹理 t=0 就是图片第一行，所以这里不能再翻一次
  float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
  gl_FragColor = texture2D(u_tex, vec2(u, v));
}
`

function compile(ctx: WebGLRenderingContext, type: number, source: string) {
  const shader = ctx.createShader(type)
  if (!shader)
    return null
  ctx.shaderSource(shader, source)
  ctx.compileShader(shader)
  if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
    console.error('[panorama] shader compile failed:', ctx.getShaderInfoLog(shader))
    ctx.deleteShader(shader)
    return null
  }
  return shader
}

function setupGL(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('webgl', { antialias: false, alpha: false })
  if (!ctx)
    return false
  const vs = compile(ctx, ctx.VERTEX_SHADER, VERT)
  const fs = compile(ctx, ctx.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs)
    return false
  const prog = ctx.createProgram()
  if (!prog)
    return false
  ctx.attachShader(prog, vs)
  ctx.attachShader(prog, fs)
  ctx.linkProgram(prog)
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS))
    return false

  // 一个铺满裁剪空间的三角形带，片元着色器负责全部工作
  const buf = ctx.createBuffer()
  ctx.bindBuffer(ctx.ARRAY_BUFFER, buf)
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW)
  const loc = ctx.getAttribLocation(prog, 'a_pos')
  ctx.enableVertexAttribArray(loc)
  ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0)

  gl = ctx
  program = prog
  buffer = buf
  return true
}

function uploadTexture(image: HTMLImageElement) {
  if (!gl)
    return
  texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // 全景图宽高常常不是 2 的幂，只能用 CLAMP_TO_EDGE + LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
}

function render() {
  const canvas = canvasRef.value
  if (!gl || !program || !canvas || disposed)
    return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.useProgram(program)
  gl.uniform2f(gl.getUniformLocation(program, 'u_res'), canvas.width, canvas.height)
  gl.uniform1f(gl.getUniformLocation(program, 'u_yaw'), yaw)
  gl.uniform1f(gl.getUniformLocation(program, 'u_pitch'), pitch)
  gl.uniform1f(gl.getUniformLocation(program, 'u_fov'), (fov * Math.PI) / 180)
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  raf = requestAnimationFrame(render)
}

function dispose() {
  disposed = true
  if (raf)
    cancelAnimationFrame(raf)
  raf = 0
  if (gl) {
    if (texture)
      gl.deleteTexture(texture)
    if (buffer)
      gl.deleteBuffer(buffer)
    if (program)
      gl.deleteProgram(program)
    // 主动释放上下文：浏览器同时能持有的 WebGL 上下文数量有限，反复开关会把老的挤掉
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
  gl = null
  program = null
  texture = null
  buffer = null
}

async function start() {
  const canvas = canvasRef.value
  if (!canvas || !props.src)
    return
  disposed = false
  failed.value = false
  loading.value = true
  yaw = 0
  pitch = 0
  fov = 75
  if (!setupGL(canvas as unknown as HTMLCanvasElement)) {
    loading.value = false
    failed.value = true
    failReason.value = 'gl'
    return
  }
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    if (disposed)
      return
    loading.value = false
    uploadTexture(image)
    render()
  }
  image.onerror = () => {
    loading.value = false
    failed.value = true
    failReason.value = 'image'
  }
  image.src = props.src
}

// ---- 交互 ----
let dragging = false
let lastX = 0
let lastY = 0

function onPointerDown(event: PointerEvent) {
  dragging = true
  lastX = event.clientX
  lastY = event.clientY
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging)
    return
  const scale = (fov * Math.PI) / 180 / 600
  yaw -= (event.clientX - lastX) * scale
  // 上下限制在 ±90°，转过头画面会翻过来
  pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch + (event.clientY - lastY) * scale))
  lastX = event.clientX
  lastY = event.clientY
}

function onPointerUp(event: PointerEvent) {
  dragging = false
  ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  fov = Math.max(30, Math.min(110, fov + (event.deltaY > 0 ? 3 : -3)))
}

function onKey(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.stopPropagation()
    emit('close')
  }
}

watch(() => props.open, (open) => {
  if (open)
    void nextTick(start)
  else
    dispose()
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  dispose()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="studio-modal-mask"
      @click.self="emit('close')"
      @pointerdown.stop
    >
      <div class="studio-modal canvas-pano" role="dialog" aria-modal="true">
        <header class="asset-picker__head">
          <div>
            <h2>{{ title || t('全景预览') }}</h2>
            <p>{{ t('拖拽转动视角，滚轮缩放') }}</p>
          </div>
          <button type="button" class="trash-modal__close" :aria-label="t('关闭')" @click="emit('close')">
            <UIcon name="i-lucide-x" class="size-4" />
          </button>
        </header>
        <div class="canvas-pano__stage">
          <canvas
            ref="canvasRef"
            class="canvas-pano__canvas"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @wheel="onWheel"
          />
          <p v-if="loading" class="canvas-pano__tip">{{ t('加载中…') }}</p>
          <p v-else-if="failed" class="canvas-pano__tip">
            {{ failReason === 'gl' ? t('当前浏览器不支持 WebGL，无法预览全景') : t('全景加载失败，可能是图片跨域或格式不支持') }}
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
