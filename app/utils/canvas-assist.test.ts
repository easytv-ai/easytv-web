import { describe, expect, it } from 'vitest'
import {
  addNodeDataPatch,
  agentModeFor,
  assistChangeTitle,
  buildAssistNodes,
  chatQuotaDisabled,
  chatQuotaExhausted,
  chatQuotaLabel,
  CHAT_QUOTA_EXCEEDED_REASON,
  hasPickedRegenerate,
  isChatQuotaExceeded,
  orderAssistChanges,
  pickedPoints,
  updatePromptPatch,
} from './canvas-assist'
import type { AssistAction, AssistChange } from './canvas-assist'

const text = (id: string, content: string, extra = {}) => ({ id, data: { kind: 'text', label: id, content, prompt: '' }, ...extra })
const media = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, data: { kind, label: id, prompt: `${id} prompt`, content: '', ...extra } })

describe('buildAssistNodes', () => {
  const nodes = [
    text('text-0', '更早的设定'),
    text('text-1', '<p>剧本</p>'),
    media('image-1', 'image', { content: 'https://x/1.png', taskId: 7 }),
    { ...media('video-1', 'video'), selected: true },
    media('audio-1', 'audio'),
    media('image-9', 'image'),
    { id: 'group-1', data: { kind: 'group', label: '组' } },
  ]
  const edges = [
    { source: 'text-0', target: 'text-1' },
    { source: 'text-1', target: 'image-1' },
    { source: 'image-1', target: 'video-1' },
    { source: 'image-1', target: 'video-1' },
    { source: 'video-1', target: 'audio-1' },
    { source: 'group-1', target: 'video-1' },
  ]
  const plain = (node: { data?: { content?: string } }) => String(node.data?.content || '').replace(/<[^>]+>/g, '')

  it('选中节点带上游两层、下游一层', () => {
    const out = buildAssistNodes(nodes, edges, plain)
    expect(out.map(n => n.id)).toEqual(['video-1', 'image-1', 'text-1', 'audio-1'])
    const video = out[0]!
    expect(video.selected).toBe(true)
    expect(video.upstream).toEqual(['image-1'])
    expect(video.downstream).toEqual(['audio-1'])
    const image = out[1]!
    expect(image.has_media).toBe(true)
    expect(image.task_id).toBe(7)
    expect(image.content).toBe('')
    expect(out[2]!.content).toBe('剧本')
  })

  it('没选中时带整张画布，跳过分组，受上限约束', () => {
    const unselected = nodes.map(n => ({ ...n, selected: false }))
    expect(buildAssistNodes(unselected, edges, plain).map(n => n.id)).toEqual(['text-0', 'text-1', 'image-1', 'video-1', 'audio-1', 'image-9'])
    expect(buildAssistNodes(unselected, edges, plain, 2)).toHaveLength(2)
  })
})

describe('assist changes', () => {
  const changes: AssistChange[] = [
    { action: 'regenerate', node_id: 'image-1', node_label: '主角', points: 20 },
    { action: 'update_prompt', node_id: 'image-1', node_label: '主角', prompt: 'x' },
    { action: 'add_node', kind: 'image', label: '特写', prompt: 'y' },
    { action: 'connect', source: 'text-1', target: 'image-1', node_label: '脚本 → 主角' },
    { action: 'regenerate', node_id: 'video-1', points: 50 },
  ]

  it('按连线 → 加节点 → 改提示词 → 生成排序，同类保持原顺序', () => {
    expect(orderAssistChanges(changes).map(c => `${c.action}:${c.node_id || c.label || c.source}`)).toEqual([
      'connect:text-1',
      'add_node:特写',
      'update_prompt:image-1',
      'regenerate:image-1',
      'regenerate:video-1',
    ])
  })

  it('只算勾选的重新生成积分', () => {
    expect(pickedPoints(changes, [])).toBe(70)
    expect(pickedPoints(changes, [false, true, true, true, true])).toBe(50)
    expect(hasPickedRegenerate(changes, [false, true, true, true, false])).toBe(false)
  })

  it('标题', () => {
    expect(assistChangeTitle(changes[1]!)).toEqual({ key: '改写「{name}」的提示词', params: { name: '主角' } })
    expect(assistChangeTitle(changes[2]!)).toEqual({ key: '新建{kind}节点「{name}」', params: { kind: '图片', name: '特写' } })
  })
})

describe('apply_graph（API.md 32）', () => {
  const graph = {
    version: 1,
    nodes: [
      { id: 'n1', kind: 'text', x: 0, y: 0, data: { label: '脚本', content: '…' } },
      { id: 'n2', kind: 'image', x: 400, y: 0, data: { label: '首帧', prompt: '…', model: 'gpt-image-1' } },
    ],
    edges: [{ source: 'n1', target: 'n2' }],
  }

  it('排在最前：先落整图，其余动作再针对已有节点', () => {
    const list: AssistChange[] = [
      { action: 'regenerate', node_id: 'image-1' },
      { action: 'update_prompt', node_id: 'image-1', prompt: 'x' },
      { action: 'add_node', kind: 'image', label: '特写', prompt: 'y' },
      { action: 'connect', source: 'text-1', target: 'image-1' },
      { action: 'apply_graph', graph },
    ]
    expect(orderAssistChanges(list).map(c => c.action)).toEqual([
      'apply_graph',
      'connect',
      'add_node',
      'update_prompt',
      'regenerate',
    ])
  })

  it('标题带节点数；未知动作不再让方案卡渲染抛错', () => {
    expect(assistChangeTitle({ action: 'apply_graph', graph })).toEqual({ key: '搭一张工作流（{n} 个节点）', params: { n: 2 } })
    expect(assistChangeTitle({ action: 'apply_graph' })).toEqual({ key: '搭一张工作流（{n} 个节点）', params: { n: 0 } })
    // 服务端可能发来前端还不认识的动作（如 set_params），必须有 default 兜底
    expect(assistChangeTitle({ action: 'set_params' as AssistAction, node_id: 'video-3' })).toEqual({ key: '不支持的动作 {name}', params: { name: 'set_params' } })
    expect(() => assistChangeTitle({} as AssistChange)).not.toThrow()
    expect(assistChangeTitle({} as AssistChange)).toEqual({ key: '不支持的动作 {name}', params: { name: '' } })
  })
})

describe('写进节点 data 的补丁', () => {
  it('update_prompt 对文本节点写 content（显示的是它），生成类节点写 prompt', () => {
    expect(updatePromptPatch({ action: 'update_prompt', prompt: '新文案' }, 'text')).toEqual({ content: '新文案' })
    expect(updatePromptPatch({ action: 'update_prompt', prompt: '新提示词' }, 'image')).toEqual({ prompt: '新提示词' })
    expect(updatePromptPatch({ action: 'update_prompt' }, 'text')).toEqual({ content: '' })
  })

  it('add_node 带上 model / params / content（契约 3.2）', () => {
    expect(addNodeDataPatch({
      action: 'add_node',
      kind: 'image',
      label: '产品首帧',
      prompt: '产品特写',
      model: 'gpt-image-1',
      params: { ratio: '9:16', clarity: '2K' },
    })).toEqual({
      prompt: '产品特写',
      label: '产品首帧',
      model: 'gpt-image-1',
      params: { ratio: '9:16', clarity: '2K' },
    })
    // 文本节点：content 写正文，prompt 照旧带上；缺 content 时沿用 prompt（与旧行为一致）
    expect(addNodeDataPatch({ action: 'add_node', kind: 'text', label: '脚本', prompt: '写一个脚本', content: '正文' }))
      .toEqual({ content: '正文', prompt: '写一个脚本', label: '脚本' })
    expect(addNodeDataPatch({ action: 'add_node', kind: 'text', prompt: '写一个脚本' }))
      .toEqual({ content: '写一个脚本', prompt: '写一个脚本' })
    // 没有 model / params 时不写这两个键，别把空值盖到节点上
    expect(addNodeDataPatch({ action: 'add_node', kind: 'video', prompt: '动起来' })).toEqual({ prompt: '动起来' })
  })
})

describe('agentModeFor', () => {
  it('空画布只能从零搭', () => {
    expect(agentModeFor(0)).toBe('generate')
    expect(agentModeFor(0, true)).toBe('generate')
  })

  it('画布上有节点时默认改现有的', () => {
    expect(agentModeFor(3)).toBe('patch')
  })

  it('打开「从零搭图」后即使画布非空也走 generate', () => {
    expect(agentModeFor(3, true)).toBe('generate')
  })
})

describe('对话次数文案与用尽判定（对话免费）', () => {
  // 与 vue-i18n 同口径的桩：把 {n}/{total} 插值出来，词条文案由各语言文件提供
  const t = (key: string, params?: Record<string, string | number>) =>
    key.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

  it('会员显示「会员 · 不限次」；后台把次数配成不限时非会员只说「不限」', () => {
    expect(chatQuotaLabel({ free: true, is_member: true, unlimited: true, daily_limit: 0, remaining: -1 }, t)).toBe('会员 · 不限次')
    // 非会员 + daily_limit<=0（服务端同样给 unlimited）：不能自称会员
    expect(chatQuotaLabel({ free: true, is_member: false, unlimited: true, daily_limit: 0, remaining: -1 }, t)).toBe('不限')
    // is_member 缺失（老响应 / 字段没下发）时也不给用户戴会员帽子
    expect(chatQuotaLabel({ free: true, unlimited: true, daily_limit: 0, remaining: -1 }, t)).toBe('不限')
  })

  it('普通用户显示今日剩余 n/上限 次', () => {
    expect(chatQuotaLabel({ free: true, unlimited: false, daily_limit: 100, remaining: 37 }, t)).toBe('今日剩余 37/100 次')
    // 剩余 0 也照常显示，用尽提示由调用方另给
    expect(chatQuotaLabel({ free: true, unlimited: false, daily_limit: 100, remaining: 0 }, t)).toBe('今日剩余 0/100 次')
  })

  it('free=false 或没有额度数据时不展示次数', () => {
    expect(chatQuotaLabel({ free: false, unlimited: false, daily_limit: 100, remaining: 0 }, t)).toBeNull()
    expect(chatQuotaLabel(null, t)).toBeNull()
    expect(chatQuotaLabel(undefined, t)).toBeNull()
  })

  it('用尽判定：免费口径 + 非会员 + 剩余 <= 0', () => {
    expect(chatQuotaExhausted({ free: true, unlimited: false, daily_limit: 100, remaining: 0 })).toBe(true)
    expect(chatQuotaExhausted({ free: true, unlimited: false, daily_limit: 100, remaining: 5 })).toBe(false)
    expect(chatQuotaExhausted({ free: true, unlimited: true, daily_limit: 0, remaining: -1 })).toBe(false)
    expect(chatQuotaExhausted({ free: false, unlimited: false, daily_limit: 100, remaining: 0 })).toBe(false)
    // 额度还没拿到（网络失败）：不拦发送
    expect(chatQuotaExhausted(null)).toBe(false)
  })

  it('平台关闭对话（enabled=false）：不渲染次数、按禁用处理', () => {
    expect(chatQuotaDisabled({ enabled: false, free: true, daily_limit: 100, remaining: 37 })).toBe(true)
    expect(chatQuotaLabel({ enabled: false, free: true, daily_limit: 100, remaining: 37 }, t)).toBeNull()
    // 额度数据还没拿到（网络失败）：不拦发送，让请求自己去报错
    expect(chatQuotaDisabled(null)).toBe(false)
    expect(chatQuotaDisabled({ enabled: true, free: true, daily_limit: 100, remaining: 37 })).toBe(false)
  })

  it('识别后端「次数用完」：优先 reason，没有码再认中文', () => {
    expect(isChatQuotaExceeded('', { reason: CHAT_QUOTA_EXCEEDED_REASON })).toBe(true)
    expect(isChatQuotaExceeded('please upgrade', { reason: CHAT_QUOTA_EXCEEDED_REASON, daily_limit: 20 })).toBe(true)
    expect(isChatQuotaExceeded('今日 AI 对话次数已用完（100 次），开通会员可无限次使用')).toBe(true)
    expect(isChatQuotaExceeded('今日 AI 对话次数已用完')).toBe(true)
    expect(isChatQuotaExceeded('请选择模型')).toBe(false)
    expect(isChatQuotaExceeded('请选择模型', { reason: 'concurrency' })).toBe(false)
    expect(isChatQuotaExceeded('')).toBe(false)
    expect(isChatQuotaExceeded(null)).toBe(false)
    expect(isChatQuotaExceeded(undefined)).toBe(false)
  })
})
