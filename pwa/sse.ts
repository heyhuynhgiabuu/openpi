/**
 * pwa/sse — fetch-streaming SSE consumer.
 *
 * Native EventSource cannot set the Authorization header, so the stream is
 * read with fetch + a hand-parsed frame splitter. Frames are `event: <name>`
 * + `data: <json>` pairs separated by a blank line (the server's format).
 * A 401 clears the stored token and emits one `unauthorized` frame instead of
 * retrying forever with a dead credential.
 */
import { clearToken, storedToken } from './api'

export interface SseFrame {
  event: string
  data: unknown
}

/** Incremental SSE parser over text chunks; tolerant of split frames. */
export class SseParser {
  private buffer = ''

  push(chunk: string): SseFrame[] {
    this.buffer += chunk
    const frames: SseFrame[] = []
    let index = this.buffer.indexOf('\n\n')
    while (index !== -1) {
      const block = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 2)
      const frame = parseBlock(block)
      if (frame) frames.push(frame)
      index = this.buffer.indexOf('\n\n')
    }
    return frames
  }
}

function parseBlock(block: string): SseFrame | null {
  let event = 'message'
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue // comment/keepalive
    if (line.startsWith('event: ')) event = line.slice('event: '.length)
    if (line.startsWith('data: ')) data += line.slice('data: '.length)
  }
  if (!data) return null
  try {
    return { event, data: JSON.parse(data) }
  } catch {
    return null
  }
}

/**
 * Opens the event stream and calls `onFrame` for every parsed frame.
 * Returns a closer. Reconnects with backoff while the tab stays visible;
 * the `closed` flag stops the loop after an explicit close.
 */
export function openEventStream(onFrame: (frame: SseFrame) => void): () => void {
  let closed = false
  let controller: AbortController | null = null

  const run = async (): Promise<void> => {
    let backoffMs = 1000
    while (!closed) {
      controller = new AbortController()
      try {
        const token = storedToken()
        if (!token) return
        const response = await fetch('/api/events', {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (response.status === 401) {
          // Revoked or stale pairing: stop retrying and reset to pairing.
          clearToken()
          onFrame({ event: 'unauthorized', data: {} })
          return
        }
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`)
        backoffMs = 1000
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        const parser = new SseParser()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const frame of parser.push(decoder.decode(value))) onFrame(frame)
        }
      } catch {
        // Aborted or dropped; fall through to the backoff.
      }
      if (closed) return
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      backoffMs = Math.min(backoffMs * 2, 15_000)
    }
  }

  void run()
  return () => {
    closed = true
    controller?.abort()
  }
}
