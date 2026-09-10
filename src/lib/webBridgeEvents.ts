type Cb = (payload: unknown) => void

function wsUrlFrom(base: string): string {
  const u = new URL(base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/api/events'
  u.search = ''
  u.hash = ''
  return u.toString()
}

export function createEventBus(base: string): { on: (ch: string, cb: Cb) => () => void } {
  const listeners = new Map<string, Set<Cb>>()
  let ws: WebSocket | null = null
  const url = wsUrlFrom(base)
  const ensure = (): void => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    try {
      ws = new WebSocket(url)
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { event: string; data: unknown }
          const set = listeners.get(msg.event)
          // Isolate listeners: one throwing callback must not starve the rest
          if (set)
            for (const cb of [...set]) {
              try {
                cb(msg.data)
              } catch (e) {
                console.error(
                  '[webBridgeBus] listener threw',
                  msg.event,
                  e instanceof Error ? (e.stack ?? e.message) : String(e).slice(0, 500)
                )
              }
            }
        } catch {
          // ignore
        }
      }
      ws.onclose = () => {
        if (listeners.size > 0) setTimeout(ensure, 2000)
      }
    } catch {
      // ignore
    }
  }
  const on = (ch: string, cb: Cb): (() => void) => {
    let set = listeners.get(ch)
    if (!set) {
      set = new Set()
      listeners.set(ch, set)
    }
    set.add(cb)
    ensure()
    return () => {
      const s = listeners.get(ch)
      if (!s) return
      s.delete(cb)
      if (s.size === 0) listeners.delete(ch)
      if (listeners.size === 0 && ws) {
        try {
          ws.close()
        } catch {
          // ignore
        }
        ws = null
      }
    }
  }
  return { on }
}
