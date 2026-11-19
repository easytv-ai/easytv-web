/**
 * 同时只放行 limit 路。视频抽尺寸和解封面各用一条队列：
 * 一进画布几十张卡一起打存储，前面的会全部卡住。
 */
function createSlotQueue(limit: number) {
  const waiters: Array<() => void> = []
  let running = 0

  function pump() {
    while (running < limit && waiters.length) {
      const start = waiters.shift()
      if (!start)
        break
      running += 1
      start()
    }
  }

  return function enqueue(run: (done: () => void) => void) {
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
}

/** 整张画布同时只读两个视频的尺寸，避免一打开就几十路解码。 */
export const enqueueVideoProbe = createSlotQueue(2)

/** 视频封面是存储现场截帧，同时只发 3 路，先出眼前这几张。 */
export const enqueuePosterLoad = createSlotQueue(3)
