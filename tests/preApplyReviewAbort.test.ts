import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionUiRequest } from '../src/lib/extensionUiTypes'
import { createOpenPiExtensionUIContext } from '../electron/pi/extensionUiRpc'
import {
  fulfillExtensionUiPending,
  rejectAllExtensionUiPending,
} from '../electron/pi/extensionUiPending'
import { handleToolCall } from '../.pi/extensions/openpi-preapply-review/index'

interface DialogOptions {
  signal?: AbortSignal
  timeout?: number
}

interface ContextOptions {
  input?: (
    title: string,
    placeholder?: string,
    options?: DialogOptions
  ) => Promise<string | undefined>
}

function createContext(options: ContextOptions = {}) {
  const confirm = vi.fn(async (_title: string, _message: string, _options?: DialogOptions) => false)
  const input = vi.fn(options.input ?? (async () => '{"approved":[0]}'))
  const notify = vi.fn()
  return {
    confirm,
    input,
    ctx: {
      cwd: '/workspace',
      ui: { confirm, input, notify },
    },
  }
}

afterEach(() => {
  rejectAllExtensionUiPending('test cleanup')
  delete process.env.OPENPI_BRIDGE_APP
})

describe('pre-apply review cancellation', () => {
  it('passes the tool-call abort signal to the hunk review dialog', async () => {
    process.env.OPENPI_BRIDGE_APP = 'openpi'
    const controller = new AbortController()
    const { ctx, input } = createContext()

    await handleToolCall(
      {
        toolName: 'edit',
        input: {
          path: 'src/App.tsx',
          edits: [{ oldText: 'before\n', newText: 'after\n' }],
        },
      },
      { ...ctx, signal: controller.signal }
    )

    expect(input.mock.calls[0]?.[2]?.signal).toBe(controller.signal)
  })

  it('passes the tool-call abort signal to whole-file confirmation', async () => {
    const controller = new AbortController()
    const { confirm, ctx } = createContext()

    await handleToolCall(
      { toolName: 'write', input: { path: 'file.txt', content: 'content\n' } },
      { ...ctx, signal: controller.signal }
    )

    expect(confirm.mock.calls[0]?.[2]?.signal).toBe(controller.signal)
  })

  it('denies promptly and closes the pending review when the run is aborted', async () => {
    process.env.OPENPI_BRIDGE_APP = 'openpi'
    const controller = new AbortController()
    const requests: ExtensionUiRequest[] = []
    const sessionEvent = vi.fn()
    const ui = createOpenPiExtensionUIContext({
      sessionEvent,
      postExtensionUiRequest: (request) => requests.push(request),
    })
    const pending = handleToolCall(
      {
        toolName: 'edit',
        input: {
          path: 'src/App.tsx',
          edits: [{ oldText: 'before\n', newText: 'after\n' }],
        },
      },
      { cwd: '/workspace', signal: controller.signal, ui }
    )
    const request = requests[0]
    if (!request) throw new Error('Expected a pending review request')

    controller.abort()

    const outcome = await Promise.race([
      pending.then((value) => ({ kind: 'resolved' as const, value })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'timeout' }), 250)
      }),
    ])
    if (outcome.kind === 'timeout') {
      rejectAllExtensionUiPending('test timeout')
      await pending.catch(() => undefined)
    }
    expect(outcome.kind).toBe('resolved')
    if (outcome.kind === 'resolved') {
      expect(outcome.value?.block).toBe(true)
      expect(sessionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ui_prompt_end', id: request.id })
      )
      expect(fulfillExtensionUiPending({ id: request.id, cancelled: true })).toBe(false)
    }
  })
})
