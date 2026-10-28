## 问题根因

节点选中后弹出的功能框（CanvasInspector / HdPanel / DepthBar / ViralBar / LightPanel / AnglePanel）位置由 `CanvasWorkspace.vue` 里的 `inspectorStyle` 等 computed 算出来，调用链是：

```
inspectorStyle  →  canvasPanelBelowNode(selectedNodeBox(), viewport.value, { paneRect: canvasFlowPaneRect(), ... })
                 →  canvasFlowToClient(viewport, box.x, box.y, pane)
                 →  { x: pane.left + viewport.x + x*z, y: pane.top + viewport.y + y*z }
```

这个 computed **确实读了 `viewport.value`**，理论上应该跟着画布平移/缩放重算。但实际表现是「吸顶/吸底不跟节点走」，根因有两点：

1. **`canvasFlowPaneRect()` 是普通函数，每次调用 `document.querySelector('.canvas-flow').getBoundingClientRect()`**，它不是响应式的。computed 跑一次后，即使 `.canvas-flow` 元素的屏幕位置变了（窗口 resize / 侧栏开合），computed 也不会重算。但它至少在 `viewport.value` 变时重算（因为读了 `viewport.value`）。

2. **真正导致"吸顶/吸底"的是 `canvasPanelBelowNode` 里的 `Math.max(16, ...)` 只夹了下界，没有夹上界**，而且更关键的是——节点滚出画布可视区上下边缘时，算出来的 `top` 会超出画布范围，但 computed 仍然返回这个值，功能框就会出现在画布外（屏幕边缘）。用户看到的"吸顶/吸底"是功能框被节点带到屏幕边缘、节点本身已经看不见了但框还挂着。

按你的要求「完全跟随节点（含出屏）」，正确做法是：**去掉边界夹取，让功能框位置 = 节点屏幕位置 + 偏移，节点出屏时框也跟着出屏（看不见，滚回来才出现）**，同时保证 `viewport` 和 `.canvas-flow` 矩形变化时 computed 真正重算。

## 修改方案

### 改动 1：`app/utils/canvas-panel-layout.ts` — 去掉 `top` 的下界夹取，纯跟随节点

`canvasPanelBelowNode` 第 55 行：
```ts
const top = Math.max(16, origin.y + box.h * z + gap)
```
改为：
```ts
const top = origin.y + box.h * z + gap
```

这样 `top` 完全由节点下缘 + gap 决定，节点滚到屏幕外，`top` 就跟着到屏幕外（`position: fixed` 的元素超出视口就不可见，滚回来自然出现）。`left` 的左右夹取保留（panelW 太宽时不出左右屏），因为左右夹取只是防止宽面板溢出窗口，不影响"上下跟随节点"。

### 改动 2：`app/components/canvas/CanvasWorkspace.vue` — 让 `.canvas-flow` 矩形变化时面板重算

在 `onMounted` 里挂一个 `ResizeObserver` 观察 `.canvas-flow` 元素，用一个 ref（如 `flowPaneRectTick`）触发依赖它的 computed 重算；`onUnmounted` 里断开。这样侧栏开合、窗口 resize 时 `inspectorStyle` 等 computed 会重算（它们都调了 `canvasFlowPaneRect()`）。

具体：
- 新增 `const flowPaneRectTick = ref(0)`
- `onMounted` 里：
  ```ts
  const flowEl = document.querySelector('.canvas-flow') as HTMLElement | null
  if (flowEl) {
    const ro = new ResizeObserver(() => { flowPaneRectTick.value++ })
    ro.observe(flowEl)
    onScopeDispose(() => ro.disconnect())  // 或在 onUnmounted 里 disconnect
  }
  ```
- 在 `inspectorStyle` / `hdPanelStyle` / `depthBarStyle` / `viralBarStyle` / `lightPanelStyle` / `anglePanelStyle` 这些 computed 里开头加一行 `void flowPaneRectTick.value`，让它们依赖这个 tick。

> 说明：实际上 `canvasFlowPaneRect()` 读 `getBoundingClientRect()` 本身在 `viewport.value` 变化时（pan/zoom 触发 computed 重算）会重新读到最新矩形，所以平移/缩放时面板已经会跟节点走。ResizeObserver 主要补的是「画布容器自身尺寸/位置变化但 viewport 没变」的情况（侧栏开合、窗口 resize），保证这些场景下面板也重新对位。

### 改动 3（可选，保守起见）：确认 `viewport.value` 在 pan-on-scroll 时确实更新

经查 `node_modules/@vue-flow/core` 源码，pan-on-scroll 的 wheel handler（vue-flow-core.mjs:8601）里调 `d3Zoom.translateBy(...)`，而 d3-zoom 的 `zoom` 事件回调（vue-flow-core.mjs:8584）里有 `viewport.value = { x: event.transform.x, y: event.transform.y, zoom: event.transform.k }` —— 所以 `viewport.value` 在 pan-on-scroll 期间持续更新，`inspectorStyle` 等 computed 会实时重算。**这一步无需改动**，只是确认链路通畅。

## 验证

- 选中一个节点，功能框出现在节点正下方。
- 用滚轮 / 拖拽平移画布，节点向上滚出屏幕顶部 → 功能框跟着滚出屏幕顶部（看不见），滚回来 → 功能框重新出现在节点下方。
- 节点向下滚出屏幕底部 → 同理。
- 开合右侧对话栏、调整侧栏宽度 → 功能框水平位置重新对齐（ResizeObserver 触发重算）。
- 不影响 HdPanel / DepthBar / ViralBar / LightPanel / AnglePanel（它们共用 `canvasPanelBelowNode`，同样变为纯跟随）。

## 涉及文件

- `app/utils/canvas-panel-layout.ts`（去掉 top 下界夹取）
- `app/components/canvas/CanvasWorkspace.vue`（加 ResizeObserver + tick，让面板 computed 响应画布容器尺寸变化）

不改 CanvasInspector.vue（它只消费 `panelStyle` prop，位置算在 workspace）。