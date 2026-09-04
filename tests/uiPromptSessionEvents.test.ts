import { describe, expect, it } from 'vitest'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../src/lib/extensionUiTypes'
import { createOpenPiExtensionUIContext } from '../electron/pi/extensionUiRpc'
import { fulfillExtensionUiPending } from '../electron/pi/extensionUiPending'

interface RecordedEvent {
  type: string
  kind?: string
  title?: string
}

function makeSinks() {
  const events: RecordedEvent[] = []
  const requests: ExtensionUiRequest[] = []
  return {
    events,
    requests,
    sessionEvent: (event: Record<string, unknown>) => {
      events.push(event as unknown as RecordedEvent)
    },
    postExtensionUiRequest: (request: ExtensionUiRequest) => {
      requests.push(request)
    },
  }
}

/** Resolve the pending request the dialogPromise registered for `id`. */
function resolvePending(id: string, response: Omit<ExtensionUiResponse, 'id'>): boolean {
  return fulfillExtensionUiPending({ id, ...response })
}

describe('extension ui prompt events', () => {
  it('emits ui_prompt_start before and ui_prompt_end after a blocking confirm', async () => {
    const sinks = makeSinks()
    const ctx = createOpenPiExtensionUIContext(sinks)
    const promise = ctx.confirm('Delete file?', '')
    // The start event fires synchronously when the request is posted.
    expect(sinks.events).toHaveLength(1)
    expect(sinks.events[0]?.type).toBe('ui_prompt_start')
    expect(sinks.events[0]?.kind).toBe('confirm')
    expect(sinks.events[0]?.title).toBe('Delete file?')
    expect(sinks.requests[0]?.method).toBe('confirm')

    const requestId = sinks.requests[0]?.id ?? ''
    expect(resolvePending(requestId, { confirmed: true })).toBe(true)
    await expect(promise).resolves.toBe(true)
    expect(sinks.events).toHaveLength(2)
    expect(sinks.events[1]?.type).toBe('ui_prompt_end')
    expect(sinks.events[1]?.kind).toBe('confirm')
  })

  it('emits exactly one start/end pair per select prompt', async () => {
    const sinks = makeSinks()
    const ctx = createOpenPiExtensionUIContext(sinks)
    const promise = ctx.select('Pick one', ['a', 'b'])
    const requestId = sinks.requests[0]?.id ?? ''
    expect(sinks.events[0]?.type).toBe('ui_prompt_start')
    expect(sinks.events[0]?.kind).toBe('select')
    resolvePending(requestId, { value: 'a' })
    await expect(promise).resolves.toBe('a')
    const starts = sinks.events.filter((e) => e.type === 'ui_prompt_start')
    const ends = sinks.events.filter((e) => e.type === 'ui_prompt_end')
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
  })

  it('emits ui_prompt_end when the prompt times out', async () => {
    const sinks = makeSinks()
    const ctx = createOpenPiExtensionUIContext(sinks)
    // No manual fulfillment: the 30ms timer in registerExtensionUiPending fires
    // the real timeout branch (resolve({cancelled:true})).
    const promise = ctx.input('Slow answer', undefined, { timeout: 30 })
    expect(sinks.events[0]?.type).toBe('ui_prompt_start')
    await expect(promise).resolves.toBeUndefined()
    expect(sinks.events.map((e) => e.type)).toEqual(['ui_prompt_start', 'ui_prompt_end'])
  })
})
