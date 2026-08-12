import { describe, expect, it } from 'vitest'
import { sidecarCommandSchema, sidecarMessageSchema } from '../electron/pi/sidecarContracts'

describe('sidecar wire contracts', () => {
  it('rejects malformed known commands', () => {
    expect(sidecarCommandSchema.safeParse({ type: 'start_session', cwd: '' }).success).toBe(false)
    expect(sidecarCommandSchema.safeParse({ type: 'get_stats' }).success).toBe(false)
    expect(sidecarCommandSchema.safeParse({ type: 'stop', unexpected: true }).success).toBe(false)
  })

  it('accepts representative valid commands', () => {
    expect(
      sidecarCommandSchema.safeParse({
        type: 'start_session',
        cwd: '/workspace',
        requestId: 'request-1',
        workspaceTrusted: true,
      }).success
    ).toBe(true)
    expect(
      sidecarCommandSchema.safeParse({
        type: 'execute_bash',
        requestId: 'request-2',
        command: 'pwd',
      }).success
    ).toBe(true)
    expect(
      sidecarMessageSchema.safeParse({ type: 'compact_result', requestId: 'request-3' }).success
    ).toBe(true)
  })

  it('rejects malformed known messages and session events', () => {
    expect(sidecarMessageSchema.safeParse({ type: 'session_ready', payload: {} }).success).toBe(
      false
    )
    expect(
      sidecarMessageSchema.safeParse({ type: 'session_event', event: { type: 'queue_update' } })
        .success
    ).toBe(false)
    for (const event of [
      { type: 'message_start' },
      { type: 'message_update', message: {} },
      {
        type: 'tool_execution_end',
        toolCallId: 'tool-1',
        toolName: 'read',
        isError: false,
      },
      { type: 'entry_appended' },
    ]) {
      expect(sidecarMessageSchema.safeParse({ type: 'session_event', event }).success).toBe(false)
    }
  })

  it('preserves extension-defined session event envelopes', () => {
    expect(
      sidecarMessageSchema.safeParse({
        type: 'session_event',
        event: { type: 'extension_custom_event', payload: { value: 1 } },
      }).success
    ).toBe(true)
  })
})
