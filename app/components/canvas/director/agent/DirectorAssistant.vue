<script setup lang="ts">
/**
 * AI 导演助手（复刻自 open-director 的 DirectorAssistantPanel.tsx，MIT）。
 *
 * 和上游最大的区别是不让用户自带 API Key。上游把 baseUrl / apiKey / model
 * 存在 localStorage 里直连模型厂商；我们统一走 EasyAPI 网关：
 * POST /user/ai-chat + 轮询 GET /user/task/:id。次数和画布「结合画布」对话共用，
 * 由服务端写免费标记，客户端不能自报。指令仍在本地解析执行。
 *
 * 模型的回复是一串 JSON 指令，解析和执行在 utils/director/agent/ 里，已单独测过。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import DirectorSelectField from '~/components/canvas/director/panels/DirectorSelectField.vue'
import aiChatApi, { type ChatQuota } from '~/api/ai-chat'
import taskApi from '~/api/task'
import { startHiddenAwarePoll } from '~/utils/hidden-poll'
import type { GenerationModel } from '~/types/creative'
import { shortModelName } from '~/utils/model-name'
import { chatQuotaDisabled, chatQuotaExhausted, chatQuotaLabel, isChatQuotaExceeded } from '~/utils/canvas-assist'
import { useDirectorStore } from '~/utils/director/use-director-store'
import { useCameraPlaybackStore } from '~/utils/director/playback/use-playback-store'
import { execCommands } from '~/utils/director/agent/commands'
import { CommandParseError, extractCommands } from '~/utils/director/agent/parse'
import { buildAgentPrompt, type AgentTurn } from '~/utils/director/agent/prompt'

const { t } = useI18n()
const route = useRoute()
const { gotoPricing } = usePricingModal()
const store = useDirectorStore()
const canvasId = computed(() => Number(route.query.id) || 0)
const playback = useCameraPlaybackStore()
const quota = ref<ChatQuota | null>(null)
const chatDisabled = computed(() => chatQuotaDisabled(quota.value))
const quotaLabel = computed(() => (chatDisabled.value ? null : chatQuotaLabel(quota.value, (key, params) => t(key, params ?? {}))))
const quotaExhausted = computed(() => !chatDisabled.value && chatQuotaExhausted(quota.value))
const sceneReadonly = computed(() => store.readonly.value)
const sendBlocked = computed(() => sceneReadonly.value || chatDisabled.value || quotaExhausted.value)

async function loadQuota() {
  const res = await aiChatApi.quota()
  if (res?.success && res.data)
    quota.value = res.data
}

/** 轮询间隔，和画布对话栏一致 */
const POLL_INTERVAL = 2000

interface PanelMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** 执行结果单独一段，和模型原话区分开 */
  result?: string
  /** 解析成功时留下完整原文，展开再看 */
  raw?: string
  pending?: boolean
  error?: boolean
}

const open = ref(false)
const input = ref('')
const busy = ref(false)
const listRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)

let seq = 0
const messages = ref<PanelMessage[]>([
  {
    id: ++seq,
    role: 'assistant',
    text: t('我是 AI 导演助手。试着说：「加一个角色放到右边，再架一台机位对准他」。'),
  },
])

const models = ref<GenerationModel[]>([])
const chatModel = ref('')
const textModels = computed(() => models.value.filter(item => item.type === 'text'))
const modelOptions = computed(() =>
  textModels.value.map(item => ({
    value: item.model,
    label: shortModelName(item),
    title: String(item.label || item.model),
  })),
)

let stopDirectorPoll = () => {}

function stopPolling() {
  stopDirectorPoll()
  stopDirectorPoll = () => {}
}

async function loadModels() {
  if (models.value.length)
    return
  const res = await taskApi.models()
  if (res?.success && Array.isArray(res.data)) {
    models.value = res.data
    if (!chatModel.value && textModels.value.length)
      chatModel.value = textModels.value[0]!.model
  }
}

function scrollToEnd() {
  nextTick(() => {
    if (listRef.value)
      listRef.value.scrollTop = listRef.value.scrollHeight
  })
}

function close() {
  open.value = false
}

async function toggle() {
  if (open.value) {
    close()
    return
  }
  if (sceneReadonly.value)
    return
  open.value = true
  await loadModels()
  void loadQuota()
  scrollToEnd()
}

function onDocPointer(event: PointerEvent) {
  if (!open.value || !rootRef.value)
    return
  if (!rootRef.value.contains(event.target as Node))
    close()
}

function onDocKey(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onDocKey)
})

onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onDocKey)
})

/** 只把成功的对话带进历史：报错那几条对模型没有参考价值，反而会带偏 */
function historyTurns(): AgentTurn[] {
  return messages.value
    .filter(item => !item.error && !item.pending && item.text)
    .map(item => ({ role: item.role, content: item.text }))
}

function finish(message: PanelMessage, text: string, options: { result?: string, raw?: string, error?: boolean } = {}) {
  message.pending = false
  message.text = text
  message.result = options.result
  message.raw = options.raw
  message.error = options.error ?? false
  busy.value = false
  scrollToEnd()
  void loadQuota()
}

/** 拿到模型回复之后：解析 → 执行 → 把结果写回这条消息 */
function applyReply(message: PanelMessage, reply: string) {
  let commands
  try {
    commands = extractCommands(reply)
  }
  catch (error) {
    // 解析不出指令不算失败：模型可能就是在回答问题，原文照样给用户看
    const raw = error instanceof CommandParseError ? error.raw : reply
    finish(message, raw)
    return
  }

  const result = execCommands({ store, playback }, commands)
  finish(message, t('已按指令改好场景'), { result: result.lines.join('\n'), raw: reply })
}

function ask(question: string, message: PanelMessage, history: AgentTurn[]) {
  const prompt = buildAgentPrompt({ store, history, question })

  aiChatApi.create({
    model: chatModel.value,
    prompt,
    canvas_id: canvasId.value || undefined,
  }).then((res) => {
    if (!res?.success || !res.data) {
      const fail = res?.message || t('发送失败，稍后再试')
      const quota = isChatQuotaExceeded(fail, res?.data as { reason?: string } | undefined)
      if (quota)
        void loadQuota()
      finish(message, quota ? t('canvas.chat.msg.quota') : fail, { error: true })
      return
    }

    const taskId = res.data.id
    stopPolling()
    stopDirectorPoll = startHiddenAwarePoll(async () => {
      const poll = await taskApi.get(taskId)
      if (!poll?.success || !poll.data)
        return
      const task = poll.data
      if (task.status === 'pending' || task.status === 'running')
        return

      stopPolling()
      if (task.status === 'succeeded')
        applyReply(message, task.result_text || '')
      else
        finish(message, task.error_msg || t('生成失败'), { error: true })
    }, POLL_INTERVAL)
  })
}

function send() {
  const question = input.value.trim()
  if (!question || busy.value)
    return
  if (sceneReadonly.value) {
    messages.value.push({ id: ++seq, role: 'assistant', text: t('只读画布不能修改'), error: true })
    scrollToEnd()
    return
  }
  if (chatDisabled.value) {
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.msg.disabled'), error: true })
    scrollToEnd()
    return
  }
  if (quotaExhausted.value) {
    messages.value.push({ id: ++seq, role: 'assistant', text: t('canvas.chat.msg.quota'), error: true })
    scrollToEnd()
    return
  }

  // 先取历史再把这句 push 进去，否则它会在「之前的对话」里再出现一遍
  const history = historyTurns()
  messages.value.push({ id: ++seq, role: 'user', text: question })
  input.value = ''

  const reply: PanelMessage = { id: ++seq, role: 'assistant', text: '', pending: true }
  messages.value.push(reply)
  scrollToEnd()

  if (!textModels.value.length) {
    finish(reply, t('还没有接入文本模型，暂时不能用助手。'), { error: true })
    return
  }

  busy.value = true
  ask(question, reply, history)
}

function onKeydown(event: KeyboardEvent) {
  // 回车发送，Shift+回车换行 —— 和画布对话栏一致
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    send()
  }
}
</script>

<template>
  <div ref="rootRef" class="director-agent">
    <button
      v-if="!open"
      type="button"
      class="director-agent__fab"
      :disabled="sceneReadonly"
      :aria-label="t('AI 导演助手')"
      :title="sceneReadonly ? t('只读画布不能修改') : undefined"
      @click="toggle()"
    >
      <UIcon name="i-lucide-bot" class="size-5" />
      <span class="canvas-tip canvas-tip--up">{{ t('AI 导演助手') }}</span>
    </button>

    <section v-if="open" class="director-agent__panel" :aria-label="t('AI 导演助手')">
      <header class="director-agent__head">
        <h2>{{ t('AI 导演助手') }}</h2>
        <div class="director-agent__head-tools">
          <DirectorSelectField
            v-if="textModels.length"
            v-model="chatModel"
            :sr-label="t('对话模型')"
            :options="modelOptions"
          />
          <button
            type="button"
            class="director-agent__close"
            :aria-label="t('关闭')"
            @click="close()"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
            <span class="canvas-tip canvas-tip--end">{{ t('关闭') }}</span>
          </button>
        </div>
      </header>

      <div ref="listRef" class="director-agent__list">
        <div
          v-for="message in messages"
          :key="message.id"
          class="director-agent__msg"
          :class="[`is-${message.role}`, { 'is-error': message.error }]"
        >
          <p v-if="message.pending" class="director-agent__pending">{{ t('正在想…') }}</p>
          <template v-else>
            <p class="director-agent__text">{{ message.text }}</p>
            <pre v-if="message.result" class="director-agent__result">{{ message.result }}</pre>
            <details v-if="message.raw" class="director-agent__raw">
              <summary>{{ t('查看模型原文') }}</summary>
              <pre>{{ message.raw }}</pre>
            </details>
          </template>
        </div>
      </div>

      <footer class="director-agent__foot">
        <div v-if="sceneReadonly" class="director-agent__quota">
          <span>{{ t('只读画布不能修改') }}</span>
        </div>
        <div v-else-if="chatDisabled" class="director-agent__quota">
          <span>{{ t('canvas.chat.msg.disabled') }}</span>
        </div>
        <div v-else-if="quotaLabel" class="director-agent__quota">
          <span>{{ quotaLabel }}</span>
          <template v-if="quotaExhausted">
            <span>{{ t('canvas.chat.msg.quota') }}</span>
            <button type="button" @click="gotoPricing('membership')">
              <UIcon name="i-lucide-crown" class="size-3.5" />
              {{ t('开通会员') }}
            </button>
          </template>
        </div>
        <div class="director-agent__composer">
          <textarea
            v-model="input"
            class="director-agent__input"
            rows="1"
            :placeholder="t('说一句你想要的画面')"
            :aria-label="t('说一句你想要的画面')"
            :disabled="busy || sendBlocked"
            @keydown="onKeydown"
          />
          <button
            type="button"
            class="director-agent__send"
            :disabled="busy || sendBlocked || !input.trim()"
            :aria-label="t('发送')"
            @click="send()"
          >
            <UIcon name="i-lucide-send" class="size-4" />
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
