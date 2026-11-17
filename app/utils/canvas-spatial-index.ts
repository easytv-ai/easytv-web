import type { CanvasCullEdge, CanvasCullNode, CanvasCullRect } from './canvas-viewport-cull'

/** 一格大约一张半卡片。停稳后只查视口盖住的格子，不扫整张画布 */
export const CANVAS_CELL = 480
/** 一条线横跨太多格时不铺进格子，单独记成宽线，查询时再测一次 */
const WIDE_CELLS = 48

export type CanvasSpatialEdge = CanvasCullEdge & {
  x: number
  y: number
  w: number
  h: number
}

export type CanvasSpatialIndex = {
  cell: number
  nodes: Map<string, CanvasCullNode>
  edges: Map<string, CanvasSpatialEdge>
  nodeCells: Map<string, string[]>
  edgeCells: Map<string, string[]>
  /** 节点 id → 连到它的线。选中或钉住的卡片在视口外时，它的线也要留着 */
  byNode: Map<string, string[]>
  wideEdges: string[]
}

function cellKey(cx: number, cy: number) {
  return `${cx}:${cy}`
}

function addTo(map: Map<string, string[]>, key: string, id: string) {
  const list = map.get(key)
  if (list)
    list.push(id)
  else
    map.set(key, [id])
}

function cover(x: number, y: number, w: number, h: number, cell: number) {
  const x0 = Math.floor(x / cell)
  const y0 = Math.floor(y / cell)
  const x1 = Math.floor((x + Math.max(w, 0)) / cell)
  const y1 = Math.floor((y + Math.max(h, 0)) / cell)
  return {
    x0,
    y0,
    x1,
    y1,
    span: (x1 - x0 + 1) * (y1 - y0 + 1),
  }
}

function intersects(box: { x: number, y: number, w: number, h: number }, rect: CanvasCullRect) {
  return box.x < rect.right
    && box.x + box.w > rect.left
    && box.y < rect.bottom
    && box.y + box.h > rect.top
}

/** 布局变了才重建。平移只改视口，不重建这张表 */
export function buildCanvasSpatialIndex(
  nodes: CanvasCullNode[],
  edges: CanvasCullEdge[],
  cell = CANVAS_CELL,
): CanvasSpatialIndex {
  const nodeMap = new Map<string, CanvasCullNode>()
  const nodeCells = new Map<string, string[]>()
  for (const node of nodes) {
    nodeMap.set(node.id, node)
    const box = cover(node.x, node.y, node.w, node.h, cell)
    for (let cy = box.y0; cy <= box.y1; cy++) {
      for (let cx = box.x0; cx <= box.x1; cx++)
        addTo(nodeCells, cellKey(cx, cy), node.id)
    }
  }
  const edgeMap = new Map<string, CanvasSpatialEdge>()
  const edgeCells = new Map<string, string[]>()
  const byNode = new Map<string, string[]>()
  const wideEdges: string[] = []
  for (const edge of edges) {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target)
      continue
    const stored: CanvasSpatialEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      x: Math.min(source.x, target.x),
      y: Math.min(source.y, target.y),
      w: Math.abs(source.x - target.x) + Math.max(source.w, target.w),
      h: Math.abs(source.y - target.y) + Math.max(source.h, target.h),
    }
    edgeMap.set(edge.id, stored)
    addTo(byNode, edge.source, edge.id)
    addTo(byNode, edge.target, edge.id)
    const box = cover(stored.x, stored.y, stored.w, stored.h, cell)
    if (box.span > WIDE_CELLS) {
      wideEdges.push(edge.id)
      continue
    }
    for (let cy = box.y0; cy <= box.y1; cy++) {
      for (let cx = box.x0; cx <= box.x1; cx++)
        addTo(edgeCells, cellKey(cx, cy), edge.id)
    }
  }
  return { cell, nodes: nodeMap, edges: edgeMap, nodeCells, edgeCells, byNode, wideEdges }
}

function visitCells(
  index: CanvasSpatialIndex,
  rect: CanvasCullRect,
  map: Map<string, string[]>,
  seen: Set<string>,
  out: string[],
) {
  const cell = index.cell
  const x0 = Math.floor(rect.left / cell)
  const y0 = Math.floor(rect.top / cell)
  const x1 = Math.floor(rect.right / cell)
  const y1 = Math.floor(rect.bottom / cell)
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const list = map.get(cellKey(cx, cy))
      if (!list)
        continue
      for (const id of list) {
        if (seen.has(id))
          continue
        seen.add(id)
        out.push(id)
      }
    }
  }
}

/** 视口（含外扩）盖住的格子里，再精确测一次盒子 */
export function queryCanvasSpatialNodes(index: CanvasSpatialIndex, rect: CanvasCullRect) {
  const ids: string[] = []
  visitCells(index, rect, index.nodeCells, new Set(), ids)
  const hits: CanvasCullNode[] = []
  for (const id of ids) {
    const node = index.nodes.get(id)
    if (node && intersects(node, rect))
      hits.push(node)
  }
  return hits
}

/**
 * 要画的线：两端有一张在视口里，或者线本身穿过视口。
 * 不穿过的线不在这些格子里，查询碰不到它们。
 */
export function queryCanvasSpatialEdges(
  index: CanvasSpatialIndex,
  rect: CanvasCullRect,
  shownNodes: Set<string>,
) {
  const shown = new Set<string>()
  for (const nodeId of shownNodes) {
    const list = index.byNode.get(nodeId)
    if (!list)
      continue
    for (const id of list)
      shown.add(id)
  }
  const ids: string[] = []
  const seen = new Set<string>()
  visitCells(index, rect, index.edgeCells, seen, ids)
  for (const id of index.wideEdges) {
    if (!seen.has(id))
      ids.push(id)
  }
  for (const id of ids) {
    if (shown.has(id))
      continue
    const edge = index.edges.get(id)
    if (edge && intersects(edge, rect))
      shown.add(id)
  }
  return shown
}
