/**
 * 跟练会话：状态只活在内存里（useState），既不写画布数据也不落库。
 *
 * 一次跟练的完整生命周期：
 *   start()  → workspace 拍一张画布快照、页面挂起自动保存（沙盒）；scriptId 为空时先让用户选场景
 *   selectScript() → 挂上选中的剧本（八条场景剧本共用这套会话）
 *   replaySubmit() → 跟练期间的「生成」全部拦在这里，按剧本回放演一遍，绝不真提交任务
 *   exit() → workspace 还原快照、页面恢复保存机（跟练数据全部丢掉）
 *
 * 退出是任何时刻都能走的（对比 oiioii 跟练进去就出不来）：退出只有一个动作——还原并离开，
 * 没有「留在画布上继续做 / 真跑一次」那种半保留的走法。
 */

import { canvasTaskPatch } from '~/utils/canvas-task-apply'
import {
  findPracticeScript,
  PRACTICE_REPLAY_FAIL_LABEL,
  PRACTICE_REPLAY_FAIL_NOTICE,
  practiceReplayFailPatch,
  practiceReplayFor,
  practiceReplayPatch,
  type PracticePrepare,
  type PracticeStep,
} from '~/utils/canvas-practice'

/** 宿主实际执行过的一条 prepare（卡片上的「跟练已替你布好这一步」由它反推，不再由剧本静态推导） */
export type PracticeApplied = {
  /** 是在进哪一步时执行的（自动计划会把前面欠着的步也一起补上，所以它未必等于「当前步」） */
  stepId: string
  prep: PracticePrepare
}

export type PracticeSession = {
  active: boolean
  /** 选中的剧本 id；空串 = 还停在场景选择（沙盒已经生效，但还没有剧本） */
  scriptId: string
  stepIndex: number
  /** 卡片收起成一个"跟练中"小药丸；会话照旧，随时能展开 */
  minimized: boolean
  /** 开始/退出各 +1：页面据此同步自己的持久化状态（画布名、保存机、version） */
  seq: number
  /** 已经演过失败演练的步骤 id：失败只发生一次，重试即成功（退出/重开都清空） */
  replayFailed: string[]
  /**
   * 判据之外的完成通道：demo 步（纯讲解，宿主演示后写入）与「跳过这一步」（result 步的逃生口）。
   * practiceStepSatisfied = 判据满足 || done.has(step.id)。
   */
  done: string[]
  /** 宿主实际执行过的 prepare：卡片上的 ready 行与它是同一份事实 */
  applied: PracticeApplied[]
  /**
   * 回放是否在飞：卡片底栏的「跳过这一步」据此禁用（回放悬在半空时跳过，产物会落到已经翻页的画布上）。
   * W3 的 Tour 读 session.replayBusy，所以它是会话字段而不是宿主内部变量。
   */
  replayBusy: boolean
  /** 现场解析不到前提时的如实说明（主体库为空 / 清单里没有带原生出声的模型），卡片上以提示行显示 */
  notice: string
}

export type PracticeSubmitNode = { id: string, data?: Record<string, any> | null }

/** 回放时用的"假任务"：id 固定 0，既不会被轮询接管，也不会让节点上出现取消按钮 */
const REPLAY_TASK = { id: 0, result_text: '', result_asset_id: 0, error_msg: '' }

export function practiceSessionDefault(): PracticeSession {
  return {
    active: false,
    scriptId: '',
    stepIndex: 0,
    minimized: false,
    seq: 0,
    replayFailed: [],
    done: [],
    applied: [],
    replayBusy: false,
    notice: '',
  }
}

export function useCanvasPractice(opts: {
  updateNodeData: (id: string, patch: Record<string, unknown>) => void
  notify: (title: string, color?: 'neutral' | 'error') => void
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  const session = useState<PracticeSession>('canvas-practice', practiceSessionDefault)
  /** 在飞的回放：退出时必须停掉，否则会把产物写到还原后的画布上 */
  let timer: ReturnType<typeof setInterval> | null = null
  /** 正在回放的节点 id：停掉时要把它复位，别留在 running（那会挡住下一次生成） */
  let flying: string | null = null

  /**
   * 停掉在飞的回放。除了清计时器，还要把节点复位——
   * 跳步（新清单把跳步做成了显眼入口）时节点会停在 taskStatus='running'，
   * 生成入口会以「该节点正在生成中」直接挡下，这一步在跟练里就再也跑不完了。
   */
  function stopReplay() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (flying) {
      opts.updateNodeData(flying, { taskId: undefined, taskStatus: '', taskProgress: 0, taskError: '' })
      flying = null
    }
    if (session.value.replayBusy)
      session.value = { ...session.value, replayBusy: false }
  }

  function currentScript() {
    return findPracticeScript(session.value.scriptId)
  }

  function currentStep(): PracticeStep | null {
    const script = currentScript()
    return script?.steps[session.value.stepIndex] ?? null
  }

  /** 开会话。scriptId 省略（入口的常规走法）时先停在场景选择：卡片上让用户挑一条剧本 */
  function start(scriptId = '') {
    stopReplay()
    session.value = {
      ...practiceSessionDefault(),
      active: true,
      scriptId,
      seq: session.value.seq + 1,
    }
  }

  /** 场景选择卡上挑了一条剧本：挂上它，回到第 0 步（沙盒与基线不动——它们按"进跟练那一刻"算） */
  function selectScript(scriptId: string) {
    if (!session.value.active || !scriptId)
      return
    stopReplay()
    session.value = { ...session.value, scriptId, stepIndex: 0, minimized: false }
  }

  /** 结束会话：还原由宿主做（loadGraph 快照），这里只把会话状态复位 */
  function exit() {
    stopReplay()
    if (!session.value.active)
      return
    session.value = { ...practiceSessionDefault(), seq: session.value.seq + 1 }
  }

  function minimize() {
    if (session.value.active)
      session.value = { ...session.value, minimized: true }
  }

  function restore() {
    if (session.value.active)
      session.value = { ...session.value, minimized: false }
  }

  function gotoStep(index: number) {
    const script = currentScript()
    if (!script)
      return
    stopReplay()
    session.value = { ...session.value, stepIndex: Math.min(Math.max(0, index), script.steps.length - 1) }
  }

  function next() {
    gotoStep(session.value.stepIndex + 1)
  }

  /**
   * 跟练期间的生成入口。返回 true 表示这次提交已经被跟练接住（不要再去调接口）。
   * 当前这一步没配回放（比如用户跑偏去点别的节点）就只提示一句，绝不放行到真实生成。
   *
   * 领回放的口径是「节点 kind + 节点的 practiceKey」：多镜 / 多规格剧本里一个步骤要对多个节点
   * 各演一次（byKey），光按 kind 认领会让两条支线抢同一份回放。
   *
   * 失败演练（replay.failOnce）：这一步的回放第一次按失败演（节点上是失败态、不挂真任务），
   * 用户再点一次生成就走正常的成功回放——全程不消耗点数，也不影响没配 failOnce 的步骤。
   */
  function replaySubmit(node: PracticeSubmitNode, req: { type: string }): boolean {
    if (!session.value.active)
      return false
    const step = currentStep()
    const replay = practiceReplayFor(step?.replay, String(node.data?.kind || ''), String(node.data?.practiceKey || ''))
    if (!replay) {
      opts.notify(opts.t('跟练里不会真的生成：先按卡片上的提示把这一步做完'))
      return true
    }
    stopReplay()
    const total = Math.max(1500, replay.simulatedMs)
    const startedAt = Date.now()
    const stepId = step?.id ?? ''
    const failFirst = Boolean(replay.failOnce) && !session.value.replayFailed.includes(stepId)
    flying = node.id
    // 回放在飞：卡片底栏的「跳过这一步」据此禁用
    session.value = { ...session.value, replayBusy: true }
    opts.updateNodeData(node.id, {
      ...canvasTaskPatch({ ...REPLAY_TASK, status: 'running', progress: 0, type: req.type as never, result_url: '' }, opts.t('生成失败')),
    })
    timer = setInterval(() => {
      if (!session.value.active) {
        stopReplay()
        return
      }
      const ratio = Math.min(1, (Date.now() - startedAt) / total)
      if (ratio >= 1) {
        // 先摘掉"在飞"，再停：产物补丁自己会写结果态，别被复位覆盖掉
        flying = null
        stopReplay()
        if (failFirst) {
          // 失败演练：写失败态并记住这一步已经失败过（重试即成功），全程不真调接口、不花点数
          session.value = { ...session.value, replayFailed: [...session.value.replayFailed, stepId] }
          opts.updateNodeData(node.id, practiceReplayFailPatch(req.type, opts.t(PRACTICE_REPLAY_FAIL_LABEL)))
          opts.notify(opts.t(PRACTICE_REPLAY_FAIL_NOTICE), 'error')
          return
        }
        // 产物是回放的，不挂真实任务 id / 素材 id：补丁与跟练收尾步的成片卡共用一份（canvas-practice）
        opts.updateNodeData(node.id, practiceReplayPatch(replay.url, req.type, opts.t('生成失败')))
        opts.notify(opts.t('跟练回放完成：这是那次真实生成的结果'))
        return
      }
      opts.updateNodeData(node.id, { taskProgress: Math.round(ratio * 99) })
    }, 350)
    return true
  }

  return { session, start, selectScript, exit, minimize, restore, gotoStep, next, currentStep, currentScript, stopReplay, replaySubmit }
}
