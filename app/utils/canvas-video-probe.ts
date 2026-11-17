/** 整张画布同时只读两个视频的尺寸，避免一打开就几十路解码。 */
const LIMIT = 2
const waiters: Array<() => void> = []
let running = 0

function pump() {
  while (running < LIMIT && waiters.length) {
    const start = waiters.shift()
    if (!start)
      break
    running += 1
    start()
  }
}

export function enqueueVideoProbe(run: (done: () => void) => void) {
  let settled = false
  let started = false
  const start = () => {
    if (settled) {
      running = Math.max(0, running - 1)
      pump()
      return
    }
    started = true
    run(() => {
      if (settled)
        return
      settled = true
      running = Math.max(0, running - 1)
      pump()
    })
  }
  waiters.push(start)
  pump()
  return () => {
    if (settled)
      return
    settled = true
    const index = waiters.indexOf(start)
    if (index >= 0) {
      waiters.splice(index, 1)
      return
    }
    if (started) {
      running = Math.max(0, running - 1)
      pump()
    }
  }
}
