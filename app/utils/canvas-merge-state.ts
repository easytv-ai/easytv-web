import { ref, shallowRef } from 'vue'
import { forwardMergeProgress, type MergeVideoProgress } from '~/utils/canvas-video-merge'

/** 进度只给提示条读。写在画布组件上的话，每一格都会重绘整块 VueFlow。 */
export const canvasMergeProgress = shallowRef<MergeVideoProgress | null>(null)
export const canvasMergeRunning = ref(false)

let paintedAt = 0
const pendingMergeUploads: Promise<void>[] = []

/** 成片还是浏览器临时地址时先等上传结束，避免保存把画面存没。 */
export function trackMergeUpload(task: Promise<void>) {
  pendingMergeUploads.push(task)
  void task.catch(() => undefined)
}

export async function flushMergeUploads() {
  let failed = false
  while (pendingMergeUploads.length) {
    const tasks = pendingMergeUploads.splice(0)
    const results = await Promise.allSettled(tasks)
    if (results.some(item => item.status === 'rejected'))
      failed = true
  }
  if (failed)
    throw new Error('merge-upload')
}

export function publishMergeProgress(next: MergeVideoProgress | null) {
  if (!next) {
    canvasMergeProgress.value = null
    paintedAt = 0
    return
  }
  const prev = canvasMergeProgress.value
  // 裁剪、分割和拼接共用一条进度。换了任务就从头计，避免上一次的百分比把新任务挡住。
  if (prev && prev.job !== next.job) {
    paintedAt = Date.now()
    canvasMergeProgress.value = next
    return
  }
  const progress = forwardMergeProgress(prev?.progress ?? null, next.progress)
  if (prev && progress === prev.progress && next.progress < prev.progress)
    return
  const now = Date.now()
  const phaseChanged = prev?.phase !== next.phase
  const done = progress >= 100
  if (!phaseChanged && !done && now - paintedAt < 250)
    return
  paintedAt = now
  canvasMergeProgress.value = progress === next.progress ? next : { ...next, progress }
}
