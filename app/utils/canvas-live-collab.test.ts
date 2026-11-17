import { describe, expect, it } from 'vitest'
import { canvasLivePositionUpdates, canvasLiveSocketUrl, parseCanvasLiveMessage } from './canvas-live-collab'

describe('canvas live collab', () => {
  it('builds a websocket url without the token', () => {
    expect(canvasLiveSocketUrl('http://localhost:8383/', 12)).toBe('ws://localhost:8383/user/canvas/12/live')
    expect(canvasLiveSocketUrl('https://api.example.com', 3)).toBe('wss://api.example.com/user/canvas/3/live')
    expect(canvasLiveSocketUrl('http://localhost:8383', 0)).toBe('')
  })

  it('parses presence, cursors and saves', () => {
    const hello = parseCanvasLiveMessage(JSON.stringify({
      op: 'hello',
      user: { id: 1, name: 'Ada', color: '#f59e0b' },
      peers: [{ id: 2, name: 'Bo', color: '#38bdf8' }, { id: 1, name: 'Ada', color: '#f59e0b' }],
    }))
    expect(hello).toMatchObject({ op: 'hello', peers: [{ id: 2, name: 'Bo' }] })
    expect(parseCanvasLiveMessage('{"op":"cursor","id":2,"x":0,"y":4}')).toEqual({ op: 'cursor', id: 2, x: 0, y: 4 })
    expect(parseCanvasLiveMessage('{"op":"saved","id":2,"version":9}')).toEqual({ op: 'saved', id: 2, version: 9 })
    expect(parseCanvasLiveMessage('not-json')).toBeNull()
    expect(parseCanvasLiveMessage('{"op":"nodes","id":2,"items":[{"id":"","x":1,"y":2}]}')).toBeNull()
  })

  it('skips the card this client is dragging', () => {
    const updates = canvasLivePositionUpdates(
      [{ id: 'a', x: 10, y: 20 }, { id: 'b', x: 8, y: 9 }, { id: 'c', x: 1, y: 1 }],
      [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3, y: 4 }],
      new Set(['a']),
    )
    expect(updates).toEqual([{ id: 'b', x: 8, y: 9 }])
  })
})
